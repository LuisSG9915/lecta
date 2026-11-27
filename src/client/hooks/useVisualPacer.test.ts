// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findFirstVisibleChunkIndex, useVisualPacer } from "./useVisualPacer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockRect(el: HTMLElement, top: number, bottom: number, height = bottom - top) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height,
    x: 0,
    y: top,
    toJSON: () => {},
  });
}

describe("findFirstVisibleChunkIndex", () => {
  it("devuelve 0 si ningún chunk tiene geometría", () => {
    const c1 = document.createElement("span");
    const c2 = document.createElement("span");
    expect(findFirstVisibleChunkIndex([c1, c2], 800)).toBe(0);
    expect(findFirstVisibleChunkIndex([], 800)).toBe(0);
  });

  it("elige el chunk visible más cercano al tercio superior (30% del viewport)", () => {
    const c0 = document.createElement("span");
    const c1 = document.createElement("span");
    const c2 = document.createElement("span");
    const c3 = document.createElement("span");
    mockRect(c0, -120, -40, 80); // fuera arriba
    mockRect(c1, 60, 120, 60);
    mockRect(c2, 230, 290, 60); // muy cerca de 800 * 0.3 = 240
    mockRect(c3, 900, 960, 60); // fuera abajo
    expect(findFirstVisibleChunkIndex([c0, c1, c2, c3], 800)).toBe(2);
  });
});

describe("useVisualPacer", () => {
  let host: HTMLDivElement;
  let root: Root;
  let bookContainer: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    bookContainer = document.createElement("div");
    bookContainer.innerHTML = [
      '<span class="lecta-syntactic-chunk">Fuera de vista arriba.</span>',
      '<span class="lecta-syntactic-chunk">Visible primero cerca del foco.</span>',
      '<span class="lecta-syntactic-chunk">Siguiente frase para avanzar.</span>',
    ].join(" ");
    const chunks = Array.from(bookContainer.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"));
    mockRect(chunks[0], -200, -100, 100);
    mockRect(chunks[1], 220, 260, 40);
    mockRect(chunks[2], 270, 310, 40);
    document.body.appendChild(bookContainer);
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    bookContainer.remove();
    vi.useRealTimers();
  });

  function Probe(props: {
    pacerIndexRef: { current: number };
    visualPacer: boolean;
    pacerPaused: boolean;
    pacerWpm?: number;
  }) {
    useVisualPacer({
      containerRef: { current: bookContainer },
      pacerIndexRef: props.pacerIndexRef,
      visualPacer: props.visualPacer,
      pacerWpm: props.pacerWpm ?? 210,
      strategyPaused: false,
      pacerPaused: props.pacerPaused,
      state: "ready",
      readingPaused: false,
    });
    return null;
  }

  it("arranca en el chunk visible, avanza con el reloj, respeta pausa y limpia al apagar", () => {
    const pacerIndexRef = { current: 0 };
    const chunks = Array.from(bookContainer.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"));

    act(() => {
      root.render(h(Probe, { pacerIndexRef, visualPacer: true, pacerPaused: false, pacerWpm: 300 }));
    });

    // Arranca en el chunk 1 (visible), no en el 0 (fuera de vista)
    expect(chunks[0].classList.contains("lecta-pacer-active")).toBe(false);
    expect(chunks[1].classList.contains("lecta-pacer-active")).toBe(true);
    expect(pacerIndexRef.current).toBe(2);

    // Avanza al chunk 2 tras la duración del chunk 1 (5 palabras a 300 WPM = 1000 ms)
    act(() => {
      vi.advanceTimersByTime(1050);
    });
    expect(chunks[1].classList.contains("lecta-pacer-active")).toBe(false);
    expect(chunks[2].classList.contains("lecta-pacer-active")).toBe(true);

    // Al pausar, retira la clase activa y no avanza
    act(() => {
      root.render(h(Probe, { pacerIndexRef, visualPacer: true, pacerPaused: true, pacerWpm: 300 }));
    });
    expect(bookContainer.querySelectorAll(".lecta-pacer-active")).toHaveLength(0);
  });
});
