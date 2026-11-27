// Barras que se retiran al bajar y vuelven al subir, y guardado de
// posición con la fracción leída de la sección. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { activeFragmentAt, fragElements } from "../lib/scroll-fragments";
import { updateParagraphFocus } from "../lib/paragraph-focus";
import { isTtsProgrammaticScroll } from "../lib/ttsGuards";
import { saveBookPosition } from "../lib/idb";
import type { DbScope, SavedBookPosition } from "../lib/idb";
import type { ChapterTarget } from "../lib/chapters";
import type { ReaderSettings } from "../lib/settings";

type Ref<T> = { current: T };

type Deps = {
  saveSoon: () => void;
  capturePosition: () => SavedBookPosition | null;
  captureDbScope: () => DbScope;
  closeActivity: () => void;
  noteActivity: () => void;
  setBarsVisible: (v: boolean) => void;
  setScrollRatio: (v: number) => void;
  setActiveScrollFragment: (v: string | null) => void;
  rafPending: Ref<boolean>;
  lastScrollY: Ref<number>;
  lastScrollRatioRef: Ref<number>;
  activeScrollFragRef: Ref<string | null>;
  settingsRef: Ref<ReaderSettings | null>;
  containerRef: Ref<HTMLElement | null>;
  currentSectionTargetsRef: Ref<ChapterTarget[]>;
};

export function useReaderScrollBars(deps: Deps): void {
  const {
    saveSoon,
    capturePosition,
    captureDbScope,
    closeActivity,
    noteActivity,
    setBarsVisible,
    setScrollRatio,
    setActiveScrollFragment,
    rafPending,
    lastScrollY,
    lastScrollRatioRef,
    activeScrollFragRef,
    settingsRef,
    containerRef,
    currentSectionTargetsRef,
  } = deps;

  useEffect(() => {
    const scrollRatioNow = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };

    const onScroll = () => {
      if (settingsRef.current?.layout === "pages") return;
      if (!isTtsProgrammaticScroll()) noteActivity();
      saveSoon();
      if (rafPending.current) return;
      rafPending.current = true;
      const paint = document.hidden ? (cb: FrameRequestCallback) => window.setTimeout(cb, 50) : requestAnimationFrame;
      paint(() => {
        rafPending.current = false;
        const y = window.scrollY;
        const delta = y - lastScrollY.current;
        lastScrollY.current = y;
        if (y < 90 || delta < -4) setBarsVisible(true);
        else if (delta > 4 && y > 160) setBarsVisible(false);
        const nextRatio = scrollRatioNow();
        if (nextRatio === 0 || nextRatio === 1 || Math.abs(nextRatio - lastScrollRatioRef.current) >= 0.005) {
          lastScrollRatioRef.current = nextRatio;
          setScrollRatio(nextRatio);
        }
        if (containerRef.current && currentSectionTargetsRef.current.length > 1) {
          const bestFrag = activeFragmentAt(fragElements(containerRef.current), 180, settingsRef.current?.layout === "pages");
          if (bestFrag !== activeScrollFragRef.current) {
            activeScrollFragRef.current = bestFrag;
            setActiveScrollFragment(bestFrag);
          }
        }
        if ((settingsRef.current?.paragraphFocus || settingsRef.current?.focusMode === "paragraph") && containerRef.current) {
          updateParagraphFocus(containerRef.current);
        }
      });
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") closeActivity();
      if (document.visibilityState !== "hidden") return;
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos, captureDbScope());
    };
    const onPageHide = () => {
      const pos = capturePosition();
      if (pos) void saveBookPosition({ ...pos, updatedAt: Date.now() }, captureDbScope());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [saveSoon, capturePosition, captureDbScope, closeActivity, noteActivity, setBarsVisible, setScrollRatio, setActiveScrollFragment, rafPending, lastScrollY, lastScrollRatioRef, activeScrollFragRef, settingsRef, containerRef, currentSectionTargetsRef]);
}