// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordScrambleGame } from "./WordScrambleGame";

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

describe("WordScrambleGame", () => {
  it("renders tiles and empty slots for target word", () => {
    render(
      h(WordScrambleGame, {
        targetWord: "sol",
        meaning: "Estrella luminosa",
        onSolve: vi.fn(),
      }),
    );

    const slots = host.querySelectorAll(".scramble-slot");
    expect(slots.length).toBe(3);
    slots.forEach((slot) => {
      expect(slot.classList.contains("is-empty")).toBe(true);
    });

    const tiles = host.querySelectorAll(".scramble-tile");
    expect(tiles.length).toBe(3);
    const tileChars = Array.from(tiles).map((t) => t.textContent?.trim());
    expect(tileChars.sort()).toEqual(["L", "O", "S"]);
  });

  it("places tile into slot on click and removes it on slot click", () => {
    render(
      h(WordScrambleGame, {
        targetWord: "sol",
        onSolve: vi.fn(),
      }),
    );

    const tiles = host.querySelectorAll(".scramble-tile");
    click(tiles[0]);

    const filledSlots = host.querySelectorAll(".scramble-slot.is-filled");
    expect(filledSlots.length).toBe(1);

    // Tapping the slot returns the letter to the pool
    click(filledSlots[0]);
    const emptySlots = host.querySelectorAll(".scramble-slot.is-empty");
    expect(emptySlots.length).toBe(3);
  });

  it("handles keyboard typing and triggers onSolve when correctly spelled", () => {
    const onSolve = vi.fn();
    render(
      h(WordScrambleGame, {
        targetWord: "sol",
        onSolve,
      }),
    );

    // Type s, o, l
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    });

    const filledSlots = host.querySelectorAll(".scramble-slot.is-filled");
    expect(filledSlots.length).toBe(3);

    // Fast forward solve timer
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("provides hint when clicking Pista button", () => {
    const onAskHint = vi.fn();
    render(
      h(WordScrambleGame, {
        targetWord: "sol",
        onSolve: vi.fn(),
        onAskHint,
      }),
    );

    const hintBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Pista"),
    );
    expect(hintBtn).toBeDefined();
    if (hintBtn) click(hintBtn);

    const slots = host.querySelectorAll(".scramble-slot");
    expect(slots[0].textContent?.trim()).toBe("S");
    expect(onAskHint).toHaveBeenCalled();
  });
});
