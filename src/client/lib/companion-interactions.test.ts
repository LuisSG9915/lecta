// Pruebas del controlador de cuidado: una acción a la vez, el
// temporizador real con cleanup, la cancelación limpia, el movimiento
// reducido inmediato y la constancia «lastCare» — jamás un cambio de
// XP, racha, logros o estadísticas. IndexedDB se simula con el mismo
// Map por base que game.test.ts; el resto del módulo corre de verdad.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const care = await import("./companion-interactions");
  return { idb, game, care };
};

const T0 = new Date("2025-06-10T12:00:00").getTime();
const meta = (id: string, at = T0) => ({ id, at, dayKey: "2025-06-10" });

beforeEach(() => {
  disk.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startCare", () => {
  it("solo permite una acción a la vez y libera al terminar", async () => {
    vi.useFakeTimers();
    const { idb, care } = await freshModules();
    const scope = idb.captureDbScope();

    const first = care.startCare("pet", { scope, now: () => T0 });
    expect(first).not.toBeNull();
    expect(first!.pose).toBe("pet");
    // Mientras corre, las nuevas se rechazan — la UI deshabilita.
    expect(care.startCare("feed", { scope })).toBeNull();
    expect(care.startCare("play", { scope })).toBeNull();

    await vi.advanceTimersByTimeAsync(care.CARE_DURATIONS.pet);
    await first!.promise;

    // Terminó: la siguiente acción ya puede arrancar.
    const next = care.startCare("play", { scope });
    expect(next).not.toBeNull();
    next!.cancel();
    await expect(next!.promise).rejects.toThrow("cancel");
  });

  it("escribe lastCare al terminar, con el sello del inicio", async () => {
    vi.useFakeTimers();
    const { idb, game, care } = await freshModules();
    const scope = idb.captureDbScope();

    const handle = care.startCare("feed", { scope, now: () => T0 });
    // Antes del timeout no hay constancia todavía.
    await vi.advanceTimersByTimeAsync(care.CARE_DURATIONS.feed - 1);
    expect(await game.readCompanionField("lastCare", scope)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await handle!.promise;
    const reg = await game.readCompanionField("lastCare", scope);
    expect(reg?.value).toEqual({ kind: "feed", at: T0 });
  });

  it("cancelar limpia el temporizador y rechaza sin fingir éxito", async () => {
    vi.useFakeTimers();
    const { idb, game, care } = await freshModules();
    const scope = idb.captureDbScope();

    const handle = care.startCare("play", { scope });
    handle!.cancel();
    await expect(handle!.promise).rejects.toThrow("cancel");
    // El temporizador quedó limpio: avanzar el tiempo no escribe nada.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await game.readCompanionField("lastCare", scope)).toBeUndefined();
    // Y la siguiente acción puede arrancar de inmediato.
    const next = care.startCare("pet", { scope });
    expect(next).not.toBeNull();
    next!.cancel();
    await expect(next!.promise).rejects.toThrow();
  });

  it("con movimiento reducido la pose es estática y persiste de inmediato", async () => {
    const { idb, game, care } = await freshModules();
    const scope = idb.captureDbScope();

    const handle = care.startCare("pet", {
      scope,
      reducedMotion: true,
      now: () => T0,
    });
    expect(handle).not.toBeNull();
    await handle!.promise;
    const reg = await game.readCompanionField("lastCare", scope);
    expect(reg?.value).toEqual({ kind: "pet", at: T0 });
  });

  it("un fallo de persistencia llega como error real, no como éxito", async () => {
    const { idb, care } = await freshModules();
    const scope = idb.captureDbScope();
    const boom = new Error("db caída");

    const handle = care.startCare("pet", {
      scope,
      reducedMotion: true,
      persist: () => Promise.reject(boom),
    });
    await expect(handle!.promise).rejects.toBe(boom);
    // La acción se liberó pese al error: el siguiente intento corre.
    const next = care.startCare("pet", {
      scope,
      reducedMotion: true,
      persist: () => Promise.resolve(),
    });
    expect(next).not.toBeNull();
    await next!.promise;
  });

  it("el cuidado jamás toca XP, racha, logros ni estadísticas", async () => {
    vi.useFakeTimers();
    const { idb, game, care } = await freshModules();
    const scope = idb.captureDbScope();

    // Estado con actividad real: lectura que suma XP y racha.
    await game.award({ kind: "read", ms: 120_000 }, scope, meta("read:i1"));
    const before = await game.loadGame(scope);

    const handle = care.startCare("pet", { scope, now: () => T0 });
    await vi.advanceTimersByTimeAsync(care.CARE_DURATIONS.pet);
    await handle!.promise;

    const after = await game.loadGame(scope);
    // La proyección del juego quedó idéntica: el cuidado no suma XP
    // ni mueve racha, logros, cofres o estadísticas.
    expect(after).toEqual(before);
    // Solo el registro del perfil cambió.
    const reg = await game.readCompanionField("lastCare", scope);
    expect(reg?.value).toEqual({ kind: "pet", at: T0 });
  });
});

describe("companionGreeting", () => {
  it("un gato dormido extrañó; uno con sueño se alegra al verte", async () => {
    const { care } = await freshModules();
    const noon = new Date("2025-06-10T12:00:00");
    expect(care.companionGreeting("Michi", "asleep", noon)).toContain(
      "te extrañó",
    );
    expect(care.companionGreeting("Michi", "sleepy", noon)).toContain(
      "tenía sueño",
    );
    // Nunca hay culpa: el dormido se despereza contento, no reclama.
    expect(care.companionGreeting("Michi", "asleep", noon)).toContain(
      "despereza",
    );
  });

  it("el gato despierto saluda según la hora del día", async () => {
    const { care } = await freshModules();
    const at = (h: number) => new Date(2025, 5, 10, h, 0, 0);
    expect(care.companionGreeting("Michi", "awake", at(4))).toContain(
      "madrugada",
    );
    expect(care.companionGreeting("Michi", "awake", at(9))).toContain(
      "buenos días",
    );
    expect(care.companionGreeting("Michi", "awake", at(15))).toContain(
      "acompaña",
    );
    expect(care.companionGreeting("Michi", "awake", at(22))).toContain(
      "de noche",
    );
  });
});

describe("cleanCompanionName", () => {
  it("acepta 1–24 caracteres Unicode, normaliza trim/NFC", async () => {
    const { care } = await freshModules();
    expect(care.cleanCompanionName("  Misifus  ")).toBe("Misifus");
    expect(care.cleanCompanionName("ñandú")).toBe("ñandú");
    expect(care.cleanCompanionName("X")).toBe("X");
    expect(care.cleanCompanionName("a".repeat(24))).toBe("a".repeat(24));
    expect(care.cleanCompanionName("a".repeat(25))).toBeNull();
    expect(care.cleanCompanionName("   ")).toBeNull();
    expect(care.cleanCompanionName("")).toBeNull();
    expect(care.cleanCompanionName("ga\u0007to")).toBeNull();
  });
});

describe("afinidad y saludo contextual (Fase 3)", () => {
  it("incrementa y lee el nivel de afinidad bondLevel en localStorage", async () => {
    const { care } = await freshModules();
    const storage: Record<string, string> = {};
    const win = {
      localStorage: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => {
          storage[k] = v;
        },
        removeItem: (k: string) => {
          delete storage[k];
        },
      },
    };
    (globalThis as unknown as { window: typeof win }).window = win;
    try {
      expect(care.getCompanionBondLevel()).toBe(0);

      const next = care.incrementCompanionBondLevel(3);
      expect(next).toBe(3);
      expect(care.getCompanionBondLevel()).toBe(3);
    } finally {
      delete (globalThis as unknown as { window?: typeof win }).window;
    }
  });

  it("genera saludos contextuales inteligentes según libro y racha", async () => {
    const { care } = await freshModules();
    const gBook = care.getCompanionContextualGreeting("Michi", 0, "Don Quijote");
    expect(gBook).toContain("Don Quijote");

    const gStreak = care.getCompanionContextualGreeting("Michi", 7);
    expect(gStreak).toContain("7");

    const gDefault = care.getCompanionContextualGreeting("Michi", 0);
    expect(typeof gDefault).toBe("string");
    expect(gDefault.length).toBeGreaterThan(0);
  });

  it("handleCompanionZoneAction responde adecuadamente a caricias, boop y choca la patita", async () => {
    const { care } = await freshModules();

    // Zona 1: Cabeza (toque corto y caricia prolongada)
    const tapHead = care.handleCompanionZoneAction("head", "tap");
    expect(tapHead.zone).toBe("head");
    expect(tapHead.reactionMood).toBe("happy");
    expect(tapHead.hapticPattern).toBe(15);

    const petHead = care.handleCompanionZoneAction("head", "pet");
    expect(petHead.zone).toBe("head");
    expect(petHead.reactionMood).toBe("purring");
    expect(petHead.reactionPose).toBe("pet");
    expect(petHead.message).toContain("Mrrr");

    // Zona 2: Nariz ("¡Boop!")
    const boopNose = care.handleCompanionZoneAction("nose", "boop");
    expect(boopNose.zone).toBe("nose");
    expect(boopNose.reactionMood).toBe("curious");
    expect(boopNose.message).toContain("cosquillas");

    // Zona 3: Patitas ("Choca la patita")
    const highFivePaws = care.handleCompanionZoneAction("paws", "highfive");
    expect(highFivePaws.zone).toBe("paws");
    expect(highFivePaws.reactionMood).toBe("excited");
    expect(highFivePaws.reactionPose).toBe("greet");
    expect(highFivePaws.message).toContain("Choca esa patita");
  });
});


