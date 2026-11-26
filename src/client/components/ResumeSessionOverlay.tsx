import React, { useRef, useState } from "react";
import type { SceneReturnRecap } from "../lib/page-recap";
import { requestCharacterRecap } from "../lib/lexicon";
import { trackPlanEvent } from "../lib/plan-events";
import PlanNote from "./PlanNote";

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
  /** Nombres propios del pasaje para «¿Quién era…?» (opcional). */
  characters?: string[];
  bookTitle?: string;
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
  characters = [],
  bookTitle,
  className = "",
}: ResumeSessionOverlayProps) {
  const [doseReviews, setDoseReviews] = useState(true);
  const [recaps, setRecaps] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState(false);
  const askedRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  // Estado de la petición por nombre: «loading» mientras vuela, «error» si falló.
  const [pending, setPending] = useState<Record<string, "loading" | "error">>({});
  const names = characters.slice(0, 3);

  // Solo al tocar: nada de red al montar. Una llamada por nombre.
  const askWho = async (name: string) => {
    if (askedRef.current.has(name) || inflightRef.current.has(name)) return;
    inflightRef.current.add(name);
    setPending((prev) => ({ ...prev, [name]: "loading" }));
    const result = await requestCharacterRecap({
      entityName: name,
      bookTitle,
      excerptsSoFar: lastReadSentences ? [lastReadSentences] : [],
    });
    inflightRef.current.delete(name);
    const clear = () =>
      setPending((prev) => {
        const { [name]: _gone, ...rest } = prev;
        return rest;
      });
    if (result.ok) {
      askedRef.current.add(name);
      clear();
      setRecaps((prev) => ({ ...prev, [name]: result.summary }));
    } else if (result.code === "LECTA_PLUS_REQUIRED") {
      trackPlanEvent("app:recap-locked");
      askedRef.current.add(name);
      clear();
      setLocked(true);
    } else {
      setPending((prev) => ({ ...prev, [name]: "error" }));
    }
  };

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

      {names.length > 0 && (
        <div className="resume-session-who">
          <span>¿Quién era… </span>
          {names.map((name) => (
            <button
              key={name}
              type="button"
              className="btn btn--link resume-session-who-name"
              onClick={() => void askWho(name)}
            >
              {name}
            </button>
          ))}
          <div aria-live="polite">
            {Object.entries(recaps).map(([name, summary]) => (
              <p key={name} className="resume-session-who-summary">
                <strong>{name}.</strong> {summary}
              </p>
            ))}
            {Object.entries(pending).map(([name, status]) => (
              <p key={name} className="resume-session-who-summary meta" data-status={status}>
                {status === "loading"
                  ? `Cargando ${name}…`
                  : `No pudimos cargar a ${name}. Toca su nombre para reintentar.`}
              </p>
            ))}
          </div>
          {locked && (
            <PlanNote
              feature="character-recap"
              title="Resumen de personajes con Lecta+"
              detail="Recuerda quién es cada personaje sin spoilers."
            />
          )}
        </div>
      )}

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
