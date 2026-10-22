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
  vi.useRealTimers();
  vi.restoreAllMocks();
  host.remove();
  document.body.innerHTML = "";
  delete (window as { visualViewport?: unknown }).visualViewport;
});

const viewportOf = () => host.querySelector(".page-viewport") as HTMLElement;
const containerOf = () => host.querySelector(".book-content") as HTMLElement;

const touch = (type: string, x: number, y: number, timeStamp: number, extra: PointerEventInit = {}) =>
  createPointerEvent(type, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
    ...extra,
  }, timeStamp);

/** Arrastra de `fromX` a `toX` con un dt grande para que la velocidad sea baja. */
const drag = (fromX: number, toX: number, y = 200) => {
  const viewport = viewportOf();
  act(() => {
    viewport.dispatchEvent(touch("pointerdown", fromX, y, 100));
    viewport.dispatchEvent(touch("pointermove", toX, y, 1_000));
    viewport.dispatchEvent(touch("pointerup", toX, y, 1_100));
  });
};

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

  it("no monta listeners en modo scroll", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { layout: "scroll", onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: 200, bubbles: true, cancelable: true }));
    });
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("libera touch-action con zoom y no inicia arrastre", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale: 2, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    expect(viewportOf().style.touchAction).toBe("auto");

    drag(300, 100);
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("ignora punteros secundarios de un pellizco", () => {
    act(() => {
      root.render(h(TestHarness));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(touch("pointerdown", 300, 200, 100, { isPrimary: false }));
      viewport.dispatchEvent(touch("pointermove", 100, 200, 200));
    });
    expect(containerOf().getAttribute("data-dragging")).toBeNull();
  });

  it("acepta lápiz (pen) como puntero válido", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });
    act(() => {
      viewport.dispatchEvent(touch("pointerdown", 300, 200, 100, { pointerType: "pen" }));
      viewport.dispatchEvent(touch("pointermove", 120, 200, 200, { pointerType: "pen" }));
      viewport.dispatchEvent(touch("pointerup", 120, 200, 250, { pointerType: "pen" }));
    });
    expect(onTurn).toHaveBeenCalledWith(1);
  });

  it("bloquea el touchmove nativo mientras el gesto está reclamado", () => {
    act(() => {
      root.render(h(TestHarness));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(touch("pointerdown", 300, 200, 100));
      viewport.dispatchEvent(touch("pointermove", 100, 200, 200));
    });
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    viewport.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
  });

  it("no reclama el gesto si hay una selección de texto activa", () => {
    const onTurn = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "texto seleccionado",
    } as unknown as Selection);
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(touch("pointerdown", 300, 200, 100));
      viewport.dispatchEvent(touch("pointermove", 100, 200, 200));
    });
    expect(containerOf().getAttribute("data-dragging")).toBeNull();
    act(() => {
      viewport.dispatchEvent(touch("pointerup", 100, 200, 250));
    });
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("aplica resistencia elástica y háptica en el borde inicial", () => {
    act(() => {
      root.render(h(TestHarness, { page: 0, isFirstPageInBook: true }));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(touch("pointerdown", 100, 200, 100));
      viewport.dispatchEvent(touch("pointermove", 180, 200, 200));
    });
    const container = containerOf();
    expect(container.getAttribute("data-dragging")).toBe("true");
    // 80px * 0.35 = 28px
    expect(container.style.getPropertyValue("--drag-x")).toBe("28px");
  });

  it("no pasa de la última página del libro", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(
        h(TestHarness, { page: 4, pageCount: 5, isLastPageInBook: true, onTurnPage: onTurn }),
      );
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });
    drag(300, 100);
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("asienta la página con una transición cuando el gesto no confirma", () => {
    vi.useFakeTimers();
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });
    drag(300, 240); // 60px < 100px (25%) y velocidad baja
    const container = containerOf();
    expect(onTurn).not.toHaveBeenCalled();
    expect(container.style.transition).toContain("transform");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.style.transition).toBe("");
  });

  it("salta la animación cuando el usuario pide movimiento reducido", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { reducedMotion: true, onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });
    drag(300, 100);
    expect(onTurn).toHaveBeenCalledWith(1);
    expect(containerOf().style.getPropertyValue("--drag-x")).toBe("0px");
  });

  it("restablece la transición cuando el pase devuelve una promesa", async () => {
    let resolveTurn: (() => void) | undefined;
    const onTurn = vi.fn(
      () => new Promise<void>((resolve) => { resolveTurn = resolve; }),
    );
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "offsetWidth", { value: 400, configurable: true });
    drag(300, 120);
    expect(onTurn).toHaveBeenCalledWith(1);
    await act(async () => {
      resolveTurn?.();
    });
    expect(containerOf().style.getPropertyValue("--drag-x")).toBe("0px");
  });

  it("pasa de página con la rueda horizontal y se bloquea por inercia", () => {
    vi.useFakeTimers();
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    const wheel = (dx: number, dy = 0, ctrl = false) =>
      viewport.dispatchEvent(
        new WheelEvent("wheel", { deltaX: dx, deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true }),
      );

    act(() => { wheel(30); });
    expect(onTurn).not.toHaveBeenCalled();
    act(() => { wheel(40); }); // 70 >= 60
    expect(onTurn).toHaveBeenCalledWith(1);

    act(() => { wheel(80); }); // bloqueada
    expect(onTurn).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { wheel(70); });
    expect(onTurn).toHaveBeenCalledTimes(2);
  });

  it("ignora la rueda vertical y la que llega con Ctrl", () => {
    const onTurn = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onTurnPage: onTurn }));
    });
    const viewport = viewportOf();
    act(() => {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: 10, deltaY: 100, bubbles: true }));
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: 200, deltaY: 0, ctrlKey: true, bubbles: true }));
    });
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("no dispara onCenterTap sobre un enlace", () => {
    const onCenterTap = vi.fn();
    act(() => {
      root.render(h(TestHarness, { onCenterTap }));
    });
    const viewport = viewportOf();
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 400, top: 0, height: 600, right: 400, bottom: 600 }),
    });
    const link = document.createElement("a");
    link.href = "#x";
    viewport.appendChild(link);
    act(() => {
      link.dispatchEvent(touch("pointerdown", 200, 200, 100));
      link.dispatchEvent(touch("pointerup", 200, 200, 120));
    });
    expect(onCenterTap).not.toHaveBeenCalled();
  });

  it("reajusta --drag-x cuando la página cambia desde React", () => {
    act(() => {
      root.render(h(TestHarness, { page: 0 }));
    });
    const container = containerOf();
    const setProperty = vi.spyOn(container.style, "setProperty");
    act(() => {
      root.render(h(TestHarness, { page: 1 }));
    });
    expect(setProperty).toHaveBeenCalledWith("--drag-x", "0px");
    expect(container.style.transition).toBe("");
  });
});
