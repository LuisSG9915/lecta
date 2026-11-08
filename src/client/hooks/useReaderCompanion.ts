// Hook extraído de Reader.tsx (R1a): estado visible del gato acompañante
// y su máquina local. Cohesivo: un solo productor (signalCompanion) y
// dependencias externas mínimas.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionContextValue } from "../components/CompanionProvider";
import type { CompanionMachine, CompanionSignal, CompanionState } from "../lib/companion-state";
import { initialCompanion, reduceCompanion } from "../lib/companion-state";
import { isReaderIdleSleepy } from "../lib/focus-telemetry";
import { playCompanionSound } from "../lib/companion-audio";
import { useReaderPresence } from "../lib/reader-presence";

type ReaderState = "idle" | "opening" | "ready" | "error";

export type UseReaderCompanionParams = {
  companion: CompanionContextValue;
  catEnabled: boolean;
  presenceMode: CompanionContextValue["presence"];
  state: ReaderState;
  presenceOverlay: boolean;
  docHidden: boolean;
  stallBubble: unknown;
  onStallBubbleClick: () => void;
  focusTrackerRef: { current: import("../lib/focus-telemetry").FocusTracker | null };
};

export function useReaderCompanion({
  companion,
  catEnabled,
  presenceMode,
  state,
  presenceOverlay,
  docHidden,
  stallBubble,
  onStallBubbleClick,
  focusTrackerRef,
}: UseReaderCompanionParams) {
  const companionRef = useRef<CompanionMachine | null>(null);
  const companionOpenedRef = useRef(false);

  const [catState, setCatState] = useState<CompanionState | null>(null);
  const [catSleepy, setCatSleepy] = useState(false);
  const [fatigueNotice, setFatigueNotice] = useState(false);

  const {
    visible: catVisible,
    greeting: catGreeting,
    greet: greetCat,
    suppressed: catSuppressed,
    setSuppressed: setCatSuppressed,
    activity: presenceActivity,
    idle: presenceIdle,
    react: presenceReact,
  } = useReaderPresence({
    enabled: catEnabled,
    mode: presenceMode,
    ready: state === "ready",
    overlay: presenceOverlay,
    hidden: docHidden,
    machine: catState,
  });

  const setCelebrationBlocked = companion.setCelebrationBlocked;
  const celebrationBlocked =
    !catEnabled ||
    presenceMode === "off" ||
    catSuppressed ||
    presenceOverlay;
  useEffect(() => {
    setCelebrationBlocked(celebrationBlocked);
    return () => setCelebrationBlocked(false);
  }, [celebrationBlocked, setCelebrationBlocked]);

  const [catRendered, setCatRendered] = useState(false);
  const [catLeaving, setCatLeaving] = useState(false);
  if (catVisible && catLeaving) {
    setCatLeaving(false);
  } else if (catVisible && !catRendered) {
    setCatRendered(true);
  } else if (!catVisible && catRendered && !catLeaving) {
    setCatLeaving(true);
  }
  useEffect(() => {
    if (!catLeaving) return;
    const timer = window.setTimeout(() => {
      setCatRendered(false);
      setCatLeaving(false);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [catLeaving]);
  if (!catEnabled && catState !== null) setCatState(null);
  const catShown = catEnabled && catRendered && catState !== null;

  const catTapTimer = useRef<number | null>(null);
  const [catTap, setCatTap] = useState(false);
  const [catSavedWord, setCatSavedWord] = useState(false);
  const catSavedWordTimer = useRef<number | null>(null);

  const onCatTap = useCallback(() => {
    if (stallBubble) {
      onStallBubbleClick();
      return;
    }
    if (catTapTimer.current !== null) return;
    if (companion.reducedMotion) {
      companion.openPanel();
      return;
    }
    setCatTap(true);
    catTapTimer.current = window.setTimeout(() => {
      catTapTimer.current = null;
      setCatTap(false);
      companion.openPanel();
    }, 600);
  }, [stallBubble, onStallBubbleClick, companion]);

  useEffect(() => {
    return () => {
      if (catTapTimer.current !== null) window.clearTimeout(catTapTimer.current);
      if (catSavedWordTimer.current !== null)
        window.clearTimeout(catSavedWordTimer.current);
    };
  }, []);

  const signalCompanion = useCallback(
    (sig: Omit<CompanionSignal, "at"> & { at?: number }) => {
      const m = companionRef.current;
      if (!m) return;
      const full: CompanionSignal = { ...sig, at: sig.at ?? Date.now() };
      if (
        full.kind === "reading_activity" &&
        (m.state === "reading" || m.state === "deep_focus") &&
        full.at - m.lastActiveAt < 4_000
      )
        return;
      const next = reduceCompanion(m, full);
      companionRef.current = next;
      setCatState((prev) => (prev === next.state ? prev : next.state));
      if (
        full.kind === "word_consulted" ||
        full.kind === "goal_completed" ||
        full.kind === "fatigue_detected"
      )
        presenceReact();
      if (full.kind === "goal_completed") {
        playCompanionSound("purr");
      }
    },
    [presenceReact],
  );

  useEffect(() => {
    if (!catEnabled) {
      companionRef.current = null;
      companionOpenedRef.current = false;
      return;
    }
    if (!companionRef.current)
      companionRef.current = initialCompanion(Date.now());
    signalCompanion({ kind: "tick", at: Date.now() });
    if (state === "ready" && !companionOpenedRef.current) {
      companionOpenedRef.current = true;
      signalCompanion({ kind: "book_opened", at: Date.now() });
      greetCat();
    }
  }, [catEnabled, state, signalCompanion, greetCat]);

  useEffect(() => {
    if (!catEnabled) return;
    let timer: number | undefined;
    const tick = () => {
      if (document.hidden) return;
      const now = Date.now();
      signalCompanion({ kind: "tick", at: now });
      const sleepy = isReaderIdleSleepy(focusTrackerRef.current, now);
      setCatSleepy(sleepy);
    };
    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(tick, 10_000);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [catEnabled, signalCompanion, focusTrackerRef]);

  const flashCatSavedWord = useCallback(() => {
    setCatSavedWord(true);
    if (catSavedWordTimer.current !== null)
      window.clearTimeout(catSavedWordTimer.current);
    catSavedWordTimer.current = window.setTimeout(() => {
      catSavedWordTimer.current = null;
      setCatSavedWord(false);
    }, 2400);
  }, []);

  return {
    catState,
    catSleepy,
    setCatSleepy,
    catShown,
    catLeaving,
    catTap,
    setCatTap,
    catSavedWord,
    signalCompanion,
    catGreeting,
    catSuppressed,
    setCatSuppressed,
    presenceActivity,
    presenceIdle,
    presenceReact,
    greetCat,
    onCatTap,
    flashCatSavedWord,
    fatigueNotice,
    setFatigueNotice,
  };
}