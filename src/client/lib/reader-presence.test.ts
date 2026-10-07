// @vitest-environment jsdom
// Prueba de integración del hook useReaderPresence: monta una sonda
// mínima que alimenta al planificador como lo hace el lector (props
// = modo/habilitado/ready/overlay/hidden/máquina) y ejercita las
// señales reales (activity con delta acotado, idle, suppress).
// No se afirma CSS ni geometría: solo comportamiento.
import {
  act,
  createElement as h,
  useEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eligibleDelta,
  useReaderPresence,
  type ReaderPresence,
} from "./reader-presence";
import type { CompanionState } from "./companion-state";
import type { ReadingPresence } from "../../shared/companion-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

type ProbeProps = {
  enabled?: boolean;
  mode?: ReadingPresence;
  ready?: boolean;
  overlay?: boolean;
  hidden?: boolean;
  machine?: CompanionState | null;
};

let latest: ReaderPresence | null = null;

// Sonda mínima: expone el objeto del hook y dibuja `visible`.
function Probe(props: ProbeProps) {
  const presence = useReaderPresence({
    enabled: props.enabled ?? true,
    mode: props.mode ?? "visits",
    ready: props.ready ?? true,
    overlay: props.overlay ?? false,
    hidden: props.hidden ?? false,
    machine: props.machine ?? "reading",
  });
  // La asignación va en efecto (post-render) para no mutar durante
  // el render — react-hooks/purity lo vigila.
  useEffect(() => {
    latest = presence;
  });
  return h("output", { "data-testid": "v" }, String(presence.visible));
}

const render = (props: ProbeProps = {}) =>
  act(() => root.render(h(Probe, props)));
const rerender = (props: ProbeProps) =>
  act(() => root.render(h(Probe, props)));
const shown = () => host.querySelector("output")?.textContent === "true";

describe("eligibleDelta", () => {
  // El delta se mide contra el lastActiveAt ANTERIOR al refresco:
  // medirlo después de pisarlo daba siempre 0 y el gato en modo
  // «visits» jamás acumulaba el umbral para aparecer.
  it("cuenta el tiempo entre señales del segmento", () => {
    const seg = { lastActiveAt: 1_000 };
    expect(eligibleDelta(seg, 61_000, 90_000)).toBe(60_000);
  });

  it("acota el hueco largo al tope del seguimiento", () => {
    const seg = { lastActiveAt: 0 };
    expect(eligibleDelta(seg, 10 * 60_000, 90_000)).toBe(90_000);
  });

  it("sin segmento vivo la señal no trae tiempo", () => {
    expect(eligibleDelta(null, 5_000, 90_000)).toBe(0);
    expect(eligibleDelta(undefined, 5_000, 90_000)).toBe(0);
  });
});

describe("useReaderPresence", () => {
  it("visits: sin actividad elegible no se ve; al cruzar 1 min se ve", () => {
    render();
    expect(shown()).toBe(false);
    act(() => latest?.activity(59_999));
    expect(shown()).toBe(false);
    act(() => latest?.activity(1));
    expect(shown()).toBe(true);
  });

  it("la visita se retira a los 15 s de reloj (latido del hook)", () => {
    render();
    act(() => latest?.activity(60_000));
    expect(shown()).toBe(true);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(shown()).toBe(true);
    act(() => void vi.advanceTimersByTime(2));
    expect(shown()).toBe(false);
  });

  it("el saludo abre sin elegible y la pose se apaga al acabar", () => {
    render();
    act(() => latest?.greet());
    expect(shown()).toBe(true);
    expect(latest?.greeting).toBe(true);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(false);
    expect(latest?.greeting).toBe(false);
  });

  it("react asoma al gato sin elegible y lo retira a los 10 s", () => {
    render();
    act(() => latest?.react());
    expect(shown()).toBe(true);
    expect(latest?.greeting).toBe(false);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(false);
  });

  it("«off» de la cuenta nunca muestra aunque haya lectura", () => {
    render({ mode: "off" });
    act(() => latest?.activity(600_000));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(shown()).toBe(false);
  });

  it("juego apagado se comporta como «off»", () => {
    render({ enabled: false });
    act(() => latest?.activity(600_000));
    expect(shown()).toBe(false);
  });

  it("overlay encima retira la visita y congela el acumulado", () => {
    render();
    act(() => latest?.activity(30_000));
    rerender({ overlay: true });
    act(() => latest?.activity(300_000)); // bajo la capa no cuenta
    rerender({ overlay: false });
    expect(shown()).toBe(false);
    act(() => latest?.activity(29_999));
    expect(shown()).toBe(false);
    act(() => latest?.activity(1));
    expect(shown()).toBe(true);
  });

  it("suppress oculta al instante y libera al quitarla", () => {
    render();
    act(() => latest?.activity(60_000));
    expect(shown()).toBe(true);
    act(() => latest?.setSuppressed(true));
    expect(shown()).toBe(false);
    // Suprimido no acumula ni reabre visita:
    act(() => latest?.activity(300_000));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(shown()).toBe(false);
    act(() => latest?.setSuppressed(false));
    expect(shown()).toBe(false); // la visita quedó cerrada
  });

  it("el cambio de modo se aplica sin desmontar", () => {
    render({ mode: "off" });
    rerender({ mode: "always" });
    expect(shown()).toBe(true);
    rerender({ mode: "off" });
    expect(shown()).toBe(false);
  });

  it("idle difiere las visitas; una señal real despierta el reloj", () => {
    render();
    act(() => latest?.activity(30_000));
    act(() => latest?.idle(true));
    // Inactivo no llegan señales: el reloj de pared solo pasa.
    act(() => void vi.advanceTimersByTime(300_000));
    expect(shown()).toBe(false);
    // La siguiente señal real reabre la lectura y la espera continúa.
    act(() => latest?.activity(29_999));
    expect(shown()).toBe(false);
    act(() => latest?.activity(1));
    expect(shown()).toBe(true);
  });

  it("al desmontar y remontar el estado es por libro (reset)", () => {
    render();
    act(() => latest?.activity(60_000));
    expect(shown()).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    render();
    // Nuevo montaje: sin acumulado heredado, sin visita viva.
    expect(shown()).toBe(false);
    act(() => latest?.activity(59_999));
    expect(shown()).toBe(false);
  });
});
