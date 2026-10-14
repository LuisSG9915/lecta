// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarGame } from "./GrammarGame";

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

describe("GrammarGame", () => {
  it("renders target word, meaning, and 4 category buttons", () => {
    render(
      h(GrammarGame, {
        targetWord: "efímero",
        meaning: "Que dura poco tiempo",
        pos: "adjetivo",
        onSolve: vi.fn(),
        onWrong: vi.fn(),
      }),
    );

    expect(host.querySelector(".grammar-target-word")?.textContent).toContain("efímero");
    expect(host.querySelector(".grammar-meaning")?.textContent).toContain("Que dura poco tiempo");

    const buttons = host.querySelectorAll(".grammar-cat-btn");
    expect(buttons.length).toBe(4);
    const labels = Array.from(buttons).map(
      (b) => b.querySelector(".grammar-cat-label")?.textContent,
    );
    expect(labels).toEqual(["Sustantivo", "Verbo", "Adjetivo", "Adverbio"]);
  });

  it("handles correct pick and triggers onSolve after delay", () => {
    const onSolve = vi.fn();
    const onWrong = vi.fn();
    render(
      h(GrammarGame, {
        targetWord: "efímero",
        pos: "adjetivo",
        onSolve,
        onWrong,
      }),
    );

    const buttons = host.querySelectorAll(".grammar-cat-btn");
    const adjButton = buttons[2]; // Adjetivo
    click(adjButton);

    expect(adjButton.classList.contains("is-correct")).toBe(true);
    expect(host.querySelector(".grammar-feedback")?.textContent).toContain("¡Exacto!");
    expect(onWrong).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("handles wrong pick and triggers onWrong", () => {
    const onSolve = vi.fn();
    const onWrong = vi.fn();
    render(
      h(GrammarGame, {
        targetWord: "efímero",
        pos: "adjetivo",
        onSolve,
        onWrong,
      }),
    );

    const buttons = host.querySelectorAll(".grammar-cat-btn");
    const verbButton = buttons[1]; // Verbo
    click(verbButton);

    expect(verbButton.classList.contains("is-wrong")).toBe(true);
    expect(host.querySelector(".grammar-feedback")?.textContent).toContain("Casi.");
    expect(onWrong).toHaveBeenCalledTimes(1);
    expect(onSolve).not.toHaveBeenCalled();
  });

  it("supports keyboard shortcut keys 1-4", () => {
    const onSolve = vi.fn();
    const onWrong = vi.fn();
    render(
      h(GrammarGame, {
        targetWord: "cantar",
        pos: "verbo",
        onSolve,
        onWrong,
      }),
    );

    // Press '2' for Verbo
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    });

    const buttons = host.querySelectorAll(".grammar-cat-btn");
    expect(buttons[1].classList.contains("is-correct")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("shows intuitive prompt and literary tone note on correct solve", () => {
    render(
      h(GrammarGame, {
        targetWord: "luminoso",
        pos: "adjetivo",
        onSolve: vi.fn(),
        onWrong: vi.fn(),
      }),
    );

    const prompt = host.querySelector(".grammar-card-prompt");
    expect(prompt?.textContent).toContain("¿Qué papel juega «luminoso» en esta escena?");

    const buttons = host.querySelectorAll(".grammar-cat-btn");
    click(buttons[2]); // Adjetivo

    const feedback = host.querySelector(".grammar-feedback")?.textContent;
    expect(feedback).toContain("Pinta la atmósfera");
  });
});
