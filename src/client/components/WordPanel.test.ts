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
  it("renderiza botones rápidos '✓ Ya la sé' y '★ Fijar en mi cuaderno'", async () => {
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
    expect(pinBtn?.textContent).toContain("★ Fijar en mi cuaderno");
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
});
