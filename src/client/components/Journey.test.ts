// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Journey from "./Journey";
import type { KnownWord, SavedBookPosition, SavedInterval, SavedReview, SavedWord, StoredBook } from "../lib/idb";

import { emptyGameState, type GameState } from "../../shared/gamification";

// Mocks de idb
let mockIntervals: SavedInterval[] = [];
let mockWords: SavedWord[] = [];
let mockPositions: SavedBookPosition[] = [];
let mockReviews: SavedReview[] = [];
let mockKnowledge: KnownWord[] = [];
let mockSessionKeys: string[] = [];
let mockSession: Record<string, string> = {};

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    captureDbScope: vi.fn(() => ({ dbName: "lecta", userId: null })),
    listIntervals: vi.fn(async () => mockIntervals),
    listSavedWords: vi.fn(async () => mockWords),
    listPositions: vi.fn(async () => mockPositions),
    listAllReviews: vi.fn(async () => mockReviews),
    listReadingEvents: vi.fn(async () => []),
    listKnowledge: vi.fn(async () => mockKnowledge),
    listSessionKeys: vi.fn(async () => mockSessionKeys),
    loadSessionValue: vi.fn(async (key: string) => mockSession[key] ?? null),
    saveSessionValue: vi.fn(async () => {}),
  };
});

// Mock de CompanionProvider
let mockCompanionContext: {
  enabled: boolean | null;
  name: string;
  stage: number;
  mood: string;
  state: GameState | null;
} | null = null;

vi.mock("./CompanionProvider", () => ({
  useCompanionSafe: vi.fn(() => mockCompanionContext),
}));

describe("Journey (Tu recorrido)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    mockIntervals = [
      {
        id: "int-1",
        bookHash: "book-1",
        startedAt: new Date("2026-10-10T10:00:00Z").getTime(),
        endedAt: new Date("2026-10-10T10:30:00Z").getTime(),
      },
    ];
    mockWords = [
      {
        key: "es:casa",
        card: { state: 2, reps: 3, lapses: 0, stability: 100, difficulty: 3, due: 0, last_review: 0 },
        savedAt: new Date("2026-10-10T10:05:00Z").getTime(),
        original: "casa",
        bookHash: "book-1",
      } as unknown as SavedWord,
      {
        key: "es:perro",
        card: { state: 0, reps: 0, lapses: 0, stability: 0, difficulty: 0, due: 0, last_review: 0 },
        savedAt: new Date("2026-10-10T10:10:00Z").getTime(),
        original: "perro",
        bookHash: "book-1",
      } as unknown as SavedWord,
    ];
    mockPositions = [
      {
        bookHash: "book-1",
        sectionIndex: 10,
        progress: 1.0,
        scrollTop: 0,
        updatedAt: Date.now(),
      },
    ];
    mockReviews = [
      {
        id: "rev-1",
        language: "es",
        form: "casa",
        kind: "word",
        rating: "good",
        hints: 0,
        createdAt: new Date("2026-10-10T12:00:00Z").getTime(),
      },
    ];
    mockKnowledge = [];
    mockCompanionContext = null;
    mockSessionKeys = [];
    mockSession = {};
  });

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  const sampleBooks: Pick<StoredBook, "hash" | "name" | "title" | "author" | "language" | "cover">[] = [
    {
      hash: "book-1",
      name: "El Quijote.epub",
      title: "Don Quijote",
      author: "Miguel de Cervantes",
      language: "es",
    },
  ];

  it("renderiza el título, métricas de resumen y etapas FSRS", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose, books: sampleBooks }));
    });
    // Esperar a que se resuelvan las promesas de carga
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Tu recorrido");
    expect(container?.textContent).toContain("Tiempo leído");
    expect(container?.textContent).toContain("Libro terminado");
    expect(container?.textContent).toContain("Palabras guardadas");

    // Vocabulario por etapas
    expect(container?.textContent).toContain("Vocabulario por etapas");
    expect(container?.textContent).toContain("Asentada");
    expect(container?.textContent).toContain("Aprendiendo");
    expect(container?.textContent).toContain("Nueva");
  });

  it("termina la carga y ofrece reintentar cuando una lectura no responde", async () => {
    // Regresión: el recorrido se quedaba en «Cargando tu recorrido…» para
    // siempre cuando una lectura de IndexedDB no se resolvía (base
    // encolada tras un borrado bloqueado). Ahora caduca y se pinta igual.
    const idbModule = await import("../lib/idb");
    vi.mocked(idbModule.listIntervals).mockImplementationOnce(
      () => new Promise<SavedInterval[]>(() => {}),
    );
    vi.useFakeTimers();
    const onClose = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose, books: sampleBooks }));
    });

    expect(container?.textContent).toContain("Cargando tu recorrido");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_100);
    });

    expect(container?.textContent).not.toContain("Cargando tu recorrido");
    expect(container?.textContent).toContain("Tu recorrido");
    expect(container?.textContent).toContain("Reintentar");
    vi.useRealTimers();
  });

  it("llama a onClose al pulsar el botón Cerrar", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const closeBtn = container?.querySelector("button[aria-label='Cerrar recorrido']");
    expect(closeBtn).toBeTruthy();
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("no muestra la sección del compañero cuando está deshabilitado", async () => {
    mockCompanionContext = {
      enabled: false,
      name: "Michi",
      stage: 1,
      mood: "sleepy",
      state: null,
    };

    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("Compañero · Michi");
    expect(container?.querySelector(".journey-companion-section")).toBeNull();
  });

  it("muestra la sección del compañero con nivel y sellos cuando está habilitado", async () => {
    const baseState = emptyGameState();
    mockCompanionContext = {
      enabled: true,
      name: "Michi",
      stage: 2,
      mood: "happy",
      state: {
        ...baseState,
        xp: 120,
        stats: {
          ...baseState.stats,
          streakDays: 4,
        },
        achievements: { palabra_1: Date.now() },
      },
    };


    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Compañero · Michi");
    expect(container?.textContent).toContain("4 días seguidos");
    expect(container?.querySelector(".journey-companion-section")).toBeTruthy();
    expect(container?.querySelectorAll(".journey-seal-item").length).toBe(8);
  });

  it("muestra cuántos capítulos sentiste al día, como valoración propia", async () => {
    mockSessionKeys = [
      "chapterFollow:v1:book-1:Cap%201",
      "chapterFollow:v1:book-1:Cap%202",
      "preparation:v1:book-1:cap1",
    ];
    mockSession = {
      "chapterFollow:v1:book-1:Cap%201": JSON.stringify({ version: 1, level: "al-dia", updatedAt: 1 }),
      "chapterFollow:v1:book-1:Cap%202": JSON.stringify({ version: 1, level: "perdido", updatedAt: 2 }),
    };
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(container?.textContent).toContain("Seguiste el hilo en 1 de 2 capítulos");
  });

  it("muestra la cuadrícula de exlibris para libros concluidos", async () => {
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Libros concluidos");
    expect(container?.textContent).toContain("Don Quijote");
    expect(container?.textContent).toContain("Miguel de Cervantes");
  });

  it("muestra mensaje sobrio cuando no hay libros concluidos", async () => {
    mockPositions = [];
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Libros concluidos");
    expect(container?.textContent).toContain("Aún no has terminado ningún libro");
  });

  it("renderiza el Rango Literario y el Sendero de Tinta con sus hitos", async () => {
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Rango Literario");
    expect(container?.textContent).toContain("El Sendero de Tinta");
    expect(container?.textContent).toContain("pts de tinta");
    expect(container?.querySelector(".journey-milestone-banner")).toBeTruthy();

    const nodes = container?.querySelectorAll(".ink-node-btn");
    expect(nodes?.length).toBe(7);
  });

  it("muestra los botones de acción del santuario y abre el buzón de cartas", async () => {
    const baseState = emptyGameState();
    const openPanelMock = vi.fn();
    mockCompanionContext = {
      enabled: true,
      name: "Michi",
      stage: 2,
      mood: "happy",
      state: baseState,
      openPanel: openPanelMock,
    } as unknown as typeof mockCompanionContext;

    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Vestidor del Gato");
    expect(container?.textContent).toContain("Buzón del Gato");
    expect(container?.textContent).toContain("Ajustar Meta Diaria");

    // Abrir vestidor del gato
    const closetBtn = container?.querySelector("button[aria-label='Abrir vestidor del gato']");
    expect(closetBtn).toBeTruthy();
    await act(async () => {
      closetBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openPanelMock).toHaveBeenCalledWith("closet");
    // El vestidor sustituye la hoja del recorrido: nunca dos modales.
    expect(closeMock).toHaveBeenCalled();

    // Abrir buzón
    const inboxBtn = container?.querySelector("button[aria-label^='Buzón del Gato']");
    expect(inboxBtn).toBeTruthy();
    await act(async () => {
      inboxBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Buzón de Tinta 💌");
    expect(container?.textContent).toContain("Correspondencia");

    // Cerrar buzón
    const closeInboxBtn = container?.querySelector("button[aria-label='Cerrar buzón']");
    expect(closeInboxBtn).toBeTruthy();
    await act(async () => {
      closeInboxBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container?.textContent).not.toContain("Correspondencia");
  });

  it("permite ajustar la meta de lectura diaria desde el santuario", async () => {
    const baseState = emptyGameState();
    mockCompanionContext = {
      enabled: true,
      name: "Michi",
      stage: 1,
      mood: "awake",
      state: baseState,
    } as unknown as typeof mockCompanionContext;

    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const goalBtn = container?.querySelector("button[aria-label='Ajustar meta de lectura diaria']");
    expect(goalBtn).toBeTruthy();
    await act(async () => {
      goalBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Meta de Lectura Diaria 🎯");
    expect(container?.textContent).toContain("5");
    expect(container?.textContent).toContain("10");
    expect(container?.textContent).toContain("15");

    const saveGoalBtn = [...(container?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Guardar meta"),
    );
    expect(saveGoalBtn).toBeTruthy();
    await act(async () => {
      saveGoalBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.textContent).not.toContain("Hábito Sostenible");
  });

  it("al tocar un hito del sendero despliega su popover de detalle", async () => {
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const firstNode = container?.querySelector(".ink-node-btn");
    expect(firstNode).toBeTruthy();
    await act(async () => {
      firstNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector(".ink-node-popover")).toBeTruthy();
    expect(container?.textContent).toContain("Recompensa:");

    const closePopoverBtn = container?.querySelector("button[aria-label='Cerrar detalle de hito']");
    expect(closePopoverBtn).toBeTruthy();
    await act(async () => {
      closePopoverBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector(".ink-node-popover")).toBeFalsy();
  });

  it("renderiza el mapa de sendero con clases mobile-safe y nodos entre 24% y 74%", async () => {
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const trailMap = container?.querySelector(".journey__trail-map");
    expect(trailMap).toBeTruthy();

    const labels = container?.querySelectorAll(".journey__node-label");
    expect(labels?.length).toBeGreaterThan(0);

    const wrappers = container?.querySelectorAll(".ink-node-wrapper");
    expect(wrappers?.length).toBe(7);

    wrappers?.forEach((w) => {
      const leftStr = (w as HTMLElement).style.left;
      const leftVal = parseFloat(leftStr);
      expect(leftVal).toBeGreaterThanOrEqual(24);
      expect(leftVal).toBeLessThanOrEqual(74);
    });
  });

  it("renderiza el bloque de Horizonte de Palabras con curva SVG y contadores de dominio pasivo vs. activo", async () => {
    // 2 palabras pasivas en conocimiento + 1 consulta activa
    // más las 2 palabras guardadas en mockWords (casa, perro -> activas)
    mockKnowledge = [
      {
        key: "es:vislumbrar",
        language: "es",
        lemma: "vislumbrar",
        known: true,
        source: "passive_frontier",
        updatedAt: 1,
      },
      {
        key: "es:perenne",
        language: "es",
        lemma: "perenne",
        known: false,
        status: "familiar",
        passiveSeenCount: 3,
        source: "inferred",
        updatedAt: 1,
      },
      {
        key: "es:inmarcesible",
        language: "es",
        lemma: "inmarcesible",
        known: true,
        source: "in-chapter-lookup",
        updatedAt: 1,
      },
    ];

    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 1. Título de sección presente
    expect(container?.textContent).toContain("Tu horizonte de palabras");

    // 2. Contadores de desglose pasivo vs activo
    // Pasivas: vislumbrar, perenne = 2
    expect(container?.textContent).toContain("Absorbidas de corrido (2)");
    // Activas: inmarcesible (in-chapter-lookup) + casa, perro (en Cuaderno) = 3
    expect(container?.textContent).toContain("Exploradas al tocar (3)");

    // 3. Indicador de nivel léxico
    expect(container?.textContent).toContain("Nivel léxico ·");

    // 4. Curva SVG renderizada con role="img"
    const curveSvg = container?.querySelector(".journey-lexical-curve");
    expect(curveSvg).toBeTruthy();
    expect(curveSvg?.getAttribute("role")).toBe("img");
    expect(curveSvg?.getAttribute("aria-label")).toContain("Curva de crecimiento léxico");

    // 5. Barra de proporción
    const splitBar = container?.querySelector(".journey-mastery-split-bar");
    expect(splitBar).toBeTruthy();
    const passiveFill = container?.querySelector(".journey-mastery-passive-fill");
    const activeFill = container?.querySelector(".journey-mastery-active-fill");
    expect(passiveFill).toBeTruthy();
    expect(activeFill).toBeTruthy();
  });

  it("renderiza píldoras de idioma y tarjetas para multilingüe (Español e Inglés)", async () => {
    // Actividad en español e inglés
    mockKnowledge = [
      {
        key: "es:vislumbrar",
        language: "es",
        lemma: "vislumbrar",
        known: true,
        source: "passive",
        updatedAt: 1,
      },
      {
        key: "en:whisper",
        language: "en",
        lemma: "whisper",
        known: true,
        source: "passive",
        updatedAt: 1,
      },
    ];

    const multilingualBooks: Pick<StoredBook, "hash" | "name" | "title" | "author" | "language" | "cover">[] = [
      ...sampleBooks,
      {
        hash: "book-en",
        name: "Great Gatsby.epub",
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        language: "en",
      },
    ];

    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: multilingualBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Píldoras de selección presentes
    const pills = container?.querySelectorAll(".journey-lang-pill");
    expect(pills?.length).toBeGreaterThanOrEqual(2);
    const pillTexts = Array.from(pills || []).map((p) => p.textContent);
    expect(pillTexts).toContain("Español");
    expect(pillTexts).toContain("Inglés");

    // Ambas tarjetas de idioma presentes en la cuadrícula
    const cards = container?.querySelectorAll(".journey-lang-card");
    expect(cards?.length).toBe(2);

    // Curvas SVG para ambos idiomas
    const curves = container?.querySelectorAll(".journey-lexical-curve");
    expect(curves?.length).toBe(2);

    // Filtrar al pulsar la píldora de Inglés
    const enPill = Array.from(pills || []).find((p) => p.textContent?.includes("Inglés"));
    expect(enPill).toBeTruthy();
    await act(async () => {
      enPill?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const filteredCards = container?.querySelectorAll(".journey-lang-card");
    expect(filteredCards?.length).toBe(1);
    expect(filteredCards?.[0].textContent).toContain("Inglés");
  });

  it("renderiza el bloque de horizonte y la curva SVG sin errores ni NaN cuando el usuario tiene 0 palabras", async () => {
    mockWords = [];
    mockKnowledge = [];
    const closeMock = vi.fn();
    await act(async () => {
      root?.render(h(Journey, { onClose: closeMock, books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const lexicalSection = container?.querySelector(".journey-lexical-section");
    expect(lexicalSection).toBeTruthy();
    expect(container?.textContent).toContain("Tu horizonte de palabras");
    expect(container?.textContent).toContain("Nivel léxico ·");
    expect(container?.textContent).not.toContain("NaN");
    expect(container?.textContent).not.toContain("Infinity");

    const svg = container?.querySelector(".journey-lexical-curve");
    expect(svg).toBeTruthy();
    const paths = svg?.querySelectorAll("path");
    expect(paths?.length).toBeGreaterThanOrEqual(2);
    for (const p of Array.from(paths || [])) {
      const d = p.getAttribute("d");
      expect(d).toBeTruthy();
      expect(d).not.toContain("NaN");
      expect(d).not.toContain("undefined");
    }

    const circles = svg?.querySelectorAll("circle");
    expect(circles?.length).toBe(2);
    for (const c of Array.from(circles || [])) {
      expect(c.getAttribute("cx")).not.toContain("NaN");
      expect(c.getAttribute("cy")).not.toContain("NaN");
    }
  });
});


