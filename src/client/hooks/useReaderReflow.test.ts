// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderReflow } from "./useReaderReflow";
import { useReaderScrollBars } from "./useReaderScrollBars";
import type { SavedBookPosition } from "../lib/idb";
import type { ReaderSettings } from "../lib/settings";
import { DEFAULT_SETTINGS } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useReaderReflow y useReaderScrollBars (transición scroll ↔ páginas)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("en scroll -> pages captura síncronamente anchor y pendingPageRef antes de rAF", () => {
    const bookEl = document.createElement("div");
    const p = document.createElement("p");
    p.textContent = "P13 · Silencio escalera tarde tarde sombra.";
    bookEl.appendChild(p);

    const layoutRef = { current: "scroll" };
    const containerRef = { current: bookEl };
    const savedPos: SavedBookPosition = {
      bookHash: "b1",
      sectionIndex: 0,
      scrollTop: 1475,
      ratio: 0.55,
      progress: 0.55,
      anchor: "P13 · Silencio escalera tarde tarde sombra.",
      anchorOffset: 0.2,
      updatedAt: 1000,
    };
    const latestPositionRef = { current: savedPos };
    const pageAnchorRef = { current: null as string | null };
    const pendingPageRef = {
      current: null as { anchor?: string; ratio?: number; flash?: boolean } | null,
    };
    const remeasure = vi.fn();

    function Harness({ layout }: { layout: "scroll" | "pages" }) {
      useReaderReflow({
        state: "ready",
        settingsLayout: layout,
        settingsFont: "literata",
        settingsSize: 18,
        settingsMeasure: 65,
        settingsLeading: 1.65,
        settingsTextSpacing: "normal",
        layoutRef,
        containerRef,
        latestPositionRef,
        pageAnchorRef,
        pendingPageRef,
        remeasure,
      });
      return null;
    }

    act(() => {
      root.render(h(Harness, { layout: "scroll" }));
    });

    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    act(() => {
      root.render(h(Harness, { layout: "pages" }));
    });

    // Síncronamente, antes del rAF, el ancla y el destino pendiente ya están listos.
    expect(pageAnchorRef.current).toBe("P13 · Silencio escalera tarde tarde sombra.");
    expect(pendingPageRef.current).toEqual({
      anchor: "P13 · Silencio escalera tarde tarde sombra.",
      ratio: 0.55,
      flash: false,
    });

    // Incluso si algo intentara pisar latestPositionRef después, el remeasure mantiene destino.
    latestPositionRef.current = { ...savedPos, ratio: 0, anchor: undefined };
    act(() => {
      for (const cb of rafCallbacks) cb(16);
    });
    expect(remeasure).toHaveBeenCalled();
  });

  it("en pages -> scroll restaura por ratio cuando no hay anchor", () => {
    const bookEl = document.createElement("div");
    const layoutRef = { current: "pages" };
    const containerRef = { current: bookEl };
    const latestPositionRef = {
      current: {
        bookHash: "b1",
        sectionIndex: 0,
        scrollTop: 0,
        ratio: 0.5,
        progress: 0.5,
        updatedAt: 1000,
      } as SavedBookPosition,
    };
    const pageAnchorRef = { current: null as string | null };
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    function Harness({ layout }: { layout: "scroll" | "pages" }) {
      useReaderReflow({
        state: "ready",
        settingsLayout: layout,
        settingsFont: "literata",
        settingsSize: 18,
        settingsMeasure: 65,
        settingsLeading: 1.65,
        layoutRef,
        containerRef,
        latestPositionRef,
        pageAnchorRef,
        remeasure: vi.fn(),
      });
      return null;
    }

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(16);
      return 1;
    });

    act(() => {
      root.render(h(Harness, { layout: "scroll" }));
    });

    expect(scrollSpy).toHaveBeenCalledWith(0, 600);
  });

  it("useReaderScrollBars ignora eventos window.scroll mientras layout === 'pages'", () => {
    const saveSoon = vi.fn();
    const noteActivity = vi.fn();
    const settingsRef = {
      current: { ...DEFAULT_SETTINGS, layout: "pages" } as ReaderSettings,
    };

    function ScrollHarness() {
      useReaderScrollBars({
        saveSoon,
        capturePosition: () => null,
        captureDbScope: () => ({ userId: null, generation: 0 }),
        closeActivity: vi.fn(),
        noteActivity,
        setBarsVisible: vi.fn(),
        setScrollRatio: vi.fn(),
        setActiveScrollFragment: vi.fn(),
        rafPending: { current: false },
        lastScrollY: { current: 0 },
        lastScrollRatioRef: { current: 0 },
        activeScrollFragRef: { current: null },
        settingsRef,
        containerRef: { current: null },
        currentSectionTargetsRef: { current: [] },
      });
      return null;
    }

    act(() => {
      root.render(h(ScrollHarness));
    });

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(saveSoon).not.toHaveBeenCalled();
    expect(noteActivity).not.toHaveBeenCalled();
  });
});
