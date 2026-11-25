import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import type { WorkerEnv } from "./db";
import * as dbModule from "./db";

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
  let r2Objects: Map<string, { body: ArrayBuffer; customMetadata?: Record<string, string>; uploaded?: Date; httpMetadata?: { contentType?: string } }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", minimalBytes));
    minimalHash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");

    r2Objects = new Map();
    mockBucket = {
      put: vi.fn(async (key: string, data: ArrayBuffer, opts?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } }) => {
        r2Objects.set(key, { body: data, customMetadata: opts?.customMetadata, httpMetadata: opts?.httpMetadata, uploaded: new Date() });
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
      // Igual que R2 con compatibility_date >= 2022-08-04: list() solo trae
      // customMetadata si se pide en `include`.
      list: vi.fn(async ({ prefix, include }: { prefix: string; include?: string[] }) => {
        const matching = Array.from(r2Objects.entries())
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, val]) => ({
            key,
            uploaded: val.uploaded ?? new Date(),
            customMetadata: include?.includes("customMetadata") ? val.customMetadata : undefined,
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
    expect(json.books[0].title).toBe("");
    expect(json.books[0].title).not.toContain("Libro");

    // El camino crítico responde sin invocar r2.get()
    expect(mockBucket.get).not.toHaveBeenCalled();
  });

  it("GET /api/books lee los metadatos de R2 y no vuelve a reparar un libro con título", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-titled" } });
    r2Objects.set(`books/user-titled/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: { title: "Marianela", author: "Galdós", hasCover: "true" },
      uploaded: new Date("2026-10-24T10:00:00Z"),
    });
    const waitUntil = vi.fn();

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"] },
      { waitUntil, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<{ title: string; hasCover: boolean }> };
    expect(json.books[0].title).toBe("Marianela");
    expect(json.books[0].hasCover).toBe(true);
    // Sin customMetadata en la lista, cada GET reescribía el EPUB y la portada
    // en R2 y la fila de user_books (bucle visto en producción el 2026-11-24).
    expect(waitUntil).not.toHaveBeenCalled();
    expect(mockBucket.put).not.toHaveBeenCalled();
  });

  it("POST /api/books rechaza con 413 si el usuario supera el límite de 100 libros", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-quota-books" } });

    // La guardia de reinicio consume la primera consulta (lee reset_at, que
    // esta fila no trae → 0) y la segunda es la de cuota.
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
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

    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
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

  it("GET /api/books repara de forma perezosa hasta 5 libros y marca repairAttemptedAt", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-repair" } });

    r2Objects.set(`books/user-repair/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: { title: "Libro 12345678" },
      uploaded: new Date(),
    });

    const waitUntilPromises: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    };

    const res = await app.request(
      "/api/books",
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"], DATABASE_URL: "postgres://mock" },
      executionCtx as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { books: Array<{ title: string; hash: string }> };
    expect(json.books[0].title).toBe("");

    expect(waitUntilPromises.length).toBe(1);
    await Promise.all(waitUntilPromises);

    // Verifica que put fue llamado marcando repairAttemptedAt
    expect(mockBucket.put).toHaveBeenCalledWith(
      `books/user-repair/${minimalHash}.epub`,
      expect.any(Uint8Array),
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          repairAttemptedAt: expect.any(String),
        }),
      }),
    );
  });

  it("ciclo completo de portadas: PUT /api/books/:hash/cover y GET /api/books/:hash/cover", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-cov" } });

    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({ query: queryMock } as unknown as Parameters<typeof callback>[0]);
    });

    const fakeCover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // magic jpeg
    const putRes = await app.request(
      `/api/books/${minimalHash}/cover`,
      {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: fakeCover,
      },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );
    expect(putRes.status).toBe(200);
    expect(mockBucket.put).toHaveBeenCalledWith(
      `covers/user-cov/${minimalHash}.jpg`,
      expect.any(Uint8Array),
      expect.objectContaining({ httpMetadata: { contentType: "image/jpeg" } }),
    );

    r2Objects.set(`covers/user-cov/${minimalHash}.jpg`, {
      body: fakeCover.buffer as ArrayBuffer,
      customMetadata: {},
      httpMetadata: { contentType: "image/jpeg" },
      uploaded: new Date(),
    });

    const getRes = await app.request(
      `/api/books/${minimalHash}/cover`,
      { method: "GET" },
      { BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"] },
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toContain("immutable");
  });

  it("POST /api/books/:hash/repair devuelve metadatos reparados de inmediato", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-rep-direct" } });

    r2Objects.set(`books/user-rep-direct/${minimalHash}.epub`, {
      body: minimalBytes.buffer as ArrayBuffer,
      customMetadata: {},
      uploaded: new Date(),
    });

    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({ query: queryMock } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      `/api/books/${minimalHash}/repair`,
      { method: "POST" },
      {
        BOOKS: mockBucket as unknown as WorkerEnv["BOOKS"],
        DATABASE_URL: "postgres://mock",
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string; author: string };
    expect(json.title).toBe("Libro de prueba");
    expect(json.author).toBe("Equipo Lecta");
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
    expect(mockBucket.delete).toHaveBeenCalledWith(`covers/user-del/${minimalHash}.jpg`);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM user_books"),
      ["user-del", minimalHash],
    );
  });
});
