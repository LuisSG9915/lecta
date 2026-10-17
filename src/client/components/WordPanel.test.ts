// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WordPanel from "./WordPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/lexicon", () => ({
  lookupWord: vi.fn(async () => ({
    ok: true,
    found: true,
    entries: [
      {
        lemma: "efimero",
        pos: "adjetivo",
        zipf: 2.5,
        senses: [{ definition: "De corta duración.", senseOrder: 1 }],
      },
    ],
  })),
  enrichWord: vi.fn(),
  explainInContext: vi.fn(),
  explainInPassage: vi.fn(async () => ({
    ok: true,
    directMeaning: "Fugaz, de corta duración.",
    contextualMeaning: "Aquí «efímero» alude a la fugacidad del instante poético.",
    toneAndNuance: "Lírico y melancólico",
    catTip: "El autor emplea esta palabra para enfatizar el paso del tiempo.",
  })),
  reportSense: vi.fn(),
}));

vi.mock("../lib/idb", () => ({
  captureDbScope: vi.fn(() => ({})),
  loadSavedWord: vi.fn(async () => null),
  removeSavedWord: vi.fn(async () => null),
  loadSessionValue: vi.fn(async () => null),
  saveSessionValue: vi.fn(async () => undefined),
  saveKnowledge: vi.fn(async (input: { language: string; lemma: string; known: boolean }) => ({
    key: `${input.language}:${input.lemma}`,
    language: input.language,
    lemma: input.lemma,
    known: input.known,
    source: "declared",
    updatedAt: Date.now(),
  })),
  saveWordWithKnowledge: vi.fn(async (input: { word: Record<string, unknown>; knowledge: Record<string, unknown> }) => ({
    word: { ...input.word, key: `es:${input.word.form}`, savedAt: Date.now() },
    knowledge: { ...input.knowledge, key: `es:${input.knowledge.lemma}`, updatedAt: Date.now() },
  })),
  updateSavedWord: vi.fn(),
  wordKey: (lang: string, form: string) => `${lang}:${form}`,
}));

vi.mock("../lib/vocab", () => ({
  pushWordsToServer: vi.fn(async () => true),
}));

vi.mock("../lib/reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));

vi.mock("../lib/reviews", () => ({
  recordReview: vi.fn(async () => ({})),
}));

vi.mock("../lib/ai-pref", () => ({
  loadUseAi: vi.fn(async () => true),
}));

vi.mock("../lib/game", () => ({
  award: vi.fn(async () => {}),
  localDayKey: vi.fn(() => "2026-10-13"),
}));

vi.mock("../lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("../lib/speech", () => ({
  speakWord: vi.fn(),
}));

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

const render = (node: ReactNode) => act(() => root.render(node));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

describe("WordPanel - Acciones Rápidas (Fase 4.3)", () => {
  it("renderiza botones unificados '★ Guardar en mi cuaderno' y '✓ Ya la sé'", async () => {
    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    // Esperar a que se resuelva la consulta
    await act(async () => {
      await Promise.resolve();
    });

    const knownBtn = host.querySelector<HTMLButtonElement>(".btn--quick-known");
    expect(knownBtn).not.toBeNull();
    expect(knownBtn?.textContent).toContain("✓ Ya la sé");

    const pinBtn = host.querySelector<HTMLButtonElement>(".btn--pin-notebook");
    expect(pinBtn).not.toBeNull();
    expect(pinBtn?.textContent).toContain("★ Guardar en mi cuaderno");
  });

  it("cuando la palabra ya está guardada muestra badge, Quitar y Ver en cuaderno", async () => {
    const { loadSavedWord } = await import("../lib/idb");
    vi.mocked(loadSavedWord).mockResolvedValueOnce({
      key: "es:efimero",
      form: "efimero",
      language: "es",
      savedAt: Date.now(),
      card: { state: 1, due: Date.now(), stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, last_review: Date.now() },
    });

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const badge = host.querySelector(".word-panel-saved-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("★ Guardada en tu cuaderno");

    const removeBtn = host.querySelector<HTMLButtonElement>(".btn--remove-word");
    expect(removeBtn).not.toBeNull();
    expect(removeBtn?.textContent).toContain("Quitar");

    const viewBtn = host.querySelector<HTMLButtonElement>(".btn--view-notebook");
    expect(viewBtn).not.toBeNull();
    expect(viewBtn?.textContent).toContain("Ver en cuaderno →");
  });

  it("al tocar '✓ Ya la sé' muestra aviso de recalibración de perfil y llama a onClose", async () => {
    const onClose = vi.fn();
    const onNotice = vi.fn();

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero.",
        language: "es",
        bookHash: "book123",
        onClose,
        onNotice,
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const knownBtn = host.querySelector<HTMLButtonElement>(".btn--quick-known")!;
    await act(async () => {
      click(knownBtn);
    });

    expect(onNotice).toHaveBeenCalledWith("Marcada como conocida. Ajustamos tu perfil.");
    expect(host.querySelector(".word-panel-notice-toast")?.textContent).toContain(
      "Marcada como conocida. Ajustamos tu perfil.",
    );

    // Avanza el temporizador para verificar el cierre
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("al tocar '★ Fijar en mi cuaderno' guarda la palabra con prioridad y contexto", async () => {
    const onSaved = vi.fn();
    const onNotice = vi.fn();

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero en el libro.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onNotice,
        onSaved,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const pinBtn = host.querySelector<HTMLButtonElement>(".btn--pin-notebook")!;
    await act(async () => {
      click(pinBtn);
    });

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        form: "efimero",
        context: "Un momento efimero en el libro.",
        priority: true,
      }),
    );
    expect(onNotice).toHaveBeenCalledWith("Fijada con prioridad en tu cuaderno.");
    expect(host.querySelector(".word-panel-notice-toast")?.textContent).toContain(
      "Fijada con prioridad en tu cuaderno.",
    );
  });

  it("renderiza la cabecera limpia, definición práctica y botón directo de explicación", async () => {
    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero en el libro.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const meaningBlock = host.querySelector(".word-panel-meaning-block");
    expect(meaningBlock).not.toBeNull();
    expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
      "De corta duración.",
    );

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainPassageBtn).not.toBeNull();
    expect(explainPassageBtn?.textContent).toContain("✨ Explicar en esta frase");
  });

  it("al pulsar '✨ Explicar en esta frase' muestra la explicación contextual de IA", async () => {
    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero en el libro.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainPassageBtn).not.toBeNull();
    expect(explainPassageBtn?.textContent).toContain("✨ Explicar en esta frase");

    // Tocar el botón de IA en pasaje directamente sin menús confusos
    await act(async () => {
      click(explainPassageBtn!);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector(".passage-meaning-text")?.textContent).toContain(
      "Aquí «efímero» alude a la fugacidad del instante poético.",
    );
    expect(host.querySelector(".passage-badge-tone")?.textContent).toContain(
      "Lírico y melancólico",
    );
    expect(host.querySelector(".cat-tip-text")?.textContent).toContain(
      "El autor emplea esta palabra para enfatizar el paso del tiempo.",
    );
  });

  it("en compactMode renderiza la micro-glosa ultracompacta con silabeo y permite expandir", async () => {
    render(
      h(WordPanel, {
        word: "hegemonía",
        language: "es",
        bookHash: "book123",
        compactMode: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const microPanel = host.querySelector(".micro-gloss-panel");
    expect(microPanel).not.toBeNull();
    expect(microPanel?.querySelector(".micro-gloss-syllables")?.textContent).toBe("he·ge·mo·ní·a");

    // Al hacer clic en la info, se expande a la ficha completa
    const info = host.querySelector<HTMLElement>(".micro-gloss-info")!;
    await act(async () => {
      click(info);
    });

    expect(host.querySelector(".micro-gloss-panel")).toBeNull();
    expect(host.querySelector(".sheet")).not.toBeNull();
  });

  it("para palabras en inglés, envía nativeLanguage a explainInPassage y pronuncia con voz en inglés", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    const { speakWord } = await import("../lib/speech");

    render(
      h(WordPanel, {
        word: "wander",
        language: "en",
        context: "He began to wander across the fields.",
        bookHash: "bookEng",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Probar pronunciación
    const audioBtn = host.querySelector<HTMLButtonElement>(".btn--pronounce");
    expect(audioBtn).not.toBeNull();
    await act(async () => {
      click(audioBtn!);
    });
    expect(speakWord).toHaveBeenCalledWith("wander", "en");

    // El botón de explicación en frase está accesible directamente sin submenús
    const explainBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainBtn).not.toBeNull();
    await act(async () => {
      click(explainBtn!);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(explainInPassage).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "wander",
        language: "en",
        nativeLanguage: "es",
      }),
      expect.anything(),
    );
  });

  it("responde a atajos de teclado rápidos 'p' (pronunciar), 'g' (guardar/fijar) y 's' (ya la sé)", async () => {
    const { speakWord } = await import("../lib/speech");
    const { saveWordWithKnowledge, saveKnowledge } = await import("../lib/idb");
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      h(WordPanel, {
        word: "efimero",
        language: "es",
        context: "El destello fue efímero pero intenso.",
        bookHash: "book123",
        onClose,
        onSaved,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 1. Probar atajo 'p'
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    });
    expect(speakWord).toHaveBeenCalledWith("efimero", "es");

    // 2. Probar atajo 'g' (guarda en cuaderno)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    });
    expect(saveWordWithKnowledge).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();

    // 3. Probar atajo 's' (marcar como conocida)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    });
    expect(saveKnowledge).toHaveBeenCalled();
  });

  it("dispara automáticamente la consulta de IA cuando la palabra no está en catálogo (OBJ-03)", async () => {
    const { lookupWord, explainInPassage } = await import("../lib/lexicon");
    vi.mocked(lookupWord).mockResolvedValueOnce({
      ok: true,
      found: false,
      entries: [],
    });


    render(
      h(WordPanel, {
        word: "desconocida",
        language: "es",
        context: "Una palabra desconocida en la lectura.",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Debe haber invocado explainInPassage de forma automática sin requerir clic manual
    expect(explainInPassage).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "desconocida",
        sentence: "Una palabra desconocida en la lectura.",
      }),
      expect.anything(),
    );

    // Debe mostrar la explicación obtenida
    expect(host.querySelector(".passage-meaning-text")?.textContent).toContain(
      "Aquí «efímero» alude a la fugacidad del instante poético.",
    );
  });

  describe("WordPanel - Tarjeta Única Track 4", () => {
    it("muestra inmediatamente significado local y sinónimos a 0 ms", async () => {
      const lookupLocalLexicon = vi.fn(async (w: string) => ({
        lemma: w,
        partOfSpeech: "sustantivo",
        shortDefinition: "Definición instantánea local.",
        synonyms: ["sin1", "sin2"],
      }));
      const onRecordSilentCalibration = vi.fn();

      render(
        h(WordPanel, {
          word: "alborada",
          sentenceContext: "Despertaron con la suave alborada.",
          bookLanguage: "es",
          lookupLocalLexicon,
          fetchContextualMeaning: vi.fn(),
          onSpeakWord: vi.fn(),
          onSaveToNotebook: vi.fn(),
          onRecordSilentCalibration,
          onClose: vi.fn(),
        }),
      );

      // Calibración silenciosa registrada en 'lookup'
      expect(onRecordSilentCalibration).toHaveBeenCalledWith("alborada", "lookup");

      await act(async () => {
        await Promise.resolve();
      });

      expect(host.querySelector(".word-card-short-def")?.textContent).toContain(
        "Definición instantánea local.",
      );
      expect(host.querySelector(".word-card-pos")?.textContent).toContain("sustantivo");
      const synonyms = [...host.querySelectorAll(".word-synonym-pill")].map((el) => el.textContent);
      expect(synonyms).toEqual(["sin1", "sin2"]);
    });

    it("resuelve en paralelo la explicación contextual y la guarda en caché para la frase exacta", async () => {
      let resolveContextual: (res: any) => void = () => {};
      const fetchContextualMeaning = vi.fn(
        () =>
          new Promise<any>((resolve) => {
            resolveContextual = resolve;
          }),
      );

      render(
        h(WordPanel, {
          word: "quimera",
          sentenceContext: "Su sueño de volar era una quimera inalcanzable.",
          bookLanguage: "es",
          lookupLocalLexicon: vi.fn(async () => null),
          fetchContextualMeaning,
          onSpeakWord: vi.fn(),
          onSaveToNotebook: vi.fn(),
          onRecordSilentCalibration: vi.fn(),
          onClose: vi.fn(),
        }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Mientras carga muestra skeleton
      expect(host.querySelector(".word-card-context-skeleton")).not.toBeNull();

      // Se resuelve la IA contextual
      await act(async () => {
        resolveContextual({
          inPassageMeaning: "Aquí significa una ilusión irrealizable.",
          toneOrNuance: "Melancólico",
        });
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      expect(host.querySelector(".word-card-context-text")?.textContent).toContain(
        "Aquí significa una ilusión irrealizable.",
      );
      expect(host.querySelector(".word-card-context-nuance")?.textContent).toContain(
        "Melancólico",
      );
    });

    it("al guardar en 1 toque notifica a onSaveToNotebook y a onRecordSilentCalibration con 'save'", async () => {
      const onSaveToNotebook = vi.fn(async () => {});
      const onRecordSilentCalibration = vi.fn();
      const lookupLocalLexicon = vi.fn(async (w: string) => ({
        lemma: w,
        shortDefinition: "Definición corta",
        synonyms: [],
      }));

      render(
        h(WordPanel, {
          word: "quimera",
          sentenceContext: "Su sueño de volar era una quimera inalcanzable.",
          bookLanguage: "es",
          lookupLocalLexicon,
          fetchContextualMeaning: vi.fn(async () => ({
            inPassageMeaning: "Ilusión imposible.",
          })),
          onSpeakWord: vi.fn(),
          onSaveToNotebook,
          onRecordSilentCalibration,
          onClose: vi.fn(),
        }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      const saveBtn = host.querySelector<HTMLButtonElement>(".word-card-save-btn")!;
      await act(async () => {
        click(saveBtn);
      });

      expect(onRecordSilentCalibration).toHaveBeenCalledWith("quimera", "save");
      expect(onSaveToNotebook).toHaveBeenCalledWith(
        expect.objectContaining({
          word: "quimera",
          sentenceContext: "Su sueño de volar era una quimera inalcanzable.",
        }),
      );
    });
  });
});

