import React from "react";
import {
  saveCharacterMemoryEnabled,
  type SceneReturnRecap,
} from "../lib/page-recap";

export interface ReaderRecapBubbleProps {
  recapBullets?: string[];
  isLoading?: boolean;
  onDismiss: () => void;
  onTriggerRecap?: () => void;
  sceneRecap?: SceneReturnRecap | null;
  timeAwayLabel?: string;
  onSelectCharacter?: (characterName: string) => void;
  onDisableCharacterMemory?: () => void;
}

export function formatTimeAway(hours: number): string {
  if (hours < 1) return "hace unos minutos";
  if (hours < 24) {
    const h = Math.round(hours);
    return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

export const ReaderRecapBubble: React.FC<ReaderRecapBubbleProps> = ({
  recapBullets = [],
  isLoading = false,
  onDismiss,
  onTriggerRecap,
  sceneRecap,
  timeAwayLabel,
  onSelectCharacter,
  onDisableCharacterMemory,
}) => {
  const handleDisableMemory = () => {
    saveCharacterMemoryEnabled(false);
    onDisableCharacterMemory?.();
    onDismiss();
  };

  const timeLabel =
    timeAwayLabel || (sceneRecap ? formatTimeAway(sceneRecap.hoursSinceLastRead) : "");

  return (
    <div className="reader-recap-bubble" role="region" aria-label="Resumen de regreso">
      <div className="recap-bubble-header">
        <span className="recap-cat-icon" aria-hidden="true">🐱</span>
        <button
          type="button"
          className="recap-title-btn"
          onClick={onTriggerRecap}
          aria-label={
            sceneRecap
              ? `Dónde te quedaste (${timeLabel}):`
              : "¿Te recuerdo en 15s qué pasaba?"
          }
        >
          <span className="recap-title">
            {sceneRecap
              ? `Dónde te quedaste (${timeLabel}):`
              : "¿Te recuerdo en 15s qué pasaba?"}
          </span>
        </button>
        <button
          type="button"
          className="recap-close-btn"
          onClick={onDismiss}
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      <div className="recap-bubble-body">
        {isLoading ? (
          <p className="recap-loading-text">Releyendo los últimos hilos...</p>
        ) : sceneRecap ? (
          <div className="recap-scene-content">
            {/* Última oración clave leída */}
            {sceneRecap.lastReadSnippet && (
              <blockquote
                className="recap-last-snippet"
                style={{
                  margin: "0.25rem 0 0.5rem",
                  paddingLeft: "0.55rem",
                  borderLeft: "2px solid currentColor",
                  fontStyle: "italic",
                  fontSize: "0.86rem",
                  lineHeight: "1.35",
                  opacity: 0.9,
                }}
              >
                «{sceneRecap.lastReadSnippet}»
              </blockquote>
            )}

            {/* Personajes en esta escena */}
            {sceneRecap.activeCharactersInScene.length > 0 && (
              <div className="recap-scene-characters" style={{ marginTop: "0.4rem" }}>
                <span
                  className="recap-characters-label"
                  style={{ fontSize: "0.76rem", fontWeight: 600, opacity: 0.85 }}
                >
                  Personajes en esta escena:
                </span>
                <div
                  className="recap-character-pills"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    marginTop: "0.25rem",
                  }}
                >
                  {sceneRecap.activeCharactersInScene.map((charName) => (
                    <button
                      key={charName}
                      type="button"
                      className="recap-character-pill word-synonym-pill"
                      onClick={() => onSelectCharacter?.(charName)}
                      title={`Ver ficha de ${charName}`}
                      style={{
                        cursor: onSelectCharacter ? "pointer" : "default",
                        fontSize: "0.76rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        border: "none",
                      }}
                    >
                      {charName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Opción directa para desactivar recordatorio en 1 toque */}
            <div
              className="recap-disable-action"
              style={{
                marginTop: "0.55rem",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="btn--disable-character-memory"
                onClick={handleDisableMemory}
                title="Desactivar recordatorio de personajes"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "0.72rem",
                  opacity: 0.65,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                ✕ Desactivar recordatorio de personajes
              </button>
            </div>
          </div>
        ) : recapBullets.length > 0 ? (
          <ul className="recap-bullets-list">
            {recapBullets.map((bullet, idx) => (
              <li key={idx}>{bullet}</li>
            ))}
          </ul>
        ) : onTriggerRecap ? (
          <button type="button" className="recap-action-btn" onClick={onTriggerRecap}>
            Ver 3 puntos clave
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default ReaderRecapBubble;
