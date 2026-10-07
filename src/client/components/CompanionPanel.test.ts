// @vitest-environment jsdom
// Pruebas de la hoja del compañero: nombre validado, armario por
// ranuras (equipar, «Sin prenda» = null explícito, bloqueos con
// requisito real, prenda remota conservada pero no dibujada) y el
// cuidado real que deja lastCare sin tocar el juego. IndexedDB va con
// el mismo Map por base que game.test.ts.
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
import { emptyGameState, type GameChest, type GameState } from "../lib/gamification";
import { startCare } from "../lib/companion-interactions";
import {
  CompanionPanel,
  type CompanionPanelProps,
} from "./CompanionPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
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

const buttons = () => [...host.querySelectorAll("button")];
const button = (label: string) =>
  buttons().find((b) => b.textContent?.includes(label));
const buttonIn = (scope: Element, label: string) =>
  [...scope.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );

// Input controlado de React: el setter nativo + evento «input».
const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const submitForm = (form: Element) =>
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
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

const makeState = (over: Partial<GameState> = {}): GameState => ({
  ...emptyGameState(),
  ...over,
  stats: { ...emptyGameState().stats, ...(over.stats ?? {}) },
});

const baseProps = (
  over: Partial<CompanionPanelProps> = {},
): CompanionPanelProps => ({
  state: makeState(),
  name: "Michi",
  equipped: { body: null, neck: null, head: null, face: null, coat: null },
  accessories: [],
  mood: "awake",
  activeCare: null,
  onCare: vi.fn(async () => undefined),
  onClose: vi.fn(),
  ...over,
});

const openCloset = async () => {
  click(button("Cambiar ropa")!);
  await flush();
};

describe("CompanionPanel", () => {
  it("lleva el nombre del gato en el rótulo y el nivel en la cabecera", async () => {
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();
    const sheet = host.querySelector(".sheet")!;
    expect(sheet.getAttribute("aria-label")).toBe("Michi");
    expect(sheet.textContent).toContain("Michi");
    expect(sheet.textContent).toContain("Nivel 1");
  });

  it("un nombre inválido no se escribe y muestra su error", async () => {
    const scope = idb.captureDbScope();
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();

    const input = host.querySelector("#companion-name") as HTMLInputElement;
    typeInto(input, "   ");
    const alerta = host.querySelector("#companion-name-error");
    expect(alerta).toBeTruthy();
    expect(alerta!.textContent).toContain("1 a 24");
    const guardar = button("Guardar nombre")! as HTMLButtonElement;
    expect(guardar.disabled).toBe(true);

    submitForm(host.querySelector("form")!);
    await flush();
    expect(
      await game.readCompanionField("name", scope),
    ).toBeUndefined();
  });

  it("un nombre válido se persiste como registro «name»", async () => {
    const scope = idb.captureDbScope();
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();

    typeInto(
      host.querySelector("#companion-name") as HTMLInputElement,
      "  Pelusa  ",
    );
    submitForm(host.querySelector("form")!);
    await flush();
    const reg = await game.readCompanionField("name", scope);
    expect(reg?.value).toBe("Pelusa");
  });

  it("equipar una prenda disponible escribe equipped.<ranura>", async () => {
    const scope = idb.captureDbScope();
    const state = makeState({
      chests: [chest("level:4", "moño", true)],
    });
    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ state, accessories: [] })),
      ),
    );
    await flush();
    await openCloset();

    const cabeza = host.querySelector("#companion-slot-head")!
      .parentElement as HTMLElement;
    const mono = buttonIn(cabeza, "Moño")! as HTMLButtonElement;
    expect(mono.disabled).toBe(false);
    click(mono);
    await flush();
    const reg = await game.readCompanionField("equipped.head", scope);
    expect(reg?.value).toBe("moño");
  });

  it("«Sin prenda» escribe null explícito en la ranura", async () => {
    const scope = idb.captureDbScope();
    const state = makeState({
      chests: [chest("level:4", "moño", true)],
    });
    act(() =>
      root.render(
        h(CompanionPanel, baseProps({
          state,
          equipped: { body: null, neck: null, head: "moño", face: null, coat: null },
        })),
      ),
    );
    await flush();
    await openCloset();

    const cabeza = host.querySelector("#companion-slot-head")!
      .parentElement as HTMLElement;
    click(buttonIn(cabeza, "Sin prenda")!);
    await flush();
    const reg = await game.readCompanionField("equipped.head", scope);
    // null persistido como dato, no como borrado del registro.
    expect(reg).toBeTruthy();
    expect(reg!.value).toBeNull();
  });

  it("la prenda bloqueada está deshabilitada y muestra su nivel", async () => {
    const state = makeState(); // sin cofres: nada desbloqueado
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state }))),
    );
    await flush();
    await openCloset();

    const cuello = host.querySelector("#companion-slot-neck")!
      .parentElement as HTMLElement;
    const collar = buttonIn(cuello, "Collar")! as HTMLButtonElement;
    expect(collar.disabled).toBe(true);
    expect(collar.textContent).toContain("Nivel 7");
    const bufanda = buttonIn(cuello, "Bufanda")! as HTMLButtonElement;
    expect(bufanda.disabled).toBe(true);
    expect(bufanda.textContent).toContain("Nivel 3");
    // «Sin prenda» nunca se bloquea: siempre hay una opción usable.
    expect(
      (buttonIn(cuello, "Sin prenda")! as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("prenda remota puesta se conserva marcada pero no se dibuja", async () => {
    // El registro dice «moño» en la cabeza, pero el cofre del moño
    // no está abierto en esta copia: el armario lo muestra puesto y
    // bloqueado; el gato no lo dibuja hasta abrir su cofre.
    const state = makeState();
    act(() =>
      root.render(
        h(CompanionPanel, baseProps({
          state,
          equipped: { body: null, neck: null, head: "moño", face: null, coat: null },
          accessories: [], // lo que el proveedor decidió dibujar
        })),
      ),
    );
    await flush();
    await openCloset();

    expect(host.querySelector(".cat-wear--mono, .cat-wear--moño")).toBeNull();
    const cabeza = host.querySelector("#companion-slot-head")!
      .parentElement as HTMLElement;
    const mono = buttonIn(cabeza, "Moño")! as HTMLButtonElement;
    expect(mono.getAttribute("aria-checked")).toBe("true");
    expect(mono.textContent).toContain("Puesta");
    // Bloqueada localmente: no se puede reelegir, pero «Sin prenda»
    // sigue disponible para quitarla.
    expect(mono.disabled).toBe(true);
    expect(
      (buttonIn(cabeza, "Sin prenda")! as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("la hoja abre saludando y muestra la línea contextual", async () => {
    act(() =>
      root.render(h(CompanionPanel, baseProps({ mood: "asleep" }))),
    );
    await flush();
    // La patita de saludo está arriba al abrir (pose «greet»).
    expect(
      host.querySelector("svg.cat")?.getAttribute("class"),
    ).toContain("cat--p-greet");
    // Y el texto conserva el humor de llegada.
    const greeting = host.querySelector(".companion-greeting");
    expect(greeting?.textContent).toContain("te extrañó");
  });

  it("el saludo de un gato despierto lleva su nombre", async () => {
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();
    expect(
      host.querySelector(".companion-greeting")?.textContent,
    ).toContain("Michi");
  });

  it("la ranura Pelaje ofrece Natural y bloquea con su nivel", async () => {
    // Nivel 1 (sin xp): solo «Natural» está usable; cada pelaje
    // muestra el nivel que lo desbloquea.
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state: makeState() }))),
    );
    await flush();
    await openCloset();

    const pelaje = host.querySelector("#companion-slot-coat")!
      .parentElement as HTMLElement;
    const natural = buttonIn(pelaje, "Natural")! as HTMLButtonElement;
    expect(natural.disabled).toBe(false);
    const atigrado = buttonIn(pelaje, "Atigrado")! as HTMLButtonElement;
    expect(atigrado.disabled).toBe(true);
    expect(atigrado.textContent).toContain("Nivel 2");
    const dorado = buttonIn(pelaje, "Dorado")! as HTMLButtonElement;
    expect(dorado.textContent).toContain("Nivel 10");
  });

  it("un pelaje desbloqueado se equipa y «Natural» lo quita", async () => {
    const scope = idb.captureDbScope();
    // xp 1150 = nivel 8: atigrado, gris, siamés y tuxedo libres.
    const state = makeState({ xp: 1150 });
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state }))),
    );
    await flush();
    await openCloset();

    const pelaje = host.querySelector("#companion-slot-coat")!
      .parentElement as HTMLElement;
    const tuxedo = buttonIn(pelaje, "Tuxedo")! as HTMLButtonElement;
    expect(tuxedo.disabled).toBe(false);
    click(tuxedo);
    await flush();
    expect(
      (await game.readCompanionField("equipped.coat", scope))?.value,
    ).toBe("pelaje-tuxedo");

    // El dorado (nivel 10) sigue bloqueado a este nivel.
    expect(
      (buttonIn(pelaje, "Dorado")! as HTMLButtonElement).disabled,
    ).toBe(true);

    // «Natural» escribe null explícito — quita el pelaje.
    click(buttonIn(pelaje, "Natural")!);
    await flush();
    const reg = await game.readCompanionField("equipped.coat", scope);
    expect(reg).toBeTruthy();
    expect(reg!.value).toBeNull();
  });

  it("el cuidado real deja lastCare sin tocar XP ni estadísticas", async () => {
    const scope = idb.captureDbScope();
    await game.award(
      { kind: "read", ms: 120_000 },
      scope,
      { id: "read:t1", at: 1000, dayKey: "2025-06-10" },
    );
    const before = await game.loadGame(scope);

    act(() =>
      root.render(
        h(CompanionPanel, baseProps({
          state: before,
          // El camino real: el proveedor haría lo mismo con sus
          // opciones de movimiento reducido.
          onCare: (kind) => {
            const handle = startCare(kind, {
              scope,
              reducedMotion: true,
            });
            return handle ? handle.promise : Promise.resolve();
          },
        })),
      ),
    );
    await flush();
    click(button("Acariciar")!);
    await flush();

    const reg = await game.readCompanionField("lastCare", scope);
    expect(reg?.value).toMatchObject({ kind: "pet" });
    const after = await game.loadGame(scope);
    expect(after).toEqual(before);
  });
});
