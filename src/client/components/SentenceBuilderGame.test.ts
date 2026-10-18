// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentenceBuilderGame, splitSentenceAtTarget } from "./SentenceBuilderGame";

vi.mock("../lib/speech", () => ({
  speakWord: vi.fn().mockResolvedValue(undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

describe("SentenceBuilderGame", () => {
  it("renders sentence target word and word pool buttons", () => {
    render(
      h(SentenceBuilderGame, {
        targetWord: "libro",
        meaning: "Obra impresa o manuscrita",
        sentence: "El libro tiene secretos.",
        onSolve: vi.fn(),
      }),
    );

    expect(host.querySelector(".sentence-card-prompt")?.textContent).toContain("libro");
    const poolButtons = host.querySelectorAll(".sentence-pool-btn");
    expect(poolButtons.length).toBe(4);
  });

  it("places word in construction zone on click and moves it back on click", () => {
    render(
      h(SentenceBuilderGame, {
        targetWord: "libro",
        sentence: "El libro tiene páginas.",
        onSolve: vi.fn(),
      }),
    );

    const poolButtons = host.querySelectorAll(".sentence-pool-btn");
    click(poolButtons[0]);

    const placedChips = host.querySelectorAll(".sentence-chip.is-placed");
    expect(placedChips.length).toBe(1);

    // Tapping placed chip unplaces it
    click(placedChips[0]);
    const remainingPlaced = host.querySelectorAll(".sentence-chip.is-placed");
    expect(remainingPlaced.length).toBe(0);
  });

  it("solves sentence with auto hint button and triggers onSolve", () => {
    const onSolve = vi.fn();
    render(
      h(SentenceBuilderGame, {
        targetWord: "libro",
        sentence: "El libro es bueno.",
        onSolve,
      }),
    );

    // Click 💡 Pista 4 times to place all words correctly
    const hintBtn = Array.from(host.querySelectorAll(".sentence-action-btn")).find((b) =>
      b.textContent?.includes("Pista"),
    );
    expect(hintBtn).toBeDefined();

    for (let i = 0; i < 4; i++) {
      if (hintBtn) click(hintBtn);
    }

    const placedChips = host.querySelectorAll(".sentence-chip.is-placed");
    expect(placedChips.length).toBe(4);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("divides long sentence into 4-6 syntactic chunks and highlights target word", () => {
    const longSentence =
      "En aquel jardín silencioso, los cisnes blancos deslizaban su cuello sobre el agua azul.";
    render(
      h(SentenceBuilderGame, {
        targetWord: "cisnes",
        sentence: longSentence,
        onSolve: vi.fn(),
      }),
    );

    const poolButtons = host.querySelectorAll(".sentence-pool-btn");
    // Long 14-word sentence should NOT have 14 buttons, but 4 to 6 chunks
    expect(poolButtons.length).toBeGreaterThanOrEqual(4);
    expect(poolButtons.length).toBeLessThanOrEqual(6);

    // Target word "cisnes" should be highlighted inside its chunk
    const highlight = host.querySelector(".sentence-target-highlight");
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toBe("cisnes");
  });

  it("delivers response metrics (responseTimeMs, errorCount, usedHint) on solve", () => {
    const onSolve = vi.fn();
    render(
      h(SentenceBuilderGame, {
        targetWord: "libro",
        sentence: "El libro es bueno.",
        onSolve,
      }),
    );

    const hintBtn = Array.from(host.querySelectorAll(".sentence-action-btn")).find((b) =>
      b.textContent?.includes("Pista"),
    );
    for (let i = 0; i < 4; i++) {
      if (hintBtn) click(hintBtn);
    }
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        responseTimeMs: expect.any(Number),
        errorCount: 0,
        usedHint: true,
      }),
    );
  });

  describe("splitSentenceAtTarget", () => {
    it("divide correctamente la oración alrededor de la palabra objetivo", () => {
      const res = splitSentenceAtTarget(
        "El viento soplaba con furia en el valle.",
        "soplaba",
      );
      expect(res.prefix).toBe("El viento ");
      expect(res.matchedWord).toBe("soplaba");
      expect(res.suffix).toBe(" con furia en el valle.");
    });

    it("maneja palabra al inicio de la frase con mayúscula", () => {
      const res = splitSentenceAtTarget("Soplaba el viento.", "soplaba");
      expect(res.prefix).toBe("");
      expect(res.matchedWord).toBe("Soplaba");
      expect(res.suffix).toBe(" el viento.");
    });
  });

  describe("Modo Hueco Contextual Episódico (Cloze)", () => {
    it("renderiza la cita del capítulo con hueco elegante, glosa y 3 opciones", () => {
      render(
        h(SentenceBuilderGame, {
          targetWord: "soplaba",
          mode: "cloze",
          chapterSentence: "El viento soplaba con furia.",
          shortGloss: "Mover el aire con fuerza",
          onSolve: vi.fn(),
        }),
      );

      expect(host.querySelector(".sentence-cloze-quote")?.textContent).toContain("El viento");
      const slot = host.querySelector(".sentence-cloze-slot.is-blank");
      expect(slot).not.toBeNull();
      expect(slot?.textContent?.trim()).toBe("······");

      const gloss = host.querySelector(".sentence-cloze-gloss");
      expect(gloss?.textContent).toContain("Mover el aire con fuerza");

      const options = host.querySelectorAll(".sentence-cloze-option-btn");
      expect(options.length).toBe(3);
    });

    it("marca error y suma fallos al seleccionar una opción incorrecta", () => {
      const onWrong = vi.fn();
      render(
        h(SentenceBuilderGame, {
          targetWord: "soplaba",
          mode: "cloze",
          chapterSentence: "El viento soplaba con furia.",
          options: ["soplaba", "soplar", "soplado"],
          onSolve: vi.fn(),
          onWrong,
        }),
      );

      const wrongBtn = Array.from(host.querySelectorAll(".sentence-cloze-option-btn")).find(
        (b) => b.textContent?.includes("soplar"),
      );
      expect(wrongBtn).toBeDefined();
      if (wrongBtn) click(wrongBtn);

      expect(onWrong).toHaveBeenCalledTimes(1);
      expect(wrongBtn?.classList.contains("is-wrong")).toBe(true);
    });

    it("resuelve la frase, rellena el hueco, entrega métricas y reproduce pronunciación en L2", async () => {
      const onSolve = vi.fn();
      const { speakWord } = await import("../lib/speech");

      render(
        h(SentenceBuilderGame, {
          targetWord: "whisper",
          language: "en",
          mode: "cloze",
          chapterSentence: "She began to whisper softly.",
          shortGloss: "Hablar en voz muy baja",
          options: ["whisper", "whispered", "whispering"],
          onSolve,
        }),
      );

      const correctBtn = Array.from(host.querySelectorAll(".sentence-cloze-option-btn")).find(
        (b) => b.textContent?.includes("whisper"),
      );
      expect(correctBtn).toBeDefined();
      if (correctBtn) click(correctBtn);

      // El hueco debe tener la clase is-filled y mostrar la palabra
      const filledSlot = host.querySelector(".sentence-cloze-slot.is-filled");
      expect(filledSlot).not.toBeNull();
      expect(filledSlot?.textContent?.trim()).toBe("whisper");

      // Debe haber llamado a speakWord en inglés
      expect(speakWord).toHaveBeenCalledWith("whisper", "en");

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(onSolve).toHaveBeenCalledWith(
        expect.objectContaining({
          responseTimeMs: expect.any(Number),
          errorCount: 0,
          usedHint: false,
        }),
      );
    });

    it("la pista descarta una opción incorrecta disponible", () => {
      render(
        h(SentenceBuilderGame, {
          targetWord: "soplaba",
          mode: "cloze",
          chapterSentence: "El viento soplaba con furia.",
          options: ["soplaba", "soplar", "soplado"],
          onSolve: vi.fn(),
        }),
      );

      const discardBtn = Array.from(host.querySelectorAll(".sentence-action-btn")).find((b) =>
        b.textContent?.includes("Descartar"),
      );
      expect(discardBtn).toBeDefined();
      if (discardBtn) click(discardBtn);

      const wrongOptions = host.querySelectorAll(".sentence-cloze-option-btn.is-wrong");
      expect(wrongOptions.length).toBe(1);
    });

    it("genera automáticamente opciones coherentes cuando no se pasa el prop options", () => {
      const onSolve = vi.fn();
      render(
        h(SentenceBuilderGame, {
          targetWord: "quimera",
          mode: "cloze",
          chapterSentence: "Perseguía una quimera inalcanzable por los montes.",
          shortGloss: "Ilusión fantástica",
          onSolve,
        }),
      );

      const optionButtons = host.querySelectorAll(".sentence-cloze-option-btn");
      expect(optionButtons.length).toBe(3);

      const correctBtn = Array.from(optionButtons).find((b) =>
        b.querySelector(".sentence-pool-text")?.textContent?.trim() === "quimera",
      );
      expect(correctBtn).toBeDefined();

      if (correctBtn) click(correctBtn);

      const filledSlot = host.querySelector(".sentence-cloze-slot.is-filled");
      expect(filledSlot).not.toBeNull();
      expect(filledSlot?.textContent?.trim()).toBe("quimera");

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(onSolve).toHaveBeenCalledTimes(1);
    });
  });
});

