// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PracticeContext } from "./PracticeContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = (node: ReactNode) => act(() => root.render(node));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

describe("PracticeContext", () => {
  it("renders short context without wrapper or expand button", () => {
    render(h(PracticeContext, { text: "Una frase muy corta.", target: "frase" }));
    expect(host.querySelector(".card-context-box")).toBeNull();
    expect(host.querySelector(".card-context-toggle")).toBeNull();
    expect(host.textContent).toContain("Una frase muy corta.");
  });

  it("renders snippet and toggle button for long context", () => {
    const long =
      "En un lugar de la Mancha de cuyo nombre no quiero acordarme vivía un hidalgo que coleccionaba palabras raras como inmarcesible en sus viejos cuadernos de estudio bajo la luz tenue.";
    render(h(PracticeContext, { text: long, target: "inmarcesible" }));

    const box = host.querySelector(".card-context-box");
    expect(box).not.toBeNull();

    const toggle = host.querySelector(".card-context-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain("Ver contexto del libro");

    // Still folded
    expect(host.querySelector(".card-context--full")).toBeNull();

    // Click to expand
    if (toggle) click(toggle);
    expect(toggle?.textContent).toContain("Ocultar contexto completo");
    const full = host.querySelector(".card-context--full");
    expect(full).not.toBeNull();
    expect(full?.textContent).toContain(long);

    // Click again to collapse
    if (toggle) click(toggle);
    expect(host.querySelector(".card-context--full")).toBeNull();
  });
});
