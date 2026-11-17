// Espejo del stop de TTS al navegar en un ref estable. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import type { TtsEndReason } from "../lib/ttsTypes";

type Ref<T> = { current: T };

type Deps<T> = {
  ttsRef: Ref<T>;
  ttsStopOnNavRef: Ref<(() => void) | null>;
};

export function useReaderTtsStopOnNav<T extends { stop?: (reason: TtsEndReason) => void } | null>(deps: Deps<T>): void {
  const { ttsRef, ttsStopOnNavRef } = deps;

  useEffect(() => {
    ttsStopOnNavRef.current = () => ttsRef.current?.stop?.("navigation");
  }, [ttsRef, ttsStopOnNavRef]);
}