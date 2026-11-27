// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DENSE_STALL_SETTLING_IN_MS, useReaderDenseStall } from "./useReaderDenseStall";
import { newDenseStallDetector } from "../lib/focus-telemetry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useReaderDenseStall", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function Probe(props: {
    isCleanMode: boolean;
    sessionStartRef: { current: number };
    denseStallDetectorRef: { current: ReturnType<typeof newDenseStallDetector> };
    lastActivityAtRef: { current: number };
    setStallBubble: (msg: string | null) => void;
  }) {
    useReaderDenseStall({
      state: "ready",
      isDeepReading: false,
      sectionWords: 100,
      pageCount: 1,
      isCleanMode: props.isCleanMode,
      sessionStartRef: props.sessionStartRef,
      denseStallDetectorRef: props.denseStallDetectorRef,
      lastActivityAtRef: props.lastActivityAtRef,
      setStallBubble: props.setStallBubble,
      stallBubbleTimerRef: { current: null },
    });
    return null;
  }

  it("se dispara en modo limpio tras superar la fase de acomodación (5 min)", () => {
    const now = Date.now();
    const setStallBubble = vi.fn();
    const detectorRef = { current: newDenseStallDetector(now - 90_000) };
    const sessionStartRef = { current: now - DENSE_STALL_SETTLING_IN_MS - 10_000 };
    const lastActivityAtRef = { current: now };

    act(() => {
      root.render(
        h(Probe, {
          isCleanMode: true,
          sessionStartRef,
          denseStallDetectorRef: detectorRef,
          lastActivityAtRef,
          setStallBubble,
        }),
      );
    });

    act(() => {
      lastActivityAtRef.current = Date.now();
      vi.advanceTimersByTime(4_000);
    });

    expect(setStallBubble).toHaveBeenCalledTimes(1);
    expect(setStallBubble).toHaveBeenCalledWith(
      expect.stringContaining("¿Pasaje denso?"),
    );
  });

  it("guarda silencio durante los primeros 5 min de sesión (acomodación)", () => {
    const now = Date.now();
    const setStallBubble = vi.fn();
    const detectorRef = { current: newDenseStallDetector(now - 90_000) };
    const sessionStartRef = { current: now - 60_000 }; // solo 1 min de sesión
    const lastActivityAtRef = { current: now };

    act(() => {
      root.render(
        h(Probe, {
          isCleanMode: true,
          sessionStartRef,
          denseStallDetectorRef: detectorRef,
          lastActivityAtRef,
          setStallBubble,
        }),
      );
    });

    act(() => {
      lastActivityAtRef.current = Date.now();
      vi.advanceTimersByTime(8_000);
    });

    expect(setStallBubble).not.toHaveBeenCalled();
  });

  it("no se dispara cuando hay ayudas activas (!isCleanMode)", () => {
    const now = Date.now();
    const setStallBubble = vi.fn();
    const detectorRef = { current: newDenseStallDetector(now - 90_000) };
    const sessionStartRef = { current: now - DENSE_STALL_SETTLING_IN_MS - 10_000 };
    const lastActivityAtRef = { current: now };

    act(() => {
      root.render(
        h(Probe, {
          isCleanMode: false,
          sessionStartRef,
          denseStallDetectorRef: detectorRef,
          lastActivityAtRef,
          setStallBubble,
        }),
      );
    });

    act(() => {
      lastActivityAtRef.current = Date.now();
      vi.advanceTimersByTime(8_000);
    });

    expect(setStallBubble).not.toHaveBeenCalled();
  });

  it("si el efecto se relanza con la burbuja a la vista, la oculta (no queda fija)", () => {
    const now = Date.now();
    const setStallBubble = vi.fn();
    const props = {
      sessionStartRef: { current: now - DENSE_STALL_SETTLING_IN_MS - 10_000 },
      denseStallDetectorRef: { current: newDenseStallDetector(now - 90_000) },
      lastActivityAtRef: { current: now },
      setStallBubble,
    };
    act(() => {
      root.render(h(Probe, { ...props, isCleanMode: true }));
    });
    act(() => {
      props.lastActivityAtRef.current = Date.now();
      vi.advanceTimersByTime(4_000);
    });
    expect(setStallBubble).toHaveBeenLastCalledWith(expect.stringContaining("¿Pasaje denso?"));
    act(() => {
      root.render(h(Probe, { ...props, isCleanMode: false }));
    });
    expect(setStallBubble).toHaveBeenLastCalledWith(null);
  });
});
