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
});
