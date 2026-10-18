// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusRuler, rulerBandPx, RULER_PARAGRAPH_LINES } from "./FocusRuler";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("FocusRuler (Track 9 - Regla Oculomotora de Cero Latencia)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("calcula rulerBandPx correctamente para números de línea y párrafo", () => {
    expect(RULER_PARAGRAPH_LINES).toBe(6);
    expect(rulerBandPx(1, 24)).toBe(24);
    expect(rulerBandPx(3, 20)).toBe(60);
    expect(rulerBandPx("paragraph", 25)).toBe(150);
  });

  it("renderiza velos superior e inferior, la franja de lectura y el botón rápido ✕", () => {
    act(() => {
      root.render(h(FocusRuler, { bandPx: 100, lineHeightPx: 25 }));
    });

    const ruler = container.querySelector(".focus-ruler");
    expect(ruler).not.toBeNull();

    const topVeil = container.querySelector(".focus-ruler-veil--top");
    const bottomVeil = container.querySelector(".focus-ruler-veil--bottom");
    const band = container.querySelector(".focus-ruler-band");
    const closeBtn = container.querySelector(".focus-ruler-close-btn");

    expect(topVeil).not.toBeNull();
    expect(bottomVeil).not.toBeNull();
    expect(band).not.toBeNull();
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.textContent?.trim()).toBe("✕");
  });

  it("desactiva la regla en 1 toque al pulsar el botón ✕ y dispara onClose", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(h(FocusRuler, { bandPx: 100, lineHeightPx: 25, onClose }));
    });

    const closeBtn = container.querySelector(".focus-ruler-close-btn") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    // Tras pulsar ✕, la regla se desmonta (retorna null)
    expect(container.querySelector(".focus-ruler")).toBeNull();
  });

  it("responde a flechas de dirección (ArrowUp / ArrowDown) y desplaza la regla", () => {
    act(() => {
      root.render(h(FocusRuler, { bandPx: 80, lineHeightPx: 30 }));
    });

    const band = container.querySelector(".focus-ruler-band") as HTMLElement;
    const initialTop = band.style.insetBlockStart;

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    const movedDownTop = band.style.insetBlockStart;
    expect(movedDownTop).not.toBe(initialTop);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });

    expect(band.style.insetBlockStart).toBe(initialTop);
  });

  it("sincroniza con movimientos del puntero (pointermove) y táctiles (touchmove)", () => {
    act(() => {
      root.render(h(FocusRuler, { bandPx: 60, lineHeightPx: 20 }));
    });

    const band = container.querySelector(".focus-ruler-band") as HTMLElement;

    // Pointer move
    act(() => {
      const pointerEvt = new MouseEvent("pointermove", { clientY: 200 } as MouseEventInit);
      window.dispatchEvent(pointerEvt);
    });
    expect(band.style.insetBlockStart).toBe(`${200 - 30}px`);

    // Touch move
    act(() => {
      const touchEvt = new CustomEvent("touchmove") as unknown as TouchEvent;
      Object.defineProperty(touchEvt, "touches", {
        value: [{ clientY: 260 }],
      });
      window.dispatchEvent(touchEvt);
    });
    expect(band.style.insetBlockStart).toBe(`${260 - 30}px`);
  });

  it("renderiza el ancla decorativa si se provee la prop anchor", () => {
    act(() => {
      root.render(
        h(FocusRuler, {
          bandPx: 90,
          anchor: h("span", { id: "cat-paw" }, "🐾"),
        }),
      );
    });

    const anchorEl = container.querySelector(".focus-ruler-anchor");
    expect(anchorEl).not.toBeNull();
    expect(anchorEl?.textContent).toContain("🐾");
  });
});
