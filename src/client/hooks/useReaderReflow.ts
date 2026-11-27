// Al cambiar el modo (scroll↔páginas) o lo que refluye el texto, el ancla
// devuelve al mismo punto. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { scrollToAnchor } from "../lib/reading-location";
import type { SavedBookPosition } from "../lib/idb";

type Ref<T> = { current: T };

type PendingPage = {
  snippet?: string;
  fragment?: string;
  anchor?: string;
  at?: "end";
  ratio?: number;
  flash?: boolean;
} | null;

type Deps = {
  state: string;
  settingsLayout: string;
  settingsFont: string;
  settingsSize: number;
  settingsMeasure: number;
  settingsLeading: number;
  settingsTextSpacing?: string;
  layoutRef: Ref<string>;
  containerRef: Ref<HTMLElement | null>;
  latestPositionRef: Ref<SavedBookPosition | null>;
  pageAnchorRef: Ref<string | null>;
  pendingPageRef?: Ref<PendingPage>;
  remeasure: () => void;
};

export function useReaderReflow(deps: Deps): void {
  const {
    state,
    settingsLayout,
    settingsFont,
    settingsSize,
    settingsMeasure,
    settingsLeading,
    settingsTextSpacing,
    layoutRef,
    containerRef,
    latestPositionRef,
    pageAnchorRef,
    pendingPageRef,
    remeasure,
  } = deps;

  useEffect(() => {
    if (state !== "ready") return;
    const wasPages = layoutRef.current === "pages";
    const saved = latestPositionRef.current;
    if (settingsLayout === "pages" && !wasPages && saved) {
      if (saved.anchor) pageAnchorRef.current = saved.anchor;
      if (pendingPageRef) {
        pendingPageRef.current = {
          anchor: saved.anchor,
          ratio: saved.ratio,
          flash: false,
        };
      }
    }
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      const target = saved ?? latestPositionRef.current;
      if (!container) return;
      if (settingsLayout === "scroll") {
        const scrolled = target?.anchor
          ? scrollToAnchor(container, target.anchor, {
              offset: target.anchorOffset,
            })
          : false;
        if (!scrolled && target) {
          const ratio = target.ratio ?? 0;
          const max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, ratio * Math.max(0, max));
        }
      } else {
        if (!wasPages && target?.anchor) pageAnchorRef.current = target.anchor;
        remeasure();
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settingsLayout,
    settingsFont,
    settingsSize,
    settingsMeasure,
    settingsLeading,
    settingsTextSpacing,
    state,
  ]);
}