// @vitest-environment jsdom
/* eslint-disable react-hooks/refs */
import { act, createElement as h, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageGesture, type UsePageGestureOptions } from "./use-page-gesture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function createPointerEvent(type: string, init: PointerEventInit, timeStamp = Date.now()): PointerEvent {
  const event = new PointerEvent(type, init);
  Object.defineProperty(event, "timeStamp", { value: timeStamp, configurable: true });
  return event;
}

function TestHarness(props: Partial<UsePageGestureOptions>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  usePageGesture({
    viewportRef,
    containerRef,
    layout: "pages",
    page: 0,
    pageCount: 5,
    pageAdvance: 500,
    isFirstPageInBook: false,
    isLastPageInBook: false,
    reducedMotion: false,
    onTurnPage: vi.fn(),
    ...props,
  });

  return h(
    "div",
    { ref: viewportRef, className: "page-viewport" },
    h("div", { ref: containerRef, className: "book-content" }),
  );
}

describe("usePageGesture", () => {
  it("monta sin errores y ajusta touch-action", () => {
    act(() => {
      root.render(h(TestHarness));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    expect(viewport.style.touchAction).toBe("pan-y pinch-zoom");
  });

  it("ignora punteros de tipo mouse", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    const container = host.querySelector(".book-content") as HTMLElement;

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 200,
          clientY: 200,
          bubbles: true,
        }),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 50,
          clientY: 200,
          bubbles: true,
        }),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 50,
          clientY: 200,
          bubbles: true,
        }),
      );
    });

    expect(onTurn).not.toHaveBeenCalled();
    expect(container.getAttribute("data-dragging")).toBeNull();
  });

  it("reclama swipe y avanza de página con toque horizontal significativo", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    const container = host.querySelector(".book-content") as HTMLElement;

    // Simular dimensiones del viewport
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: 300,
          clientY: 200,
          bubbles: true,
        }, 100),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 150, // dx = -150 (> 25% de 400)
          clientY: 200,
          bubbles: true,
        }, 200),
      );
    });

    expect(container.getAttribute("data-dragging")).toBe("true");

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 150,
          clientY: 200,
          bubbles: true,
        }, 250),
      );
    });

    expect(container.getAttribute("data-dragging")).toBeNull();
    expect(onTurn).toHaveBeenCalledWith(1);
  });

  it("suprime el click posterior a un swipe confirmado", () => {
    act(() => {
      root.render(h(TestHarness, { onTurnPage: vi.fn() }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: 300,
          clientY: 200,
          bubbles: true,
        }, 100),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 100,
          clientY: 200,
          bubbles: true,
        }, 200),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 100,
          clientY: 200,
          bubbles: true,
        }, 250),
      );
    });

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const notPrevented = viewport.dispatchEvent(clickEvent);
    // El listener en fase de captura debió prevenir el click
    expect(notPrevented).toBe(false);
  });

  it("cancela swipe si el movimiento es predominantemente vertical", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    const container = host.querySelector(".book-content") as HTMLElement;

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: 200,
          clientY: 200,
          bubbles: true,
        }, 100),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 205,
          clientY: 300, // dy grande
          bubbles: true,
        }, 200),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 205,
          clientY: 300,
          bubbles: true,
        }, 250),
      );
    });

    expect(container.getAttribute("data-dragging")).toBeNull();
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("invoca onCenterTap en tap simple en zona central", () => {
    const onCenterTap = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onCenterTap }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 400, top: 0, height: 600, right: 400, bottom: 600 }),
    });

    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: 200,
          clientY: 200,
          bubbles: true,
        }, 100),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 200,
          clientY: 200,
          bubbles: true,
        }, 120),
      );
    });

    expect(onCenterTap).toHaveBeenCalledTimes(1);
  });

  it("no invoca onCenterTap si el toque ocurre en zona lateral o sobre elemento interactivo", () => {
    const onCenterTap = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onCenterTap }));
    });
    const viewport = host.querySelector(".page-viewport") as HTMLElement;
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 400, top: 0, height: 600, right: 400, bottom: 600 }),
    });

    // Toque lateral izquierdo (clientX: 50 < 25% de 400)
    act(() => {
      viewport.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: 50,
          clientY: 200,
          bubbles: true,
        }, 100),
      );
      viewport.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 50,
          clientY: 200,
          bubbles: true,
        }, 120),
      );
    });

    expect(onCenterTap).not.toHaveBeenCalled();
  });
});

