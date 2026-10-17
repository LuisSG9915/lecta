// @vitest-environment jsdom
// Pruebas de la hoja del compañero: nombre validado (editor inline con ✎,
// Cancelar y Escape sin cerrar la hoja), pestañas con teclado, rincón con
// globo contextual, armario con bandeja por ranura y prueba temporal de
// prendas bloqueadas sin persistir.

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

const openCloset = async (slotLabel?: string) => {
  click(button("Armario")!);
  await flush();
  if (slotLabel) {
    click(button(slotLabel)!);
    await flush();
  }
};

const openNameEdit = async () => {
  const btn = host.querySelector(".companion-rename-btn")!;
  click(btn);
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
    await openNameEdit();

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
    await openNameEdit();

    typeInto(
      host.querySelector("#companion-name") as HTMLInputElement,
      "  Pelusa  ",
    );
    submitForm(host.querySelector("form")!);
    await flush();
    const reg = await game.readCompanionField("name", scope);
    expect(reg?.value).toBe("Pelusa");
  });

  it("cancelar la edición restaura el nombre sin guardar", async () => {
    const scope = idb.captureDbScope();
    act(() => root.render(h(CompanionPanel, baseProps({ name: "Michi" }))));
    await flush();
    await openNameEdit();

    const input = host.querySelector("#companion-name") as HTMLInputElement;
    typeInto(input, "NuevoNombre");
    click(button("Cancelar")!);
    await flush();

    expect(host.querySelector("#companion-name")).toBeNull();
    expect(host.querySelector(".companion-title")?.textContent).toBe("Michi");
    expect(await game.readCompanionField("name", scope)).toBeUndefined();
  });

  it("Escape dentro de la edición de nombre cancela sin cerrar la hoja", async () => {
    const onClose = vi.fn();
    act(() => root.render(h(CompanionPanel, baseProps({ onClose }))));
    await flush();
    await openNameEdit();

    const input = host.querySelector("#companion-name") as HTMLInputElement;
    input.focus();
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector("#companion-name")).toBeNull();
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
    await openCloset("Cabeza");

    const mono = button("Moño")! as HTMLButtonElement;
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
    await openCloset("Cabeza");

    click(button("Sin prenda")!);
    await flush();
    const reg = await game.readCompanionField("equipped.head", scope);
    expect(reg).toBeTruthy();
    expect(reg!.value).toBeNull();
  });

  it("la prenda bloqueada muestra su nivel y probarla no persiste", async () => {
    const scope = idb.captureDbScope();
    const state = makeState();
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state }))),
    );
    await flush();
    await openCloset("Cuello");

    const collar = button("Collar")! as HTMLButtonElement;
    expect(collar.getAttribute("aria-disabled")).toBe("true");
    expect(collar.textContent).toContain("Nivel 7");

    const bufanda = button("Bufanda")! as HTMLButtonElement;
    expect(bufanda.getAttribute("aria-disabled")).toBe("true");
    expect(bufanda.textContent).toContain("Nivel 3");

    // Al tocar la prenda bloqueada se prueba sin escribir nada
    click(collar);
    await flush();
    expect(await game.readCompanionField("equipped.neck", scope)).toBeUndefined();
    expect(host.querySelector(".companion-bubble")?.textContent).toContain("Se desbloquea en el nivel 7");

    // Botón de quitar prueba
    const quitarBtn = button("Quitar prueba");
    expect(quitarBtn).toBeTruthy();
    click(quitarBtn!);
    await flush();
    expect(button("Quitar prueba")).toBeFalsy();

    // «Sin prenda» nunca se bloquea
    expect(
      (button("Sin prenda")! as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("prenda remota puesta se conserva marcada pero no se dibuja", async () => {
    const state = makeState();
    act(() =>
      root.render(
        h(CompanionPanel, baseProps({
          state,
          equipped: { body: null, neck: null, head: "moño", face: null, coat: null },
          accessories: [],
        })),
      ),
    );
    await flush();
    await openCloset("Cabeza");

    // El gato grande del escenario no dibuja la prenda remota porque
    // está bloqueada localmente (accessories=[]).
    expect(
      host.querySelector(".companion-stage .cat-wear--mono, .companion-stage .cat-wear--moño"),
    ).toBeNull();
    const mono = button("Moño")! as HTMLButtonElement;
    expect(mono.getAttribute("aria-checked")).toBe("true");
    expect(mono.textContent).toContain("Puesta");
    expect(mono.getAttribute("aria-disabled")).toBe("true");
    expect(
      (button("Sin prenda")! as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("la hoja abre saludando y muestra la línea contextual", async () => {
    act(() =>
      root.render(h(CompanionPanel, baseProps({ mood: "asleep" }))),
    );
    await flush();
    expect(
      host.querySelector("svg.cat")?.getAttribute("class"),
    ).toContain("cat--p-greet");
    const bubble = host.querySelector(".companion-bubble");
    expect(bubble?.textContent).toContain("te extrañó");
  });

  it("el saludo de un gato despierto lleva su nombre", async () => {
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();
    expect(
      host.querySelector(".companion-bubble")?.textContent,
    ).toContain("Michi");
  });

  it("la ranura Pelaje ofrece Natural y bloquea con su nivel", async () => {
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state: makeState() }))),
    );
    await flush();
    await openCloset("Pelaje");

    const natural = button("Natural")! as HTMLButtonElement;
    expect(natural.disabled).toBe(false);
    const atigrado = button("Atigrado")! as HTMLButtonElement;
    expect(atigrado.getAttribute("aria-disabled")).toBe("true");
    expect(atigrado.textContent).toContain("Nivel 2");
    const dorado = button("Dorado")! as HTMLButtonElement;
    expect(dorado.textContent).toContain("Nivel 10");
  });

  it("un pelaje desbloqueado se equipa y «Natural» lo quita", async () => {
    const scope = idb.captureDbScope();
    const state = makeState({ xp: 1150 });
    act(() =>
      root.render(h(CompanionPanel, baseProps({ state }))),
    );
    await flush();
    await openCloset("Pelaje");

    const tuxedo = button("Tuxedo")! as HTMLButtonElement;
    expect(tuxedo.getAttribute("aria-disabled")).toBeNull();
    click(tuxedo);
    await flush();
    expect(
      (await game.readCompanionField("equipped.coat", scope))?.value,
    ).toBe("pelaje-tuxedo");

    expect(
      (button("Dorado")! as HTMLButtonElement).getAttribute("aria-disabled"),
    ).toBe("true");

    click(button("Natural")!);
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

  it("la pestaña de recompensas permite abrir cofres pendientes", async () => {
    const pending = chest("level:2", "bufanda", false);
    const state = makeState({
      chests: [pending],
    });

    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ state })),
      ),
    );
    await flush();

    click(button("Recompensas")!);
    await flush();

    expect(host.textContent).toContain("Cofre level:2");
    const openBtn = button("Abrir cofre")!;
    expect(openBtn).toBeTruthy();

    click(openBtn);
    await flush();

    expect(host.textContent).toContain("¡Tesoro abierto!");
    expect(host.textContent).toContain("Bufanda");
    expect(button("Vestir a Michi ahora")).toBeTruthy();
  });

  it("la pestaña de vitrina lista las estampas de logros y su estado", async () => {
    const state = makeState({
      achievements: { palabra_1: 1000 },
    });

    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ state })),
      ),
    );
    await flush();

    click(button("Vitrina")!);
    await flush();

    expect(host.textContent).toContain("Álbum de Estampas de Lectura");
    expect(host.textContent).toContain("Primera palabra");
    expect(host.textContent).toContain("1 de 36 conseguidas");
  });

  it("la vitrina muestra las 8 familias con sus sellos y marca «Nuevo» para logros recientes", async () => {
    const now = Date.now();
    const state = makeState({
      achievements: {
        palabra_1: now - 2 * 86_400_000, // 2 días atrás: nuevo
        palabra_10: now - 30 * 86_400_000, // 30 días atrás: no nuevo
      },
    });

    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ state })),
      ),
    );
    await flush();

    click(button("Vitrina")!);
    await flush();

    const familyCards = host.querySelectorAll(".family-card");
    expect(familyCards.length).toBe(8);

    const seals = host.querySelectorAll(".seal");
    expect(seals.length).toBeGreaterThanOrEqual(8);

    // Badge "Nuevo" presente para palabra_1
    const newBadges = host.querySelectorAll(".family-badge-new");
    expect(newBadges.length).toBe(1);
    expect(newBadges[0]?.textContent).toBe("Nuevo");
  });

  it("los libros terminados muestran exlibris con sello genérico si no están en la biblioteca", async () => {
    const state = makeState({
      finishedBooks: ["hash_libro_desconocido"],
    });

    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ state })),
      ),
    );
    await flush();

    click(button("Vitrina")!);
    await flush();

    expect(host.textContent).toContain("Exlibris de Libros Completados");
    expect(host.textContent).toContain("Libro terminado");
    expect(host.textContent).toContain("Biblioteca de Lecta");
  });

  it("las flechas del teclado en la lista de pestañas cambian de sección", async () => {
    act(() => root.render(h(CompanionPanel, baseProps())));
    await flush();

    const careTab = host.querySelector("#companion-tab-care") as HTMLButtonElement;
    expect(careTab.getAttribute("aria-selected")).toBe("true");

    act(() => {
      careTab.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();

    const rewardsTab = host.querySelector("#companion-tab-rewards") as HTMLButtonElement;
    expect(rewardsTab.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("#companion-panel-rewards")).toBeTruthy();
  });

  it("el globo muestra el estado del cuidado durante una acción activa", async () => {
    act(() =>
      root.render(
        h(CompanionPanel, baseProps({ activeCare: "feed" })),
      ),
    );
    await flush();

    const bubble = host.querySelector(".companion-bubble");
    expect(bubble?.textContent).toContain("comiendo");
  });

  describe("Track 4: El Rincón de tu Gato (2 Pestañas)", () => {
    it("renderiza la tarjeta unificada con los datos clave de progreso y escenario", async () => {
      act(() =>
        root.render(
          h(CompanionPanel, {
            catName: "Pelusa",
            catMoodMessage: "¡Hoy leíste genial!",
            streakDays: 5,
            minutesReadToday: 15,
            dailyGoalMinutes: 20,
            wordsLearnedCount: 42,
            renderStagePreview: () => h("div", { className: "stage-preview-mock" }, "Stage Mock"),
            renderClosetGrid: () => h("div", { className: "closet-grid-mock" }, "Closet Mock"),
            onClose: () => {},
          }),
        ),
      );
      await flush();

      expect(host.querySelector(".cat-corner-sheet")).toBeTruthy();
      expect(host.textContent).toContain("🐱 El Rincón de Pelusa");
      expect(host.textContent).toContain("“¡Hoy leíste genial!”");
      expect(host.textContent).toContain("🔥 5 d");
      expect(host.textContent).toContain("⏱️ 15/20 m");
      expect(host.textContent).toContain("Meta de hoy (75%)");
      expect(host.textContent).toContain("✨ 42");
      expect(host.textContent).toContain("Palabras tuyas");
      expect(host.querySelector(".stage-preview-mock")).toBeTruthy();
    });

    it("renderiza atajos mágicos cuando isInsideReader es true", async () => {
      let triggeredWhereWasI = false;
      let triggeredWhoIs = false;

      act(() =>
        root.render(
          h(CompanionPanel, {
            catMoodMessage: "Leyendo...",
            streakDays: 3,
            minutesReadToday: 10,
            dailyGoalMinutes: 20,
            wordsLearnedCount: 12,
            isInsideReader: true,
            renderStagePreview: () => h("div", null, "Stage"),
            renderClosetGrid: () => h("div", null, "Closet"),
            onTriggerWhereWasI: () => {
              triggeredWhereWasI = true;
            },
            onTriggerWhoIsOnPage: () => {
              triggeredWhoIs = true;
            },
            onClose: () => {},
          }),
        ),
      );
      await flush();

      const whereBtn = button("✨ ¿En qué me quedé? (15s)");
      expect(whereBtn).toBeTruthy();
      click(whereBtn!);
      expect(triggeredWhereWasI).toBe(true);

      const whoBtn = button("👥 Personajes en esta página");
      expect(whoBtn).toBeTruthy();
      click(whoBtn!);
      expect(triggeredWhoIs).toBe(true);
    });

    it("alterna entre '🌱 Mi Progreso' y '🎀 Personalizar Gato'", async () => {
      act(() =>
        root.render(
          h(CompanionPanel, {
            catMoodMessage: "Leyendo...",
            streakDays: 3,
            minutesReadToday: 10,
            dailyGoalMinutes: 20,
            wordsLearnedCount: 12,
            renderStagePreview: () => h("div", null, "Stage"),
            renderClosetGrid: () => h("div", { className: "custom-closet" }, "Mi Armario"),
            renderJourneyMilestones: () => h("div", { className: "custom-journey" }, "Mis Hitos"),
            onClose: () => {},
          }),
        ),
      );
      await flush();

      // Pestaña por defecto es progreso
      expect(host.querySelector(".custom-journey")).toBeTruthy();
      expect(host.querySelector(".custom-closet")).toBeFalsy();

      // Cambiar a personalizar
      const customizeTab = button("Personalizar Gato");
      expect(customizeTab).toBeTruthy();
      click(customizeTab!);
      await flush();

      expect(host.querySelector(".custom-closet")).toBeTruthy();
      expect(host.querySelector(".custom-journey")).toBeFalsy();
    });

    it("el botón cerrar invoca onClose en el modo Track 4", async () => {
      let closed = false;
      act(() =>
        root.render(
          h(CompanionPanel, {
            catMoodMessage: "Listo",
            streakDays: 1,
            minutesReadToday: 5,
            dailyGoalMinutes: 20,
            wordsLearnedCount: 3,
            renderStagePreview: () => h("div", null, "Stage"),
            renderClosetGrid: () => h("div", null, "Closet"),
            onClose: () => {
              closed = true;
            },
          }),
        ),
      );
      await flush();

      const closeBtn = host.querySelector(".cat-corner-close-btn") as HTMLButtonElement;
      expect(closeBtn).toBeTruthy();
      click(closeBtn);
      expect(closed).toBe(true);
    });
  });
});
