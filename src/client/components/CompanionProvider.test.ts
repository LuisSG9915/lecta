// @vitest-environment jsdom
// Pruebas del proveedor del compañero: el aislamiento entre cuentas
// (cambiar A→B nunca deja datos de A visibles en B) y la resolución
// pura de ropa/último cuidado. IndexedDB se simula con el mismo Map
// por base que game.test.ts — los módulos corren de verdad.
import {
  act,
  createElement as h,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
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

import * as idb from "../lib/idb";
import * as game from "../lib/game";
import { emptyGameState, type GameChest } from "../lib/gamification";
import {
  catReducedMotion,
  CompanionProvider,
  drawableAccessories,
  effectiveEquipped,
  lastCareOf,
  ownedArticles,
  useCompanion,
} from "./CompanionProvider";
import type { CompanionRegister } from "../../shared/companion-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  // Las bases persisten entre pruebas por la conexión cacheada: se
  // vacían los almacenes, no el mapa, y se vuelve al modo anónimo.
  for (const db of disk.values()) db.stores.clear();
  await idb.setDbUser(null);
  game.resetGameCache();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  // La preferencia de movimiento vive en <html> y sobrevive al
  // desmontaje del proveedor — se limpia para no filtrarla entre
  // pruebas, igual que las bases.
  delete document.documentElement.dataset.catMotion;
  vi.unstubAllGlobals();
});

const flush = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const chest = (
  id: string,
  reward: string,
  opened: boolean,
): GameChest => ({
  id,
  source: "level",
  label: `Cofre ${id}`,
  reward,
  createdAt: 1,
  openedAt: opened ? 2 : null,
});

const register = (
  field: CompanionRegister["field"],
  value: unknown,
  updatedAt = 1,
): CompanionRegister => ({
  field,
  value,
  updatedAt,
  operationId: `op-${field}-${updatedAt}`,
});

const Probe = () => {
  const c = useCompanion();
  return h(
    "output",
    { "data-testid": "probe" },
    `${c.name}|${c.state ? "state" : "null"}|${c.open ? "open" : "closed"}`,
  );
};

const probeText = () =>
  (host.querySelector("[data-testid=probe]") as HTMLElement).textContent ??
  "";

const renderProvider = (userId: string | null, children: ReactNode) =>
  act(() =>
    root.render(h(CompanionProvider, { userId, children })),
  );

describe("resolución de ropa (helpers puros)", () => {
  it("sin registros equipped.*, el default viene del inventario", () => {
    const state = {
      ...emptyGameState(),
      chests: [
        chest("level:2", "bufanda", true),
        chest("level:4", "moño", true),
      ],
    };
    expect(effectiveEquipped([], state)).toEqual({
      body: null,
      neck: "bufanda",
      head: "moño",
      face: null,
      coat: null,
    });
    // El collar es el fallback de cuello cuando no hay bufanda.
    const soloCollar = {
      ...emptyGameState(),
      chests: [chest("level:6", "collar", true)],
    };
    expect(effectiveEquipped([], soloCollar).neck).toBe("collar");
  });

  it("cualquier registro equipped.* manda — null incluido", () => {
    const state = {
      ...emptyGameState(),
      chests: [chest("level:2", "bufanda", true)],
    };
    // Un solo registro basta para mandar en TODAS las ranuras: las
    // que no tienen registro quedan vacías, no al default.
    const regs = [register("equipped.neck", null)];
    expect(effectiveEquipped(regs, state)).toEqual({
      body: null,
      neck: null,
      head: null,
      face: null,
      coat: null,
    });
    const regs2 = [register("equipped.face", "anteojos")];
    expect(effectiveEquipped(regs2, state).face).toBe("anteojos");
    expect(effectiveEquipped(regs2, state).neck).toBeNull();
  });

  it("lo puesto en otro dispositivo se conserva pero no se dibuja", () => {
    // equipped.head = «moño» sin cofre local abierto: el registro
    // sigue siendo el dato, pero no entra al inventario local.
    const regs = [register("equipped.head", "moño")];
    const state = emptyGameState();
    const equipped = effectiveEquipped(regs, state);
    expect(equipped.head).toBe("moño");
    expect(ownedArticles(state).has("moño")).toBe(false);
    expect(drawableAccessories(equipped, ownedArticles(state))).toEqual([]);
    // Con el cofre abierto localmente ya se dibuja.
    const conMoño = {
      ...emptyGameState(),
      chests: [chest("level:4", "moño", true)],
    };
    expect(
      drawableAccessories(equipped, ownedArticles(conMoño)),
    ).toEqual(["moño"]);
  });

  it("el chaleco es gratis: no necesita cofre", () => {
    const state = emptyGameState();
    const regs = [register("equipped.body", "chaleco")];
    const equipped = effectiveEquipped(regs, state);
    expect(drawableAccessories(equipped, ownedArticles(state))).toEqual([
      "chaleco",
    ]);
  });

  it("los pelajes entran al inventario por nivel, sin cofre", () => {
    // Nivel 8 (xp 1150): cuatro pelajes libres, el dorado no.
    const state = { ...emptyGameState(), xp: 1150 };
    const owned = ownedArticles(state);
    expect(owned.has("pelaje-tuxedo")).toBe(true);
    expect(owned.has("pelaje-dorado")).toBe(false);
    // Equipado y disponible: se dibuja.
    const puesto = {
      body: null,
      neck: null,
      head: null,
      face: null,
      coat: "pelaje-tuxedo",
    };
    expect(drawableAccessories(puesto, owned)).toEqual(["pelaje-tuxedo"]);
    // Puesto en otro dispositivo pero bloqueado aquí: el registro se
    // conserva como dato y no se dibuja — igual que una prenda remota.
    const remoto = { ...puesto, coat: "pelaje-dorado" };
    expect(effectiveEquipped([register("equipped.coat", "pelaje-dorado")], state).coat)
      .toBe("pelaje-dorado");
    expect(drawableAccessories(remoto, owned)).toEqual([]);
  });
});

describe("lastCareOf", () => {
  it("lee el último cuidado arbitrado y tolera basura", () => {
    expect(lastCareOf([])).toBeNull();
    expect(
      lastCareOf([register("lastCare", { kind: "pet", at: 7 })]),
    ).toEqual({ kind: "pet", at: 7 });
    // Valores sin la forma de CompanionCare no cuentan.
    expect(lastCareOf([register("lastCare", "ayer") as never])).toBeNull();
    expect(
      lastCareOf([register("lastCare", { kind: "baño", at: 7 }) as never]),
    ).toBeNull();
  });
});

describe("CompanionProvider con base real simulada", () => {
  it("al cambiar de cuenta no queda nada de la anterior visible", async () => {
    await idb.setDbUser("ua");
    await game.writeCompanionField("name", "Misifus", idb.captureDbScope());

    renderProvider("ua", h(Probe));
    await flush();
    expect(probeText()).toBe("Misifus|state|closed");

    await act(async () => {
      await idb.setDbUser("ub");
    });
    renderProvider("ub", h(Probe));
    await flush();
    // La base de «ub» arrancó vacía: ni el nombre ni la ropa de la
    // cuenta A se asoman — la hoja vuelve al nombre por omisión.
    expect(probeText()).toBe("Gato|state|closed");
    expect(probeText()).not.toContain("Misifus");
  });

  it("openPanel monta la hoja una vez y closePanel la quita", async () => {
    const Opener = () => {
      const c = useCompanion();
      return h("button", { onClick: c.openPanel }, "abrir");
    };
    renderProvider(null, h(Opener));
    await flush();
    expect(host.querySelector(".sheet")).toBeNull();

    const openBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "abrir",
    )!;
    act(() => {
      openBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    const sheets = host.querySelectorAll(".sheet");
    expect(sheets.length).toBe(1);
    // La hoja lleva el nombre del gato como rótulo accesible.
    expect(sheets[0].getAttribute("aria-label")).toBe("Gato");

    const closeBtn = [...sheets[0].querySelectorAll("button")].find(
      (b) => b.textContent === "Cerrar",
    )!;
    act(() => {
      closeBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    expect(host.querySelector(".sheet")).toBeNull();
  });

  it("cuidar desde el contexto escribe lastCare sin tocar el juego", async () => {
    // Movimiento reducido en las preferencias del dispositivo: el
    // cuidado persiste de inmediato, sin esperar la animación.
    const scope = idb.captureDbScope();
    await game.saveCompanionDevicePrefs(
      { version: 1, soundEnabled: false, motion: "reduced" },
      scope,
    );
    await game.award(
      { kind: "read", ms: 120_000 },
      scope,
      { id: "read:t1", at: 1000, dayKey: "2025-06-10" },
    );
    const before = await game.loadGame(scope);

    const Opener = () => {
      const c = useCompanion();
      return h("button", { onClick: c.openPanel }, "abrir");
    };
    renderProvider(null, h(Opener));
    await flush();
    act(() => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "abrir")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    });
    await flush();

    act(() => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Acariciar")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    });
    await flush();

    const reg = await game.readCompanionField("lastCare", scope);
    expect(reg?.value).toMatchObject({ kind: "pet" });
    const after = await game.loadGame(scope);
    expect(after).toEqual(before);
  });
});

describe("movimiento del compañero", () => {
  it("catReducedMotion resuelve los tres modos", () => {
    // «full» anima aunque el sistema pida reducir; «reduced» reduce
    // aunque el sistema anime; «system» sigue al sistema.
    expect(catReducedMotion("full", true)).toBe(false);
    expect(catReducedMotion("full", false)).toBe(false);
    expect(catReducedMotion("reduced", false)).toBe(true);
    expect(catReducedMotion("reduced", true)).toBe(true);
    expect(catReducedMotion("system", true)).toBe(true);
    expect(catReducedMotion("system", false)).toBe(false);
  });

  it("las preferencias guardadas aceptan «full» y rechazan basura", async () => {
    const scope = idb.captureDbScope();
    await idb.saveSessionValue(
      idb.COMPANION_DEVICE_PREFS_KEY,
      JSON.stringify({ version: 1, soundEnabled: false, motion: "full" }),
      scope,
    );
    expect((await game.loadCompanionDevicePrefs(scope)).motion).toBe("full");

    // Un valor fuera del catálogo cae al default «system».
    await idb.saveSessionValue(
      idb.COMPANION_DEVICE_PREFS_KEY,
      JSON.stringify({ version: 1, soundEnabled: false, motion: "turbo" }),
      scope,
    );
    expect((await game.loadCompanionDevicePrefs(scope)).motion).toBe(
      "system",
    );
  });

  it("el proveedor publica el modo en <html data-cat-motion>", async () => {
    const scope = idb.captureDbScope();
    await game.saveCompanionDevicePrefs(
      { version: 1, soundEnabled: false, motion: "full" },
      scope,
    );
    renderProvider(null, h(Probe));
    await flush();
    expect(document.documentElement.dataset.catMotion).toBe("full");
  });

  it("«full» no reduce aunque el sistema pida reducir", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const scope = idb.captureDbScope();
    await game.saveCompanionDevicePrefs(
      { version: 1, soundEnabled: false, motion: "full" },
      scope,
    );
    const MotionProbe = () =>
      h("output", { "data-testid": "probe" }, String(useCompanion().reducedMotion));
    renderProvider(null, h(MotionProbe));
    await flush();
    expect(probeText()).toBe("false");
  });

  it("«system» sí reduce cuando el sistema lo pide", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const scope = idb.captureDbScope();
    await game.saveCompanionDevicePrefs(
      { version: 1, soundEnabled: false, motion: "system" },
      scope,
    );
    const MotionProbe = () =>
      h("output", { "data-testid": "probe" }, String(useCompanion().reducedMotion));
    renderProvider(null, h(MotionProbe));
    await flush();
    expect(probeText()).toBe("true");
  });
});
