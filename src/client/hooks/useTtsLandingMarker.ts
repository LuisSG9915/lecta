// Marcador de aterrizaje auditivo: cuando el TTS pasa de speaking/stopping
// a idle, aplica el marcador visual en la posición guardada (Fase 3).
// Extraído de Reader.tsx (B7 del plan de refactor) para aligerar el
// orquestador sin cambiar comportamiento.
import { useEffect, useRef } from "react";
import {
  loadTtsLandingPosition,
  applyTtsLandingMarker,
} from "../lib/tts-landing";

type ContainerRef = { current: HTMLElement | null };

export function useTtsLandingMarker(
  containerRef: ContainerRef,
  bookHash: string,
  ttsStatus: string,
): void {
  const prevStatusRef = useRef(ttsStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = ttsStatus;
    if ((prev === "speaking" || prev === "stopping") && ttsStatus === "idle") {
      const landing = loadTtsLandingPosition(bookHash);
      if (landing && containerRef.current) {
        applyTtsLandingMarker(containerRef.current, landing);
      }
    }
  }, [ttsStatus, bookHash, containerRef]);
}