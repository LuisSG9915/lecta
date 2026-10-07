// Pruebas de la capa de IO del juego: el journal idempotente, la
// proyección que ve la UI, los créditos de logro como recepciones y
// los registros de perfil. IndexedDB se simula con el mismo Map por
// base que idb-scope.test.ts; el resto del módulo corre de verdad.
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

  // Transacción simulada: las escrituras quedan en espera hasta
  // `done`; `abort` las descarta, como IDB real.
  transaction() {
    const pending: (() => void)[] = [];
    let aborted = false;
    return {
      objectStore: (name: string) => ({
        get: (key: unknown) => this.get(name, key),
        // Lee solo lo confirmado: los puts del mismo tx todavía no se
        // ven, así que el código no puede depender de releer lo que
        // acaba de encolar.
        getAll: () => this.getAll(name),
        getAllKeys: () => this.getAllKeys(name),
        put: (value: unknown, key?: unknown) => {
          if (aborted) return Promise.reject(new Error("tx abortada"));
          pending.push(() => {
            void this.put(name, value, key);
          });
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

const freshModules = async () => {
  vi.resetModules();
  const idb = await import("./idb");
  const game = await import("./game");
  return { idb, game };
};

const T0 = new Date("2025-06-10T12:00:00").getTime();
const meta = (id: string, at = T0) => ({ id, at, dayKey: "2025-06-10" });

beforeEach(() => {
  disk.clear();
});

describe("award y el journal", () => {
  it("persiste el evento y la proyección suma su XP", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.award({ kind: "read", ms: 60_000 }, scope, meta("read:i1"));

    const events = await idb.listCompanionEvents(scope);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "read:i1",
      at: T0,
      dayKey: "2025-06-10",
      streakBonus: false,
      event: { kind: "read", ms: 60_000 },
    });

    // La proyección que ve la UI sale del journal: 1 minuto = 1 punto.
    const state = await game.loadGame(scope);
    expect(state.xp).toBeCloseTo(1);
    expect(state.stats.minutes).toBeCloseTo(1);
  });

  it("un award duplicado con el mismo id no suma dos veces", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.award({ kind: "read", ms: 60_000 }, scope, meta("read:i1"));
    await game.award({ kind: "read", ms: 60_000 }, scope, meta("read:i1"));

    expect(await idb.listCompanionEvents(scope)).toHaveLength(1);
    expect((await game.loadGame(scope)).xp).toBeCloseTo(1);
  });

  it("book_finished da un solo crédito por hash aunque llegue dos veces", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    // Dos ocurrencias del mismo libro con event ids distintos (p. ej.
    // dos dispositivos o un re-disparo del efecto del lector).
    await game.award(
      { kind: "book_finished", bookHash: "h1" },
      scope,
      meta("book:h1:a", T0),
    );
    await game.award(
      { kind: "book_finished", bookHash: "h1" },
      scope,
      meta("book:h1:b", T0 + 1),
    );

    const events = await idb.listCompanionEvents(scope);
    expect(events).toHaveLength(2);
    const byId = new Map(events.map((e) => [e.id, e]));
    // El primero quedó elegible; el segundo ya veía el libro terminado.
    expect(byId.get("book:h1:a")?.bookCreditEligible).toBe(true);
    expect(byId.get("book:h1:b")?.bookCreditEligible).toBe(false);

    const state = await game.loadGame(scope);
    // 50 del libro terminado + 80 del logro «libro_1» que descubrió:
    // el segundo evento del mismo hash no volvió a acreditar.
    expect(state.xp).toBeCloseTo(130);
    expect(state.stats.booksFinished).toBe(1);
    expect(state.finishedBooks).toEqual(["h1"]);
    const receipts = await idb.listCompanionReceipts(scope);
    expect(receipts).toEqual([
      { id: "achievement-credit:libro_1", at: T0 },
    ]);
  });

  it("los logros alcanzados se sellan como receipts y aparecen en la proyección", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.award(
      { kind: "saved", zipf: null },
      scope,
      meta("saved:es:casa:1"),
    );

    const receipts = await idb.listCompanionReceipts(scope);
    expect(receipts).toEqual([
      { id: "achievement-credit:palabra_1", at: T0 },
    ]);

    const state = await game.loadGame(scope);
    // 3 por guardar + 10 del logro «palabra_1» del catálogo.
    expect(state.xp).toBeCloseTo(13);
    expect(state.achievements.palabra_1).toBe(T0);
    expect(
      state.chests.some((c) => c.id === "achievement:palabra_1"),
    ).toBe(true);
  });

  it("un premio sobre baseline migrado suma encima de lo heredado", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    dbFor("lecta").stores.set(
      "session",
      new Map([
        [
          "gameState",
          JSON.stringify({
            version: 1,
            xp: 40,
            stats: {
              minutes: 40,
              longestSessionMin: 20,
              consulted: 0,
              saved: 0,
              rareSaved: 0,
              reviews: 0,
              booksFinished: 0,
              streakDays: 0,
              lastDayKey: null,
            },
            achievements: {},
            chests: [],
            finishedBooks: [],
            caredAt: T0 - 1000,
          }),
        ],
      ]),
    );

    await game.award({ kind: "consulted" }, scope, meta("consult:c1"));

    // El award selló el v1 como baseline y el evento suma encima.
    const baselines = await idb.readCompanionBaselines(scope);
    expect(Object.values(baselines)).toHaveLength(1);
    expect((await game.loadGame(scope)).xp).toBeCloseTo(42);
  });

  it("con el juego apagado no se registra nada", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.saveGameEnabled(false, scope);

    await game.award({ kind: "read", ms: 60_000 }, scope, meta("read:i1"));

    expect(await idb.listCompanionEvents(scope)).toHaveLength(0);
    expect(await idb.listCompanionReceipts(scope)).toHaveLength(0);
    expect(await game.loadGameEnabled(scope)).toBe(false);
    // Y el opt-out v1 quedó escrito para clientes anteriores.
    expect(await idb.loadSessionValue("companion", scope)).toBe("0");
  });

  it("mismo id con hechos distintos no reescribe el journal", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.award({ kind: "read", ms: 60_000 }, scope, meta("read:i1"));
    // Mismo id, otro payload: award aborta en silencio y lo guardado
    // queda intacto (tampoco duplica).
    await game.award(
      { kind: "read", ms: 60_000 },
      scope,
      meta("read:i1", T0 + 999),
    );

    const events = await idb.listCompanionEvents(scope);
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(T0);

    // La vía explícita sí informa el conflicto al llamador.
    await expect(
      idb.appendCompanionEvents(
        [
          {
            version: 1,
            id: "read:i1",
            at: T0 + 5,
            dayKey: "2025-06-10",
            streakBonus: false,
            event: { kind: "consulted" },
          },
        ],
        scope,
      ),
    ).rejects.toThrow("companion event conflict");
    expect(await idb.listCompanionEvents(scope)).toHaveLength(1);
  });
});

describe("recepciones y cofres", () => {
  it("openGameChest sella la apertura con la clave canónica", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    // Un cofre de logro en la proyección: primero el crédito.
    await game.award(
      { kind: "saved", zipf: null },
      scope,
      meta("saved:es:casa:1"),
    );
    await game.openGameChest("achievement:palabra_1", scope);

    const receipts = await idb.listCompanionReceipts(scope);
    expect(
      receipts.some((r) => r.id === "chest-open:achievement:palabra_1"),
    ).toBe(true);
    const state = await game.loadGame(scope);
    const chest = state.chests.find((c) => c.id === "achievement:palabra_1");
    expect(chest?.openedAt).not.toBeNull();
  });

  it("mergeCompanionReceipts conserva el menor sello por id", async () => {
    const { idb } = await freshModules();
    const scope = idb.captureDbScope();
    await idb.mergeCompanionReceipts(
      [{ id: "achievement-seen:palabra_1", at: 500 }],
      scope,
    );
    await idb.mergeCompanionReceipts(
      [
        { id: "achievement-seen:palabra_1", at: 900 },
        { id: "achievement-seen:palabra_1", at: 300 },
      ],
      scope,
    );
    const receipts = await idb.listCompanionReceipts(scope);
    expect(receipts).toEqual([{ id: "achievement-seen:palabra_1", at: 300 }]);
  });
});

describe("registros del perfil", () => {
  it("un null nuevo gana sobre la prenda vieja", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    await game.writeCompanionField("equipped.neck", "bufanda", scope);
    let reg = await game.readCompanionField("equipped.neck", scope);
    expect(reg?.value).toBe("bufanda");

    await game.writeCompanionField("equipped.neck", null, scope);
    reg = await game.readCompanionField("equipped.neck", scope);
    // El null quedó como dato explícito con sello mayor, no borró el
    // registro.
    expect(reg?.value).toBeNull();
    expect(reg!.updatedAt).toBeGreaterThan(0);
  });

  it("el nombre se lee con default «Gato»", async () => {
    const { idb, game } = await freshModules();
    const scope = idb.captureDbScope();
    expect(await game.loadCompanionName(scope)).toBe("Gato");
    await game.writeCompanionField("name", "Misifus", scope);
    expect(await game.loadCompanionName(scope)).toBe("Misifus");
  });
});
