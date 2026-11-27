// Evalúa la eficacia real de una ayuda de neuro-foco tras una ventana de 90 s:
// premia si el lector la mantuvo encendida y penaliza de inmediato si la apagó
// antes de cumplirse el plazo.
import { useCallback, useEffect, useRef } from "react";
import {
  loadFocusTelemetryProfile,
  recordFocusAidOutcome,
  saveFocusTelemetryProfile,
  type FocusAidType,
} from "../lib/focus-telemetry";
import type { ReaderSettings } from "../lib/settings";

export const FOCUS_AID_EVAL_MS = 90_000;

function isAidActive(settings: ReaderSettings, aid: FocusAidType): boolean {
  if (aid === "paragraph-focus") return Boolean(settings.paragraphFocus);
  if (aid === "syntactic-lines") return Boolean(settings.syntacticLines);
  return Boolean(settings.focusRuler);
}

export function useFocusAidEvaluation({
  settings,
  settingsRef,
}: {
  settings: ReaderSettings;
  settingsRef: { current: ReaderSettings | null };
}) {
  const pendingRef = useRef<{
    aid: FocusAidType;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const scheduleFocusAidEvaluation = useCallback(
    (aid: FocusAidType) => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      const timer = setTimeout(() => {
        pendingRef.current = null;
        const latest = settingsRef.current;
        if (!latest) return;
        const prof = loadFocusTelemetryProfile();
        saveFocusTelemetryProfile(
          recordFocusAidOutcome(prof, aid, isAidActive(latest, aid)),
        );
      }, FOCUS_AID_EVAL_MS);
      pendingRef.current = { aid, timer };
    },
    [settingsRef],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (!isAidActive(settings, pending.aid)) {
      clearTimeout(pending.timer);
      pendingRef.current = null;
      const prof = loadFocusTelemetryProfile();
      saveFocusTelemetryProfile(recordFocusAidOutcome(prof, pending.aid, false));
    }
  }, [settings, settings.paragraphFocus, settings.syntacticLines, settings.focusRuler]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    };
  }, []);

  return { scheduleFocusAidEvaluation };
}
