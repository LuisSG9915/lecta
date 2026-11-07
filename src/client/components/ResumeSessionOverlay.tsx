import React, { useState } from "react";
import type { SceneReturnRecap } from "../lib/page-recap";

export interface ResumeSessionOverlayProps {
  /** Texto del recap de 1 línea derivado de generateZeroSpoilerSceneRecap */
  recapLine: string;
  /** Extracto sombreado con las últimas 2 oraciones leídas */
  lastReadSentences: string;
  /** Si el usuario tiene >25 repasos FSRS acumulados */
  hasPendingReviewsDosing?: boolean;
  /** Acción principal para reanudar la lectura */
  onResumeReading: () => void;
  /** Callback al alternar el toggle de dosificación de repasos */
  onToggleDoseReviews?: (dosed: boolean) => void;
  className?: string;
}

/**
 * Extrae las últimas N oraciones de un fragmento de texto.
 */
export function extractLastSentences(text: string, count = 2): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const parts = cleaned
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  if (parts.length === 0) return cleaned.slice(-200);
  return parts.slice(-count).join(" ");
}

/**
 * Genera el recap de 1 línea a partir de SceneReturnRecap sin spoilers.
 */
export function formatSceneRecapOneLine(recap: SceneReturnRecap): string {
  if (recap.activeCharactersInScene && recap.activeCharactersInScene.length > 0) {
    const chars = recap.activeCharactersInScene.slice(0, 3).join(", ");
    return `En escena con ${chars}.`;
  }
  return "Retomando el hilo de la historia donde lo dejaste.";
}

export default function ResumeSessionOverlay({
  recapLine,
  lastReadSentences,
  hasPendingReviewsDosing = false,
  onResumeReading,
  onToggleDoseReviews,
  className = "",
}: ResumeSessionOverlayProps) {
  const [doseReviews, setDoseReviews] = useState(true);

  const handleToggleDose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setDoseReviews(checked);
    onToggleDoseReviews?.(checked);
  };

  return (
    <div
      className={`resume-session-overlay ${className}`.trim()}
      role="region"
      aria-label="Reanudar sesión de lectura"
    >
      <div className="resume-session-header">
        <span aria-hidden="true" className="resume-session-icon">
          📖
        </span>
        <span className="resume-session-kicker">
          Bienvenido de vuelta
        </span>
      </div>

      {/* Recap de 1 línea */}
      <p className="resume-session-recap-text">
        {recapLine}
      </p>

      {/* Extracto sombreado con las últimas 2 oraciones leídas */}
      {lastReadSentences ? (
        <blockquote className="resume-session-extract">
          «{lastReadSentences}»
        </blockquote>
      ) : null}

      {/* Toggle de dosificación si hay > 25 repasos FSRS pendientes */}
      {hasPendingReviewsDosing && (
        <div className="resume-session-dose-container">
          <label className="resume-session-dose-label">
            <input
              type="checkbox"
              className="resume-session-dose-checkbox"
              checked={doseReviews}
              onChange={handleToggleDose}
            />
            <span>
              Dosificar repasos pendientes (3/día) para ir directo a la historia
            </span>
          </label>
        </div>
      )}

      {/* Único botón primario */}
      <button
        type="button"
        className="btn btn--primary resume-session-primary-btn"
        onClick={onResumeReading}
      >
        Retomar lectura
      </button>
    </div>
  );
}
