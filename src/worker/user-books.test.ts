import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import { loadEpubBufferForKindle } from "./kindle/routes";
import type { WorkerEnv } from "./db";

// Bloque 2 (docs/designs/2026-11-12-planes-y-landing.md): las rutas con gating
// consultan el plan con loadUserPlan. Por defecto la cuenta es fundadora, así
// la consulta no pasa por withClient ni consume los mocks de la base.
const loadUserPlanMock = vi.hoisted(() =>
  vi.fn(async () => ({
    plan: "founder_lifetime" as const,
    starterCoat: null,
    expiresAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    degraded: false,
  })),
);
vi.mock("./plan-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plan-store")>()),
  loadUserPlan: loadUserPlanMock,
}));


const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionUser: async (...args: unknown[]) => {
    const s = await getSessionMock(...args);
    return s?.user ?? null;
  },
}));

// Almacén pg en memoria (Bloque 2, docs/designs/2026-11-12-planes-y-landing.md):
// withClient ejecuta el callback con un cliente que entiende las formas de
// SQL que tocan estas rutas. Sin rama D1: el env ya no lleva DB.
const pgStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());

function pgQuery(sql: string, params: unknown[] = []): { rows: Record<string, unknown>[] } {
  const text = sql.replace(/\s+/g, " ").trim();
  const rowsOf = (userId: unknown) =>
    [...pgStore.values()].filter((row) => row.user_id === userId);
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(text)) return { rows: [] };
  if (text.includes("lecta_account_state")) return { rows: [] };
  if (text.startsWith("INSERT INTO user_books")) {
    const cols = text.slice(text.indexOf("(") + 1, text.indexOf(")")).split(",").map((c) => c.trim());
    const values = text.slice(text.indexOf("VALUES (") + 8, text.indexOf(")", text.indexOf("VALUES ("))).split(",").map((v) => v.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      const v = values[i];
      row[col] = /^\$\d+$/.test(v) ? params[Number(v.slice(1)) - 1] : v === "true" ? true : v === "false" ? false : v === "''" ? "" : Number(v);
    });
    const key = `${row.user_id}:${row.book_id}`;
    const prev = pgStore.get(key);
    if (prev && row.has_file === false) {
      // /meta sobre una fila existente: solo metadatos, nunca r2_key,
      // size_bytes ni has_file (igual que su DO UPDATE).
      pgStore.set(key, { ...prev, title: row.title, author: row.author, language: row.language });
    } else {
      pgStore.set(key, { has_file: true, ...prev, ...row });
    }
    return { rows: [] };
  }
  if (text.includes("SUM(size_bytes)")) {
    const rows = rowsOf(params[0]).filter((row) => row.book_id !== params[1]);
    return {
      rows: [
        {
          total_bytes: rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
          book_count: rows.length,
        },
      ],
    };
  }
  if (text.startsWith("SELECT r2_key")) {
    const row = pgStore.get(`${params[0]}:${params[1]}`);
    return { rows: row ? [{ r2_key: row.r2_key, title: row.title }] : [] };
  }
  if (text.includes("SELECT book_id AS id")) {
    return {
      rows: rowsOf(params[0])
        .filter((row) => !text.includes("has_file = true") || row.has_file !== false)
        .map((row) => ({
          id: row.book_id,
          title: row.title,
          author: row.author,
          sizebytes: row.size_bytes ?? 0,
          sha256: row.sha256 ?? "",
          updatedat: row.updated_at ?? 0,
        })),
    };
  }
  if (text.includes("r2_key NOT LIKE")) {
    return {
      rows: rowsOf(params[0])
        .filter((row) => !String(row.r2_key ?? "").startsWith("books/"))
        .filter((row) => !text.includes("has_file = true") || row.has_file !== false)
        .map((row) => ({ ...row, language: row.language ?? "" })),
    };
  }
  if (text.includes("has_file = false")) {
    return {
      rows: rowsOf(params[0])
        .filter((row) => row.has_file === false)
        .map((row) => ({ ...row, language: row.language ?? "" })),
    };
  }
  if (text.includes("paper_only = true")) {
    return { rows: rowsOf(params[0]).filter((row) => row.paper_only === true) };
  }
  if (text.includes("SELECT book_id, shared, paper_only")) {
    return {
      rows: rowsOf(params[0]).map((row) => ({
        book_id: row.book_id,
        shared: row.shared ?? false,
        paper_only: row.paper_only ?? false,
        genre: row.genre ?? "",
      })),
    };
  }
  return { rows: [] };
}

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getConnectionString: () => "postgres://mock",
    withClient: async (
      _env: unknown,
      run: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>,
    ) => run({ query: async (sql: string, params?: unknown[]) => pgQuery(sql, params) }),
  };
});

interface UserBookRecord {
  user_id: string;
  book_id: string;
  title: string;
  author: string;
  language?: string;
  r2_key?: string;
  size_bytes?: number;
  sha256?: string;
  created_at?: number;
  updated_at?: number;
}

describe("User Books Cloud Sync (pg en memoria, R2, Kindle fallback)", () => {
  const minimalPath = resolve(__dirname, "../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  let mockBucket: unknown;
  const store = {
    set: (key: string, row: UserBookRecord) => pgStore.set(key, { has_file: true, ...row }),
    has: (key: string) => pgStore.has(key),
    get: (key: string) => pgStore.get(key),
  };
  let r2Store: Map<string, ArrayBuffer>;

  beforeEach(() => {
    vi.clearAllMocks();
    pgStore.clear();
    loadUserPlanMock.mockResolvedValue({
      plan: "founder_lifetime",
      starterCoat: null,
      expiresAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      degraded: false,
    });
    r2Store = new Map();

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
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        objects: [...r2Store.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({
            key,
            uploaded: new Date(1000),
            customMetadata: {
              title: "Título del objeto",
              author: "Autor",
              name: "titulo.epub",
              sections: "3",
              language: "es",
              hasCover: "false",
            },
          })),
      })),
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
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
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
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(400);
  });

  it("PUT /api/user/books/:bookId/file guarda el EPUB en R2 y en user_books", async () => {
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
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; bookId: string };
    expect(json.ok).toBe(true);
    expect(json.bookId).toBe("book-abc");

    // Verificar en R2
    expect(r2Store.has("user-books/user-1/book-abc.epub")).toBe(true);
    // Verificar en la base (pg en memoria)
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
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
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
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    const downloaded = await res.arrayBuffer();
    expect(downloaded.byteLength).toBe(minimalBytes.byteLength);
  });

  it("loadEpubBufferForKindle no sirve el catálogo y resuelve libros de user_books", async () => {
    // 1. El catálogo no es camino del portal Kindle (ni con slug ni con hash)
    const catHash = "c".repeat(64);
    r2Store.set("catalog/cat-book.epub", minimalBytes.buffer as ArrayBuffer);
    r2Store.set(`catalog/${catHash}.epub`, minimalBytes.buffer as ArrayBuffer);
    for (const id of ["cat-book", catHash]) {
      const fromCat = await loadEpubBufferForKindle(
        { BOOKS: mockBucket as WorkerEnv["BOOKS"] } as WorkerEnv,
        "user-1",
        id,
      );
      expect(fromCat).toBeNull();
    }

    // 2. Desde user_books
    const myHash = "d".repeat(64);
    store.set(`user-1:${myHash}`, {
      user_id: "user-1",
      book_id: myHash,
      title: "My Book",
      author: "Author",
      r2_key: `user-books/user-1/${myHash}.epub`,
    });
    r2Store.set(`user-books/user-1/${myHash}.epub`, minimalBytes.buffer as ArrayBuffer);

    const fromUser = await loadEpubBufferForKindle(
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] } as WorkerEnv,
      "user-1",
      myHash,
    );
    expect(fromUser).not.toBeNull();
  });

  // Regresión: libros de la era user-books/ — la fila user_books existe
  // pero el archivo no está bajo books/{userId}/. Antes del puente,
  // GET /api/books no los veía y la estantería parecía vacía.
  const LEGACY_HASH = "ab".repeat(32);

  const seedLegacyBook = () => {
    store.set(`user-1:${LEGACY_HASH}`, {
      user_id: "user-1",
      book_id: LEGACY_HASH,
      title: "Libro de la era vieja",
      author: "Autor Viejo",
      language: "es",
      r2_key: `user-books/user-1/${LEGACY_HASH}.epub`,
      updated_at: 5000,
    });
    r2Store.set(
      `user-books/user-1/${LEGACY_HASH}.epub`,
      minimalBytes.buffer as ArrayBuffer,
    );
  };

  it("GET /api/books lista libros cuyo archivo vive en user-books/", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    seedLegacyBook();

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      books: Array<{ hash: string; title: string }>;
    };
    const entry = json.books.find((b) => b.hash === LEGACY_HASH);
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Libro de la era vieja");
  });

  it("GET /api/books/:hash descarga el EPUB guardado en user-books/", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    seedLegacyBook();

    const res = await app.request(
      `/api/books/${LEGACY_HASH}`,
      { method: "GET" },
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    const downloaded = await res.arrayBuffer();
    expect(downloaded.byteLength).toBe(minimalBytes.byteLength);
  });

  it("GET /api/books no duplica un libro que también está en books/", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    seedLegacyBook();
    // El mismo hash también tiene objeto moderno: gana la lista de R2.
    r2Store.set(
      `books/user-1/${LEGACY_HASH}.epub`,
      minimalBytes.buffer as ArrayBuffer,
    );

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<{ hash: string }> };
    expect(json.books.filter((b) => b.hash === LEGACY_HASH)).toHaveLength(1);
  });

  it("GET /api/books/:hash sirve primero el objeto de books/ si existe", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    seedLegacyBook();
    const modernBytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    r2Store.set(`books/user-1/${LEGACY_HASH}.epub`, modernBytes.buffer);

    const res = await app.request(
      `/api/books/${LEGACY_HASH}`,
      { method: "GET" },
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

    expect(res.status).toBe(200);
    const downloaded = new Uint8Array(await res.arrayBuffer());
    expect(downloaded.byteLength).toBe(modernBytes.byteLength);
    expect(downloaded[4]).toBe(1);
  });

  // ---- Bloque 2: libros propios solo con metadatos (027) y gating ----
  const META_HASH = "cd".repeat(32);
  const putMeta = (body: Record<string, unknown>, hash = META_HASH) =>
    app.request(
      `/api/user/books/${hash}/meta`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { BOOKS: mockBucket as WorkerEnv["BOOKS"] },
    );

  it("PUT /meta registra la fila sin archivo (gratis, con sesión)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    loadUserPlanMock.mockResolvedValue({ ...(await loadUserPlanMock()), plan: "free" as never });
    const res = await putMeta({ title: "Mi libro", author: "Yo", language: "es", sha256: META_HASH });
    expect(res.status).toBe(200);
    expect(store.get(`user-1:${META_HASH}`)).toMatchObject({ r2_key: "", has_file: false, size_bytes: 0 });
  });

  it("PUT /meta rechaza un sha256 distinto del libro y no escribe", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    const res = await putMeta({ title: "x", sha256: "ef".repeat(32) });
    expect(res.status).toBe(400);
    expect(store.has(`user-1:${META_HASH}`)).toBe(false);
  });

  it("PUT /meta sin sesión responde 401", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await putMeta({ sha256: META_HASH });
    expect(res.status).toBe(401);
  });

  it("PUT /meta nunca pisa r2_key ni has_file de una fila con archivo", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    store.set(`user-1:${META_HASH}`, {
      user_id: "user-1",
      book_id: META_HASH,
      title: "Viejo",
      author: "A",
      r2_key: `books/user-1/${META_HASH}.epub`,
      size_bytes: 999,
    });
    const res = await putMeta({ title: "Nuevo", author: "B", sha256: META_HASH });
    expect(res.status).toBe(200);
    expect(store.get(`user-1:${META_HASH}`)).toMatchObject({
      title: "Nuevo",
      r2_key: `books/user-1/${META_HASH}.epub`,
      size_bytes: 999,
      has_file: true,
    });
  });

  it("PUT /meta respeta el tope de libros de la cuenta (413)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    for (let i = 0; i < 100; i += 1) {
      store.set(`user-1:b${i}`, { user_id: "user-1", book_id: `b${i}`, title: "t", author: "a" });
    }
    const res = await putMeta({ sha256: META_HASH });
    expect(res.status).toBe(413);
  });

  it("GET /api/books lista los libros sin archivo con hasFile: false y sin duplicar", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    await putMeta({ title: "Solo metadatos", sha256: META_HASH });
    const res = await app.request("/api/books", { method: "GET" }, { BOOKS: mockBucket as WorkerEnv["BOOKS"] });
    const json = (await res.json()) as { books: Array<{ hash: string; hasFile?: boolean }> };
    const entries = json.books.filter((b) => b.hash === META_HASH);
    expect(entries).toHaveLength(1);
    expect(entries[0].hasFile).toBe(false);
  });

  it("GET /api/user/books excluye las filas sin archivo", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    await putMeta({ title: "Solo metadatos", sha256: META_HASH });
    const res = await app.request("/api/user/books", { method: "GET" }, { BOOKS: mockBucket as WorkerEnv["BOOKS"] });
    const json = (await res.json()) as { books: Array<{ id: string }> };
    expect(json.books.some((b) => b.id === META_HASH)).toBe(false);
  });

  it("una cuenta free recibe 402 al subir o bajar binarios", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    loadUserPlanMock.mockResolvedValue({ ...(await loadUserPlanMock()), plan: "free" as never });
    const env = { BOOKS: mockBucket as WorkerEnv["BOOKS"] };
    const put = await app.request("/api/user/books/b1/file", { method: "PUT", body: minimalBytes.buffer }, env);
    const get = await app.request("/api/user/books/b1/file", { method: "GET" }, env);
    const getBook = await app.request(`/api/books/${LEGACY_HASH}`, { method: "GET" }, env);
    for (const res of [put, get, getBook]) {
      expect(res.status).toBe(402);
      expect(((await res.json()) as { code: string }).code).toBe("LECTA_PLUS_REQUIRED");
    }
  });
});
