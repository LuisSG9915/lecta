// Inicialización de refs de tiempo al montar el lector (una sola vez) y
// carga de la meta de lectura diaria. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { captureDbScope, loadSessionValue } from "../lib/idb";
import { READING_GOAL_KEY } from "../lib/reading-goal";
import { parseReadingGoal } from "../lib/reading-goal";

type Ref<T> = { current: T };

type Deps<T extends { pageEnteredAt: number }> = {
  sessionStartRef: Ref<number>;
  chapterStartedAtRef: Ref<number>;
  pageTurnTimeRef: Ref<number>;
  focusTelemetryRef: Ref<T>;
  setDailyGoalMs: (v: number) => void;
};

export function useReaderSessionStart<T extends { pageEnteredAt: number }>(deps: Deps<T>): void {
  const { sessionStartRef, chapterStartedAtRef, pageTurnTimeRef, focusTelemetryRef, setDailyGoalMs } = deps;

  useEffect(() => {
    const now = Date.now();
    if (!sessionStartRef.current) sessionStartRef.current = now;
    if (!chapterStartedAtRef.current) chapterStartedAtRef.current = now;
    if (!pageTurnTimeRef.current) pageTurnTimeRef.current = now;
    if (focusTelemetryRef.current.pageEnteredAt === 0) focusTelemetryRef.current.pageEnteredAt = now;
    void loadSessionValue(READING_GOAL_KEY, captureDbScope()).then((raw) => {
      const parsed = parseReadingGoal(raw);
      if (parsed && typeof parsed.dailyGoalMs === "number" && parsed.dailyGoalMs > 0) {
        setDailyGoalMs(parsed.dailyGoalMs);
      }
    }).catch(() => undefined);
  }, [sessionStartRef, chapterStartedAtRef, pageTurnTimeRef, focusTelemetryRef, setDailyGoalMs]);
}