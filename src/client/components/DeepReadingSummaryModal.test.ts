// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeepReadingSummaryModal from "./DeepReadingSummaryModal";
import type { DeepReadingSummary } from "../lib/deep-reading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DeepReadingSummaryModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const baseSummary: DeepReadingSummary = {
    durationMinutes: 20,
    targetMinutes: 20,
    sectionsRead: 3,
    completedNaturally: true,
    wordsAssimilated: 12,
    coverageDeltaPercent: 2,
  };

  it("muestra la duración, palabras asimiladas y cobertura del libro", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(h(DeepReadingSummaryModal, { summary: baseSummary, onClose }));
    });

    const text = host.textContent ?? "";
    expect(text).toContain("20 minutos");
    expect(text).toContain("3");
    expect(text).toContain("Secciones leídas");
    expect(text).toContain("+12");
    expect(text).toContain("Palabras asimiladas");
    expect(text).toContain("+2%");
    expect(text).toContain("Incremento de cobertura");
    expect(text).toContain("celebra tu lectura");
  });

  it("permite cerrar y continuar la lectura", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          onClose,
          onContinue,
        }),
      );
    });

    const continueBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Continuar"),
    )!;
    expect(continueBtn).toBeTruthy();

    act(() => {
      continueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalled();
  });

  it("muestra tarjeta de consolidación episódica de 25 segundos y permite saltar sin fricción al siguiente capítulo", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const onStartConsolidation = vi.fn();
    const consolidationQueue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión o fantasía",
          chapterSentence: "Perseguía una quimera inalcanzable.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
      {
        item: {
          lemma: "efímero",
          surfaceForm: "efímero",
          lang: "es",
          shortGloss: "Que dura poco tiempo",
          chapterSentence: "El instante fue efímero pero intenso.",
          chapterTitle: "Capítulo 1",
          source: "pre-chapter-primed" as const,
        },
        modality: "word-scramble" as const,
      },
    ];

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          onStartConsolidation,
          onContinue,
          onClose,
        }),
      );
    });

    const text = host.textContent ?? "";
    expect(text).toContain("quimera");
    expect(text).toContain("efímero");
    expect(text).toContain("Fija en tu memoria 2 palabras de este capítulo (~25 s)");

    // Botón principal prominente para saltar sin fricción
    const skipBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar al siguiente capítulo"),
    )!;
    expect(skipBtn).toBeTruthy();

    act(() => {
      skipBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);

    // Si pulsamos el botón de fijar en memoria se dispara onStartConsolidation
    const consolidateBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Fijar en memoria"),
    )!;
    expect(consolidateBtn).toBeTruthy();

    act(() => {
      consolidateBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onStartConsolidation).toHaveBeenCalledTimes(1);
  });

  it("permite abrir el menú de opciones y ocultar la consolidación para el libro actual en 1 clic", () => {
    localStorage.clear();
    const onClose = vi.fn();
    const consolidationQueue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión o fantasía",
          chapterSentence: "Perseguía una quimera inalcanzable.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          bookId: "book-don-quijote",
          onClose,
        }),
      );
    });

    expect(host.textContent).toContain("Fija en tu memoria 1 palabras de este capítulo (~25 s)");

    // Abrir menú Opciones ▾
    const optionsToggle = host.querySelector(".consolidation-options-toggle") as HTMLButtonElement;
    expect(optionsToggle).toBeTruthy();

    act(() => {
      optionsToggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Aparecen las opciones
    expect(host.textContent).toContain("Ocultar en este libro");
    expect(host.textContent).toContain("Desactivar consolidación al final de capítulo siempre");

    const muteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ocultar en este libro"),
    )!;
    expect(muteBtn).toBeTruthy();

    act(() => {
      muteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // La tarjeta desaparece inmediatamente
    expect(host.textContent).not.toContain("Fija en tu memoria 1 palabras");
  });

  it("permite desactivar la consolidación globalmente desde el menú de opciones", () => {
    localStorage.clear();
    const onClose = vi.fn();
    const consolidationQueue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión o fantasía",
          chapterSentence: "Perseguía una quimera inalcanzable.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          onClose,
        }),
      );
    });

    const optionsToggle = host.querySelector(".consolidation-options-toggle") as HTMLButtonElement;
    act(() => {
      optionsToggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const disableBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Desactivar consolidación al final de capítulo siempre"),
    )!;
    expect(disableBtn).toBeTruthy();

    act(() => {
      disableBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // La tarjeta desaparece inmediatamente
    expect(host.textContent).not.toContain("Fija en tu memoria 1 palabras");
  });

  it("ejecuta el micro-reto de consolidación in-modal paso a paso y muestra la pantalla de celebración", () => {
    localStorage.clear();
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const consolidationQueue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión o fantasía",
          chapterSentence: "Perseguía una quimera inalcanzable.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          onContinue,
          onClose,
        }),
      );
    });

    // Iniciar consolidación in-modal
    const startBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Fijar en memoria"),
    )!;
    expect(startBtn).toBeTruthy();

    act(() => {
      startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Debe mostrar la cabecera del runner
    expect(host.textContent).toContain("Palabra 1 de 1");
    expect(host.textContent).toContain("Saltar al siguiente capítulo →");

    // Resolver la palabra seleccionando la opción correcta en SentenceBuilderGame
    const correctOptionBtn = [...host.querySelectorAll("button")].find(
      (b) => b.querySelector(".sentence-pool-text")?.textContent?.trim() === "quimera",
    )!;
    expect(correctOptionBtn).toBeTruthy();

    act(() => {
      correctOptionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(1000);
    });

    // Debe transicionar a la pantalla de celebración
    expect(host.textContent).toContain("¡Capítulo sellado en memoria!");
    expect(host.textContent).toContain("Fijaste 1 palabras clave de este capítulo");

    const finalContinueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar al siguiente capítulo"),
    )!;
    expect(finalContinueBtn).toBeTruthy();

    act(() => {
      finalContinueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("no muestra la tarjeta de consolidación si la cola está vacía", () => {
    localStorage.clear();
    const onClose = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue: [],
          onClose,
        }),
      );
    });

    expect(host.textContent).not.toContain("Fija en tu memoria");
    expect(host.querySelector(".consolidation-card")).toBeNull();
  });

  it("muestra la sección de 'Tu Cosecha en este Capítulo' con palabras y mensaje celebratorio", () => {
    const onClose = vi.fn();
    const harvestWords = ["alborada", "crepúsculo", "destello"];
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          harvestWords,
          onClose,
        }),
      );
    });

    const text = host.textContent ?? "";
    expect(text).toContain("Tu Cosecha en este Capítulo");
    expect(text).toContain("¡Leíste este capítulo de corrido integrando nuevas palabras en contexto!");
    expect(text).toContain("alborada");
    expect(text).toContain("crepúsculo");
    expect(text).toContain("destello");
  });

  it("permite crear la postal del capítulo en 1 clic llamando a onShareQuote", () => {
    const onClose = vi.fn();
    const onShareQuote = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          featuredQuote: "El mar sonreía a lo lejos con dientes de espuma.",
          bookTitle: "Canción de otoño",
          author: "Rubén Darío",
          onShareQuote,
          onClose,
        }),
      );
    });

    const quoteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    expect(quoteBtn).toBeTruthy();

    act(() => {
      quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onShareQuote).toHaveBeenCalledWith("El mar sonreía a lo lejos con dientes de espuma.");
  });

  it("abre QuoteCardModal in situ al pulsar 'Crear postal del capítulo' si no hay onShareQuote", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          featuredQuote: "La lectura es un refugio en el tiempo.",
          bookTitle: "Don Quijote",
          author: "Cervantes",
          onClose,
        }),
      );
    });

    const quoteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    expect(quoteBtn).toBeTruthy();

    act(() => {
      quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Debe abrir QuoteCardModal (Dialog con label o contenido de postal)
    expect(host.textContent).toContain("Crear postal");
  });
});

