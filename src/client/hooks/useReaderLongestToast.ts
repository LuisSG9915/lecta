// Aviso de récord mensual de lectura (sesión ≥ 10 min). Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import type { CompanionSignal } from "../lib/companion-state";
import { isLongestSessionThisMonth } from "../lib/journey";
import type { TimeInterval } from "../lib/reading-activity";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  signalCompanion: (signal: Omit<CompanionSignal, "at"> & { at?: number }) => void;
  setRecordToast: (msg: string | null) => void;
  sessionStartRef: Ref<number | null>;
  intervalsRef: Ref<TimeInterval[]>;
  longestToastFiredRef: Ref<boolean>;
};

export function useReaderLongestToast(deps: Deps): void {
  const { state, signalCompanion, setRecordToast, sessionStartRef, intervalsRef, longestToastFiredRef } = deps;

  useEffect(() => {
    if (state !== "ready" || longestToastFiredRef.current) return;
    const check = () => {
      if (document.hidden || longestToastFiredRef.current) return;
      const now = Date.now();
      const currentSessionMs = now - (sessionStartRef.current || now);
      if (currentSessionMs < 10 * 60_000) return;
      if (!isLongestSessionThisMonth(currentSessionMs, intervalsRef.current, now)) return;
      longestToastFiredRef.current = true;
      setRecordToast("Nuevo récord: tu lectura más larga este mes");
      signalCompanion({ kind: "goal_completed" });
      window.setTimeout(() => {
        setRecordToast(null);
      }, 5000);
    };
    const interval = window.setInterval(check, 60_000);
    return () => window.clearInterval(interval);
  }, [state, signalCompanion, setRecordToast, sessionStartRef, intervalsRef, longestToastFiredRef]);
}