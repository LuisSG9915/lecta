// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shelf, { type ShelfItem } from "./Shelf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    captureDbScope: vi.fn(() => ({})),
    loadShelfBootstrap: vi.fn(async () => ({
      positions: [
        {
          bookHash: "h-test-1",
          sectionIndex: 2,
          progress: 0.45,
          updatedAt: Date.now() - 3600_000,
        },
      ],
      savedWords: [
        {
          key: "es:palabra",
          bookHash: "h-test-1",
          card: { due: Date.now() - 1000 },
        },
      ],
      latestHash: "h-test-1",
      readingDays: [],
      intervals: [],
      rawGoal: JSON.stringify({ version: 1, daysPerWeek: 5, updatedAt: 1 }),
    })),
    listStoredBooks: vi.fn(async () => []),
    updateBookMeta: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/reading-goal", () => ({
  parseReadingGoal: vi.fn(() => ({ version: 1, daysPerWeek: 5, updatedAt: 1 })),
  weeklyGoalProgress: vi.fn(() => ({
    startKey: "2026-03-09",
    endKey: "2026-03-15",
    readDays: 3,
    target: 5,
    met: false,
    days: [],
  })),
}));

vi.mock("../lib/settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/settings")>();
  return {
    ...mod,
    loadActivityHidden: vi.fn(() => false),
    loadReaderSettings: vi.fn(() => ({
      strategyPreset: "focus",
    })),
    saveReaderSettings: vi.fn(),
  };
});

vi.mock("./CompanionProvider", () => ({
  useCompanion: vi.fn(() => ({
    enabled: true,
    state: {
      stats: {
        streakDays: 4,
        lastDayKey: "2026-03-10",
      },
    },
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
  CompanionStage: () =>
    h("div", { "data-testid": "companion-stage" }, "CompanionStage"),
}));

const mockLibrary: ShelfItem[] = [
  {
    hash: "h-test-1",
    name: "Don Quijote",
    title: "Don Quijote de la Mancha",
    author: "Miguel de Cervantes",
    addedAt: 1,
    sectionCount: 10,
    language: "es",
  },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("Shelf - Tu Mesa de Lectura (Fase 5.2)", () => {
  it("renderiza la sección Tu Mesa de Lectura con lomo de libro, modo de lectura y compañero", async () => {
    const onOpen = vi.fn();
    const onOpenPractice = vi.fn();

    await act(async () => {
      root.render(
        h(Shelf, {
          library: mockLibrary,
          checking: false,
          onOpen,
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
          onGetCatalogBook: vi.fn(),
          onDownloadBook: vi.fn(),
          onOpenPractice,
        }),
      );
      // Wait for bootstrap effect
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // Sección Tu Mesa de Lectura
    const heroSection = host.querySelector(".shelf-hero.shelf-reading-table");
    expect(heroSection).toBeTruthy();
    expect(heroSection?.getAttribute("aria-label")).toBe("Tu Mesa de Lectura");

    // Lomo de libro realista
    const coverBtn = host.querySelector(".shelf-hero-cover.shelf-book-spine");
    expect(coverBtn).toBeTruthy();

    // Título del libro
    expect(heroSection?.textContent).toContain("Don Quijote de la Mancha");

    // Botón continuar con el modo activo (Modo Enfoque)
    const continueBtn = host.querySelector(".btn--hero-continue") as HTMLButtonElement;
    expect(continueBtn).toBeTruthy();
    expect(continueBtn.textContent).toContain("Continuar leyendo · Modo Enfoque");

    // CompanionStage en el lado derecho
    expect(host.querySelector("[data-testid='companion-stage']")).toBeTruthy();

    // Widget de meta semanal
    const goalWidget = host.querySelector(".shelf-goal-ring-widget");
    expect(goalWidget).toBeTruthy();
    expect(goalWidget?.textContent).toContain("3/5");

    // Botón de práctica rápida de 1 clic para palabras pendientes
    const quickPracticeBtn = host.querySelector(".btn--quick-practice") as HTMLButtonElement;
    expect(quickPracticeBtn).toBeTruthy();
    expect(quickPracticeBtn.textContent).toContain("Practicar 1 palabra pendiente");

    // Al pulsar práctica rápida, ejecuta onOpenPractice
    await act(async () => {
      quickPracticeBtn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(onOpenPractice).toHaveBeenCalledTimes(1);

    // Selector rápido de estrategia: cambiar a Explorador Léxico
    const lexicalPill = Array.from(host.querySelectorAll(".shelf-strategy-pill")).find(
      (btn) => btn.textContent?.includes("Explorador Léxico"),
    ) as HTMLButtonElement;
    expect(lexicalPill).toBeTruthy();

    await act(async () => {
      lexicalPill.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(continueBtn.textContent).toContain("Continuar leyendo · Modo Léxico");

    // Botón secundario de pre-entrenar palabras
    const preTrainBtn = host.querySelector(".btn--pre-train") as HTMLButtonElement;
    expect(preTrainBtn).toBeTruthy();
    expect(preTrainBtn.textContent).toContain("Pre-entrenar 3 palabras del capítulo");

    await act(async () => {
      preTrainBtn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(onOpenPractice).toHaveBeenCalledTimes(2);

    // Rincón del gato e interactividad al acariciar
    const catContainer = host.querySelector(".shelf-hero-companion") as HTMLDivElement;
    expect(catContainer).toBeTruthy();
    expect(host.querySelector(".shelf-cat-pending-note")?.textContent).toContain(
      "Tienes 1 palabra lista en tu cuaderno",
    );

    await act(async () => {
      catContainer.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    // Clases semánticas de biblioteca móvil
    expect(host.querySelector(".shelf__desk-hero")).toBeTruthy();
    expect(host.querySelector(".shelf-hero-strategies")).toBeTruthy();
    expect(host.querySelector(".shelf__desk-companion")).toBeTruthy();

    // Filtros de estantería
    const filterPills = Array.from(host.querySelectorAll(".shelf-filter-pill"));
    expect(filterPills.length).toBeGreaterThanOrEqual(4);
    const readingPill = filterPills.find((p) => p.textContent?.includes("Leyendo ahora")) as HTMLButtonElement;
    const finishedPill = filterPills.find((p) => p.textContent?.includes("Terminados")) as HTMLButtonElement;
    expect(readingPill).toBeTruthy();
    expect(finishedPill).toBeTruthy();

    // Actualmente Don Quijote está en progreso (0.45), debe estar en Leyendo ahora
    await act(async () => {
      readingPill.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(host.querySelectorAll(".shelf-row .shelf-book").length).toBe(1);

    // En Terminados no debe haber libros
    await act(async () => {
      finishedPill.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(host.querySelectorAll(".shelf-row .shelf-book").length).toBe(0);
  });

  it("muestra la insignia de idioma EN para libros en inglés", async () => {
    const englishLibrary: ShelfItem[] = [
      {
        hash: "h-en-1",
        name: "Red Queen",
        title: "Red Queen",
        author: "Victoria Aveyard",
        addedAt: 1,
        sectionCount: 70,
        language: "en",
      },
    ];

    await act(async () => {
      root.render(
        h(Shelf, {
          library: englishLibrary,
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    const badge = host.querySelector(".shelf-lang-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe("EN");
    expect(badge?.getAttribute("title")).toBe("Idioma: Inglés");
  });

  it("muestra el Banner de Primera Lectura en 1 Clic cuando no hay libros (Fase 1)", async () => {
    const onAdd = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["test-epub"]),
      })),
    );

    await act(async () => {
      root.render(
        h(Shelf, {
          library: [],
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd,
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    const hero = host.querySelector(".shelf-welcome-hero");
    expect(hero).toBeTruthy();
    expect(hero?.querySelector(".shelf-welcome-hero-title")?.textContent).toBe(
      "Vive cómo se siente leer sin interrupciones",
    );
    expect(hero?.querySelector(".shelf-welcome-hero-subtitle")?.textContent).toContain(
      "Abre nuestra edición interactiva de muestra o elige una obra gratuita abajo",
    );

    const btn = hero?.querySelector(".shelf-welcome-hero-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Empezar lectura de muestra ahora");

    const secondaryBtn = hero?.querySelector(".shelf-welcome-hero-btn-secondary") as HTMLButtonElement;
    expect(secondaryBtn).toBeTruthy();
    expect(secondaryBtn.textContent).toContain("Elegir archivo EPUB");

    // Zero-Friction: No ritual de 3 pasos ni tarjeta de gato en la primera apertura
    expect(host.querySelector(".shelf-onboarding-card")).toBeNull();
    expect(host.querySelector(".shelf__desk-companion")).toBeNull();

    await act(async () => {
      btn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("con 1 libro sin abrir, el Banner de 1 Clic lo abre directamente (Fase 1)", async () => {
    const onOpen = vi.fn();
    const unopenedBook: ShelfItem = {
      hash: "h-unopened-1",
      name: "Azul…",
      title: "Azul…",
      author: "Rubén Darío",
      addedAt: 1,
      sectionCount: 12,
      language: "es",
    };

    await act(async () => {
      root.render(
        h(Shelf, {
          library: [unopenedBook],
          checking: false,
          onOpen,
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    const hero = host.querySelector(".shelf-welcome-hero");
    expect(hero).toBeTruthy();

    const btn = hero?.querySelector(".shelf-welcome-hero-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(onOpen).toHaveBeenCalledWith(unopenedBook);
  });
});


