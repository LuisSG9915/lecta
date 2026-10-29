// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderOverlays, type ReaderOverlaysProps } from "./ReaderOverlays";
import type { QuoteCardState } from "../../hooks/useReaderAnnotationsAndSearch";
import type { DeepReadingSummary } from "../../lib/deep-reading";

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

describe("ReaderOverlays: Integración flujo postal y unicidad de capas (FASE 3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("completa el flujo: Crear postal desmonta el resumen, mantiene un único scrim, permite guardar e interactuar, y Escape devuelve el foco", async () => {
    const savePassageDirectly = vi.fn();
    const mockQuote = "El arte de leer despacio revela mundos invisibles.";

    function ReaderHarness() {
      const [deepSummary, setDeepSummary] = useState<DeepReadingSummary | null>({
        durationMinutes: 15,
        targetMinutes: 15,
        sectionsRead: 1,
        completedNaturally: true,
        wordsAssimilated: 5,
        coverageDeltaPercent: 1,
      });
      const [quoteCard, setQuoteCard] = useState<QuoteCardState | null>(null);
      const [passages, setPassages] = useState<string[]>([]);

      const isQuoteAlreadySaved = (text: string) => passages.includes(text);

      const handleShareQuote = (quote?: string) => {
        setDeepSummary(null);
        const text = quote || mockQuote;
        setQuoteCard({
          text,
          bookTitle: "Cien años de soledad",
          author: "Gabriel García Márquez",
          chapterTitle: "Capítulo 1",
          alreadySaved: isQuoteAlreadySaved(text),
        });
      };

      const handleSavePassage = (text: string) => {
        setPassages((prev) => [...prev, text]);
        savePassageDirectly(text);
      };

      return h(
        "div",
        null,
        h(
          "button",
          { "data-testid": "reader-focus-anchor", id: "reader-anchor" },
          "Lector de fondo",
        ),
        h(ReaderOverlays, {
          bookHash: "test-book",
          selection: null,
          onCloseSelection: () => {},
          catPassageExplanation: null,
          onCloseCatExplanation: () => {},
          prep: null,
          quoteCard: quoteCard
            ? {
                ...quoteCard,
                alreadySaved: quoteCard.alreadySaved ?? isQuoteAlreadySaved(quoteCard.text),
              }
            : null,
          onCloseQuoteCard: () => setQuoteCard(null),
          onSaveQuoteCardPassage: handleSavePassage,
          deepSummary,
          featuredQuote: mockQuote,
          onShareDeepSummaryQuote: handleShareQuote,
          onCloseDeepSummary: () => setDeepSummary(null),
        }),
      );
    }

    await act(async () => {
      root.render(h(ReaderHarness));
    });

    // 1. Estado inicial: DeepReadingSummaryModal está abierto
    const anchorBtn = container.querySelector("#reader-anchor") as HTMLButtonElement;
    anchorBtn.focus();
    expect(document.activeElement).toBe(anchorBtn);

    expect(container.textContent).toContain("Retiro completado");
    expect(container.textContent).toContain("Crear postal del capítulo");
    expect(container.querySelector(".quote-modal")).toBeNull();
    // Exactamente 1 .dialog-scrim
    expect(document.querySelectorAll(".dialog-scrim").length).toBe(1);

    // 2. Clic en "Crear postal del capítulo"
    const postalBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    expect(postalBtn).toBeTruthy();

    await act(async () => {
      postalBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // 3. Unicidad de capa:
    // - DeepReadingSummaryModal se desmonta
    expect(container.textContent).not.toContain("Retiro completado");
    // - QuoteCardModal es visible
    expect(container.querySelector(".quote-modal")).not.toBeNull();
    // - Solo existe UN elemento .dialog-scrim en el DOM
    const scrims = document.querySelectorAll(".dialog-scrim");
    expect(scrims.length).toBe(1);

    // 4. Interactividad: los controles de QuoteCardModal reciben eventos
    const formatStoryBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Historia (9:16)"),
    )!;
    expect(formatStoryBtn).toBeTruthy();
    await act(async () => {
      formatStoryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(formatStoryBtn.getAttribute("aria-pressed")).toBe("true");

    // Guardar pasaje
    const saveBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Cuaderno"),
    )!;
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Invocó savePassageDirectly con el texto de la cita
    expect(savePassageDirectly).toHaveBeenCalledWith(mockQuote);
    // Estado visual actualizado a guardado
    expect(container.textContent).toContain("Pasaje guardado en tu Cuaderno.");
    const savedBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("✓ Guardado en tu Cuaderno"),
    )!;
    expect(savedBtn).toBeTruthy();
    expect(savedBtn.disabled).toBe(true);

    // 5. Cierre y Foco con Escape
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // QuoteCardModal cerrado
    expect(container.querySelector(".quote-modal")).toBeNull();
    // Ningún .dialog-scrim restante en el DOM
    expect(document.querySelectorAll(".dialog-scrim").length).toBe(0);
    // Foco devuelto al elemento previo del Reader
    expect(document.activeElement).toBe(anchorBtn);
  });
});
