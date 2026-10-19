import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import { loadEpubBufferForKindle } from "./kindle/routes";
import type { WorkerEnv } from "./db";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionUser: async (...args: unknown[]) => {
    const s = await getSessionMock(...args);
    return s?.user ?? null;
  },
}));

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getConnectionString: () => "postgres://mock",
  };
});

interface UserBookRecord {
  user_id: string;
  book_id: string;
  title: string;
  author: string;
  r2_key?: string;
  size_bytes?: number;
  sha256?: string;
  created_at?: number;
  updated_at?: number;
}

describe("User Books Cloud Sync (D1, R2, Kindle fallback)", () => {
  const minimalPath = resolve(__dirname, "../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  let mockDb: unknown;
  let mockBucket: unknown;
  let store: Map<string, UserBookRecord>;
  let r2Store: Map<string, ArrayBuffer>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map();
    r2Store = new Map();

    mockDb = {
      prepare: vi.fn((sql: string) => {
        let boundParams: unknown[] = [];
        const stmt = {
          bind: (...params: unknown[]) => {
            boundParams = params;
            return stmt;
          },
          first: vi.fn(async () => {
            if (sql.includes("SUM(size_bytes)")) {
              let total = 0;
              for (const item of store.values()) {
                if (item.user_id === boundParams[0] && item.book_id !== boundParams[1]) {
                  total += item.size_bytes ?? 0;
                }
              }
              return { total };
            }
            if (sql.includes("SELECT r2_key")) {
              const [userId, bookId] = boundParams as [string, string];
              const item = store.get(`${userId}:${bookId}`);
              return item ? { r2_key: item.r2_key, title: item.title } : null;
            }
            return null;
          }),
          all: vi.fn(async () => {
            if (sql.includes("SELECT book_id AS id")) {
              const [userId] = boundParams as [string];
              const results = Array.from(store.values())
                .filter((v) => v.user_id === userId)
                .map((v) => ({
                  id: v.book_id,
                  title: v.title,
                  author: v.author,
                  sizeBytes: v.size_bytes,
                  sha256: v.sha256,
                  updatedAt: v.updated_at,
                }));
              return { results };
            }
            return { results: [] };
          }),
          run: vi.fn(async () => {
            if (sql.includes("INSERT INTO user_books")) {
              const [userId, bookId, title, author, r2Key, sizeBytes, sha256, createdAt, updatedAt] =
                boundParams as [string, string, string, string, string, number, string, number, number];
              store.set(`${userId}:${bookId}`, {
                user_id: userId,
                book_id: bookId,
                title,
                author,
                r2_key: r2Key,
                size_bytes: sizeBytes,
                sha256,
                created_at: createdAt,
                updated_at: updatedAt,
              });
              return { success: true };
            }
            return { success: true };
          }),
        };
        return stmt;
      }),
    };

    mockBucket = {
      put: vi.fn(async (key: string, data: ArrayBuffer) => {
        r2Store.set(key, data);
      }),
      get: vi.fn(async (key: string) => {
        const data = r2Store.get(key);
        if (!data) return null;
        return {
          body: data,
          arrayBuffer: async () => data,
        };
      }),
    };
  });

  it("PUT /api/user/books/:bookId/file rechaza peticiones no autenticadas", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await app.request(
      "/api/user/books/b1/file",
      {
        method: "PUT",
        body: minimalBytes.buffer,
      },
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(401);
  });

  it("PUT /api/user/books/:bookId/file rechaza archivos no EPUB", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await app.request(
      "/api/user/books/b1/file",
      {
        method: "PUT",
        body: new Uint8Array([1, 2, 3, 4]).buffer,
      },
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(400);
  });

  it("PUT /api/user/books/:bookId/file guarda el EPUB en R2 y D1", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await app.request(
      "/api/user/books/book-abc/file",
      {
        method: "PUT",
        headers: {
          "x-book-title": encodeURIComponent("Mi libro propio"),
          "x-book-author": encodeURIComponent("Autor"),
        },
        body: minimalBytes.buffer,
      },
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; bookId: string };
    expect(json.ok).toBe(true);
    expect(json.bookId).toBe("book-abc");

    // Verificar en R2
    expect(r2Store.has("user-books/user-1/book-abc.epub")).toBe(true);
    // Verificar en D1
    expect(store.has("user-1:book-abc")).toBe(true);
  });

  it("GET /api/user/books lista los libros del usuario", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    store.set("user-1:b1", {
      user_id: "user-1",
      book_id: "b1",
      title: "Libro 1",
      author: "Autor 1",
      size_bytes: 1234,
      sha256: "hash1",
      updated_at: 1000,
    });

    const res = await app.request(
      "/api/user/books",
      { method: "GET" },
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<{ id: string; title: string }> };
    expect(json.books).toHaveLength(1);
    expect(json.books[0].id).toBe("b1");
    expect(json.books[0].title).toBe("Libro 1");
  });

  it("GET /api/user/books/:bookId/file descarga el binario EPUB", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    store.set("user-1:b1", {
      user_id: "user-1",
      book_id: "b1",
      title: "Libro 1",
      author: "Autor 1",
      r2_key: "user-books/user-1/b1.epub",
    });
    r2Store.set("user-books/user-1/b1.epub", minimalBytes.buffer as ArrayBuffer);

    const res = await app.request(
      "/api/user/books/b1/file",
      { method: "GET" },
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    const downloaded = await res.arrayBuffer();
    expect(downloaded.byteLength).toBe(minimalBytes.byteLength);
  });

  it("loadEpubBufferForKindle resuelve desde catálogo y con fallback a user_books", async () => {
    // 1. Desde catálogo
    r2Store.set("catalog/cat-book.epub", minimalBytes.buffer as ArrayBuffer);
    const fromCat = await loadEpubBufferForKindle(
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] } as WorkerEnv,
      "user-1",
      "cat-book",
    );
    expect(fromCat).not.toBeNull();

    // 2. Desde user_books en D1
    store.set("user-1:my-book", {
      user_id: "user-1",
      book_id: "my-book",
      title: "My Book",
      author: "Author",
      r2_key: "user-books/user-1/my-book.epub",
    });
    r2Store.set("user-books/user-1/my-book.epub", minimalBytes.buffer as ArrayBuffer);

    const fromUser = await loadEpubBufferForKindle(
      { DB: mockDb as WorkerEnv["DB"], BOOKS: mockBucket as WorkerEnv["BOOKS"] } as WorkerEnv,
      "user-1",
      "my-book",
    );
    expect(fromUser).not.toBeNull();
  });
});
