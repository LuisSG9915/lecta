// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentenceBuilderGame } from "./SentenceBuilderGame";

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
});
