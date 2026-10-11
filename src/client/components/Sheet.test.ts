// @vitest-environment jsdom
import {
  act,
  createElement as h,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sheet from "./Sheet";

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

const sheetFor = (onClose: () => void) =>
  h(Sheet, {
    label: "Prueba",
    onClose,
    children: h("div", { className: "inside" }, h("button", null, "acción")),
  });

const scrim = () => host.querySelector(".sheet-scrim") as HTMLElement;
const sheet = () => host.querySelector(".sheet") as HTMLElement;
const inside = () => host.querySelector(".inside") as HTMLElement;

describe("Sheet toque exterior", () => {
  it("envuelve la hoja en un fondo y el panel es dialog tabIndex -1", () => {
    render(sheetFor(() => {}));
    expect(scrim()).toBeTruthy();
    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().getAttribute("tabindex")).toBe("-1");
  });

  it("cierra cuando el puntero empieza y termina en el fondo", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    fire(scrim(), "pointerdown");
    fire(scrim(), "pointerup");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("no cierra si el puntero empezó dentro aunque termine fuera", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    fire(inside(), "pointerdown");
    fire(scrim(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no cierra si el puntero empezó fuera pero termina dentro", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    fire(scrim(), "pointerdown");
    fire(inside(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pointercancel anula un toque ya empezado en el fondo", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    fire(scrim(), "pointerdown");
    fire(scrim(), "pointercancel");
    fire(scrim(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tocar dentro del panel nunca cierra", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    fire(inside(), "pointerdown");
    fire(inside(), "pointerup");
    fire(sheet(), "pointerdown");
    fire(sheet(), "pointerup");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("la variante stage aplica la clase sheet--stage", () => {
    render(
      h(Sheet, {
        label: "Escenario",
        variant: "stage",
        onClose: () => {},
        children: h("div", null, "contenido"),
      }),
    );
    expect(sheet().classList.contains("sheet--stage")).toBe(true);
  });

  it("un gesto más horizontal que vertical no cierra la hoja", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    const target = sheet();
    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: 160,
          clientY: 110,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: 160,
          clientY: 110,
        }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("arrastre vertical hacia abajo sin scroll interior cierra la hoja", () => {
    const onClose = vi.fn();
    render(sheetFor(onClose));
    const target = sheet();
    // jsdom no tiene layout real; simulamos offsetHeight
    Object.defineProperty(target, "offsetHeight", { value: 300, configurable: true });
    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 50,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 200,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 200,
        }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con un contenedor interior desplazado (scrollTop > 0) no inicia arrastre", () => {
    const onClose = vi.fn();
    render(
      h(Sheet, {
        label: "Interior scrolleado",
        onClose,
        children: h(
          "div",
          { className: "scroll-child" },
          h("div", { className: "leaf" }, "texto"),
        ),
      }),
    );
    const scrollChild = host.querySelector(".scroll-child") as HTMLElement;
    Object.defineProperty(scrollChild, "scrollTop", { value: 40, configurable: true });
    const leaf = host.querySelector(".leaf") as HTMLElement;
    act(() => {
      leaf.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 50,
        }),
      );
      leaf.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 250,
        }),
      );
      leaf.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 250,
        }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

