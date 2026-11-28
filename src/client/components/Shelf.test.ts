// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shelf, { type ShelfItem } from "./Shelf";
import { clearTtsLandingPosition, saveTtsLandingPosition } from "../lib/tts-landing";
import { consentTts } from "../lib/ttsSettings";

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
          card: { due: Date.now() - 1000, reps: 1 },
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

const loadDailyTip = vi.hoisted(() => vi.fn(async () => null as unknown));
vi.mock("../lib/tips", () => ({ loadDailyTip }));

vi.mock("./BookCover", () => ({
  default: () => h("div", { className: "mock-book-cover" }, "Cover"),
}));

vi.mock("./DiscoverRail", () => ({
  // El riel recibe `query` en vivo: el atributo deja comprobar que
  // filtra mientras se escribe, antes de enviar la búsqueda.
  default: (props: { query?: string }) =>
    h("div", {
      "data-testid": "discover-rail",
      "data-query": props.query ?? "",
    }),
}));

vi.mock("./GutenbergSearch", () => ({
  // `query` es el texto ya enviado; `pendingQuery` el escrito sin
  // enviar. El botón simula el envío de la fila «Buscar en todos».
  default: (props: {
    query?: string;
    pendingQuery?: string;
    onSubmitPending?: () => void;
  }) =>
    h("div", {
      "data-testid": "gutenberg-search",
      "data-query": props.query ?? "",
      "data-pending": props.pendingQuery ?? "",
    },
      h(
        "button",
        {
          type: "button",
          "data-testid": "gs-submit-pending",
          onClick: props.onSubmitPending,
        },
        "submit-pending",
      ),
    ),
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

// React escucha «input» para onChange: hay que fijar el valor por el
// setter nativo o el evento no actualiza el estado controlado.
const typeInto = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

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

describe("Shelf - Explora diferido", () => {
  // Debe ser la primera prueba que monta Shelf del archivo: una vez
  // que React.lazy resuelve el chunk, el respaldo ya no se puede ver.
  it("reserva el encabezado «Explora» mientras llega el chunk", async () => {
    // Un solo tick tras el render: el import() de ExploreShelf sigue
    // pendiente y el Suspense debe mostrar el respaldo con el título.
    await act(async () => {
      root.render(
        h(Shelf, {
          library: mockLibrary,
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
          onGetCatalogBook: vi.fn(),
          onDownloadBook: vi.fn(),
        }),
      );
      await Promise.resolve();
    });
    const fallback = host.querySelector(".shelf-explore[aria-busy='true']");
    expect(fallback?.textContent).toContain("Explora");
    expect(host.querySelector(".shelf-explore-tabs")).toBeNull();

    // Al resolver el chunk aparecen las pestañas reales. Se espera el
    // mismo import() que usa React.lazy: con la suite cargada el chunk
    // tardaba más que unas cuantas microtareas y la prueba fallaba sola.
    await act(async () => {
      await import("./ExploreShelf");
      // Esperar a que React monte el chunk resuelto (microtasks + macrotask).
      for (let i = 0; i < 50; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 50; i++) await Promise.resolve();
    });
    expect(host.querySelector(".shelf-explore-tabs")).toBeTruthy();
  });
});

describe("Shelf - consejo del día", () => {
  it("recalcula el consejo cuando la base de la cuenta queda activa", async () => {
    const tipText = "Hoy volviste atrás 12 veces en 20 min.";
    loadDailyTip.mockReset();
    // Primer montaje con la base anónima: sin historial, sin consejo.
    loadDailyTip.mockResolvedValueOnce(null);
    loadDailyTip.mockResolvedValueOnce({
      tip: tipText,
      action: "focus_ruler",
      version: "tip-local-v1",
      tipDay: "2026-03-10",
    });
    const props = {
      library: mockLibrary,
      checking: false,
      onOpen: vi.fn(),
      onRemove: vi.fn(),
      onAdd: vi.fn(),
      onLibraryChange: vi.fn(),
      onGetCatalogBook: vi.fn(),
      onDownloadBook: vi.fn(),
    };
    const flush = async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    };

    await act(async () => {
      root.render(h(Shelf, { ...props, dbUserId: null }));
      await flush();
    });
    expect(host.querySelector(".shelf-tip")).toBeNull();

    await act(async () => {
      root.render(h(Shelf, { ...props, dbUserId: "u1" }));
      await flush();
    });
    expect(loadDailyTip).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".shelf-tip")?.textContent).toContain(tipText);
  });
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
    expect(heroSection?.textContent).toContain("Capítulo 3 de 10 · 45% leído");
    expect(heroSection?.textContent).not.toContain("Quedan ~5 min");

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
      "¿Con qué quieres empezar hoy?",
    );
    expect(hero?.querySelector(".shelf-welcome-hero-subtitle")?.textContent).toContain(
      "Toca un libro y entra directo a la página",
    );

    const picks = [...(hero?.querySelectorAll(".shelf-welcome-pick-btn") ?? [])];
    expect(picks.length).toBe(3);
    expect(hero?.textContent).toContain("A Christmas Carol");
    expect(hero?.textContent).toContain("Alice's Adventures in Wonderland");
    expect(hero?.textContent).toContain("Marianela");

    const btn = hero?.querySelector(".shelf-welcome-hero-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("A Christmas Carol");

    const secondaryBtn = hero?.querySelector(".shelf-welcome-hero-btn-secondary") as HTMLButtonElement;
    expect(secondaryBtn).toBeTruthy();
    expect(secondaryBtn.textContent).toContain("Traer mi archivo EPUB");

    // Zero-Friction: sin checklist escolar ni tarjeta separada de gato ni jerga
    expect(host.querySelector(".shelf-onboarding-card")).toBeNull();
    expect(host.querySelector(".shelf__desk-companion")).toBeNull();
    expect(host.textContent).not.toMatch(/Estrategia|notas léxicas|45 seg/);

    await act(async () => {
      btn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("en la mesa inicial, tocar una recomendación dispara onGetCatalogBook si está disponible", async () => {
    const onGetCatalogBook = vi.fn(async () => "h-carol");
    await act(async () => {
      root.render(
        h(Shelf, {
          library: [],
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onGetCatalogBook,
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    const btn = host.querySelector(".shelf-welcome-hero-btn") as HTMLButtonElement;
    await act(async () => {
      btn.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(onGetCatalogBook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "christmas-carol", language: "en" }),
    );
  });

  it("incluso con lectura iniciada no muestra checklist de 3 pasos ni jerga de onboarding", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: [
            {
              hash: "h-test-1",
              name: "Azul…",
              title: "Azul…",
              author: "Rubén Darío",
              addedAt: 1,
              sectionCount: 10,
              language: "es",
            },
          ],
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
        }),
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

    expect(host.querySelector(".shelf-onboarding-card")).toBeNull();
    expect(host.textContent).not.toContain("Prepara tu lectura en 3 pasos");
    expect(host.textContent).not.toMatch(/Estrategia|45 seg/);
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

  describe("Fase 4.3: Búsqueda y Ordenación en la Estantería", () => {
    const multiBooks: ShelfItem[] = [
      {
        hash: "h-1",
        name: "quijote",
        title: "Don Quijote de la Mancha",
        author: "Miguel de Cervantes",
        addedAt: 100,
        sectionCount: 10,
        language: "es",
      },
      {
        hash: "h-2",
        name: "arbol",
        title: "El Árbol de la Ciencia",
        author: "Pío Baroja",
        addedAt: 200,
        sectionCount: 20,
        language: "es",
      },
      {
        hash: "h-3",
        name: "ficciones",
        title: "Ficciones",
        author: "Jorge Luis Borges",
        addedAt: 300,
        sectionCount: 5,
        language: "es",
      },
    ];

    it("filtra libros por título y autor sin distinción de mayúsculas ni acentos", async () => {
      await act(async () => {
        root.render(
          h(Shelf, {
            library: multiBooks,
            checking: false,
            onOpen: vi.fn(),
            onRemove: vi.fn(),
            onAdd: vi.fn(),
            onLibraryChange: vi.fn(),
          }),
        );
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      const searchInput = host.querySelector<HTMLInputElement>(".shelf-search-input");
      expect(searchInput).toBeTruthy();

      // Búsqueda por título sin acento: "arbol" debe encontrar "El Árbol de la Ciencia"
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(searchInput, "arbol");
        searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput?.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const titlesAfterSearch1 = Array.from(
        host.querySelectorAll(".shelf-row .shelf-book-cover"),
      ).map((el) => el.getAttribute("title"));
      expect(titlesAfterSearch1.some((t) => t?.includes("Árbol"))).toBe(true);
      expect(titlesAfterSearch1.some((t) => t?.includes("Quijote"))).toBe(false);
      expect(titlesAfterSearch1.some((t) => t?.includes("Ficciones"))).toBe(false);

      // Búsqueda por autor: "cervantes" debe encontrar "Don Quijote de la Mancha"
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(searchInput, "cervantes");
        searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput?.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const titlesAfterSearch2 = Array.from(
        host.querySelectorAll(".shelf-row .shelf-book-cover"),
      ).map((el) => el.getAttribute("title"));
      expect(titlesAfterSearch2.some((t) => t?.includes("Quijote"))).toBe(true);
      expect(titlesAfterSearch2.some((t) => t?.includes("Árbol"))).toBe(false);

      // Búsqueda sin coincidencias muestra mensaje discreto
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(searchInput, "inexistente xyz");
        searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput?.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const emptyMsg = host.querySelector(".shelf-empty-search");
      expect(emptyMsg).toBeTruthy();
      expect(emptyMsg?.textContent).toContain("inexistente xyz");
    });

    it("ordena libros por título, progreso y recientes", async () => {
      await act(async () => {
        root.render(
          h(Shelf, {
            library: multiBooks,
            checking: false,
            onOpen: vi.fn(),
            onRemove: vi.fn(),
            onAdd: vi.fn(),
            onLibraryChange: vi.fn(),
          }),
        );
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      const sortSelect = host.querySelector<HTMLSelectElement>(".shelf-sort-select");
      expect(sortSelect).toBeTruthy();

      // Ordenar por título alfabético
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )!.set!;
        setter.call(sortSelect, "title");
        sortSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const titlesByTitle = Array.from(
        host.querySelectorAll(".shelf-row .shelf-book-cover"),
      ).map((el) => el.getAttribute("title"));
      expect(titlesByTitle[0]).toContain("Don Quijote");
      expect(titlesByTitle[1]).toContain("El Árbol");
      expect(titlesByTitle[2]).toContain("Ficciones");
    });
  });
});



describe("Shelf - Libros gratuitos", () => {
  it("muestra un solo buscador compartido en la pestaña del catálogo", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: mockLibrary,
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
          onGetCatalogBook: vi.fn(),
          onDownloadBook: vi.fn(),
        }),
      );
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Libros gratuitos",
    )!;
    expect(tab).toBeTruthy();
    await act(async () => tab.click());
    // El chunk de GutenbergSearch es lazy: darle margen al import.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const input = host.querySelector<HTMLInputElement>("#free-books-search");
    expect(input).toBeTruthy();
    expect(input?.getAttribute("type")).toBe("search");
    // Un solo campo: el panel de Gutenberg no repite el suyo cuando la
    // búsqueda viene controlada desde la pestaña.
    expect(host.querySelector("#gutenberg-search-field")).toBeNull();
  });

  it("escribir filtra el riel en vivo; solo enviar busca en Gutenberg", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: mockLibrary,
          checking: false,
          onOpen: vi.fn(),
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
          onGetCatalogBook: vi.fn(),
          onDownloadBook: vi.fn(),
        }),
      );
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Libros gratuitos",
    )!;
    await act(async () => tab.click());
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const input = host.querySelector<HTMLInputElement>("#free-books-search")!;
    const rail = () =>
      host.querySelector("[data-testid='discover-rail']");
    const gutenberg = () =>
      host.querySelector("[data-testid='gutenberg-search']");

    // Escribir filtra el riel curado en vivo y deja el texto como
    // pendiente en Gutenberg: la búsqueda completa no se dispara.
    await act(async () => typeInto(input, "dickens"));
    expect(rail()?.getAttribute("data-query")).toBe("dickens");
    expect(gutenberg()?.getAttribute("data-query")).toBe("");
    expect(gutenberg()?.getAttribute("data-pending")).toBe("dickens");

    // Enter en el formulario envía la búsqueda una sola vez.
    const form = host.querySelector("form[role='search']")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(gutenberg()?.getAttribute("data-query")).toBe("dickens");
    expect(gutenberg()?.getAttribute("data-pending")).toBe("");

    // La fila «Buscar en todos los clásicos» también envía.
    await act(async () => typeInto(input, "austen"));
    const submitPending = host.querySelector<HTMLButtonElement>(
      "[data-testid='gs-submit-pending']",
    )!;
    await act(async () => submitPending.click());
    expect(gutenberg()?.getAttribute("data-query")).toBe("austen");
    expect(gutenberg()?.getAttribute("data-pending")).toBe("");

    // Borrar el campo devuelve Gutenberg a los más descargados.
    await act(async () => typeInto(input, ""));
    expect(gutenberg()?.getAttribute("data-query")).toBe("");
  });
});

describe("Shelf - Continuar escuchando", () => {
  const mount = async (onResumeAudio?: (b: ShelfItem) => void) => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: mockLibrary,
          checking: false,
          onOpen: vi.fn(),
          onResumeAudio,
          onRemove: vi.fn(),
          onAdd: vi.fn(),
          onLibraryChange: vi.fn(),
          onGetCatalogBook: vi.fn(),
          onDownloadBook: vi.fn(),
        }),
      );
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };
  const landing = (chapterLabel?: string) =>
    saveTtsLandingPosition({
      bookHash: "h-test-1",
      sectionIndex: 4,
      sentenceIndex: 2,
      paragraphText: "Una frase.",
      anchor: "Una frase.",
      chapterLabel,
      updatedAt: 1,
    });

  afterEach(() => {
    clearTtsLandingPosition("h-test-1");
    localStorage.clear();
  });

  it("sale con landing y consentimiento, con el capítulo", async () => {
    consentTts();
    landing("Cap. 3");
    const onResumeAudio = vi.fn();
    await mount(onResumeAudio);
    const btn = host.querySelector(".btn--resume-audio") as HTMLButtonElement;
    expect(btn.textContent).toBe("Continuar escuchando · Cap. 3");
    await act(async () => btn.click());
    expect(onResumeAudio).toHaveBeenCalledWith(expect.objectContaining({ hash: "h-test-1" }));
  });

  it("no sale sin consentimiento ni sin landing", async () => {
    landing("Cap. 3");
    await mount(vi.fn());
    expect(host.querySelector(".btn--resume-audio")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    clearTtsLandingPosition("h-test-1");
    consentTts();
    await mount(vi.fn());
    expect(host.querySelector(".btn--resume-audio")).toBeNull();
  });

  it("muestra el aviso descartable de past_due en la estantería y abre el Carné al pulsar Actualizar tarjeta", async () => {
    const { planStore } = await import("../lib/account-plan");
    const spy = vi.spyOn(planStore, "get").mockReturnValue({
      plan: "lecta_plus",
      starterCoat: null,
      expiresAt: Date.now() - 86_400_000,
      pastDue: true,
    });
    const openCarneSpy = vi.fn();
    window.addEventListener("lecta:open-carne", openCarneSpy);
    try {
      await mount(vi.fn());
      const note = host.querySelector('[data-testid="past-due-note"]');
      expect(note).toBeTruthy();
      expect(note?.textContent).toContain("No pudimos renovar tu pago de Lecta+");
      await act(async () => {
        note?.querySelector<HTMLButtonElement>(".trial-note__cta")?.click();
      });
      expect(openCarneSpy).toHaveBeenCalledTimes(1);
      await act(async () => {
        note?.querySelector<HTMLButtonElement>(".trial-note__close")?.click();
      });
      expect(host.querySelector('[data-testid="past-due-note"]')).toBeNull();
    } finally {
      window.removeEventListener("lecta:open-carne", openCarneSpy);
      spy.mockRestore();
    }
  });

  it("permite abrir la importación por enlace y oculta compartir en artículos localOnly (E18)", async () => {
    const onImportArticle = vi.fn();
    const onShareBook = vi.fn();

    await act(async () => {
      root.render(
        h(Shelf, {
          library: [
            {
              hash: "h-article-1",
              name: "ensayo.epub",
              title: "Ensayo importado",
              addedAt: Date.now(),
              sectionCount: 1,
              localOnly: true,
            },
          ],
          vocabCount: 0,
          dueReviewsCount: 0,
          onSelect: vi.fn(),
          onImportArticle,
          onShareBook,
        }),
      );
    });

    // Botón de opciones del libro localOnly no ofrece "Compartir a la comunidad"
    const optsBtn = host.querySelector<HTMLButtonElement>('[title="Opciones del libro"]');
    expect(optsBtn).toBeTruthy();
    await act(async () => optsBtn!.click());
    expect(document.body.textContent).not.toContain("Compartir a la comunidad");
    const closeOpts = document.body.querySelector<HTMLButtonElement>('[aria-label="Cerrar opciones"]');
    await act(async () => closeOpts?.click());

    // Al pulsar "Leer artículo por enlace" carga lazy ArticleImportSheet
    const articleBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Leer artículo por enlace"),
    );
    expect(articleBtn).toBeTruthy();
    await act(async () => articleBtn!.click());
    for (let i = 0; i < 15; i += 1) {
      if (document.body.querySelector('[role="dialog"][aria-label="Leer artículo por enlace"]')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Leer artículo por enlace"]');
    expect(dialog).toBeTruthy();
  });

  it("muestra «Leer artículo por enlace» también con la estantería vacía (E18)", async () => {
    await act(async () => {
      root.render(
        h(Shelf, {
          library: [],
          vocabCount: 0,
          dueReviewsCount: 0,
          onSelect: vi.fn(),
          onImportArticle: vi.fn(),
        }),
      );
    });

    const articleBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Leer artículo por enlace"),
    );
    expect(articleBtn).toBeTruthy();
    await act(async () => articleBtn!.click());
    for (let i = 0; i < 15; i += 1) {
      if (document.body.querySelector('[role="dialog"][aria-label="Leer artículo por enlace"]')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Leer artículo por enlace"]'),
    ).toBeTruthy();
  });
});
