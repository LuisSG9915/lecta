// Hook extraído de Reader.tsx (R3a): trackMove — telemetría de
// movimiento (regresiones y fatiga) por cambio de página/sección.
import { useCallback } from "react";
import type { FocusTracker } from "../lib/focus-telemetry";
import {
  newFocusTracker,
  recordMove,
  detectFatigue,
  isFocusSuggestionMuted,
  loadFocusTelemetryProfile,
} from "../lib/focus-telemetry";
import type { CompanionSignal } from "../lib/companion-state";
import type { VisitEventDraft } from "../lib/reading-events";

export type UseReaderTrackMoveParams = {
  focusTrackerRef: { current: FocusTracker | null };
  sectionIndexRef: { current: number };
  trackEvent: (event: VisitEventDraft) => void;
  signalCompanion: (sig: Omit<CompanionSignal, "at"> & { at?: number }) => void;
  setFatigueNotice: (v: boolean) => void;
  bookHash: string;
};

export function useReaderTrackMove({
  focusTrackerRef,
  sectionIndexRef,
  trackEvent,
  signalCompanion,
  setFatigueNotice,
  bookHash,
}: UseReaderTrackMoveParams): { trackMove: (back: boolean) => void } {
  const trackMove = useCallback(
    (back: boolean) => {
      const at = Date.now();
      const t =
        focusTrackerRef.current ??
        (focusTrackerRef.current = newFocusTracker(at));
      recordMove(t, at, back);
      if (back)
        trackEvent({
          kind: "page_regressed",
          sectionIndex: sectionIndexRef.current,
        });
      const hit = detectFatigue(t, at);
      if (!hit) return;
      trackEvent({
        kind: "fatigue_flag",
        sectionIndex: sectionIndexRef.current,
        regressions: hit.backs,
        moves: hit.moves,
      });
      signalCompanion({ kind: "fatigue_detected", at });
      // El aviso respeta «No volver a mostrar» (global o por libro);
      // el evento se registra igual: es telemetría, no interrupción.
      if (isFocusSuggestionMuted(loadFocusTelemetryProfile(), bookHash)) return;
      setFatigueNotice(true);
    },
    [trackEvent, signalCompanion, setFatigueNotice, focusTrackerRef, sectionIndexRef, bookHash],
  );

  return { trackMove };
}