// Regresión del bug «sesión anónima → libro de muestra → iniciar
// sesión»: la estantería solo mostraba la muestra y ni «Sincronizar»
// recuperaba los libros de la cuenta.
//
// Cubre la mitad local del flujo con el módulo idb real (IndexedDB se
// simula con un Map por base, como en idb-scope.test.ts): la muestra
// migra a la base de la cuenta y el pull de la era user-books/
// descarga en la base dueña del contexto — nunca en la anónima.
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY_PATHS: Record<string, string> = {
  books: "hash",
  positions: "bookHash",
  savedWords: "key",
  annotations: "key",
  activity: "id",
  reviews: "id",
  knowledge: "key",
  readingEvents: "id",
  bookOps: "id",
  companionEvents: "id",
  companionReceipts: "id",
  lexiconCache: "key",
};

class FakeDb {
  stores = new Map<string, Map<unknown, unknown>>();
  closed = false;
  private storeFor(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }
  get(name: string, key: unknown) {
    return Promise.resolve(this.storeFor(name).get(key));
  }
  getAll(name: string) {
    return Promise.resolve([...this.storeFor(name).values()]);
  }
  getAllKeys(name: string) {
    return Promise.resolve([...this.storeFor(name).keys()]);
  }
  put(name: string, value: unknown, key?: unknown) {
    const k = key ?? (value as Record<string, unknown>)[KEY_PATHS[name]];
    this.storeFor(name).set(k, value);
    return Promise.resolve(k);
  }
  delete(name: string, key: unknown) {
    this.storeFor(name).delete(key);
    return Promise.resolve();
  }
  transaction() {
    const pending: (() => void)[] = [];
    let aborted = false;
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        getAll: () => this.getAll(name),
        getAllKeys: () => this.getAllKeys(name),
        put: (value: unknown, key?: unknown) => {
          if (aborted) return Promise.reject(new Error("tx abortada"));
          pending.push(() => void this.put(name, value, key));
          return Promise.resolve(
            key ?? (value as Record<string, unknown>)[KEY_PATHS[name]],
          );
        },
        delete: (key: unknown) => {
          pending.push(() => this.delete(name, key));
          return Promise.resolve();
        },
        clear: () => {
          pending.push(() => this.storeFor(name).clear());
          return Promise.resolve();
        },
      }),
      abort() {
        aborted = true;
        pending.length = 0;
      },
      get done() {
        if (!aborted) pending.forEach((run) => run());
        return Promise.resolve();
      },
    };
  }
  close() {
    this.closed = true;
  }
}

const disk = new Map<string, FakeDb>();
const dbFor = (name: string) => {
  let db = disk.get(name);
  if (!db) {
    db = new FakeDb();
    disk.set(name, db);
  }
  return db;
};

vi.mock("idb", () => ({
  openDB: vi.fn(async (name: string) => dbFor(name)),
}));

// Un solo resetModules: idb y reading-sync comparten registro, así el
// pull corre sobre la MISMA instancia de módulo (mismo activeUserId,
// mismo dbPromise) que el test prepara.
const freshModules = async () => {
  vi.resetModules();
  const idb = await import("./idb");
  const sync = await import("./reading-sync");
  return { idb, sync };
};

beforeEach(() => {
  disk.clear();
  vi.unstubAllGlobals();
});

const SAMPLE = {
  hash: "ab".repeat(32),
  name: "Azul… — Rubén Darío.epub",
  data: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
  addedAt: 1,
};

describe("anónimo → muestra → login", () => {
  it("el libro de muestra migra a la cuenta y la estantería lo lista", async () => {
    const { idb } = await freshModules();
    const anonScope = idb.captureDbScope();
    await idb.saveBook({ ...SAMPLE }, anonScope);

    await idb.setDbUser("u1");
    const userScope = idb.captureDbScope();

    const books = await idb.listStoredBooks(userScope);
    expect(books.map((b) => b.hash)).toContain(SAMPLE.hash);
    expect([...disk.get("lecta")!.stores.get("books")!.keys()]).toEqual([]);
  });

  it("un saveBook tardío con contexto anónimo vencido aterriza en la cuenta", async () => {
    const { idb } = await freshModules();
    const anonScope = idb.captureDbScope();
    await idb.setDbUser("u1");
    // La migración ya cerró: anonymousHeir apunta a u1 y el contexto
    // anónimo vencido escribe en la base dueña.
    await idb.saveBook({ ...SAMPLE }, anonScope);
    const books = await idb.listStoredBooks(idb.captureDbScope());
    expect(books.map((b) => b.hash)).toContain(SAMPLE.hash);
  });

  it("pullMissingUserBooksFromCloud descarga los libros que faltan en la cuenta", async () => {
    const { idb, sync } = await freshModules();
    await idb.setDbUser("u1");
    const scope = idb.captureDbScope();
    const remoteHash = "cd".repeat(32);
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/file")) {
          return new Response(new Uint8Array([9, 9, 9]).buffer, {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            books: [
              { id: remoteHash, title: "Libro nube", author: "Autor", updatedAt: 7 },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const downloaded = await sync.pullMissingUserBooksFromCloud(scope);

    expect(downloaded).toBe(1);
    const books = await idb.listStoredBooks(scope);
    expect(books.map((b) => b.hash)).toContain(remoteHash);
    expect(requested.some((u) => u === "/api/user/books")).toBe(true);
    expect(
      requested.some((u) => u === `/api/user/books/${remoteHash}/file`),
    ).toBe(true);
  });

  it("el pull salta libros que ya están locales", async () => {
    const { idb, sync } = await freshModules();
    await idb.setDbUser("u1");
    const scope = idb.captureDbScope();
    await idb.saveBook({ ...SAMPLE }, scope);
    const downloads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/file")) downloads.push(url);
        return new Response(
          JSON.stringify({
            books: [
              { id: SAMPLE.hash, title: "Muestra", author: "", updatedAt: 2 },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const downloaded = await sync.pullMissingUserBooksFromCloud(scope);
    expect(downloaded).toBe(0);
    expect(downloads).toEqual([]);
  });

  it("el pull con contexto vencido no escribe en la base nueva", async () => {
    const { idb, sync } = await freshModules();
    await idb.setDbUser("u1");
    const stale = idb.captureDbScope();
    // Otra identidad toma el control antes de que corra el pull.
    await idb.setDbUser("u2");
    let called = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        called += 1;
        return new Response(JSON.stringify({ books: [] }), { status: 200 });
      }),
    );
    const downloaded = await sync.pullMissingUserBooksFromCloud(stale);
    expect(downloaded).toBe(0);
    expect(called).toBe(0);
  });

  it("el pull sin sesión no toca la red", async () => {
    const { idb, sync } = await freshModules();
    const anon = idb.captureDbScope();
    let called = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      }),
    );
    expect(await sync.pullMissingUserBooksFromCloud(anon)).toBe(0);
    expect(called).toBe(0);
  });
});
