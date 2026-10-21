import { useCallback, useEffect, useState, type RefObject } from "react";
import { usePageGesture } from "../lib/use-page-gesture";
import {
  isFullscreen,
  isFullscreenSupported,
  subscribeFullscreenChange,
  toggleFullscreen,
} from "../lib/fullscreen";
import { triggerHaptic } from "../lib/haptics";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint } from "../lib/words";

export interface UseReaderShortcutsAndGesturesOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  lastPointRef?: RefObject<{ x: number; y: number } | null>;
  layout: "pages" | "scroll";
  page: number;
  pageCount: number;
  pageAdvancePx: number;
  sectionIndex: number;
  sectionTotal: number;
  reducedMotion?: boolean;
  panelsOpen?: boolean;
  selectionActive?: boolean;
  sheetActive?: boolean;
  language?: string;
  visualPacerActive?: boolean;
  deepReadingActive?: boolean;
  onTurnPage: (delta: number) => void;
  onCenterTap: () => void;
  onNavPrevSection?: (index: number) => void;
  onNavNextSection?: (index: number) => void;
  onOpenSheet?: (sheet: "toc" | "search" | "marks" | "theme" | "display" | "bilingual") => void;
  onOpenSelection?: (hit: WordHit) => void;
  onTogglePacer?: () => void;
  onFinishDeepReading?: (cancelled?: boolean) => void;
  noteActivity: () => void;
  ttsStatus?: string;
}

export function useReaderShortcutsAndGestures({
  viewportRef,
  containerRef,
  lastPointRef,
  layout,
  page,
  pageCount,
  pageAdvancePx,
  sectionIndex,
  sectionTotal,
  reducedMotion = false,
  panelsOpen = false,
  selectionActive = false,
  sheetActive = false,
  language = "es",
  visualPacerActive = false,
  deepReadingActive = false,
  onTurnPage,
  onCenterTap,
  onNavPrevSection,
  onNavNextSection,
  onOpenSheet,
  onOpenSelection,
  onTogglePacer,
  onFinishDeepReading,
  noteActivity,
  ttsStatus,
}: UseReaderShortcutsAndGesturesOptions) {
  const [isFullscreenActive, setIsFullscreenActive] = useState(() => isFullscreen());

  // 1. Gestos táctiles de página
  usePageGesture({
    viewportRef,
    containerRef,
    layout,
    page,
    pageCount,
    pageAdvance: pageAdvancePx,
    isFirstPageInBook: sectionIndex === 0,
    isLastPageInBook: sectionIndex + 1 >= sectionTotal,
    reducedMotion,
    onTurnPage,
    onCenterTap,
  });

  // 2. Sincronización de pantalla completa
  useEffect(() => {
    return subscribeFullscreenChange(() => {
      setIsFullscreenActive(isFullscreen());
    });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    triggerHaptic("selection");
    const next = await toggleFullscreen();
    setIsFullscreenActive(next);
  }, []);

  // 3. Screen Wake Lock durante la lectura o reproducción de TTS
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let isLive = true;

    const acquireLock = async () => {
      if (typeof document === "undefined" || document.hidden || !isLive) return;
      try {
        if (
          typeof navigator !== "undefined" &&
          "wakeLock" in navigator &&
          navigator.wakeLock?.request
        ) {
          sentinel = await navigator.wakeLock.request("screen");
        }
      } catch {
        sentinel = null;
      }
    };

    const releaseLock = async () => {
      try {
        await sentinel?.release();
      } catch {
        // ignore
      } finally {
        sentinel = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void acquireLock();
      } else {
        void releaseLock();
      }
    };

    void acquireLock();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isLive = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      void releaseLock();
    };
  }, [ttsStatus, deepReadingActive]);

  // 4. Atajos de teclado para lectura
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") onCenterTap();
      const target = event.target;
      const inInput =
        target instanceof HTMLElement &&
        Boolean(target.closest("input, textarea, select, [contenteditable]"));

      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        if (!inInput && onOpenSheet) {
          event.preventDefault();
          onOpenSheet("search");
          return;
        }
      }

      if (selectionActive || sheetActive || panelsOpen) return;
      if (inInput) return;

      if (deepReadingActive && event.key === "Escape" && onFinishDeepReading) {
        event.preventDefault();
        onFinishDeepReading(false);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if ((event.key === "t" || event.key === "T") && onOpenSheet) {
          event.preventDefault();
          onOpenSheet("toc");
          return;
        }
        if ((event.key === "m" || event.key === "M") && onOpenSheet) {
          event.preventDefault();
          onOpenSheet("marks");
          return;
        }
        if (event.key === "f" || event.key === "F") {
          event.preventDefault();
          void handleToggleFullscreen();
          return;
        }
      }

      if (event.key === "F11") {
        event.preventDefault();
        void handleToggleFullscreen();
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        noteActivity();
        if (visualPacerActive && onTogglePacer) {
          onTogglePacer();
          return;
        }
        if (layout === "pages") {
          if (event.shiftKey) onTurnPage(-1);
          else onTurnPage(1);
        } else if (typeof window !== "undefined") {
          window.scrollBy({
            top: (event.shiftKey ? -1 : 1) * Math.round(window.innerHeight * 0.75),
            behavior: "smooth",
          });
        }
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        noteActivity();
        if (layout === "pages") onTurnPage(1);
        else if (typeof window !== "undefined") {
          window.scrollBy({ top: Math.round(window.innerHeight * 0.75), behavior: "smooth" });
        }
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        noteActivity();
        if (layout === "pages") onTurnPage(-1);
        else if (typeof window !== "undefined") {
          window.scrollBy({ top: -Math.round(window.innerHeight * 0.75), behavior: "smooth" });
        }
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") noteActivity();
      if (event.key === "ArrowLeft") {
        if (layout === "pages") onTurnPage(-1);
        else if (sectionIndex > 0 && onNavPrevSection) onNavPrevSection(sectionIndex - 1);
      }
      if (event.key === "ArrowRight") {
        if (layout === "pages") onTurnPage(1);
        else if (sectionIndex + 1 < sectionTotal && onNavNextSection) {
          onNavNextSection(sectionIndex + 1);
        }
      }
      if (
        (event.key === "d" || event.key === "D") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        lastPointRef?.current &&
        containerRef.current &&
        onOpenSelection
      ) {
        const hit = extractWordAtPoint(
          lastPointRef.current.x,
          lastPointRef.current.y,
          containerRef.current,
          language,
        );
        if (hit) onOpenSelection(hit);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    selectionActive,
    sheetActive,
    panelsOpen,
    sectionIndex,
    sectionTotal,
    layout,
    onTurnPage,
    noteActivity,
    language,
    handleToggleFullscreen,
    onCenterTap,
    onOpenSheet,
    onOpenSelection,
    onNavPrevSection,
    onNavNextSection,
    visualPacerActive,
    onTogglePacer,
    deepReadingActive,
    onFinishDeepReading,
    containerRef,
    lastPointRef,
  ]);

  return {
    isFullscreenActive,
    isFullscreenSupported: isFullscreenSupported(),
    handleToggleFullscreen,
  };
}
