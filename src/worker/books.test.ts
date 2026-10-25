import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import type { WorkerEnv } from "./db";
import * as dbModule from "./db";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return {
    ...actual,
    getSession: (...args: unknown[]) => getSessionMock(...args),
    getSessionUser: async (...args: unknown[]) => {
      const s = await getSessionMock(...args);
      return s?.user ?? null;
    },
  };
});

describe("Cloud Books & Storage Quotas (/api/books)", () => {
  const minimalPath = resolve(__dirname, "../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));
  let minimalHash = "";

  let mockBucket: {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let r2Objects: Map<string, { body: ArrayBuffer; customMetadata?: Record<string, string>; uploaded?: Date }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", minimalBytes));
    minimalHash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");

    r2Objects = new Map();
    mockBucket = {
      put: vi.fn(async (key: string, data: ArrayBuffer, opts?: { customMetadata?: Record<string, string> }) => {
        r2Objects.set(key, { body: data, customMetadata: opts?.customMetadata, uploaded: new Date() });
        return {};
      }),
      get: vi.fn(async (key: string) => {
        const obj = r2Objects.get(key);
        if (!obj) return null;
        return {
          body: obj.body,
          customMetadata: obj.customMetadata,
          arrayBuffer: async () => obj.body,
        };
      }),
      delete: vi.fn(async (key: string) => {
        r2Objects.delete(key);
      }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => {
        const matching = Array.from(r2Objects.entries())
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, val]) => ({
            key,
            uploaded: val.uploaded ?? new Date(),
            customMetadata: val.customMetadata,
          }));
        return { objects: matching };
      }),
    };
  });

  it("GET /api/books devuelve metadatos inmediatos sin invocar r2.get() en el camino crítico", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-quick" } });

    // Libro sin metadatos en customMetadata
    r2Objects.set(`books/user-quick/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: {},
      uploaded: new Date("2026-10-24T10:00:00Z"),
    });

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<{ hash: string; name: string; title: string }> };
    expect(json.books).toHaveLength(1);
    expect(json.books[0].hash).toBe(minimalHash);
    expect(json.books[0].title).toBe(`Libro ${minimalHash.slice(0, 8)}`);

    // El camino crítico responde sin invocar r2.get()
    expect(mockBucket.get).not.toHaveBeenCalled();
  });

  it("POST /api/books rechaza con 413 si el usuario supera el límite de 100 libros", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-quota-books" } });

    vi.spyOn(dbModule, "withClient").mockImplementationOnce(async (_env, callback) => {
      return callback({
        query: vi.fn().mockResolvedValue({
          rows: [{ total_bytes: 10_000_000, book_count: 100 }],
        }),
      } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      "/api/books",
      {
        method: "POST",
        body: minimalBytes.buffer,
      },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Storage quota exceeded");
    expect(mockBucket.put).not.toHaveBeenCalled();
  });

  it("PUT /api/books/:hash rechaza con 413 si el usuario supera la cuota de 500 MB", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-quota-bytes" } });

    vi.spyOn(dbModule, "withClient").mockImplementationOnce(async (_env, callback) => {
      return callback({
        query: vi.fn().mockResolvedValue({
          rows: [{ total_bytes: 500 * 1024 * 1024, book_count: 5 }],
        }),
      } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      `/api/books/${minimalHash}`,
      {
        method: "PUT",
        body: minimalBytes.buffer,
      },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Storage quota exceeded");
    expect(mockBucket.put).not.toHaveBeenCalled();
  });

  it("PUT /api/books/:hash guarda el libro en R2 y registra en user_books cuando está dentro de la cuota", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-valid" } });

    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) {
        return Promise.resolve({ rows: [{ total_bytes: 1000, book_count: 1 }] });
      }
      return Promise.resolve({ rowCount: 1 });
    });

    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({
        query: queryMock,
      } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      `/api/books/${minimalHash}?title=El%20Quijote&author=Cervantes`,
      {
        method: "PUT",
        body: minimalBytes.buffer,
      },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );

    expect(res.status).toBe(200);
    expect(mockBucket.put).toHaveBeenCalledWith(
      `books/user-valid/${minimalHash}.epub`,
      expect.any(Uint8Array),
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          title: "El Quijote",
          author: "Cervantes",
        }),
      }),
    );

    // Registro en user_books
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_books"),
      expect.arrayContaining(["user-valid", minimalHash]),
    );
  });

  it("DELETE /api/books/:hash borra de R2 y de la tabla user_books", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-del" } });

    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({
        query: queryMock,
      } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      `/api/books/${minimalHash}`,
      { method: "DELETE" },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );

    expect(res.status).toBe(200);
    expect(mockBucket.delete).toHaveBeenCalledWith(`books/user-del/${minimalHash}.epub`);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM user_books"),
      ["user-del", minimalHash],
    );
  });
});
