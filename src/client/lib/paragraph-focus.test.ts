// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  clearParagraphFocus,
  focusBlock,
  FOCUSED_BLOCK_CLASS,
  updateParagraphFocus,
} from "./paragraph-focus";

describe("paragraph-focus", () => {
  it("focusBlock activa la clase y limpia a otros hermanos", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p id='p1'>Uno</p><p id='p2' class='is-focused'>Dos</p>";
    const p1 = div.querySelector("#p1")!;
    const p2 = div.querySelector("#p2")!;

    focusBlock(div, p1);
    expect(p1.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);
    expect(p2.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(false);
  });

  it("clearParagraphFocus retira la clase de todos los párrafos", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p class='is-focused'>A</p><blockquote class='is-focused'>B</blockquote>";
    clearParagraphFocus(div);
    expect(div.querySelectorAll(`.${FOCUSED_BLOCK_CLASS}`).length).toBe(0);
  });

  it("updateParagraphFocus elige el párrafo que cruza la línea focal", () => {
    const div = document.createElement("div");
    const p1 = document.createElement("p");
    p1.textContent = "Primer párrafo";
    const p2 = document.createElement("p");
    p2.textContent = "Segundo párrafo";
    div.appendChild(p1);
    div.appendChild(p2);

    // Simulamos getBoundingClientRect
    vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 200,
      left: 0,
      right: 500,
      width: 500,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(p2, "getBoundingClientRect").mockReturnValue({
      top: 220,
      bottom: 450,
      left: 0,
      right: 500,
      width: 500,
      height: 230,
      x: 0,
      y: 220,
      toJSON: () => {},
    });

    // Línea focal a 300px: debe enfocar p2
    const focused = updateParagraphFocus(div, 300);
    expect(focused).toBe(p2);
    expect(p2.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);
    expect(p1.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(false);

    // Línea focal a 100px: debe enfocar p1
    const focused2 = updateParagraphFocus(div, 100);
    expect(focused2).toBe(p1);
    expect(p1.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);
    expect(p2.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(false);
  });

  it("updateParagraphFocus ignora bloques vacíos o dentro de .section-preview-slot", () => {
    const div = document.createElement("div");
    div.innerHTML = `
      <div class="section-preview-slot"><p id="slot-p">Previa</p></div>
      <p id="empty">   </p>
      <p id="real">Texto real</p>
    `;
    const real = div.querySelector("#real")!;
    vi.spyOn(real, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 200,
      left: 0,
      right: 500,
      width: 500,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => {},
    });

    const focused = updateParagraphFocus(div, 150);
    expect(focused).toBe(real);
  });
});
