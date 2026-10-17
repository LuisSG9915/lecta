import React from "react";

export interface ReaderRecapBubbleProps {
  recapBullets: string[];
  isLoading: boolean;
  onDismiss: () => void;
  onTriggerRecap?: () => void;
}

export const ReaderRecapBubble: React.FC<ReaderRecapBubbleProps> = ({
  recapBullets,
  isLoading,
  onDismiss,
  onTriggerRecap,
}) => {
  return (
    <div className="reader-recap-bubble" role="region" aria-label="Resumen de regreso">
      <div className="recap-bubble-header">
        <span className="recap-cat-icon" aria-hidden="true">🐱</span>
        <button
          type="button"
          className="recap-title-btn"
          onClick={onTriggerRecap}
          aria-label="¿Te recuerdo en 15s qué pasaba?"
        >
          <span className="recap-title">¿Te recuerdo en 15s qué pasaba?</span>
        </button>
        <button type="button" className="recap-close-btn" onClick={onDismiss} aria-label="Cerrar">
          ✕
        </button>
      </div>
      <div className="recap-bubble-body">
        {isLoading ? (
          <p className="recap-loading-text">Releyendo los últimos hilos...</p>
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
