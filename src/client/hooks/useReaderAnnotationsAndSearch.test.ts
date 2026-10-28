// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReaderAnnotationsAndSearch,
  type UseReaderAnnotationsAndSearchOptions,
} from "./useReaderAnnotationsAndSearch";
import type { SavedAnnotation, DbScope } from "../lib/idb";
import type { SearchHit } from "../lib/book-search";
import type { EpubBook } from "../lib/epub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSearchHits: SearchHit[] = [
  {
    sectionIndex: 0,
    label: "Capítulo 1",
    anchor: "lugar",
    before: "En un ",
    match: "lugar",
    after: " de la Mancha",
  },
];

async function* mockSearchGenerator() {
  for (const hit of mockSearchHits) {
    yield hit;
  }
}

vi.mock("../lib/book-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/book-search")>();
  return {
    ...actual,
    searchBookSections: vi.fn(() => mockSearchGenerator()),
  };
});

const mockAnnotations: SavedAnnotation[] = [];
vi.mock("../lib/idb", () => ({
  listAnnotations: vi.fn(async () => [...mockAnnotations]),
  saveAnnotation: vi.fn(async (ann: SavedAnnotation) => ({
    ...ann,
    key: ann.key || `ann-${Date.now()}`,
    updatedAt: Date.now(),
  })),
  removeAnnotation: vi.fn(async (key: string) => {
    const idx = mockAnnotations.findIndex((a) => a.key === key);
    if (idx >= 0) mockAnnotations.splice(idx, 1);
  }),
  updateAnnotation: vi.fn(async () => {}),
  captureDbScope: vi.fn(() => ({})),
}));

vi.mock("../lib/reading-sync", () => ({
  pushAnnotationsToServer: vi.fn(async () => {}),
}));

vi.mock("../lib/lexicon", () => ({
  explainInPassage: vi.fn(async () => ({
    ok: true,
    contextualMeaning: "Sentido en este contexto.",
    toneAndNuance: "Lírico",
    catTip: "Presta atención a la metáfora.",
  })),
  lookupWordInMemory: vi.fn(() => null),
  lookupWord: vi.fn(async () => ({ ok: false, error: "not found" })),
}));

vi.mock("../lib/book-glossary", () => ({
  recordBookConsultedWord: vi.fn(async () => {}),
}));

describe("useReaderAnnotationsAndSearch", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockAnnotations.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderHook(overrides?: Partial<UseReaderAnnotationsAndSearchOptions>) {
    let hookResult!: ReturnType<typeof useReaderAnnotationsAndSearch>;

    const defaultOptions: UseReaderAnnotationsAndSearchOptions = {
      bookHash: "hash-libro-1",
      sectionIndex: 0,
      state: "ready",
      vocabVersion: 1,
      prediction: null,
      bookRef: {
        current: {
          sections: [{ id: "s1", content: "<p>En un lugar de la Mancha</p>" }],
        } as unknown as EpubBook,
      },
      containerRef: { current: container },
      metricsRef: { current: null },
      layoutRef: { current: "pages" },
      pageRef: { current: 1 },
      tocRows: [{ label: "Capítulo 1", index: 0 }],
      tocRowsRef: { current: [{ label: "Capítulo 1", index: 0 }] },
      currentChapterTarget: {
        id: "c1",
        label: "Capítulo 1",
        href: "c1.xhtml",
        sectionIndex: 0,
        depth: 0,
        kind: "chapter",
      },
      title: "Don Quijote",
      author: "Cervantes",
      language: "es",
      signedIn: true,
      captureDbScope: vi.fn(() => ({ userId: "u1", active: true } as unknown as DbScope)),
      onStatus: vi.fn(),
      setSelButton: vi.fn(),
      ...overrides,
    };

    function TestComp() {
      hookResult = useReaderAnnotationsAndSearch(defaultOptions);
      return null;
    }

    act(() => {
      root.render(h(TestComp));
    });

    return {
      get current() {
        return hookResult;
      },
    };
  }

  it("busca texto dentro del libro y actualiza searchHits", async () => {
    const handle = renderHook();

    await act(async () => {
      handle.current.setSearchQ("lugar");
    });

    // Esperar al debounce de búsqueda
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(handle.current.searchDone).toBe(true);
    expect(handle.current.searchHits).toHaveLength(1);
    expect(
      handle.current.searchHits[0].before + handle.current.searchHits[0].match,
    ).toContain("En un lugar");
  });

  it("guarda un pasaje y lo elimina correctamente", async () => {
    const handle = renderHook();

    await act(async () => {
      await handle.current.savePassageDirectly("Texto del pasaje seleccionado");
    });

    expect(handle.current.annotations.length).toBeGreaterThan(0);
    const createdKey = handle.current.annotations[0].key;
    expect(createdKey).toBeDefined();

    await act(async () => {
      await handle.current.removeMark(createdKey);
    });

    expect(handle.current.annotations.find((a) => a.key === createdKey)).toBeUndefined();
  });

  it("genera datos para la tarjeta de cita con el texto seleccionado", async () => {
    const handle = renderHook();

    // Simular selección de ventana no colapsada
    const selectionText = "Cita memorable del ingenioso hidalgo.";
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => selectionText,
      removeAllRanges: vi.fn(),
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({} as Range),
    } as unknown as Selection);

    await act(async () => {
      handle.current.openQuoteCardFromSelection();
    });

    expect(handle.current.quoteCard).toBeDefined();
    expect(handle.current.quoteCard?.text).toBe(selectionText);
    expect(handle.current.quoteCard?.bookTitle).toBe("Don Quijote");
    expect(handle.current.quoteCard?.author).toBe("Cervantes");
    expect(handle.current.quoteCard?.chapterTitle).toBe("Capítulo 1");
  });

  it("askCatAboutSelection inyecta dictEntry de inmediato, registra en glosario y preserva el bloque local tras la respuesta de IA", async () => {
    const { lookupWordInMemory, explainInPassage } = await import("../lib/lexicon");
    const { recordBookConsultedWord } = await import("../lib/book-glossary");

    vi.mocked(lookupWordInMemory).mockReturnValue({
      ok: true,
      found: true,
      lemma: "ataraxia",
      partOfSpeech: "sustantivo",
      definitions: ["Estado de tranquilidad, serenidad e imperturbabilidad."],
      entries: [
        {
          entryId: "e1",
          freqRank: 100,
          zipf: 4.5,
          lemma: "ataraxia",
          pos: "sustantivo",
          senses: [{ definition: "Estado de tranquilidad, serenidad e imperturbabilidad.", example: null, senseOrder: 1 }],
        },
      ],
    });

    const handle = renderHook();

    await act(async () => {
      await handle.current.askCatAboutSelection({
        word: "ataraxia",
        passage: "Buscaba la ataraxia del alma en tiempos inciertos.",
        bookId: "hash-libro-1",
      });
    });

    // 1. Debe haber registrado la palabra en el glosario del libro
    expect(recordBookConsultedWord).toHaveBeenCalledWith(
      "hash-libro-1",
      "ataraxia",
      expect.anything(),
    );

    // 2. Debe haber enviado lemma y localDefinition al backend
    expect(explainInPassage).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "ataraxia",
        lemma: "ataraxia",
        localDefinition: "Estado de tranquilidad, serenidad e imperturbabilidad.",
        passage: "Buscaba la ataraxia del alma en tiempos inciertos.",
        bookTitle: "Don Quijote",
      }),
      expect.anything(),
    );

    // 3. El estado final debe preservar dictEntry intacto (cero pérdida de datos del diccionario local)
    const explanation = handle.current.catPassageExplanation;
    expect(explanation).not.toBeNull();
    expect(explanation?.word).toBe("ataraxia");
    expect(explanation?.dictEntry).toEqual({
      lemma: "ataraxia",
      pos: "sustantivo",
      definition: "Estado de tranquilidad, serenidad e imperturbabilidad.",
    });
    expect(explanation?.loading).toBe(false);
    expect(explanation?.data?.contextualMeaning).toBe("Sentido en este contexto.");
    expect(explanation?.data?.toneAndNuance).toBe("Lírico");
    expect(explanation?.data?.catTip).toBe("Presta atención a la metáfora.");
  });
});
