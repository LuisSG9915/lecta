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
      className={`resume-session-overlay ${className}`}
      role="region"
      aria-label="Reanudar sesión de lectura"
      style={{
        width: "100%",
        maxWidth: "600px",
        margin: "1.5rem auto",
        padding: "1.25rem 1.5rem",
        background: "var(--paper-raised, #ffffff)",
        color: "var(--ink, #1f2937)",
        borderRadius: "14px",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.12)",
        border: "1px solid var(--rule-subtle, rgba(0, 0, 0, 0.08))",
        boxSizing: "border-box",
        zIndex: 25,
      }}
    >
      <div
        className="resume-session-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "0.5rem",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "1.2rem" }}>
          📖
        </span>
        <span
          style={{
            fontSize: "0.8rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            opacity: 0.7,
          }}
        >
          Bienvenido de vuelta
        </span>
      </div>

      {/* Recap de 1 línea */}
      <p
        className="resume-session-recap-text"
        style={{
          margin: "0 0 0.85rem 0",
          fontSize: "1rem",
          fontWeight: 600,
          lineHeight: 1.4,
          color: "var(--ink)",
        }}
      >
        {recapLine}
      </p>

      {/* Extracto sombreado con las últimas 2 oraciones leídas */}
      {lastReadSentences ? (
        <blockquote
          className="resume-session-extract"
          style={{
            margin: "0 0 1rem 0",
            padding: "0.75rem 1rem",
            background: "var(--paper-sunken, rgba(0, 0, 0, 0.03))",
            borderLeft: "3px solid var(--accent, #4f46e5)",
            borderRadius: "6px",
            fontStyle: "italic",
            fontSize: "0.92rem",
            lineHeight: 1.5,
            color: "var(--ink-secondary, #4b5563)",
          }}
        >
          «{lastReadSentences}»
        </blockquote>
      ) : null}

      {/* Toggle de dosificación si hay > 25 repasos FSRS pendientes */}
      {hasPendingReviewsDosing && (
        <div
          className="resume-session-dose-container"
          style={{
            marginBottom: "1.25rem",
            padding: "0.5rem 0.75rem",
            background: "rgba(79, 70, 229, 0.06)",
            borderRadius: "8px",
            border: "1px solid rgba(79, 70, 229, 0.15)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
              fontSize: "0.86rem",
              lineHeight: 1.35,
              color: "var(--ink)",
            }}
          >
            <input
              type="checkbox"
              checked={doseReviews}
              onChange={handleToggleDose}
              style={{
                width: "16px",
                height: "16px",
                accentColor: "var(--accent, #4f46e5)",
                cursor: "pointer",
              }}
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
        className="btn--primary resume-session-primary-btn"
        onClick={onResumeReading}
        style={{
          width: "100%",
          padding: "0.75rem 1.25rem",
          fontSize: "0.95rem",
          fontWeight: 600,
          borderRadius: "9999px",
          background: "var(--accent, #4f46e5)",
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(79, 70, 229, 0.3)",
          transition: "transform 0.15s ease, opacity 0.15s ease",
        }}
      >
        Retomar lectura
      </button>
    </div>
  );
}
