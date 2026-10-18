// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  clearParagraphFocus,
  focusBlock,
  FOCUSED_BLOCK_CLASS,
  updateParagraphFocus,
  FOCUS_DIM_OPACITY_LIGHT,
  FOCUS_DIM_OPACITY_DARK,
  getFocusDimOpacity,
  focusNextParagraph,
  focusPrevParagraph,
  handleParagraphFocusKey,
  setupParagraphFocusClick,
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

  describe("Ventana Atencional Adaptativa (Fase 2)", () => {
    it("provee constantes de opacidad suave (0.32 claro / 0.28 oscuro)", () => {
      expect(FOCUS_DIM_OPACITY_LIGHT).toBe(0.32);
      expect(FOCUS_DIM_OPACITY_DARK).toBe(0.28);
      expect(getFocusDimOpacity(false)).toBe(0.32);
      expect(getFocusDimOpacity(true)).toBe(0.28);
    });

    it("aplica opacidad suave a bloques atenuados y 100% al activo", () => {
      const div = document.createElement("div");
      div.innerHTML = "<p id='p1'>Párrafo 1</p><p id='p2'>Párrafo 2</p><p id='p3'>Párrafo 3</p>";
      const p1 = div.querySelector("#p1") as HTMLElement;
      const p2 = div.querySelector("#p2") as HTMLElement;
      const p3 = div.querySelector("#p3") as HTMLElement;

      focusBlock(div, p2, { isDark: false, applyInlineOpacity: true });
      expect(p2.style.opacity).toBe("1");
      expect(p1.style.opacity).toBe("0.32");
      expect(p3.style.opacity).toBe("0.32");

      // En tema oscuro: 0.28
      focusBlock(div, p1, { isDark: true, applyInlineOpacity: true });
      expect(p1.style.opacity).toBe("1");
      expect(p2.style.opacity).toBe("0.28");
      expect(p3.style.opacity).toBe("0.28");
    });

    it("avanza y retrocede de párrafo con focusNextParagraph y focusPrevParagraph", () => {
      const div = document.createElement("div");
      div.innerHTML = "<p id='p1'>A</p><p id='p2'>B</p><p id='p3'>C</p>";
      const p1 = div.querySelector("#p1")!;
      const p2 = div.querySelector("#p2")!;
      const p3 = div.querySelector("#p3")!;

      // Si no hay foco inicial, focusNextParagraph enfoca el primero
      expect(focusNextParagraph(div)).toBe(p1);
      expect(p1.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);

      // Siguiente pasa a p2
      expect(focusNextParagraph(div)).toBe(p2);
      expect(p2.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);

      // Siguiente pasa a p3
      expect(focusNextParagraph(div)).toBe(p3);
      expect(p3.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);

      // Al tope superior/inferior se mantiene en el último
      expect(focusNextParagraph(div)).toBe(p3);

      // Retroceder pasa a p2 y luego a p1
      expect(focusPrevParagraph(div)).toBe(p2);
      expect(focusPrevParagraph(div)).toBe(p1);
      expect(focusPrevParagraph(div)).toBe(p1);
    });

    it("navega con teclado (ArrowDown, ArrowUp, j, k)", () => {
      const div = document.createElement("div");
      div.innerHTML = "<p id='p1'>Alpha</p><p id='p2'>Beta</p>";
      const p1 = div.querySelector("#p1")!;
      const p2 = div.querySelector("#p2")!;
      focusBlock(div, p1);

      const onFocusChanged = vi.fn();
      const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown" });
      const focused = handleParagraphFocusKey(downEvent, div, { onFocusChanged });

      expect(focused).toBe(p2);
      expect(onFocusChanged).toHaveBeenCalledWith(p2);

      const upEvent = new KeyboardEvent("keydown", { key: "k" });
      const backFocused = handleParagraphFocusKey(upEvent, div, { onFocusChanged });
      expect(backFocused).toBe(p1);
    });

    it("permite cambiar foco en 1 toque al hacer clic en un párrafo", () => {
      const div = document.createElement("div");
      div.innerHTML = "<p id='p1'>Primero</p><p id='p2'>Segundo</p>";
      document.body.appendChild(div);
      const p1 = div.querySelector("#p1")!;
      const p2 = div.querySelector("#p2")!;
      focusBlock(div, p1);

      const onFocusChanged = vi.fn();
      const cleanup = setupParagraphFocusClick(div, { onFocusChanged });

      p2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(p2.classList.contains(FOCUSED_BLOCK_CLASS)).toBe(true);
      expect(onFocusChanged).toHaveBeenCalledWith(p2);

      cleanup();
      div.remove();
    });
  });
});
