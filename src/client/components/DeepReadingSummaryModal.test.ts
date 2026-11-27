// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeepReadingSummaryModal from "./DeepReadingSummaryModal";
import type { DeepReadingSummary } from "../lib/deep-reading";
import { saveChapterFollowAnswer } from "../lib/chapter-follow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/chapter-follow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chapter-follow")>()),
  saveChapterFollowAnswer: vi.fn(async () => undefined),
}));

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

  it("muestra la duración y las palabras leídas, sin cobertura inventada", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(h(DeepReadingSummaryModal, { summary: baseSummary, onClose }));
    });

    const text = host.textContent ?? "";
    expect(text).toContain("20 minutos");
    expect(text).toContain("3");
    expect(text).toContain("Secciones leídas");
    expect(text).toContain("12");
    expect(text).toContain("Palabras leídas");
    expect(text).not.toContain("asimiladas");
    expect(text).not.toContain("Incremento de cobertura");
    expect(text).toContain("celebra tu lectura");
  });

  it("muestra la vista previa editorial de la postal y envía la cita al pulsar 'Crear postal del capítulo'", () => {
    const onShareQuote = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          featuredQuote: "El arte de leer es recordar con otros ojos.",
          bookTitle: "Azul…",
          author: "Rubén Darío",
          chapterTitle: "El Rey Burgués",
          onShareQuote,
          onClose: vi.fn(),
        }),
      );
    });

    const preview = host.querySelector(".deep-summary-postal-preview");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("«El arte de leer es recordar con otros ojos.»");
    expect(preview?.textContent).toContain("Azul… · Rubén Darío · El Rey Burgués");

    const postalBtn = host.querySelector<HTMLButtonElement>(".deep-summary-quote-btn")!;
    expect(postalBtn).not.toBeNull();
    act(() => {
      postalBtn.click();
    });
    expect(onShareQuote).toHaveBeenCalledWith("El arte de leer es recordar con otros ojos.");
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

    const continueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar"),
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
          options: ["linterna", "quimera", "montaña", "sombra"],
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
      consolidateBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
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
          options: ["linterna", "quimera", "montaña", "sombra"],
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
          options: ["linterna", "quimera", "montaña", "sombra"],
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
          options: ["linterna", "quimera", "montaña", "sombra"],
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
    expect(host.textContent).toContain("Repaso del capítulo hecho");
    expect(host.textContent).toContain("Practicaste 1 palabra de este capítulo");

    const finalContinueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar al siguiente capítulo"),
    )!;
    expect(finalContinueBtn).toBeTruthy();

    act(() => {
      finalContinueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("un hueco sin opciones reales se convierte en ordenar letras", () => {
    localStorage.clear();
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
        h(DeepReadingSummaryModal, { summary: baseSummary, consolidationQueue, onClose: vi.fn() }),
      );
    });
    const startBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Fijar en memoria"),
    )!;
    act(() => {
      startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector(".sentence-cloze-game")).toBeNull();
    expect(host.querySelectorAll(".sentence-cloze-option-btn").length).toBe(0);
  });

  it("anota si seguiste el hilo con un toque y no bloquea continuar", () => {
    const onContinue = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          onClose: vi.fn(),
          onContinue,
          bookId: "libro-1",
          chapterId: "cap-1",
        }),
      );
    });

    const lost = [...host.querySelectorAll("button")].find((b) => b.textContent === "Me perdí")!;
    act(() => {
      lost.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(saveChapterFollowAnswer).toHaveBeenCalledWith("libro-1", "cap-1", "perdido");
    expect(host.textContent).toContain("Anotado");
    expect(host.textContent).not.toContain("Seguí el hilo");

    const continueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar al siguiente capítulo"),
    )!;
    act(() => {
      continueBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("no ofrece el hilo si el capítulo no está identificado", () => {
    act(() => {
      root.render(h(DeepReadingSummaryModal, { summary: baseSummary, onClose: vi.fn() }));
    });
    expect(host.textContent).not.toContain("¿Seguiste el hilo de este capítulo?");
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
    expect(text).toContain("3 palabras");
    expect(text).toContain("alborada");
    expect(text).toContain("crepúsculo");
    expect(text).toContain("destello");
  });

  it("permite crear la postal del capítulo en 1 clic llamando a onShareQuote con featuredQuote", () => {
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

    expect(onShareQuote).toHaveBeenCalledTimes(1);
    expect(onShareQuote).toHaveBeenCalledWith("El mar sonreía a lo lejos con dientes de espuma.");
  });

  it("prioriza featuredQuote antes de recurrir a la frase del capítulo o al fallback genérico", () => {
    const onClose = vi.fn();
    const onShareQuote1 = vi.fn();
    const consolidationQueue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión",
          chapterSentence: "La quimera dorada navegaba el horizonte.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
        },
        modality: "sentence-cloze" as const,
      },
    ];

    // Caso A: featuredQuote tiene prioridad máxima sobre la cola
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          featuredQuote: "Cita destacada prioritaria.",
          onShareQuote: onShareQuote1,
          onClose,
        }),
      );
    });

    let quoteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    act(() => {
      quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onShareQuote1).toHaveBeenCalledWith("Cita destacada prioritaria.");

    // Caso B: sin featuredQuote, recurre a chapterSentence de la cola
    const onShareQuote2 = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          onShareQuote: onShareQuote2,
          onClose,
        }),
      );
    });

    quoteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    act(() => {
      quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onShareQuote2).toHaveBeenCalledWith("La quimera dorada navegaba el horizonte.");

    // Caso C: sin featuredQuote ni chapterSentence, usa el fallback literario genérico
    const onShareQuote3 = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue: [],
          onShareQuote: onShareQuote3,
          onClose,
        }),
      );
    });

    quoteBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    act(() => {
      quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onShareQuote3).toHaveBeenCalledWith(
      "La lectura profunda transforma el tiempo en memoria viva.",
    );
  });

  it("permite crear la postal desde la pantalla de celebración llamando a onShareQuote", () => {
    localStorage.clear();
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const onShareQuote = vi.fn();
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
          options: ["linterna", "quimera", "montaña", "sombra"],
        },
        modality: "sentence-cloze" as const,
      },
    ];

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          consolidationQueue,
          featuredQuote: "Frase celebrada del capítulo.",
          onShareQuote,
          onContinue,
          onClose,
        }),
      );
    });

    // Iniciar y resolver el reto
    const startBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Fijar en memoria"),
    )!;
    act(() => {
      startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const correctOptionBtn = [...host.querySelectorAll("button")].find(
      (b) => b.querySelector(".sentence-pool-text")?.textContent?.trim() === "quimera",
    )!;
    act(() => {
      correctOptionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(1000);
    });

    expect(host.textContent).toContain("Repaso del capítulo hecho");

    // Pulsar "Crear postal del capítulo" en la pantalla de celebración
    const postalBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Crear postal del capítulo"),
    )!;
    expect(postalBtn).toBeTruthy();

    act(() => {
      postalBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onShareQuote).toHaveBeenCalledWith("Frase celebrada del capítulo.");
  });

  it("no renderiza QuoteCardModal anidado ni duplica .dialog-scrim cuando no se pasa onShareQuote", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary: baseSummary,
          featuredQuote: "La lectura es un refugio en el tiempo.",
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

    // Solo debe existir el .dialog-scrim del resumen, jamás un modal anidado
    const scrims = document.querySelectorAll(".dialog-scrim");
    expect(scrims.length).toBe(1);
    expect(host.querySelector(".quote-modal")).toBeNull();
  });

  describe("cierre natural de capítulo (source: chapter)", () => {
    const queue = [
      {
        item: {
          lemma: "quimera",
          surfaceForm: "quimera",
          lang: "es",
          shortGloss: "Ilusión o fantasía",
          chapterSentence: "Perseguía una quimera inalcanzable.",
          chapterTitle: "Capítulo 1",
          source: "in-chapter-lookup" as const,
          options: ["linterna", "quimera", "montaña", "sombra"],
        },
        modality: "sentence-cloze" as const,
      },
    ];

    it("startInRunner abre directo la primera palabra, sin pasar por el resumen", () => {
      act(() => {
        root.render(
          h(DeepReadingSummaryModal, {
            summary: { ...baseSummary, source: "chapter", startInRunner: true },
            consolidationQueue: queue,
            onClose: vi.fn(),
          }),
        );
      });
      expect(host.textContent).toContain("Palabra 1 de 1");
      expect(host.textContent).not.toContain("Retiro completado");
    });

    it("con source chapter el resumen habla de capítulo y de lectura", () => {
      act(() => {
        root.render(
          h(DeepReadingSummaryModal, {
            summary: { ...baseSummary, source: "chapter" },
            onClose: vi.fn(),
          }),
        );
      });
      const text = host.textContent ?? "";
      expect(text).toContain("Cerraste el capítulo");
      expect(text).toContain("de lectura");
      expect(text).toContain("Tiempo de lectura");
      expect(text).not.toContain("Retiro completado");
      expect(text).not.toContain("inmersión profunda");
    });

    it("el Retiro real (completedNaturally true) conserva sus textos", () => {
      act(() => {
        root.render(
          h(DeepReadingSummaryModal, {
            summary: { ...baseSummary, source: "retreat" },
            onClose: vi.fn(),
          }),
        );
      });
      const text = host.textContent ?? "";
      expect(text).toContain("Retiro completado");
      expect(text).toContain("Tiempo en retiro");
    });
  });
});

describe("DeepReadingSummaryModal: cortesía de IA agotada", () => {
  it("solo avisa con la bandera y en cierre de capítulo, y emite app:paywall:chapter-summary al pulsar", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const summary = { source: "chapter", durationMinutes: 5, sectionsRead: 1 } as unknown as DeepReadingSummary;
    act(() => root.render(h(DeepReadingSummaryModal, { summary, onClose: vi.fn(), aiCourtesyExhausted: true })));
    expect(document.body.textContent).toContain("Hoy ya usaste tus explicaciones con IA");
    const link = document.body.querySelector<HTMLAnchorElement>(".deep-summary-ai-link")!;
    act(() => {
      link.click();
    });
    expect(beacon.mock.calls.some((c) => String((c as unknown[])[1]).includes("app:paywall:chapter-summary"))).toBe(true);
    act(() => root.render(h(DeepReadingSummaryModal, { summary, onClose: vi.fn() })));
    expect(document.body.textContent).not.toContain("Hoy ya usaste");
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("muestra 'Ver tu Exlibris' solo cuando bookCompleted es true y delega sin anidar modales", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const summary = { source: "chapter", durationMinutes: 12, sectionsRead: 1 } as unknown as DeepReadingSummary;
    const onOpenExlibris = vi.fn();

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary,
          bookCompleted: false,
          onOpenExlibris,
          onClose: vi.fn(),
        }),
      );
    });
    expect(host.textContent).not.toContain("Ver tu Exlibris");

    act(() => {
      root.render(
        h(DeepReadingSummaryModal, {
          summary,
          bookCompleted: true,
          onOpenExlibris,
          onClose: vi.fn(),
        }),
      );
    });

    const exlibrisBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver tu Exlibris"),
    );
    expect(exlibrisBtn).toBeTruthy();

    act(() => {
      exlibrisBtn!.click();
    });

    expect(onOpenExlibris).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".dialog-scrim").length).toBe(1);

    act(() => root.unmount());
    host.remove();
  });
});
