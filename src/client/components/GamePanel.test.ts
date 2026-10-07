// @vitest-environment jsdom
// Pruebas del panel del juego montado bajo el proveedor real: el gato
// abre la hoja compartida, y el cofre se compromete ANTES de revelar —
// primero la recepción persistida, luego el contenido y «Ponérselo»
// para la ropa; un commit que no aterrizó no revela nada. IndexedDB va
// con el mismo Map por base que game.test.ts.
import { act, createElement as h } from "react";
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
  // Almacenes cuyo put revienta — para ensayar un commit que falla.
  failPuts = new Set<string>();

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
    if (this.failPuts.has(name))
      return Promise.reject(new Error("put falló"));
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
          if (this.failPuts.has(name))
            return Promise.reject(new Error("put falló"));
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
import { CompanionProvider } from "./CompanionProvider";
import { GamePanel } from "./GamePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  for (const db of disk.values()) {
    db.stores.clear();
    db.failPuts.clear();
  }
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
});

const flush = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );

const renderPanel = async () => {
  act(() =>
    root.render(
      h(CompanionProvider, { userId: null, children: h(GamePanel) }),
    ),
  );
  await flush();
};

// 90 minutos leídos = 90 XP: cruza al nivel 3 (índice 2) y deja el
// cofre «level:2» con la bufanda pendiente, junto al de «level:1».
const seedChests = async () => {
  const scope = idb.captureDbScope();
  await game.award(
    { kind: "read", ms: 90 * 60_000 },
    scope,
    { id: "read:t1", at: 1000, dayKey: "2025-06-10" },
  );
  return scope;
};

describe("GamePanel", () => {
  it("el botón del gato abre la hoja del compañero", async () => {
    await renderPanel();
    const cat = host.querySelector(".companion-btn")! as HTMLButtonElement;
    expect(cat.getAttribute("aria-label")).toBe("Ver a Gato");
    click(cat);
    await flush();
    const sheet = host.querySelector(".sheet");
    expect(sheet).toBeTruthy();
    expect(sheet!.getAttribute("aria-label")).toBe("Gato");
    expect(sheet!.textContent).toContain("Acariciar");
    expect(sheet!.textContent).toContain("Jugar con la pelota");
  });

  it("cofre comprometido → revela → «Ponérselo» equipa la prenda", async () => {
    const scope = await seedChests();
    await renderPanel();

    const cofre = button("Nivel 3 · Lector constante")!;
    expect(cofre).toBeTruthy();
    click(cofre);
    await flush();

    // El commit ya quedó: la recepción existe en la base.
    const receipts = await idb.listCompanionReceipts(scope);
    expect(
      receipts.some((r) => r.id === "chest-open:level:2"),
    ).toBe(true);
    // Y solo entonces se reveló el contenido con sus dos opciones.
    expect(host.textContent).toContain("Bufanda del gato");
    expect(button("Ponérselo")).toBeTruthy();
    expect(button("Después")).toBeTruthy();

    click(button("Ponérselo")!);
    await flush();
    const reg = await game.readCompanionField("equipped.neck", scope);
    expect(reg?.value).toBe("bufanda");
    // El gato del botón ya la luce: puesta y disponible localmente.
    expect(host.querySelector(".cat-wear--bufanda")).toBeTruthy();
    // El aviso se retiró y el cofre salió de los pendientes.
    expect(host.querySelector(".game-reveal")).toBeNull();
    expect(button("Nivel 3 · Lector constante")).toBeUndefined();
  });

  it("un commit que no aterrizó muestra error y no revela", async () => {
    const scope = await seedChests();
    await renderPanel();

    // La escritura de recepciones va a fallar: nada debe revelarse.
    dbFor("lecta").failPuts.add("companionReceipts");
    click(button("Nivel 3 · Lector constante")!);
    await flush();

    expect(host.querySelector(".game-reveal")).toBeNull();
    expect(button("Ponérselo")).toBeUndefined();
    expect(host.textContent).toContain(
      "No se pudo abrir el cofre. Intenta de nuevo.",
    );
    const receipts = await idb.listCompanionReceipts(scope);
    expect(
      receipts.some((r) => r.id === "chest-open:level:2"),
    ).toBe(false);
  });

  it("sin juego encendido el panel no se muestra", async () => {
    const scope = idb.captureDbScope();
    await game.writeCompanionField("enabled", false, scope);
    await renderPanel();
    expect(host.querySelector(".companion-btn")).toBeNull();
    expect(host.querySelector(".game")).toBeNull();
  });
});
