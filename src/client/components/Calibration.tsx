import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Icon from "./Icon";
import {
  initCatSession,
  skipCatSession,
  submitCatAnswer,
  type CalibrationWord,
  type CatSessionState,
} from "../lib/calibration";

export type CalibrationProps = {
  words?: CalibrationWord[];
  language?: string;
  onDone: () => void;
  onClose?: () => void;
  onComplete?: (finalTheta: number) => void;
};

export default function Calibration({
  language = "es",
  onDone,
  onClose,
  onComplete,
}: CalibrationProps) {
  const [prevLanguage, setPrevLanguage] = useState(language);
  const [session, setSession] = useState<CatSessionState>(() =>
    initCatSession(language),
  );
  const [isFinishing, setIsFinishing] = useState(false);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reiniciar sesión adaptativa si cambia la prop de idioma (sin useEffect sincrónico)
  if (language !== prevLanguage) {
    setPrevLanguage(language);
    setSession(initCatSession(language));
    setIsFinishing(false);
  }

  // Limpieza del timer al desmontar
  useEffect(() => {
    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current);
      }
    };
  }, []);

  const handleSkip = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
    }
    skipCatSession(session);
    if (onClose) {
      onClose();
    } else {
      onDone();
    }
  }, [session, onClose, onDone]);

  const handleAnswer = useCallback(
    (known: boolean) => {
      if (!session.currentItem || isFinishing) return;
      const next = submitCatAnswer(session, known);
      setSession(next);

      if (next.isComplete) {
        setIsFinishing(true);
        finishTimerRef.current = setTimeout(() => {
          onComplete?.(next.theta);
          onDone();
        }, 650);
      }
    },
    [session, isFinishing, onComplete, onDone],
  );

  // Atajos de teclado para respuesta ultra-rápida (< 1.5 s por palabra)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (isFinishing) return;

      if (e.key === "ArrowLeft" || e.key === "1") {
        e.preventDefault();
        handleAnswer(false);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        e.preventDefault();
        handleAnswer(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAnswer, handleSkip, isFinishing]);

  const langLabel =
    session.lang === "en"
      ? "Ajuste rápido · Inglés (15 s)"
      : "Ajuste rápido · Español (15 s)";

  return (
    <Sheet label="Ajuste rápido de vocabulario" onClose={handleSkip}>
      <div
        className="cat-calibration-card"
        role="region"
        aria-label="Ajuste adaptativo de vocabulario"
      >
        <div className="cat-calibration-header">
          <span className="cat-lang-badge">{langLabel}</span>
          <button
            type="button"
            className="cat-skip-btn"
            onClick={handleSkip}
            aria-label="Saltar e ir al libro"
          >
            Saltar e ir al libro →
          </button>
        </div>

        {isFinishing ? (
          <div
            className="cat-celebration-stage"
            role="status"
            aria-live="polite"
          >
            <div className="cat-celebration-icon" aria-hidden="true">
              <Icon name="sparkles" size={24} />
            </div>
            <p className="cat-celebration-msg">
              ¡Listo! Lecta ajustó las ayudas del capítulo a tu ritmo.
            </p>
            <p className="cat-celebration-sub">Abriendo tu lectura…</p>
          </div>
        ) : session.currentItem ? (
          <>
            <div
              className="cat-progress-dots"
              role="group"
              aria-label={`Palabra ${session.step + 1} de ${session.maxSteps}`}
            >
              {Array.from({ length: session.maxSteps }).map((_, idx) => {
                const isActive = idx === session.step;
                const isCompleted = idx < session.step;
                return (
                  <span
                    key={idx}
                    className={`cat-progress-dot${isActive ? " is-active" : ""}${isCompleted ? " is-completed" : ""}`}
                    aria-hidden="true"
                  />
                );
              })}
            </div>

            <div key={session.currentItem.id} className="cat-word-stage">
              <h2 className="cat-word-title">{session.currentItem.word}</h2>
              {session.currentItem.posHint ? (
                <p className="cat-word-pos">{session.currentItem.posHint}</p>
              ) : null}
              <p className="cat-word-hint">
                ¿Reconoces qué significa esta palabra al leer?
              </p>
            </div>

            <div
              className="cat-actions-grid"
              role="group"
              aria-label="Opciones de respuesta"
            >
              <button
                type="button"
                className="cat-action-btn cat-action-btn--secondary"
                onClick={() => handleAnswer(false)}
              >
                <span>No estoy seguro</span>
                <span className="cal-btn-key">[← / 1]</span>
              </button>
              <button
                type="button"
                className="cat-action-btn cat-action-btn--primary"
                onClick={() => handleAnswer(true)}
              >
                <span>Sí la conozco</span>
                <span className="cal-btn-key">[→ / 2]</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
