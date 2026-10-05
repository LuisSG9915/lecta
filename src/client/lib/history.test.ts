// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushOverlay } from "./history";

// Simula «atrás» hasta el estado `id`: replaceState mueve el estado y el
// popstate disparado hace que la pila cierre lo que quedó encima.
const popTo = (id: number) => {
  history.replaceState(id ? { lecta: id } : {}, "");
  window.dispatchEvent(new Event("popstate"));
};
const currentId = () =>
  (history.state as { lecta?: number } | null)?.lecta ?? 0;

afterEach(() => popTo(0));

describe("pushOverlay", () => {
  it("atrás cierra solo la capa superior", () => {
    const a = vi.fn();
    const b = vi.fn();
    pushOverlay(a);
    const idA = currentId();
    pushOverlay(b);
    popTo(idA);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("swap cambia qué cierra la entrada sin crear otra", () => {
    const first = vi.fn();
    const next = vi.fn();
    const handle = pushOverlay(first);
    handle.swap(next);
    popTo(0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("release saca la entrada de la pila sin llamar a close", () => {
    const close = vi.fn();
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    const handle = pushOverlay(close);
    handle.release();
    popTo(0);
    expect(back).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it("release dos veces no retrocede dos entradas", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    const handle = pushOverlay(() => {});
    handle.release();
    handle.release();
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it("swap sobre una entrada ya cerrada no revive nada", () => {
    const close = vi.fn();
    const next = vi.fn();
    const handle = pushOverlay(close);
    popTo(0);
    expect(close).toHaveBeenCalledTimes(1);
    handle.swap(next);
    popTo(0);
    expect(next).not.toHaveBeenCalled();
  });
});
