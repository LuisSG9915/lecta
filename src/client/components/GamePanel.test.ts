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
  localStorage.clear();
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

  it("muestra la barra de progreso de tinta y la meta próxima con sello sin trofeos", async () => {
    await renderPanel();
    // Progreso con ProgressInk
    expect(host.querySelector(".progress-ink")).toBeTruthy();
    // Meta próxima presente con Seal
    const nextGoal = host.querySelector(".game-next-goal");
    expect(nextGoal).toBeTruthy();
    expect(nextGoal?.querySelector(".seal")).toBeTruthy();
    // No hay lista plana ni emojis de trofeo
    expect(host.querySelector(".game-badges")).toBeNull();
    expect(host.textContent).not.toContain("🏆");
  });

  it("renderiza el Taller con el Gato IA y permite evaluar una frase", async () => {
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "ai_workshop",
            words: [
              {
                word: "relicario",
                meaning: "Lugar sagrado o estuche donde se guardan reliquias",
              },
            ],
          }),
        }),
      ),
    );
    await flush();

    expect(host.querySelector(".game-ai-workshop")).toBeTruthy();
    expect(host.textContent).toContain("El Reto del Escritor");
    expect(host.textContent).toContain("Cuento de Tinta");
    expect(host.textContent).toContain("relicario");

    // Escribir una oración
    const textarea = host.querySelector("textarea")!;
    expect(textarea).toBeTruthy();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      nativeSetter?.call(
        textarea,
        "Guardó la carta en el viejo relicario de plata.",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    const reviewBtn = button("Revisar con el Gato")!;
    expect(reviewBtn).toBeTruthy();
    click(reviewBtn);
    await flush();
    await flush();

    // Se evalúa y muestra la puntuación y retroalimentación
    expect(host.querySelector(".ai-result-panel")).toBeTruthy();
    expect(host.textContent).toContain("/ 100");
    expect(host.textContent).toContain("relicario");
  });

  it("permite tejer un Cuento de Tinta con las palabras del cuaderno", async () => {
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "ai_workshop",
            words: [
              { word: "sombra" },
              { word: "antiguo" },
            ],
          }),
        }),
      ),
    );
    await flush();

    // Cambiar a la pestaña de cuento
    const storyTab = button("Cuento de Tinta")!;
    expect(storyTab).toBeTruthy();
    click(storyTab);
    await flush();

    expect(host.textContent).toContain("Palabras del cuaderno que se integrarán en el cuento");
    expect(host.textContent).toContain("«sombra»");
    expect(host.textContent).toContain("«antiguo»");

    const weaveBtn = button("Tejer Cuento con el Gato")!;
    expect(weaveBtn).toBeTruthy();
    click(weaveBtn);
    await flush();

    expect(host.querySelector(".ai-story-card")).toBeTruthy();
    expect(host.querySelector(".ai-story-highlight")).toBeTruthy();
  });

  it("renderiza el botón de consolidación post-capítulo y responde al toque", async () => {
    const onStartConsolidation = vi.fn();
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "post_chapter_consolidation",
            onStartConsolidation,
          }),
        }),
      ),
    );
    await flush();

    const btn = button("Fijar Palabras del Capítulo");
    expect(btn).toBeTruthy();
    click(btn!);
    expect(onStartConsolidation).toHaveBeenCalledTimes(1);
  });

  it("renderiza la tarjeta de consolidación post-capítulo (25s) y permite continuar o iniciar reto", async () => {
    const onStartConsolidation = vi.fn();
    const onContinueNextChapter = vi.fn();
    const queue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Fantasía",
          chapterSentence: "Buscaba una quimera.",
          chapterTitle: "Cap. 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
      {
        item: {
          lemma: "efímero",
          surfaceForm: "efímero",
          lang: "es",
          shortGloss: "Pasajero",
          chapterSentence: "Un instante efímero.",
          chapterTitle: "Cap. 1",
          source: "pre-chapter-primed" as const,
        },
        modality: "word-scramble" as const,
      },
    ];

    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "post_chapter_consolidation",
            consolidationQueue: queue,
            onStartConsolidation,
            onContinueNextChapter,
          }),
        }),
      ),
    );
    await flush();

    expect(host.textContent).toContain("Fija en tu memoria 2 palabras de este capítulo (~25 s)");
    expect(host.textContent).toContain("quimera");
    expect(host.textContent).toContain("efímero");

    // Botón principal prominente para saltar sin fricción
    const skipBtn = button("Continuar al siguiente capítulo");
    expect(skipBtn).toBeTruthy();
    click(skipBtn!);
    expect(onContinueNextChapter).toHaveBeenCalledTimes(1);

    // Botón para iniciar el reto
    const startBtn = button("Fijar palabras (~25 s)");
    expect(startBtn).toBeTruthy();
    click(startBtn!);
    expect(onStartConsolidation).toHaveBeenCalledTimes(1);
  });

  it("permite silenciar la consolidación para el libro en 1 clic desde GamePanel", async () => {
    const queue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Fantasía",
          chapterSentence: "Buscaba una quimera.",
          chapterTitle: "Cap. 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "post_chapter_consolidation",
            consolidationQueue: queue,
            bookId: "book-101",
          }),
        }),
      ),
    );
    await flush();

    expect(host.textContent).toContain("Fija en tu memoria 1 palabras");

    // Abrir menú de opciones
    const optionsBtn = button("Opciones ▾");
    expect(optionsBtn).toBeTruthy();
    click(optionsBtn!);
    await flush();

    const muteBtn = button("Ocultar en este libro");
    expect(muteBtn).toBeTruthy();
    click(muteBtn!);
    await flush();

    // La tarjeta desaparece
    expect(host.textContent).not.toContain("Fija en tu memoria 1 palabras");
  });

  it("permite desactivar la consolidación globalmente desde GamePanel", async () => {
    const queue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Fantasía",
          chapterSentence: "Buscaba una quimera.",
          chapterTitle: "Cap. 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "post_chapter_consolidation",
            consolidationQueue: queue,
          }),
        }),
      ),
    );
    await flush();

    const optionsBtn = button("Opciones ▾");
    click(optionsBtn!);
    await flush();

    const disableBtn = button("Desactivar consolidación al final de capítulo siempre");
    expect(disableBtn).toBeTruthy();
    click(disableBtn!);
    await flush();

    expect(host.textContent).not.toContain("Fija en tu memoria 1 palabras");
  });

  it("muestra la píldora de contexto literario '📖 Eco de: {bookTitle}' en la tarjeta de palabra", async () => {
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "ai_workshop",
            words: [
              {
                word: "relicario",
                meaning: "Lugar sagrado",
                bookTitle: "La sombra del viento",
              },
            ],
          }),
        }),
      ),
    );
    await flush();

    expect(host.textContent).toContain("📖 Eco de: La sombra del viento");
  });

  it("muestra el estado vacío humanizado cuando no hay palabras pendientes con botón 'Volver a mi lectura'", async () => {
    const onReturnToReading = vi.fn();
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            mode: "adaptive_flow",
            words: [],
            onReturnToReading,
          }),
        }),
      ),
    );
    await flush();

    expect(host.textContent).toContain(
      "✨ Tu memoria está al día. Sigue disfrutando tu libro; Lecta guardará aquí los momentos y palabras que quieras conservar.",
    );

    const returnBtn = button("Volver a mi lectura");
    expect(returnBtn).toBeTruthy();
    click(returnBtn!);
    expect(onReturnToReading).toHaveBeenCalledTimes(1);
  });

  it("celebra el final de una ronda rápida mostrando palabras afianzadas para el próximo capítulo", async () => {
    const onReturnToReading = vi.fn();
    act(() =>
      root.render(
        h(CompanionProvider, {
          userId: null,
          children: h(GamePanel, {
            roundFinished: true,
            wordsReviewedCount: 4,
            onReturnToReading,
          }),
        }),
      ),
    );
    await flush();

    expect(host.textContent).toContain("Ecos de tus lecturas afianzados");
    expect(host.textContent).toContain("Afianzaste 4 palabras para tu próximo capítulo");

    const returnBtn = button("Volver a mi lectura");
    expect(returnBtn).toBeTruthy();
    click(returnBtn!);
    expect(onReturnToReading).toHaveBeenCalledTimes(1);
  });
});



