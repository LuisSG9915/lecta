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

// Biblioteca comunitaria «solo papel» (migración 024): compartir marca
// la fila `user_books`; el catálogo deduplica por book_id; adjuntar
// copia el objeto R2 del donante y crea la copia con paper_only.
describe("Biblioteca comunitaria (/api/books/community + /share)", () => {
  const minimalPath = resolve(__dirname, "../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));
  let minimalHash = "";

  let mockBucket: {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let r2Objects: Map<
    string,
    { body: ArrayBuffer; customMetadata?: Record<string, string>; uploaded?: Date }
  >;

  const stubDb = (impl: (sql: string, params?: unknown[]) => Promise<unknown>) => {
    const queryMock = vi.fn(impl);
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({ query: queryMock } as unknown as Parameters<typeof callback>[0]);
    });
    return queryMock;
  };

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
      list: vi.fn(async () => ({ objects: [] })),
    };
  });

  it("PUT /api/books/:hash/share exige sesión", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      { method: "PUT" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"] },
    );
    expect(res.status).toBe(401);
  });

  it("PUT /share marca shared en la fila del dueño (y nadie más)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-dueno" } });
    const queryMock = stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("UPDATE user_books")) return { rowCount: 1 };
      return { rows: [] };
    });

    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      { method: "PUT" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; shared: boolean };
    expect(json).toEqual({ ok: true, shared: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET shared"),
      expect.arrayContaining(["user-dueno", minimalHash, true]),
    );
  });

  it("DELETE /share retira la marca; libro ajeno responde 404", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-dueno" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      return { rowCount: 0, rows: [] };
    });
    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      { method: "DELETE" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(404);
  });

  it("share responde 503 amable si falta la columna (pre-migración 024)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-dueno" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      const err = new Error("column shared does not exist") as Error & { code: string };
      err.code = "42703";
      throw err;
    });
    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      { method: "PUT" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("comunidad");
  });

  it("GET /community deduplica por book_id y exige sesión", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const anon = await app.request("/api/books/community", { method: "GET" }, {});
    expect(anon.status).toBe(401);

    getSessionMock.mockResolvedValue({ user: { id: "user-lector" } });
    stubDb(async () => ({
      rows: [
        {
          book_id: minimalHash,
          title: "El Quijote",
          author: "Cervantes",
          language: "es",
          size_bytes: 12345,
          has_cover: true,
          shared_at: 1000,
          sharers: 3,
        },
      ],
    }));
    const res = await app.request(
      "/api/books/community",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<Record<string, unknown>> };
    expect(json.books).toHaveLength(1);
    expect(json.books[0]).toMatchObject({
      hash: minimalHash,
      title: "El Quijote",
      sharers: 3,
      hasCover: true,
    });
  });

  it("GET /community con columna ausente devuelve lista vacía, no 500", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-lector" } });
    stubDb(async () => {
      const err = new Error("column shared does not exist") as Error & { code: string };
      err.code = "42703";
      throw err;
    });
    const res = await app.request(
      "/api/books/community",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: unknown[] };
    expect(json.books).toEqual([]);
  });

  it("POST /community/:hash/attach copia el EPUB del donante y crea fila paper_only", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-nuevo" } });

    r2Objects.set(`books/user-donor/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: { title: "El Quijote", author: "Cervantes" },
      uploaded: new Date(),
    });

    const queryMock = stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("FROM user_books") && sql.includes("shared = true")) {
        return {
          rows: [
            {
              user_id: "user-donor",
              r2_key: `books/user-donor/${minimalHash}.epub`,
              title: "El Quijote",
              author: "Cervantes",
              language: "es",
              size_bytes: minimalBytes.byteLength,
              sha256: minimalHash,
              has_cover: false,
            },
          ],
        };
      }
      if (sql.includes("SELECT 1 FROM user_books")) return { rows: [] };
      if (sql.includes("total_bytes")) return { rows: [{ total_bytes: 0, book_count: 0 }] };
      if (sql.includes("INSERT INTO user_books")) return { rowCount: 1 };
      return { rows: [] };
    });

    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; hash: string };
    expect(json).toEqual({ ok: true, hash: minimalHash });

    // La copia quedó en las llaves del usuario nuevo, no del donante.
    expect(mockBucket.put).toHaveBeenCalledWith(
      `books/user-nuevo/${minimalHash}.epub`,
      expect.any(Uint8Array),
      expect.objectContaining({
        customMetadata: expect.objectContaining({ paperOnly: "true" }),
      }),
    );
    // La fila nace con paper_only=true y shared=false.
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_books"),
    );
    expect(insertCall?.[0]).toContain("paper_only");
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining(["user-nuevo", minimalHash]),
    );
  });

  it("POST /attach a un libro que no está compartido responde 404", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-nuevo" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(404);
  });

  it("POST /attach sobre el propio libro compartido responde 409", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-donor" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("shared = true")) {
        return {
          rows: [
            {
              user_id: "user-donor",
              r2_key: `books/user-donor/${minimalHash}.epub`,
              title: "T",
              author: "",
              language: "es",
              size_bytes: 1,
              sha256: minimalHash,
              has_cover: false,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(409);
    // No se copió nada a R2.
    expect(mockBucket.put).not.toHaveBeenCalled();
  });

  it("GET /api/books fusiona flags shared/paperOnly de la fila", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-flags" } });
    mockBucket.list = vi.fn(async () => ({
      objects: [
        {
          key: `books/user-flags/${minimalHash}.epub`,
          uploaded: new Date(),
          customMetadata: { title: "Mi libro" },
        },
      ],
    }));
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("book_id, shared, paper_only")) {
        return { rows: [{ book_id: minimalHash, shared: true, paper_only: false }] };
      }
      return { rows: [] };
    });

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      books: Array<{ hash: string; shared?: boolean; paperOnly?: boolean }>;
    };
    expect(json.books[0].shared).toBe(true);
    expect(json.books[0].paperOnly).toBeUndefined();
  });
});
