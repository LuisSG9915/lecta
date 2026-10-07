import type { TtsSnapshot } from "../lib/ttsTypes";

// Chip de sesión «Leer en voz alta»: estado + pausa/reanudar +
// velocidad en ciclo + detener. Vive abajo, no captura la lectura y
// en foco profundo se reduce a su etiqueta (nada nuevo aparece ahí).
const RATE_LABEL: Record<number, string> = { "0.8": "0.8×", "1": "1×", "1.2": "1.2×" };

export default function TtsNowPlaying({
  snap,
  minimal,
  onPauseResume,
  onCycleRate,
  onStop,
}: {
  snap: TtsSnapshot;
  // deep_focus: el chip se queda mínimo — solo la etiqueta.
  minimal?: boolean;
  onPauseResume: () => void;
  onCycleRate: () => void;
  onStop: () => void;
}) {
  if (snap.status === "idle" || snap.status === "stopping") return null;
  const label =
    snap.status === "preparing"
      ? "Preparando…"
      : snap.status === "paused"
        ? "En pausa"
        : "En voz alta";
  return (
    <div className="tts-chip" role="status" aria-label="Lectura en voz alta">
      <span className="tts-chip-label">{label}</span>
      {minimal ? null : (
        <div className="tts-chip-actions">
          {snap.status === "speaking" ? (
            <button type="button" className="btn--quiet" onClick={onPauseResume}>
              Pausar
            </button>
          ) : snap.status === "paused" ? (
            <button type="button" className="btn--quiet" onClick={onPauseResume}>
              Reanudar
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
          <button type="button" className="btn--quiet" onClick={onStop}>
            Detener
          </button>
        </div>
      )}
    </div>
  );
}
