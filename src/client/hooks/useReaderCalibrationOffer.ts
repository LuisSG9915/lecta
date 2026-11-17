// Oferta automática de calibración de vocabulario. Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import { captureDbScope, loadSessionValue, saveSessionValue } from "../lib/idb";
import { hasCalibrationEvidence } from "../lib/calibration";
import { calibrationDoneKey } from "../lib/calibration";
import { trackCalibrationOffer } from "../lib/chapters";
import type { CalibrationTrack } from "../lib/chapters";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  sectionIndex: number;
  viewRatio: number;
  language: string | null | undefined;
  rangeFor: (index: number) => { startSection: number; endSection: number } | null;
  pendingPageRef: Ref<unknown>;
  setCalNotice: (v: boolean) => void;
  trackCalibrationOffer: typeof trackCalibrationOffer;
};

export function useReaderCalibrationOffer(deps: Deps): void {
  const { state, sectionIndex, viewRatio, language, rangeFor, pendingPageRef, setCalNotice, trackCalibrationOffer } = deps;
  const calEvaluated = useRef(false);
  const calTrack = useRef<CalibrationTrack | null>(null);

  useEffect(() => {
    if (state !== "ready" || calEvaluated.current) return;
    if (pendingPageRef.current) return;
    const next = trackCalibrationOffer(
      calTrack.current,
      sectionIndex,
      viewRatio,
      rangeFor,
    );
    calTrack.current = next.track;
    if (!next.offer) return;
    calEvaluated.current = true;
    void (async () => {
      if (language !== "es" && language !== "en") return;
      const scope = captureDbScope();
      const doneKey = calibrationDoneKey(language);
      const done = await loadSessionValue(doneKey, scope).catch(() => "1");
      if (done != null) return;
      if (await hasCalibrationEvidence(language, scope).catch(() => false)) {
        void saveSessionValue(doneKey, "1", scope).catch(() => undefined);
        return;
      }
      setCalNotice(true);
    })();
  }, [state, sectionIndex, viewRatio, language, rangeFor, pendingPageRef, setCalNotice, trackCalibrationOffer]);
}