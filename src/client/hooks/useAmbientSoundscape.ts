// Paisajes sonoros procedurales Web Audio y ronroneo ambiental («Body
// Doubling» acústico). Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import type { SoundscapeKind } from "../lib/companion-audio";

type Deps = {
  soundscape: string | undefined;
  ambientPurr: boolean | undefined;
  strategyPaused: boolean;
  state: string;
  readingPaused: boolean;
  ttsStatus: string;
  startAmbientPurr: () => void;
  startSoundscape: (kind: SoundscapeKind) => void;
  stopAmbientPurr: () => void;
  stopSoundscape: () => void;
};

export function useAmbientSoundscape(deps: Deps): void {
  const {
    soundscape,
    ambientPurr,
    strategyPaused,
    state,
    readingPaused,
    ttsStatus,
    startAmbientPurr,
    startSoundscape,
    stopAmbientPurr,
    stopSoundscape,
  } = deps;

  useEffect(() => {
    const activeSound = soundscape || (ambientPurr ? "purr" : "none");
    const shouldPlay =
      activeSound !== "none" &&
      !strategyPaused &&
      state === "ready" &&
      !readingPaused &&
      ttsStatus !== "speaking";

    if (shouldPlay) {
      if (activeSound === "purr") {
        startAmbientPurr();
      } else {
        startSoundscape(activeSound as SoundscapeKind);
      }
    } else {
      stopAmbientPurr();
      stopSoundscape();
    }
    return () => {
      stopAmbientPurr();
      stopSoundscape();
    };
  }, [
    soundscape,
    ambientPurr,
    strategyPaused,
    state,
    readingPaused,
    ttsStatus,
    startAmbientPurr,
    startSoundscape,
    stopAmbientPurr,
    stopSoundscape,
  ]);
}