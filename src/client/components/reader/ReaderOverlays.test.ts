// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderOverlays, type ReaderOverlaysProps } from "./ReaderOverlays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const defaultProps: ReaderOverlaysProps = {
  bookHash: "book-test-hash",
  selection: null,
  onCloseSelection: vi.fn(),
  catPassageExplanation: null,
  onCloseCatExplanation: vi.fn(),
  prep: null,
  quoteCard: null,
  onCloseQuoteCard: vi.fn(),
};

describe("ReaderOverlays: Apunte literario del Gato (FASE 2)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renderiza el Bloque 1 (Diccionario Local) con lema, categoría y definición sin esperar a la IA", async () => {
    const props: ReaderOverlaysProps = {
      ...defaultProps,
      catPassageExplanation: {
        passage: "El cielo azur resplandecía sobre la colina.",
        word: "azur",
        dictEntry: {
          lemma: "azur",
          pos: "adjetivo",
          definition: "Dicho de un color: Azul oscuro o heráldico.",
        },
        loading: true,
        data: null,
        error: null,
      },
    };

    await act(async () => {
      root.render(h(ReaderOverlays, props));
    });

    const dictBlock = container.querySelector('[data-testid="cat-explanation-dict-block"]');
    expect(dictBlock).not.toBeNull();
    expect(dictBlock?.textContent).toContain("azur");
    expect(dictBlock?.textContent).toContain("adjetivo");
    expect(dictBlock?.textContent).toContain("Dicho de un color: Azul oscuro o heráldico.");
    expect(dictBlock?.textContent).toContain("Diccionario");

    // Bloque 2 debe mostrar el estado de carga del matiz
    const loadingBlock = container.querySelector(".cat-passage-loading");
    expect(loadingBlock).not.toBeNull();
  });

  it("muestra el skeleton en Bloque 1 cuando hay palabra pero el diccionario local aún está cargando", async () => {
    const props: ReaderOverlaysProps = {
      ...defaultProps,
      catPassageExplanation: {
        passage: "Un término complejo.",
        word: "complejo",
        dictEntry: null,
        loading: true,
        data: null,
        error: null,
      },
    };

    await act(async () => {
      root.render(h(ReaderOverlays, props));
    });

    const dictBlock = container.querySelector('[data-testid="cat-explanation-dict-block"]');
    expect(dictBlock).not.toBeNull();
    const skeleton = container.querySelector(".cat-explanation-dict-skeleton");
    expect(skeleton).not.toBeNull();
  });

  it("renderiza Bloque 1 y Bloque 2 sin duplicar la definición cuando la IA responde", async () => {
    const props: ReaderOverlaysProps = {
      ...defaultProps,
      catPassageExplanation: {
        passage: "El cielo azur resplandecía sobre la colina.",
        word: "azur",
        dictEntry: {
          lemma: "azur",
          pos: "adjetivo",
          definition: "Dicho de un color: Azul oscuro o heráldico.",
        },
        loading: false,
        data: {
          contextualMeaning: "Describe una atmósfera mística y noble en el paisaje.",
          toneAndNuance: "Lírico / Romántico",
          catTip: "Rubén Darío utilizaba este tono para evocar la perfección celeste.",
          directMeaning: "Dicho de un color: Azul oscuro.", // No debe duplicarse en UI porque dictEntry ya está presente
        },
        error: null,
      },
    };

    await act(async () => {
      root.render(h(ReaderOverlays, props));
    });

    // Bloque 1 presente
    const dictBlock = container.querySelector('[data-testid="cat-explanation-dict-block"]');
    expect(dictBlock).not.toBeNull();
    expect(dictBlock?.textContent).toContain("Dicho de un color: Azul oscuro o heráldico.");

    // Bloque 2 presente
    const nuanceBlock = container.querySelector('[data-testid="cat-explanation-nuance-block"]');
    expect(nuanceBlock).not.toBeNull();
    expect(nuanceBlock?.textContent).toContain("Lírico / Romántico");
    expect(nuanceBlock?.textContent).toContain("Describe una atmósfera mística y noble en el paisaje.");
    expect(nuanceBlock?.textContent).toContain("Rubén Darío utilizaba este tono");

    // Cero duplicación: no renderiza directMeaning duplicado en bloque 2 si dictEntry existe
    const directMeaningElem = container.querySelector(".passage-direct-meaning-text");
    expect(directMeaningElem).toBeNull();
  });
});
