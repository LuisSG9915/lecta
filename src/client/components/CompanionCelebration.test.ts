// @vitest-environment jsdom
// Pruebas de la tarjeta de festejos del compañero (fase 5): el
// componente aislado (texto, agrupación, «visto» al mostrar, avance
// en cola, pendiente mientras está bloqueado) y el inbox completo
// dentro del CompanionProvider con IndexedDB simulada — recibo
// persistido, baseline importada que no celebra, supresión que deja
// pendiente y cambio de cuenta A→B que no arrastra tarjetas.
import {
  act,
  createElement as h,
  useEffect,
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
import { CompanionProvider, useCompanion } from "./CompanionProvider";
import {
  CompanionCelebration,
  CELEBRATION_MS,
} from "./CompanionCelebration";
import type { CelebrationItem } from "../lib/companion-inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  for (const db of disk.values()) db.stores.clear();
  await idb.setDbUser(null);
  game.resetGameCache();
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const flush = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const toast = () => host.querySelector(".companion-toast");
const toastText = () => toast()?.textContent ?? "";

const achItem = (ids: string[]): CelebrationItem => ({
  kind: "achievements",
  ids,
  titles: ids,
});
const stageItem = (stage: number): CelebrationItem => ({
  kind: "stage",
  stage,
});
const levelItem = (
  level: number,
  crossed: number[],
  stage?: number,
): CelebrationItem => ({
  kind: "level",
  level,
  crossed,
  ...(stage !== undefined ? { stage } : {}),
});

// ---------- Componente aislado ----------

describe("CompanionCelebration (componente)", () => {
  const props = {
    name: "Michi",
    stage: 0,
    accessories: [] as string[],
  };

  it("tarjeta de logro: título, role=status y recibo al mostrar", () => {
    const onSeen = vi.fn();
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"])],
          blocked: false,
          onSeen,
        }),
      ),
    );
    const card = toast();
    expect(card?.getAttribute("role")).toBe("status");
    expect(toastText()).toBe("Primera palabra");
    expect(onSeen).toHaveBeenCalledWith(achItem(["Primera palabra"]));
  });

  it("varios logros se agrupan: «el primero y N más»", () => {
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra", "Curioso", "Maratón"])],
          blocked: false,
          onSeen: () => undefined,
        }),
      ),
    );
    expect(toastText()).toBe("Primera palabra y 2 más");
  });

  it("evolución: «[nombre] ha crecido: [etapa]»", () => {
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [stageItem(1)],
          blocked: false,
          onSeen: () => undefined,
        }),
      ),
    );
    expect(toastText()).toBe("Michi ha crecido: gatito atento");
  });

  it("subida de nivel: «¡Nivel [n]! [nombre]»", () => {
    const onSeen = vi.fn();
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [levelItem(1, [1])],
          blocked: false,
          onSeen,
        }),
      ),
    );
    expect(toastText()).toBe("¡Nivel 2! Apuntador");
    expect(onSeen).toHaveBeenCalledWith(levelItem(1, [1]));
  });

  it("subida de nivel con evolución agrupada: anuncia nivel y crecimiento en la misma tarjeta", () => {
    const onSeen = vi.fn();
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [levelItem(2, [1, 2], 1)],
          blocked: false,
          onSeen,
        }),
      ),
    );
    expect(toastText()).toBe(
      "¡Nivel 3! Lector constante · Michi ha crecido: gatito atento",
    );
    expect(onSeen).toHaveBeenCalledWith(levelItem(2, [1, 2], 1));
  });

  it("bloqueado no muestra ni marca: queda pendiente", () => {
    const onSeen = vi.fn();
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"])],
          blocked: true,
          onSeen,
        }),
      ),
    );
    expect(toast()).toBeNull();
    expect(onSeen).not.toHaveBeenCalled();
  });

  it("avanzada su duración muestra la siguiente de la cola", () => {
    const onSeen = vi.fn();
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"]), stageItem(1)],
          blocked: false,
          onSeen,
        }),
      ),
    );
    expect(toastText()).toBe("Primera palabra");
    act(() => void vi.advanceTimersByTime(CELEBRATION_MS.achievements));
    expect(toastText()).toBe("Michi ha crecido: gatito atento");
    expect(onSeen).toHaveBeenCalledWith(stageItem(1));
    act(() => void vi.advanceTimersByTime(CELEBRATION_MS.stage));
    expect(toast()).toBeNull();
  });

  it("un recibo que aterriza a mitad no corta la tarjeta", () => {
    const items = [achItem(["Primera palabra"])];
    const node = (next: CelebrationItem[]) =>
      act(() =>
        root.render(
          h(CompanionCelebration, {
            ...props,
            items: next,
            blocked: false,
            onSeen: () => undefined,
          }),
        ),
      );
    void node(items);
    expect(toastText()).toBe("Primera palabra");
    // El recibo aterrizó: la pendiente sale, pero la tarjeta en
    // pantalla cumple su tiempo completo.
    void node([]);
    expect(toastText()).toBe("Primera palabra");
    act(() =>
      void vi.advanceTimersByTime(CELEBRATION_MS.achievements - 1),
    );
    expect(toast()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(toast()).toBeNull();
  });

  it("bloquear a mitad retira la tarjeta y al volver se ve completa", () => {
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"])],
          blocked: false,
          onSeen: () => undefined,
        }),
      ),
    );
    act(() => void vi.advanceTimersByTime(2_000));
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"])],
          blocked: true,
          onSeen: () => undefined,
        }),
      ),
    );
    expect(toast()).toBeNull();
    act(() => void vi.advanceTimersByTime(10_000));
    act(() =>
      root.render(
        h(CompanionCelebration, {
          ...props,
          items: [achItem(["Primera palabra"])],
          blocked: false,
          onSeen: () => undefined,
        }),
      ),
    );
    expect(toastText()).toBe("Primera palabra");
  });
});

// ---------- Inbox dentro del proveedor (idb simulada) ----------

const renderProvider = (userId: string | null, children?: ReactNode) =>
  act(() =>
    root.render(h(CompanionProvider, { userId, children })),
  );

const awardSaved = async () => {
  // Guardar una palabra real: el logro «palabra_1» entra por el
  // journal, no inventado — el festejo celebra ese premio.
  await game.award(
    { kind: "saved", zipf: null },
    idb.captureDbScope(),
    { id: "saved:es:gato:1", at: 1_000, dayKey: "2025-06-10" },
  );
};

describe("inbox de festejos dentro del proveedor", () => {
  it("logro nuevo: tarjeta → recibo achievement-seen persistido", async () => {
    await awardSaved();
    renderProvider(null);
    await flush();
    expect(toastText()).toContain("Primera palabra");
    // Marcado al mostrarse: el recibo existe en la base.
    await flush();
    const receipts = await idb.listCompanionReceipts(
      idb.captureDbScope(),
    );
    expect(receipts.map((r) => r.id)).toContain(
      "achievement-seen:palabra_1",
    );
    // Se retira a los 4 s y no vuelve tras remontar.
    act(() => void vi.advanceTimersByTime(CELEBRATION_MS.achievements));
    expect(toast()).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    renderProvider(null);
    await flush();
    expect(toast()).toBeNull();
  });

  it("subida de nivel real: tarjeta → recibos level-seen persistidos", async () => {
    // 40 min leídos = 40 XP cruza al nivel 2 (índice 1: «Apuntador») y
    // además desbloquea logros de lectura/sesión.
    await game.award(
      { kind: "read", ms: 40 * 60_000 },
      idb.captureDbScope(),
      { id: "read:level:1", at: 1_000, dayKey: "2025-06-10" },
    );
    renderProvider(null);
    await flush();
    // La primera tarjeta de la cola anuncia los logros desbloqueados
    expect(toastText()).toContain("Maratón");
    // Al vencer la de logros, sale la tarjeta de nivel
    act(() => void vi.advanceTimersByTime(CELEBRATION_MS.achievements));
    expect(toastText()).toContain("¡Nivel 2! Apuntador");
    await flush();
    const receipts = await idb.listCompanionReceipts(idb.captureDbScope());
    expect(receipts.map((r) => r.id)).toContain("level-seen:1");
    act(() => void vi.advanceTimersByTime(CELEBRATION_MS.level));
    expect(toast()).toBeNull();
  });

  it("baseline importada no celebra", async () => {
    // Estado v1 con el logro ya ganado: la migración lo sella como
    // baseline — es heredado, no un premio nuevo.
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
              saved: 1,
              rareSaved: 0,
              reviews: 0,
              booksFinished: 0,
              streakDays: 0,
              lastDayKey: null,
            },
            achievements: { palabra_1: 500 },
            chests: [],
            finishedBooks: [],
            caredAt: 800,
          }),
        ],
      ]),
    );
    renderProvider(null);
    await flush();
    await flush();
    expect(toast()).toBeNull();
    const receipts = await idb.listCompanionReceipts(
      idb.captureDbScope(),
    );
    expect(receipts.map((r) => r.id)).not.toContain(
      "achievement-seen:palabra_1",
    );
  });

  it("suprimida/bloqueada queda pendiente sin marcar como vista", async () => {
    await awardSaved();
    // La superficie reporta «bloqueada» al montar — como el lector
    // con presencia «off» o supresión por libro.
    const Surface = ({ blocked }: { blocked: boolean }) => {
      const c = useCompanion();
      const report = c.setCelebrationBlocked;
      useEffect(() => {
        report(blocked);
      }, [blocked, report]);
      return null;
    };
    renderProvider(null, h(Surface, { blocked: true }));
    await flush();
    await flush();
    act(() => void vi.advanceTimersByTime(60_000));
    await flush();
    // La superficie bloqueada: ni tarjeta ni recibo.
    expect(toast()).toBeNull();
    let receipts = await idb.listCompanionReceipts(
      idb.captureDbScope(),
    );
    expect(receipts.map((r) => r.id)).not.toContain(
      "achievement-seen:palabra_1",
    );
    // Al liberarse se muestra y entonces sí queda vista.
    renderProvider(null, h(Surface, { blocked: false }));
    await flush();
    expect(toastText()).toContain("Primera palabra");
    await flush();
    receipts = await idb.listCompanionReceipts(idb.captureDbScope());
    expect(receipts.map((r) => r.id)).toContain(
      "achievement-seen:palabra_1",
    );
  });

  it("la hoja de cuidado abierta también difiere el festejo", async () => {
    await awardSaved();
    const Opener = () => {
      const c = useCompanion();
      return h(
        "button",
        { onClick: c.openPanel, "data-testid": "open" },
        "abrir",
      );
    };
    renderProvider(null, h(Opener));
    // La hoja se abre ANTES de que lleguen los datos: el festejo
    // espera a que la superficie quede libre.
    act(() => {
      host
        .querySelector("[data-testid=open]")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();
    expect(host.querySelector(".sheet")).not.toBeNull();
    expect(toast()).toBeNull();
    const receipts = await idb.listCompanionReceipts(
      idb.captureDbScope(),
    );
    expect(receipts.map((r) => r.id)).not.toContain(
      "achievement-seen:palabra_1",
    );
  });

  it("cambio de cuenta A→B no arrastra los festejos de A", async () => {
    await idb.setDbUser("ua");
    await awardSaved();
    renderProvider("ua");
    await flush();
    expect(toastText()).toContain("Primera palabra");

    await act(async () => {
      await idb.setDbUser("ub");
    });
    renderProvider("ub");
    await flush();
    await flush();
    // La cuenta B arrancó sin logros: ninguna tarjeta de A queda.
    expect(toast()).toBeNull();
    const receiptsB = await idb.listCompanionReceipts(
      idb.captureDbScope(),
    );
    expect(receiptsB.map((r) => r.id)).not.toContain(
      "achievement-seen:palabra_1",
    );
  });
});
