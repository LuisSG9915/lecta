// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shelf, { type ShelfItem } from "./Shelf";
import { repairRemoteBook } from "../lib/books";

vi.mock("../lib/books", () => ({
  repairRemoteBook: vi.fn(async () => ({
    title: "Libro Reparado",
    author: "Autor Real",
    hasCover: true,
  })),
  fetchBookCover: vi.fn(async () => null),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    captureDbScope: vi.fn(() => ({})),
    loadShelfBootstrap: vi.fn(async () => ({
      positions: [
        {
          bookHash: "h-test-1",
          sectionIndex: 0,
          progress: 0.1,
          updatedAt: Date.now() - 1000,
        },
      ],
      savedWords: [],
      latestHash: "h-test-1",
      readingDays: [],
      intervals: [],
      rawGoal: JSON.stringify({ version: 1, daysPerWeek: 5, updatedAt: 1 }),
    })),
    listStoredBooks: vi.fn(async () => []),
    updateBookMeta: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/book-vocab", () => ({
  loadBookVocab: vi.fn(async () => ({
    v: 1,
    wordCount: 1000,
    uniqueForms: 100,
    forms: ["arcano", "efimero"],
    entries: [],
    byForm: {},
    missing: [],
  })),
  analyzeStoredBook: vi.fn(async () => null),
}));

vi.mock("../lib/coverage", () => ({
  createCoverageInputsLoader: vi.fn(() => async () => ({
    saved: new Set(),
    knowledge: new Map(),
    threshold: 0,
    confidence: "mid" as const,
    evidenceCount: 10,
  })),
  coverageOfBook: vi.fn(() => ({
    percent: 92,
    total: 1000,
    missing: 10,
    uncertain: 20,
    measuredShare: 0.97,
    newWordsCount: 80,
  })),
  coverageIsReliable: vi.fn(
    (cov: { measuredShare: number }) => cov.measuredShare >= 0.6,
  ),
  COVERAGE_UNMEASURED_LABEL: "Vocabulario aún sin medir",
  affinityTierOf: vi.fn(() => "reto"),
  affinityBadgeLabel: vi.fn(() => "Reto Ideal (i+1)"),
}));

vi.mock("./CompanionProvider", () => ({
  useCompanion: vi.fn(() => ({
    enabled: true,
    state: { stats: { streakDays: 4, lastDayKey: "2026-03-10" } },
    stage: 2,
    mood: "content",
    accessories: [],
    reducedMotion: false,
    activeCare: null,
    care: vi.fn(),
  })),
}));

vi.mock("./BookCover", () => ({
  default: () => h("div", { className: "mock-book-cover" }, "Cover"),
}));

vi.mock("./DiscoverRail", () => ({
  default: () => null,
}));

vi.mock("./CompanionStage", () => ({
  CompanionStage: () => h("div", { "data-testid": "companion-stage" }, "CompanionStage"),
}));

const mockBook: ShelfItem = {
  hash: "h-test-1",
  name: "Cien Años de Soledad",
  title: "Cien Años de Soledad",
  author: "Gabriel García Márquez",
  language: "es",
  addedAt: 1,
  sectionCount: 10,
};

describe("Cobertura de vocabulario en Estantería (sin escrituras ocultas)", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("el destacado muestra «% vocabulario conocido» sin botón de activar ayudas", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: [mockBook],
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const badge = host.querySelector(".shelf-affinity-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("92% vocabulario conocido");

    // El pre-vuelo con escrituras al Cuaderno ya no existe: no hay
    // botón de «Activar ayudas» ni texto de «palabras nuevas».
    expect(host.querySelector(".btn--activate-assists")).toBeNull();
    expect(host.querySelector(".shelf-difficulty-preflight")).toBeNull();
    expect(host.textContent).not.toContain("palabras nuevas");
  });

  it("las filas muestran el mismo encuadre «% vocabulario conocido», sin botón", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: [mockBook],
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const rowChip = host.querySelector(".shelf-difficulty-preflight-item");
    expect(rowChip).not.toBeNull();
    expect(rowChip?.textContent).toContain("~92% vocabulario conocido");
    expect(rowChip?.querySelector("button")).toBeNull();
  });

  it("tocar el libro abre el lector en 0 segundos sin modales bloqueantes", async () => {
    const onOpen = vi.fn();

    await act(async () => {
      root.render(
        h(Shelf, {
          library: [mockBook],
          checking: false,
          onOpen,
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const cover = host.querySelector<HTMLButtonElement>(".shelf-hero-cover");
    expect(cover).not.toBeNull();

    await act(async () => {
      cover?.click();
    });

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "h-test-1" }),
    );
  });

  it("un libro remoteOnly con título 'Libro en la nube' ejecuta repair y abre opciones con botón 'Descargar y abrir'", async () => {
    const onOpen = vi.fn();
    const remoteItem: ShelfItem = {
      hash: "h-remote-cloud",
      name: "Libro en la nube",
      addedAt: Date.now(),
      remoteOnly: true,
      title: "Libro en la nube",
    };

    await act(async () => {
      root.render(
        h(Shelf, {
          library: [mockBook, remoteItem],
          checking: false,
          onOpen,
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const remoteCard = host.querySelector<HTMLButtonElement>('button[aria-label*="Libro en la nube"]');
    expect(remoteCard).not.toBeNull();

    await act(async () => {
      remoteCard?.click();
      await Promise.resolve();
    });

    // NO abre el lector directamente
    expect(onOpen).not.toHaveBeenCalled();
    expect(repairRemoteBook).toHaveBeenCalledWith("h-remote-cloud");

    // Despliega el panel de opciones
    const downloadBtn = host.querySelector<HTMLButtonElement>(".shelf-options-download-btn");
    expect(downloadBtn).not.toBeNull();
    expect(downloadBtn?.textContent).toContain("Descargar y abrir");
  });
});
