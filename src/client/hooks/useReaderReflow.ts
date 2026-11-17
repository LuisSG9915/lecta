// Al cambiar el modo (scroll↔páginas) o lo que refluye el texto, el ancla
// devuelve al mismo punto. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { scrollToAnchor } from "../lib/reading-location";
import type { SavedBookPosition } from "../lib/idb";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  settingsLayout: string;
  settingsFont: string;
  settingsSize: number;
  settingsMeasure: number;
  settingsLeading: number;
  layoutRef: Ref<string>;
  containerRef: Ref<HTMLElement | null>;
  latestPositionRef: Ref<SavedBookPosition | null>;
  pageAnchorRef: Ref<string | null>;
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
    layoutRef,
    containerRef,
    latestPositionRef,
    pageAnchorRef,
    remeasure,
  } = deps;

  useEffect(() => {
    if (state !== "ready") return;
    const wasPages = layoutRef.current === "pages";
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      const saved = latestPositionRef.current;
      if (!container) return;
      if (settingsLayout === "scroll") {
        if (saved?.anchor) {
          const scrolled = scrollToAnchor(container, saved.anchor, {
            offset: saved.anchorOffset,
          });
          if (!scrolled) {
            const ratio = saved?.ratio ?? 0;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, ratio * Math.max(0, max));
          }
        }
      } else {
        if (!wasPages && saved?.anchor) pageAnchorRef.current = saved.anchor;
        remeasure();
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLayout, settingsFont, settingsSize, settingsMeasure, settingsLeading, state]);
}