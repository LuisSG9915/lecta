// Hook extraído de Reader.tsx (R3g): ciclo del modo Retiro de lectura
// (deep reading). Compone useReaderDeepReading y expone finish/start
// + timer effect. Recibe sectionIndexRef y setBarsVisible.
import { useCallback, useEffect, useRef } from "react";
import { useReaderDeepReading, type UseReaderDeepReadingResult } from "./useReaderDeepReading";
import type { DeepReadingConfig, DeepReadingSummary } from "../lib/deep-reading";
import {
  requestScreenWakeLock,
  releaseScreenWakeLock,
  formatRemainingTime,
  formatElapsedMinutes,
} from "../lib/deep-reading";
import { toggleFullscreen } from "../lib/fullscreen";
import { playCompanionSound } from "../lib/companion-audio";
import { triggerHaptic } from "../lib/deep-reading";

export type UseReaderDeepReadingCycleResult = UseReaderDeepReadingResult & {
  finishDeepReading: (natural?: boolean) => Promise<void>;
  startDeepReading: (config: DeepReadingConfig) => Promise<void>;
  deepIndicatorRef: { current: HTMLElement | null };
};

export function useReaderDeepReadingCycle({
  sectionIndexRef,
  setBarsVisible,
}: {
  sectionIndexRef: { current: number };
  setBarsVisible: (v: boolean) => void;
}): UseReaderDeepReadingCycleResult {
  const base = useReaderDeepReading();
  const {
    deepReading,
    setDeepReading,
    setDeepSummary,
    setDeepModal,
    deepReadingRef,
  } = base;

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const deepIndicatorRef = useRef<HTMLElement | null>(null);

  const finishDeepReading = useCallback(
    async (natural = false) => {
      if (wakeLockRef.current) {
        await releaseScreenWakeLock(wakeLockRef.current);
        wakeLockRef.current = null;
      }
      await toggleFullscreen(false);

      if (natural) {
        playCompanionSound("purr");
        triggerHaptic("success");
      } else {
        triggerHaptic("light");
      }

      const current = deepReadingRef.current;
      if (current) {
        const elapsed = Date.now() - current.startedAt;
        const durationMinutes = Math.max(1, Math.round(elapsed / 60_000));
        const sectionsRead = Math.max(
          1,
          Math.abs(sectionIndexRef.current - current.initialSectionIndex) + 1,
        );

        if (elapsed >= 45_000) {
          const wordsAssimilated = Math.max(3, sectionsRead * 4);
          const coverageDeltaPercent = Math.max(1, Math.min(5, sectionsRead));
          const summary: DeepReadingSummary = {
            durationMinutes,
            targetMinutes: current.targetMinutes,
            sectionsRead,
            completedNaturally: natural,
            wordsAssimilated,
            coverageDeltaPercent,
          };
          setDeepSummary(summary);
        }
      }

      setDeepReading(null);
    },
    [sectionIndexRef, setDeepReading, setDeepSummary, deepReadingRef],
  );

  const startDeepReading = useCallback(
    async (config: DeepReadingConfig) => {
      setDeepModal(false);
      triggerHaptic("success");
      if (config.fullscreen) {
        await toggleFullscreen(true);
      }
      if (config.keepScreenAwake) {
        wakeLockRef.current = await requestScreenWakeLock();
      }
      setBarsVisible(false);
      const now = Date.now();
      const targetEndedAt =
        config.durationMinutes > 0
          ? now + config.durationMinutes * 60_000
          : null;

      setDeepReading({
        active: true,
        targetMinutes: config.durationMinutes,
        startedAt: now,
        targetEndedAt,
        elapsedMs: 0,
        initialSectionIndex: sectionIndexRef.current,
        sectionsRead: 1,
        wordsRead: 0,
      });
    },
    [setBarsVisible, sectionIndexRef, setDeepReading, setDeepModal],
  );

  useEffect(() => {
    if (!deepReading?.active) return;
    const startedAt = deepReading.startedAt;
    const targetEndedAt = deepReading.targetEndedAt;
    const targetMinutes = deepReading.targetMinutes;
    let minuteMark = -1;
    const paint = (elapsed: number) => {
      const node = deepIndicatorRef.current;
      if (!node) return;
      node.textContent =
        targetEndedAt != null
          ? formatRemainingTime(Math.max(0, targetMinutes * 60_000 - elapsed))
          : formatElapsedMinutes(elapsed);
    };
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - startedAt;
      if (targetEndedAt != null && now >= targetEndedAt) {
        window.clearInterval(interval);
        void finishDeepReading(true);
        return;
      }
      paint(elapsed);
      const minute = Math.floor(elapsed / 60_000);
      if (minute === minuteMark) return;
      minuteMark = minute;
      setDeepReading((prev) => (prev ? { ...prev, elapsedMs: elapsed } : null));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [
    deepReading?.active,
    deepReading?.startedAt,
    deepReading?.targetEndedAt,
    deepReading?.targetMinutes,
    finishDeepReading,
    setDeepReading,
  ]);

  return {
    ...base,
    finishDeepReading,
    startDeepReading,
    deepIndicatorRef,
  };
}