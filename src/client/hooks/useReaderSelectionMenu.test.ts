// @vitest-environment jsdom
// Menú de selección del lector (extraído de Reader.tsx, R1): una palabra abre
// la ficha, varias cierran la ficha y piden la barra de pasajes.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderSelectionMenu, type UseReaderSelectionMenuOptions } from "./useReaderSelectionMenu";
import type { WordHit } from "../lib/words";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let container: HTMLDivElement;

function Probe(props: UseReaderSelectionMenuOptions) {
  useReaderSelectionMenu(props);
  return null;
}

function makeOptions(over: Partial<UseReaderSelectionMenuOptions> = {}): UseReaderSelectionMenuOptions {
  return {
    containerRef: { current: container },
    language: "es",
    lastPointerTypeRef: { current: "mouse" },
    reappliedRangeRef: { current: null },
    selectionRef: { current: null },
    keepNativeSelectionRef: { current: false },
    overlayReleaseRef: { current: null },
    selButtonVisibleRef: { current: false },
    setSelButton: vi.fn(),
    openSelection: vi.fn<(hit: WordHit) => void>(),
    closeSelection: vi.fn(),
    ...over,
  };
}

function select(text: string) {
  const node = container.firstChild as Text;
  const start = container.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ width: 40, height: 16, left: 10, right: 50, top: 10, bottom: 26 }),
  });
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  container = document.createElement("div");
  container.textContent = "La casa grande está aquí";
  document.body.append(host, container);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  window.getSelection()?.removeAllRanges();
  host.remove();
  container.remove();
  vi.useRealTimers();
});

describe("useReaderSelectionMenu", () => {
  it("una palabra con ratón abre la ficha y borra la selección", () => {
    const opts = makeOptions();
    act(() => root.render(h(Probe, opts)));
    select("casa");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(opts.openSelection).toHaveBeenCalledTimes(1);
    expect(opts.openSelection).toHaveBeenCalledWith(expect.objectContaining({ word: "casa" }));
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it("dos palabras con la ficha abierta cierran la ficha y conservan la selección nativa", () => {
    const opts = makeOptions({
      selectionRef: { current: { word: "casa", context: "La casa grande" } as WordHit },
    });
    act(() => root.render(h(Probe, opts)));
    select("casa grande");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(opts.keepNativeSelectionRef.current).toBe(true);
    expect(opts.closeSelection).toHaveBeenCalledTimes(1);
    expect(opts.openSelection).not.toHaveBeenCalled();
  });

  it("en táctil el primer selectionchange reaplica el rango y no abre nada", () => {
    const opts = makeOptions({ lastPointerTypeRef: { current: "touch" } });
    act(() => root.render(h(Probe, opts)));
    select("casa");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(opts.reappliedRangeRef.current).not.toBeNull();
    expect(opts.openSelection).not.toHaveBeenCalled();
  });
});
