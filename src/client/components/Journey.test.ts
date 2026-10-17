// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Journey from "./Journey";
import type { SavedBookPosition, SavedInterval, SavedReview, SavedWord, StoredBook } from "../lib/idb";

import { emptyGameState, type GameState } from "../../shared/gamification";

// Mocks de idb
let mockIntervals: SavedInterval[] = [];
let mockWords: SavedWord[] = [];
let mockPositions: SavedBookPosition[] = [];
let mockReviews: SavedReview[] = [];

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
    loadSessionValue: vi.fn(async () => null),
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
    mockCompanionContext = null;
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

    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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


    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Compañero · Michi");
    expect(container?.textContent).toContain("4 días seguidos");
    expect(container?.querySelector(".journey-companion-section")).toBeTruthy();
    expect(container?.querySelectorAll(".journey-seal-item").length).toBe(8);
  });

  it("muestra la cuadrícula de exlibris para libros concluidos", async () => {
    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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
    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Libros concluidos");
    expect(container?.textContent).toContain("Aún no has terminado ningún libro");
  });

  it("renderiza el Rango Literario y el Sendero de Tinta con sus hitos", async () => {
    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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

    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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

    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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
    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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
    await act(async () => {
      root?.render(h(Journey, { onClose: vi.fn(), books: sampleBooks }));
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
});

