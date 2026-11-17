// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WordPanel, { type ContextualMeaningResult } from "./WordPanel";

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
        ipa: "eˈfimero",
        senses: [{ definition: "De corta duración.", example: null, senseOrder: 1 }],
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
  lookupWordInMemory: vi.fn(() => null),
  primeLexiconMemoryCache: vi.fn(),
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
  scheduleReadingSyncPush: vi.fn(),
  flushPendingReadingSync: vi.fn(async () => {}),
}));

vi.mock("../lib/reviews", () => ({
  recordReview: vi.fn(async () => ({})),
  recordLookupLapse: vi.fn(async () => null),
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

vi.mock("../lib/translate", () => ({
  translateParagraph: vi.fn(async (text: string) => `[ES] ${text}`),
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
// Diccionario y cadena de promesas internas necesitan varios ticks.
const flush = async (ticks = 8) => {
  await act(async () => {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  });
};
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

    // El atajo muerto «Ver en cuaderno» ya no se pinta: el Cuaderno se
    // abre desde el dock, no desde la ficha de una palabra.
    expect(host.querySelector(".btn--view-notebook")).toBeNull();
  });

  it("al reencontrar una palabra practicada muestra su etapa de aprendizaje", async () => {
    const { loadSavedWord } = await import("../lib/idb");
    vi.mocked(loadSavedWord).mockResolvedValueOnce({
      key: "es:efimero",
      form: "efimero",
      language: "es",
      savedAt: Date.now(),
      card: {
        state: 2,
        due: Date.now() + 86_400_000,
        stability: 30,
        difficulty: 5,
        elapsed_days: 3,
        scheduled_days: 10,
        reps: 3,
        lapses: 0,
        last_review: Date.now() - 3 * 86_400_000,
      },
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
    expect(badge?.textContent).toBe("★ Guardada en tu cuaderno · Asentada");
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

  it("«Ya la sé» ajusta theta una sola vez y en la llave viva", async () => {
    window.localStorage.clear();
    const onRecordSilentCalibration = vi.fn();

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onRecordSilentCalibration,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // La consulta de ficha sí deja su señal; el acto de declarar no la repite.
    onRecordSilentCalibration.mockClear();
    const knownBtn = host.querySelector<HTMLButtonElement>(".btn--quick-known")!;
    await act(async () => {
      click(knownBtn);
    });

    expect(onRecordSilentCalibration).not.toHaveBeenCalled();

    const { loadUserLanguageProfile } = await import("../lib/profile-models");
    expect(loadUserLanguageProfile().thetaByLang.es).toBeGreaterThan(0);
    // La llave heredada (escala 7 − zipf) ya no se escribe.
    expect(window.localStorage.getItem("lecta:user_theta:es:v1")).toBeNull();
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

    const { scheduleReadingSyncPush } = await import("../lib/reading-sync");
    expect(scheduleReadingSyncPush).toHaveBeenCalledWith("words");
    const { getSyncState } = await import("../lib/sync-state");
    expect(getSyncState().pendingChangesCount).toBeGreaterThan(0);
  });

  it("abre con la definición de diccionario sin llamar a la IA y ofrece '¿Qué significa aquí?'", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    vi.mocked(explainInPassage).mockClear();

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

    await flush();

    const meaningBlock = host.querySelector(".word-panel-meaning-block");
    expect(meaningBlock).not.toBeNull();
    expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
      "De corta duración.",
    );

    // Con diccionario disponible no hay consulta IA automática ni se
    // muestra la explicación sin pedirla.
    expect(explainInPassage).not.toHaveBeenCalled();
    expect(host.querySelector(".passage-meaning-text")).toBeNull();

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainPassageBtn).not.toBeNull();
    expect(explainPassageBtn?.textContent).toContain("¿Qué significa aquí?");

    // La palabra queda resaltada dentro de la cita.
    expect(host.querySelector(".word-card-context-quote mark")?.textContent).toBe("efimero");
  });

  it("cuenta free: '¿Qué significa aquí?' muestra la nota de Lecta+ sin llamar a la IA", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    vi.mocked(explainInPassage).mockClear();

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero en el libro.",
        language: "es",
        bookHash: "book123",
        planLocked: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await flush();

    const btn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(btn).not.toBeNull();
    await act(async () => {
      click(btn!);
    });
    await flush();

    expect(explainInPassage).not.toHaveBeenCalled();
    expect(host.querySelector(".plan-note")?.textContent).toContain(
      "La explicación en contexto es de Lecta+.",
    );
    // El significado del diccionario sigue a la vista.
    expect(host.textContent).toContain("De corta duración.");
  });

  it("un 402 del servidor también pinta la nota de Lecta+", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    vi.mocked(explainInPassage).mockResolvedValueOnce({
      ok: false,
      error: "Esta función es de Lecta+.",
      code: "LECTA_PLUS_REQUIRED",
    });

    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero en el libro.",
        language: "es",
        bookHash: "book402",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await flush();
    await act(async () => {
      click(host.querySelector<HTMLButtonElement>(".btn--explain-passage")!);
    });
    await flush();

    expect(host.querySelector(".plan-note")).not.toBeNull();
  });

  it("al tocar '¿Qué significa aquí?' muestra el matiz y el tono, sin apunte del gato", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    vi.mocked(explainInPassage).mockClear();

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

    await flush();

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainPassageBtn).not.toBeNull();

    await act(async () => {
      click(explainPassageBtn!);
    });
    await flush();

    // La consulta envía la definición visible para pedir sólo el matiz.
    expect(explainInPassage).toHaveBeenCalledTimes(1);
    expect(explainInPassage).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "efimero",
        localDefinition: "De corta duración.",
      }),
      expect.anything(),
    );

    expect(host.querySelector(".passage-meaning-text")?.textContent).toContain(
      "Aquí «efímero» alude a la fugacidad del instante poético.",
    );
    expect(host.querySelector(".word-card-tone")?.textContent).toContain(
      "Lírico y melancólico",
    );
    // El apunte del gato ya no vive en el panel.
    expect(host.querySelector(".cat-tip-text")).toBeNull();
  });

  it("sin definición de diccionario pide el significado a la IA y la frase no repite la consulta", async () => {
    const { lookupWord, explainInPassage } = await import("../lib/lexicon");
    vi.mocked(lookupWord).mockResolvedValueOnce({ ok: true, found: false, entries: [] });
    vi.mocked(explainInPassage).mockClear();

    render(
      h(WordPanel, {
        word: "stilt",
        context: "The high, stilt buildings rise above the muddy ground.",
        language: "en",
        bookHash: "bookEng",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await flush();

    // Variante completa: se pidió el significado sin localDefinition.
    expect(explainInPassage).toHaveBeenCalledTimes(1);
    expect(explainInPassage).toHaveBeenCalledWith(
      expect.not.objectContaining({ localDefinition: expect.anything() }),
      expect.anything(),
    );
    expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
      "Fugaz, de corta duración.",
    );
    expect(host.querySelector(".word-card-ai-source")?.textContent).toContain(
      "Significado sugerido por IA",
    );
    expect(host.querySelector(".passage-meaning-text")).toBeNull();

    // Al tocar la frase se reutiliza la misma respuesta: 0 consultas extra.
    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage")!;
    await act(async () => {
      click(explainPassageBtn);
    });
    await flush();

    expect(explainInPassage).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".passage-meaning-text")?.textContent).toContain(
      "Aquí «efímero» alude a la fugacidad del instante poético.",
    );
  });

  it("si la frase repite el significado (servidor sin directMeaning) no se pinta dos veces", async () => {
    const { lookupWord, explainInPassage } = await import("../lib/lexicon");
    vi.mocked(lookupWord).mockResolvedValueOnce({ ok: true, found: false, entries: [] });
    vi.mocked(explainInPassage).mockClear();
    vi.mocked(explainInPassage).mockResolvedValueOnce({
      ok: true,
      contextualMeaning: "Aquí describe edificios elevados sobre pilotes.",
      toneAndNuance: "Irónico",
      catTip: "El nombre del pueblo es un guiño.",
    });

    render(
      h(WordPanel, {
        word: "obstinate",
        context: "The obstinate mule refused to move an inch.",
        language: "en",
        bookHash: "bookEng",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await flush();

    // Sin directMeaning el matiz cubre el significado…
    expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
      "Aquí describe edificios elevados sobre pilotes.",
    );

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage")!;
    await act(async () => {
      click(explainPassageBtn);
    });
    await flush();

    // …y al revelar la frase sólo queda el tono: el texto no se duplica.
    expect(host.querySelector(".passage-meaning-text")).toBeNull();
    expect(host.querySelector(".word-card-tone")?.textContent).toContain("Irónico");
  });

  it("sin sesión y sin diccionario no llama a la IA y muestra el aviso de iniciar sesión", async () => {
    const { lookupWord, explainInPassage } = await import("../lib/lexicon");
    vi.mocked(lookupWord).mockResolvedValueOnce({ ok: true, found: false, entries: [] });
    vi.mocked(explainInPassage).mockClear();

    render(
      h(WordPanel, {
        word: "stilt",
        context: "The high, stilt buildings rise above the muddy ground.",
        language: "en",
        bookHash: "bookEng",
        canExplain: false,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await flush();

    expect(explainInPassage).not.toHaveBeenCalled();
    const fallbacks = [...host.querySelectorAll(".word-card-context-fallback")].map(
      (el) => el.textContent,
    );
    expect(
      fallbacks.some((t) => t?.includes("Inicia sesión para que la IA la explique")),
    ).toBe(true);
    expect(
      fallbacks.some((t) => t?.includes("Inicia sesión para explicar frases con IA")),
    ).toBe(true);
    expect(host.querySelector(".btn--explain-passage")).toBeNull();
  });

  it("un error de la IA muestra aviso y 'Reintentar' vuelve a consultar", async () => {
    const { explainInPassage } = await import("../lib/lexicon");
    vi.mocked(explainInPassage).mockClear();
    vi.mocked(explainInPassage).mockResolvedValueOnce({
      ok: false,
      error: "Llegaste al límite de explicaciones por hora. Intenta más tarde.",
    });

    render(
      h(WordPanel, {
        word: "efimero",
        context: "La gloria efimera pasa y no regresa.",
        language: "es",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await flush();

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage")!;
    await act(async () => {
      click(explainPassageBtn);
    });
    await flush();

    expect(host.querySelector(".word-card-context-fallback")?.textContent).toContain(
      "Llegaste al límite de explicaciones por hora",
    );
    const retryBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage")!;
    expect(retryBtn.textContent).toContain("Reintentar");

    await act(async () => {
      click(retryBtn);
    });
    await flush();

    expect(explainInPassage).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".passage-meaning-text")?.textContent).toContain(
      "Aquí «efímero» alude a la fugacidad del instante poético.",
    );
  });

  it("al guardar sin diccionario el cuaderno recibe el significado, no el matiz", async () => {
    const { lookupWord } = await import("../lib/lexicon");
    const { saveWordWithKnowledge } = await import("../lib/idb");
    vi.mocked(lookupWord).mockResolvedValueOnce({ ok: true, found: false, entries: [] });
    vi.mocked(saveWordWithKnowledge).mockClear();

    render(
      h(WordPanel, {
        word: "stilt",
        context: "The high, stilt buildings rise above the muddy ground.",
        language: "en",
        bookHash: "bookEng",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await flush();

    const saveBtn = host.querySelector<HTMLButtonElement>(".btn--pin-notebook")!;
    await act(async () => {
      click(saveBtn);
    });
    await flush();

    expect(saveWordWithKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        word: expect.objectContaining({
          meaning: "Fugaz, de corta duración.",
        }),
      }),
      expect.anything(),
    );
  });

  it("renderiza la cabecera responsiva de 2 filas con botón × fijo en la fila superior", async () => {
    const onClose = vi.fn();
    render(
      h(WordPanel, {
        word: "efimero",
        context: "Un momento efimero.",
        language: "es",
        bookHash: "book123",
        onClose,
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const header = host.querySelector(".word-panel__header");
    expect(header).not.toBeNull();

    const topRow = header?.querySelector(".word-panel__top-row");
    expect(topRow).not.toBeNull();
    expect(topRow?.querySelector(".word-panel__word")?.textContent).toBe("efimero");
    expect(topRow?.querySelector(".word-panel__audio-btn")).not.toBeNull();

    const closeBtn = topRow?.querySelector<HTMLButtonElement>(".word-panel__close-btn");
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      click(closeBtn!);
    });
    expect(onClose).toHaveBeenCalled();

    const statusRow = header?.querySelector(".word-panel__status-row");
    expect(statusRow).not.toBeNull();
    expect(statusRow?.querySelector(".word-panel__save-cta")).not.toBeNull();
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
    await flush();

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
    const { saveKnowledge } = await import("../lib/idb");
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

    // 2. Con modificador no es atajo: Cmd+S no declara nada
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
    });
    expect(saveKnowledge).not.toHaveBeenCalled();

    // 3. Probar atajo 's' (marcar como conocida)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    });
    expect(saveKnowledge).toHaveBeenCalled();
    // Una declaración queda en el historial pero no paga XP.
    const { recordReview } = await import("../lib/reviews");
    expect(recordReview).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "declared", rating: "known" }),
      expect.anything(),
      { award: false },
    );
  });

  it("atajo 'g' guarda y después 's' ya no declara conocida la palabra guardada", async () => {
    const { saveWordWithKnowledge, saveKnowledge } = await import("../lib/idb");
    const onSaved = vi.fn();
    render(
      h(WordPanel, {
        word: "efimero",
        language: "es",
        context: "El destello fue efímero pero intenso.",
        bookHash: "book123",
        onClose: vi.fn(),
        onSaved,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    });
    expect(saveWordWithKnowledge).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    vi.mocked(saveKnowledge).mockClear();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    });
    expect(saveKnowledge).not.toHaveBeenCalled();
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

    // El significado de la IA queda en el bloque de Significado; la
    // explicación de la frase sigue esperando al toque del lector.
    expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
      "Fugaz, de corta duración.",
    );
    expect(host.querySelector(".passage-meaning-text")).toBeNull();
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
      expect(onRecordSilentCalibration).toHaveBeenCalledWith("alborada", "lookup", "es", undefined);

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

    it("resuelve el significado con la consulta de contexto y deja el matiz listo al tocarla", async () => {
      let resolveContextual: (res: ContextualMeaningResult) => void = () => {};
      const fetchContextualMeaning = vi.fn(
        () =>
          new Promise<ContextualMeaningResult>((resolve) => {
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

      // Se resuelve la IA contextual: sin definición de diccionario el
      // texto cubre el bloque de Significado.
      await act(async () => {
        resolveContextual({
          inPassageMeaning: "Aquí significa una ilusión irrealizable.",
          toneOrNuance: "Melancólico",
        });
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });

      expect(host.querySelector(".word-panel-primary-def")?.textContent).toContain(
        "Aquí significa una ilusión irrealizable.",
      );

      // Al tocar la frase no hay nueva consulta: el mismo texto no se
      // repite y sólo queda el tono.
      const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage")!;
      expect(fetchContextualMeaning).toHaveBeenCalledTimes(1);
      await act(async () => {
        click(explainPassageBtn);
      });
      expect(host.querySelector(".passage-meaning-text")).toBeNull();
      expect(host.querySelector(".word-card-tone")?.textContent).toContain("Melancólico");
      expect(fetchContextualMeaning).toHaveBeenCalledTimes(1);
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

      expect(onRecordSilentCalibration).toHaveBeenCalledWith("quimera", "save", "es", undefined);
      expect(onSaveToNotebook).toHaveBeenCalledWith(
        expect.objectContaining({
          word: "quimera",
          sentenceContext: "Su sueño de volar era una quimera inalcanzable.",
        }),
      );
    });
  });

  describe("WordPanel - Memoria de Personajes y Cero Spoilers (Track 8 · Fase 2)", () => {
    it("conmuta automáticamente a la tarjeta de personaje si es nombre propio y muestra anclas sin spoilers", async () => {
      const onSelectWord = vi.fn();
      const sections = [
        {
          createDocument: async () =>
            new DOMParser().parseFromString(
              "<body><p>Edmond Dantès llegó al puerto de Marsella con Mercédès.</p></body>",
              "text/html",
            ),
        },
        {
          createDocument: async () =>
            new DOMParser().parseFromString(
              "<body><p>Dantès fue arrestado durante el banquete.</p></body>",
              "text/html",
            ),
        },
        {
          createDocument: async () =>
            new DOMParser().parseFromString(
              "<body><p>SPOILER FATAL: Dantès escapa del Castillo de If.</p></body>",
              "text/html",
            ),
        },
      ];

      const toc = [
        { index: 0, label: "Capítulo I: Marsella" },
        { index: 1, label: "Capítulo II: El Banquete" },
        { index: 2, label: "Capítulo III: El Castillo de If (Futuro)" },
      ];

      render(
        h(WordPanel, {
          word: "Dantès",
          sentenceContext: "Entonces Dantès miró a su alrededor con asombro.",
          language: "es",
          sections,
          toc,
          currentSectionIndex: 1,
          currentChapterTitle: "Capítulo II: El Banquete",
          onSelectWord,
          initialViewMode: "character",
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

      // 1. Debe haber conmutado automáticamente al modo personaje
      const memoryCard = host.querySelector(".character-memory-card");
      expect(memoryCard).not.toBeNull();
      expect(memoryCard?.textContent).toContain("Memoria del libro · Sin spoilers hasta tu página");

      // 2. Insignia de seguridad estricta Cero Spoilers
      const securityBadge = host.querySelector(".character-security-badge");
      expect(securityBadge).not.toBeNull();
      expect(securityBadge?.textContent).toContain("Hasta el Capítulo II: El Banquete (Cero Spoilers)");

      // 3. Primera aparición (Capítulo I)
      const firstMention = host.querySelector(".character-first-mention");
      expect(firstMention).not.toBeNull();
      expect(firstMention?.textContent).toContain("Primera vez que apareció (Capítulo I: Marsella)");
      expect(firstMention?.textContent).toContain("Edmond Dantès llegó al puerto de Marsella");

      // 4. Última vez visto antes de aquí (Capítulo II)
      const recentMention = host.querySelector(".character-recent-mention");
      expect(recentMention).not.toBeNull();
      expect(recentMention?.textContent).toContain("Última vez visto antes de aquí (Capítulo II: El Banquete)");
      expect(recentMention?.textContent).toContain("Dantès fue arrestado durante el banquete");

      // 5. Garantía matemática Cero Spoilers: el capítulo 3 no existe en la ficha
      expect(host.textContent).not.toContain("Castillo de If");

      // 6. Relación en escena: píldoras de personajes que co-ocurren (Mercédès)
      const companionPills = [...host.querySelectorAll<HTMLButtonElement>(".character-companion-pill")];
      const mercedesPill = companionPills.find((p) => p.textContent === "Mercédès");
      expect(mercedesPill).toBeDefined();

      // Al pulsar en el personaje relacionado, invoca onSelectWord
      await act(async () => {
        click(mercedesPill!);
      });
      expect(onSelectWord).toHaveBeenCalledWith("Mercédès");
    });

    it("permite conmutar manualmente entre vista de Personaje y Diccionario con 1 toque", async () => {
      render(
        h(WordPanel, {
          word: "Dantès",
          sentenceContext: "Entonces Dantès miró al mar.",
          language: "es",
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Localizar botones del conmutador de modo
      const modeButtons = host.querySelectorAll<HTMLButtonElement>(".btn--mode-toggle");
      expect(modeButtons.length).toBe(2);

      const dictBtn = [...modeButtons].find((b) => b.textContent?.includes("Diccionario"))!;
      const charBtn = [...modeButtons].find((b) => b.textContent?.includes("Personaje"))!;

      // Conmutar a Diccionario
      await act(async () => {
        click(dictBtn);
      });
      expect(host.querySelector(".word-panel-meaning-block")).not.toBeNull();
      expect(host.querySelector(".character-memory-card")).toBeNull();

      // Conmutar de vuelta a Personaje
      await act(async () => {
        click(charBtn);
      });
      expect(host.querySelector(".character-memory-card")).not.toBeNull();
      expect(host.querySelector(".word-panel-meaning-block")).toBeNull();
    });

    it("en libros L2 ofrece botón de traducción de citas al idioma materno", async () => {
      const { translateParagraph } = await import("../lib/translate");

      const sections = [
        {
          createDocument: async () =>
            new DOMParser().parseFromString(
              "<body><p>Dr. Watson met Sherlock Holmes in the laboratory.</p></body>",
              "text/html",
            ),
        },
      ];

      render(
        h(WordPanel, {
          word: "Watson",
          sentenceContext: "Dr. Watson stepped forward quietly.",
          language: "en",
          bookLanguage: "en",
          sections,
          currentSectionIndex: 0,
          currentChapterTitle: "Chapter 1",
          initialViewMode: "character",
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

      const translateBtn = host.querySelector<HTMLButtonElement>(".btn--translate-character-quotes");
      expect(translateBtn).not.toBeNull();
      expect(translateBtn?.textContent).toContain("Traducir citas al español");

      // Pulsar traducir citas
      await act(async () => {
        click(translateBtn!);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(translateParagraph).toHaveBeenCalledWith(
        expect.stringContaining("Watson"),
        "en",
        "es",
        expect.anything(),
      );
      expect(host.querySelector(".character-first-mention")?.textContent).toContain(
        "[ES] Dr. Watson met Sherlock Holmes",
      );
    });

    it("no escanea capítulos del EPUB ni muestra pestaña Personaje al consultar una palabra común en minúscula", async () => {
      const createDocSpy = vi.fn(async () =>
        new DOMParser().parseFromString(
          "<body><p>Un momento efimero de lectura.</p></body>",
          "text/html",
        ),
      );
      const sections = [{ createDocument: createDocSpy }];

      render(
        h(WordPanel, {
          word: "efimero",
          sentenceContext: "Un momento efimero de lectura.",
          language: "es",
          sections,
          currentSectionIndex: 0,
          currentChapterTitle: "Capítulo 1",
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
      );

      await flush();

      expect(createDocSpy).not.toHaveBeenCalled();
      expect(host.querySelector(".word-panel-mode-switcher")).toBeNull();
      expect(host.querySelector(".character-memory-card")).toBeNull();
    });
  });
  describe("WordPanel - IPA y pronunciación lenta (remediación)", () => {
    it("pinta el IPA bajo el término cuando el entry lo trae", async () => {
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
      await flush();
      const ipa = host.querySelector(".word-panel__ipa");
      expect(ipa).not.toBeNull();
      expect(ipa?.textContent).toContain("eˈfimero");
    });

    it("no pinta IPA cuando el entry no lo trae", async () => {
      const { lookupWord } = await import("../lib/lexicon");
      vi.mocked(lookupWord).mockResolvedValueOnce({
        ok: true,
        found: true,
        entries: [
          {
            entryId: null,
            lemma: "efimero",
            pos: "adjetivo",
            freqRank: null,
            zipf: 2.5,
            senses: [{ definition: "De corta duración.", example: null, senseOrder: 1 }],
          },
        ],
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
      await flush();
      expect(host.querySelector(".word-panel__ipa")).toBeNull();
    });

    it("long-press del altavoz dispara speakWord con rate 0.6", async () => {
      const { speakWord } = await import("../lib/speech");
      vi.mocked(speakWord).mockClear();

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
      await flush();

      const audioBtn = host.querySelector<HTMLButtonElement>(".btn--pronounce")!;
      await act(async () => {
        audioBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      await flush();

      expect(speakWord).toHaveBeenCalledWith("efimero", "es", 0.6);
    });

    it("click normal del altavoz dispara speakWord con rate por defecto", async () => {
      const { speakWord } = await import("../lib/speech");
      vi.mocked(speakWord).mockClear();

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
      await flush();

      const audioBtn = host.querySelector<HTMLButtonElement>(".btn--pronounce")!;
      await act(async () => {
        click(audioBtn);
      });
      await flush();

      expect(speakWord).toHaveBeenCalledWith("efimero", "es");
    });
  });

});

