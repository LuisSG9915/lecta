// Chequeo periódico de pasajes densos (modo limpio, tras fase de acomodación). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import { loadBaselineWpm, detectDensePassageStall } from "../lib/focus-telemetry";
import type { DenseStallDetector } from "../lib/focus-telemetry";

export const DENSE_STALL_SETTLING_IN_MS = 5 * 60_000;

type Ref<T> = { current: T };

type Deps = {
  state: string;
  isDeepReading: boolean;
  sectionWords: number;
  pageCount: number;
  isCleanMode: boolean;
  sessionStartRef: Ref<number>;
  denseStallDetectorRef: Ref<DenseStallDetector>;
  lastActivityAtRef: Ref<number>;
  setStallBubble: (msg: string | null) => void;
  stallBubbleTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
};

export function useReaderDenseStall(deps: Deps): void {
  const {
    state,
    isDeepReading,
    sectionWords,
    pageCount,
    isCleanMode,
    sessionStartRef,
    denseStallDetectorRef,
    lastActivityAtRef,
    setStallBubble,
    stallBubbleTimerRef,
  } = deps;

  useEffect(() => {
    if (state !== "ready" || isDeepReading || !isCleanMode) return;
    let shownHere = false;
    const checkDenseStall = () => {
      if (state !== "ready" || isDeepReading || document.hidden) return;
      const now = Date.now();
      // Sin inicio de sesión todavía no hay fase de acomodación que medir: esperar.
      if (
        sessionStartRef.current <= 0 ||
        now - sessionStartRef.current < DENSE_STALL_SETTLING_IN_MS
      ) {
        return;
      }
      const baselineWpm = loadBaselineWpm();
      const pageWords = Math.max(30, Math.round(sectionWords / (pageCount || 1)));
      const isStalled = detectDensePassageStall(
        denseStallDetectorRef.current,
        now,
        pageWords,
        baselineWpm,
        lastActivityAtRef.current,
      );
      if (isStalled) {
        setStallBubble("¿Pasaje denso? Tócame para iluminar el párrafo paso a paso.");
        shownHere = true;
        if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
        stallBubbleTimerRef.current = setTimeout(() => {
          shownHere = false;
          setStallBubble(null);
        }, 6000);
      }
    };

    const interval = setInterval(checkDenseStall, 4000);
    return () => {
      clearInterval(interval);
      if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
      // Cancelado el temporizador que la ocultaba, la burbuja quedaría fija.
      if (shownHere) setStallBubble(null);
    };
  }, [
    state,
    isDeepReading,
    sectionWords,
    pageCount,
    isCleanMode,
    sessionStartRef,
    denseStallDetectorRef,
    lastActivityAtRef,
    setStallBubble,
    stallBubbleTimerRef,
  ]);
}