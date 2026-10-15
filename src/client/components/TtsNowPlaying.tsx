import { useState, useRef, useEffect } from "react";
import type { TtsSnapshot } from "../lib/ttsTypes";

// Chip de sesión «Leer en voz alta»: pastilla flotante ergonómica con
// navegación por frases (⏮ ⏭), control de velocidad en ciclo (0.9× a 1.3×),
// captura de vocabulario al vuelo al Cuaderno y pausa/detener.
// En foco profundo se reduce a su etiqueta discreta.
const RATE_LABEL: Record<number, string> = {
  0.8: "0.8×",
  0.9: "0.9×",
  1: "1.0×",
  1.15: "1.15×",
  1.2: "1.2×",
  1.3: "1.3×",
};

export default function TtsNowPlaying({
  snap,
  minimal,
  onPauseResume,
  onPrevSentence,
  onNextSentence,
  onCycleRate,
  onCaptureWord,
  onStop,
}: {
  snap: TtsSnapshot;
  // deep_focus: el chip se queda mínimo — solo la etiqueta.
  minimal?: boolean;
  onPauseResume: () => void;
  onPrevSentence?: () => void;
  onNextSentence?: () => void;
  onCycleRate: () => void;
  onCaptureWord?: () => void;
  onStop: () => void;
}) {
  const [captured, setCaptured] = useState(false);
  const captureTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (captureTimerRef.current) window.clearTimeout(captureTimerRef.current);
    };
  }, []);

  if (snap.status === "idle" || snap.status === "stopping") return null;

  const label =
    snap.status === "preparing"
      ? "Preparando…"
      : snap.status === "paused"
        ? "En pausa"
        : "En voz alta";

  const handleCapture = () => {
    if (!onCaptureWord) return;
    onCaptureWord();
    setCaptured(true);
    if (captureTimerRef.current) window.clearTimeout(captureTimerRef.current);
    captureTimerRef.current = window.setTimeout(() => {
      setCaptured(false);
      captureTimerRef.current = null;
    }, 1800);
  };

  return (
    <div
      className={`tts-chip ${minimal ? "tts-chip--minimal" : "tts-chip--expanded"}`}
      role="status"
      aria-label="Reproductor de lectura en voz alta"
    >
      <span className="tts-chip-label">{label}</span>
      {minimal ? null : (
        <div className="tts-chip-actions">
          {onPrevSentence ? (
            <button
              type="button"
              className="btn--quiet tts-btn-step"
              onClick={onPrevSentence}
              disabled={snap.status === "preparing"}
              aria-label="Frase anterior"
              title="Frase anterior"
            >
              ⏮
            </button>
          ) : null}
          {snap.status === "speaking" ? (
            <button
              type="button"
              className="btn--quiet tts-btn-playpause"
              onClick={onPauseResume}
              aria-label="Pausar lectura"
            >
              Pausar
            </button>
          ) : snap.status === "paused" ? (
            <button
              type="button"
              className="btn--quiet tts-btn-playpause"
              onClick={onPauseResume}
              aria-label="Reanudar lectura"
            >
              Reanudar
            </button>
          ) : null}
          {onNextSentence ? (
            <button
              type="button"
              className="btn--quiet tts-btn-step"
              onClick={onNextSentence}
              disabled={snap.status === "preparing"}
              aria-label="Frase siguiente"
              title="Frase siguiente"
            >
              ⏭
            </button>
          ) : null}
          <button
            type="button"
            className="btn--quiet tts-chip-rate"
            onClick={onCycleRate}
            aria-label="Velocidad de lectura en voz alta"
          >
            {RATE_LABEL[snap.rate] ?? `${snap.rate}×`}
          </button>
          {onCaptureWord ? (
            <button
              type="button"
              className={`btn--quiet tts-chip-capture ${captured ? "tts-chip-capture--active" : ""}`}
              onClick={handleCapture}
              disabled={snap.status === "preparing"}
              aria-label="Capturar joya léxica de la frase al Cuaderno"
              title="Guardar palabra clave de la frase"
            >
              {captured ? "✓ Guardada" : "★ Capturar palabra"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn--quiet tts-chip-stop"
            onClick={onStop}
            aria-label="Detener lectura"
          >
            Detener
          </button>
        </div>
      )}
    </div>
  );
}
