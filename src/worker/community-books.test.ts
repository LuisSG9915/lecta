import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import type { WorkerEnv } from "./db";
import * as dbModule from "./db";
import type { PaperBookGuide } from "../shared/paper-guide";

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

const sampleGuide = (hash: string): PaperBookGuide => ({
  version: 1,
  bookHash: hash,
  title: "El Quijote",
  author: "Cervantes",
  language: "es",
  updatedAt: 1,
  chapters: [
    {
      id: "cap/uno.xhtml",
      label: "Capítulo uno",
      depth: 0,
      kind: "chapter",
      forms: ["antigua", "casa", "perenne"],
      capitalOnly: [],
    },
  ],
});

// Biblioteca comunitaria «solo papel» (modelo A1): compartir marca la
// fila `user_books` y sube la GUÍA de papel a `guides/{hash}.json`;
// adjuntar NO copia el EPUB — crea la fila paper_only (size_bytes=0) y
// devuelve la guía en la respuesta.
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

  const donorRow = () => ({
    user_id: "user-donor",
    title: "El Quijote",
    author: "Cervantes",
    language: "es",
  });

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
          json: async () => JSON.parse(new TextDecoder().decode(obj.body)),
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

  it("PUT /share con guía la guarda validada en guides/{hash}.json", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-dueno" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("UPDATE user_books")) return { rowCount: 1 };
      return { rows: [] };
    });

    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guide: {
            ...sampleGuide(minimalHash),
            // Campo ajeno al contrato: debe ser descartado al guardar.
            text: "oración del libro que jamás viaja",
          },
        }),
      },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);

    const key = `guides/${minimalHash}.json`;
    expect(r2Objects.has(key)).toBe(true);
    const rawBody = r2Objects.get(key)!.body;
    const stored = JSON.parse(
      typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody),
    ) as Record<string, unknown>;
    expect(stored.text).toBeUndefined();
    expect(stored.bookHash).toBe(minimalHash);
  });

  it("PUT /share con guía malformada responde 400 y no escribe", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-dueno" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      return { rows: [] };
    });

    const res = await app.request(
      `/api/books/${minimalHash}/share`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guide: { version: 1, bookHash: "otro" } }),
      },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(400);
    expect(r2Objects.has(`guides/${minimalHash}.json`)).toBe(false);
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

  it("GET /community deduplica por book_id, exige sesión y no promete portada", async () => {
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
      // A1: jamás portada del donante — la tipográfica es del cliente.
      hasCover: false,
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

  it("POST /community/:hash/attach devuelve la guía y crea fila paper_only SIN copiar EPUB", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-nuevo" } });

    // El donante tiene su EPUB privado y la guía publicada.
    r2Objects.set(`books/user-donor/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: { title: "El Quijote" },
      uploaded: new Date(),
    });
    r2Objects.set(`guides/${minimalHash}.json`, {
      body: new TextEncoder().encode(JSON.stringify(sampleGuide(minimalHash)))
        .buffer as ArrayBuffer,
      uploaded: new Date(),
    });

    const queryMock = stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("FROM user_books") && sql.includes("shared = true")) {
        return { rows: [donorRow()] };
      }
      if (sql.includes("SELECT 1 FROM user_books")) return { rows: [] };
      if (sql.includes("INSERT INTO user_books")) return { rowCount: 1 };
      return { rows: [] };
    });

    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      hash: string;
      guide: PaperBookGuide;
    };
    expect(json.ok).toBe(true);
    expect(json.hash).toBe(minimalHash);
    expect(json.guide.chapters[0].forms).toContain("casa");

    // A1: ningún EPUB se escribió en el espacio del usuario nuevo — ni
    // el del donante se leyó para copiar (solo guides/ se consultó).
    for (const [key] of r2Objects) {
      expect(key.startsWith(`books/user-nuevo/`)).toBe(false);
    }
    const getCalls = mockBucket.get.mock.calls.map(([key]) => String(key));
    expect(getCalls).toEqual([`guides/${minimalHash}.json`]);
    expect(getCalls.some((k) => k.endsWith(".epub"))).toBe(false);

    // La fila nace paper_only con la guía como r2_key y sin bytes.
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_books"),
    );
    expect(insertCall?.[0]).toContain("paper_only");
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining([
        "user-nuevo",
        minimalHash,
        "El Quijote",
        `guides/${minimalHash}.json`,
        0,
      ]),
    );
  });

  it("POST /attach sin guía publicada responde 404 (libro compartido viejo)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-nuevo" } });
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("shared = true")) return { rows: [donorRow()] };
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(404);
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
        return { rows: [donorRow()] };
      }
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/community/${minimalHash}/attach`,
      { method: "POST" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(409);
    expect(mockBucket.put).not.toHaveBeenCalled();
  });

  it("GET /api/books/:hash/guide sirve la guía a quien tiene la fila o si está compartida", async () => {
    r2Objects.set(`guides/${minimalHash}.json`, {
      body: new TextEncoder().encode(JSON.stringify(sampleGuide(minimalHash)))
        .buffer as ArrayBuffer,
      uploaded: new Date(),
    });
    getSessionMock.mockResolvedValue({ user: { id: "user-con-guia" } });
    stubDb(async (sql: string) => {
      if (sql.includes("book_id, shared, paper_only")) {
        return { rows: [{ book_id: minimalHash, shared: false, paper_only: true }] };
      }
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/${minimalHash}/guide`,
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const guide = (await res.json()) as PaperBookGuide;
    expect(guide.bookHash).toBe(minimalHash);
  });

  it("GET /api/books/:hash/guide sin fila ni libro compartido responde 404", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-ajeno" } });
    stubDb(async () => ({ rows: [] }));
    const res = await app.request(
      `/api/books/${minimalHash}/guide`,
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/books/:hash niega la descarga del EPUB en filas paper_only", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-lector" } });
    // Aun con un objeto en su llave (no debería existir), la fila manda.
    r2Objects.set(`books/user-lector/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      uploaded: new Date(),
    });
    stubDb(async (sql: string) => {
      if (sql.includes("book_id, shared, paper_only")) {
        return { rows: [{ book_id: minimalHash, shared: false, paper_only: true }] };
      }
      return { rows: [] };
    });
    const res = await app.request(
      `/api/books/${minimalHash}`,
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/books incluye entradas paper_only sin objeto R2", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-flags" } });
    mockBucket.list = vi.fn(async () => ({ objects: [] }));
    stubDb(async (sql: string) => {
      if (sql.includes("reset_at")) return { rows: [{ reset_at: 0 }] };
      if (sql.includes("book_id, shared, paper_only")) {
        return { rows: [{ book_id: minimalHash, shared: false, paper_only: true }] };
      }
      if (sql.includes("AND paper_only = true")) {
        return {
          rows: [
            {
              book_id: minimalHash,
              title: "El Quijote",
              author: "Cervantes",
              language: "es",
              created_at: 1000,
            },
          ],
        };
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
      books: Array<{ hash: string; paperOnly?: boolean; hasCover?: boolean }>;
    };
    expect(json.books).toHaveLength(1);
    expect(json.books[0].hash).toBe(minimalHash);
    expect(json.books[0].paperOnly).toBe(true);
    expect(json.books[0].hasCover).toBe(false);
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

  it("GET /community/:hash/cover siempre 404 (portada tipográfica en el cliente)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-lector" } });
    const res = await app.request(
      `/api/books/community/${minimalHash}/cover`,
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(404);
  });
});
