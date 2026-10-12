// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

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
const fire = (el: Element, type: string) =>
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });

const dialogFor = (onClose: () => void) =>
  h(Dialog, {
    label: "Prueba",
    onClose,
    children: h("div", { className: "inside" }, h("button", null, "acción")),
  });

const scrim = () => host.querySelector(".dialog-scrim") as HTMLElement;
const dialog = () => host.querySelector(".dialog") as HTMLElement;
const inside = () => host.querySelector(".inside") as HTMLElement;

describe("Dialog toque exterior", () => {
  it("el contenedor es dialog enfocable (tabIndex -1)", () => {
    render(dialogFor(() => {}));
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().getAttribute("tabindex")).toBe("-1");
  });

  it("marca data-closing al tocar el fondo y completa onClose tras animationend", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    fire(scrim(), "pointerdown");
    fire(scrim(), "pointerup");
    expect(scrim().getAttribute("data-closing")).toBe("true");
    expect(dialog().getAttribute("data-closing")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    fire(dialog(), "animationend");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marca data-closing al presionar Escape y cierra tras animationend", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(scrim().getAttribute("data-closing")).toBe("true");
    expect(dialog().getAttribute("data-closing")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    fire(dialog(), "animationend");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marca data-closing al hacer click en un botón con data-dialog-close y cierra tras animationend", () => {
    const onClose = vi.fn();
    render(
      h(Dialog, {
        label: "Prueba botón",
        onClose,
        children: h("button", { type: "button", "aria-label": "Cerrar", "data-dialog-close": "" }, "✕"),
      }),
    );
    const closeBtn = host.querySelector("button[data-dialog-close]") as HTMLElement;
    fire(closeBtn, "click");
    expect(scrim().getAttribute("data-closing")).toBe("true");
    expect(dialog().getAttribute("data-closing")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    fire(dialog(), "animationend");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("completa onClose por temporizador de seguridad si no hay animationend", () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(dialogFor(onClose));
      fire(scrim(), "pointerdown");
      fire(scrim(), "pointerup");
      expect(onClose).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no cierra si el puntero empezó dentro aunque termine fuera", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    fire(inside(), "pointerdown");
    fire(scrim(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no cierra si el puntero empezó fuera pero termina dentro", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    fire(scrim(), "pointerdown");
    fire(inside(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pointercancel anula un toque ya empezado en el fondo", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    fire(scrim(), "pointerdown");
    fire(scrim(), "pointercancel");
    fire(scrim(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tocar dentro del panel nunca cierra", () => {
    const onClose = vi.fn();
    render(dialogFor(onClose));
    fire(inside(), "pointerdown");
    fire(inside(), "pointerup");
    fire(dialog(), "pointerdown");
    fire(dialog(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });
});
