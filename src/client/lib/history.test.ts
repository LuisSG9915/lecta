// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushOverlay } from "./history";

// Simula «atrás» hasta el estado `id`: replaceState mueve el estado y el
// popstate disparado hace que la pila cierre lo que quedó encima. La
// marca `s` se copia del estado vigente: las entradas de esta sesión la
// comparten, y un estado sin ella cuenta como historia ajena.
const sessionTag = () =>
  (history.state as { s?: string } | null)?.s;
const popTo = (id: number) => {
  history.replaceState(id ? { lecta: id, s: sessionTag() } : {}, "");
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

  it("release seguido de un push no cierra la capa nueva", () => {
    // Repro del clic «ignorado»: el back() que encola release() es
    // asíncrono; si el usuario abre otra capa antes de que aterrice,
    // su popstate la vería como «encima del estado al que se volvió»
    // y la cerraría al instante — abrir Cuaderno tras cerrar la hoja
    // parecía no responder. owedBacks descuenta ese popstate.
    const closeNew = vi.fn();
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    const handle = pushOverlay(() => {});
    handle.release();
    pushOverlay(closeNew);
    popTo(0); // aterriza el back() encolado por release()
    expect(closeNew).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it("release de una entrada que ya no es la vigente no retrocede", () => {
    // Entrada enterrada por otra capa: soltarla no debe mover el
    // historial (un back() caería en el hueco y cerraría la capa de
    // arriba). Su hueco queda en el historial y un atrás posterior
    // cierra lo que quede encima, como antes.
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    const below = pushOverlay(() => {});
    const closeTop = vi.fn();
    pushOverlay(closeTop);
    below.release(); // enterrada: no es la vigente
    expect(back).not.toHaveBeenCalled();
    popTo(0); // atrás real: cierra la capa de arriba igual
    expect(closeTop).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it("atrás sobre un estado de otra carga cierra las capas vivas", () => {
    // Los estados lecta:* sobreviven en el historial de la pestaña tras
    // recargar. Aterrizar en uno (sin la marca `s` de esta sesión, o
    // con id mayor que cualquier capa viva) debe cerrar todo lo vivo:
    // comparar solo por id lo tomaría como «encima» y no cerraría nada.
    const close = vi.fn();
    pushOverlay(close);
    history.replaceState({ lecta: 99 }, ""); // estado viejo, sin marca
    window.dispatchEvent(new Event("popstate"));
    expect(close).toHaveBeenCalledTimes(1);
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
