// Chequeo periódico de pasajes densos (preset inmersivo). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import { loadBaselineWpm, detectDensePassageStall } from "../lib/focus-telemetry";
import type { DenseStallDetector } from "../lib/focus-telemetry";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  isDeepReading: boolean;
  sectionWords: number;
  pageCount: number;
  strategyPreset: string;
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
    strategyPreset,
    denseStallDetectorRef,
    lastActivityAtRef,
    setStallBubble,
    stallBubbleTimerRef,
  } = deps;

  useEffect(() => {
    if (state !== "ready" || isDeepReading) return;
    if (strategyPreset !== "immersive") return;
    const checkDenseStall = () => {
      if (state !== "ready" || isDeepReading || document.hidden) return;
      const now = Date.now();
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
        if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
        stallBubbleTimerRef.current = setTimeout(() => {
          setStallBubble(null);
        }, 6000);
      }
    };

    const interval = setInterval(checkDenseStall, 4000);
    return () => {
      clearInterval(interval);
      if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
    };
  }, [
    state,
    isDeepReading,
    sectionWords,
    pageCount,
    strategyPreset,
    denseStallDetectorRef,
    lastActivityAtRef,
    setStallBubble,
    stallBubbleTimerRef,
  ]);
}