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

  it("renderiza Nivel 1 (Vistazo Rápido) con la acepción exacta y botón 'Profundizar ↑'", async () => {
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

    const level1 = host.querySelector(".word-panel-level-1");
    expect(level1).not.toBeNull();
    expect(host.querySelector(".word-panel-best-sense-def")?.textContent).toContain(
      "De corta duración.",
    );

    const deepenBtn = host.querySelector<HTMLButtonElement>(".btn--profundizar");
    expect(deepenBtn).not.toBeNull();
    expect(deepenBtn?.textContent).toContain("Profundizar ↑");
  });

  it("al pulsar 'Profundizar ↑' pasa a Nivel 2 y muestra '✨ Explicar en este pasaje (IA)'", async () => {
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

    const deepenBtn = host.querySelector<HTMLButtonElement>(".btn--profundizar")!;
    await act(async () => {
      click(deepenBtn);
    });

    const level2 = host.querySelector(".word-panel-level-2");
    expect(level2).not.toBeNull();

    const explainPassageBtn = host.querySelector<HTMLButtonElement>(".btn--explain-passage");
    expect(explainPassageBtn).not.toBeNull();
    expect(explainPassageBtn?.textContent).toContain("✨ Explicar en este pasaje (IA)");

    // Tocar el botón de IA en pasaje
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

    // Abrir nivel 2 (profundizar) para ver el botón de explicación
    const deepenBtn = host.querySelector<HTMLButtonElement>(".btn--profundizar")!;
    expect(deepenBtn).not.toBeNull();
    await act(async () => {
      click(deepenBtn);
    });

    // Probar explicación en pasaje con nativeLanguage
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
});

