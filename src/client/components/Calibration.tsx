import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Icon from "./Icon";
import {
  initCatSession,
  skipCatSession,
  submitCatAnswer,
  type CalibrationWord,
  type CatResponseRecord,
  type CatSessionState,
} from "../lib/calibration";
import { getCalibrationBankByLang } from "../../shared/calibration-bank";
import { catLevelLabel } from "../lib/vocab-level";
import { languageName } from "../lib/epub";

export type CalibrationProps = {
  words?: CalibrationWord[];
  language?: string;
  // Hay un libro esperando entrar al cerrar: el botón de la pantalla
  // de resultado dice «Continuar al libro →» en vez de «Listo».
  hasPendingBook?: boolean;
  onDone: () => void;
  onClose?: () => void;
  onComplete?: (result: { theta: number; history: CatResponseRecord[] }) => void;
};

export default function Calibration({
  language = "es",
  hasPendingBook = false,
  onDone,
  onClose,
  onComplete,
}: CalibrationProps) {
  const [prevLanguage, setPrevLanguage] = useState(language);
  const [session, setSession] = useState<CatSessionState>(() =>
    initCatSession(language, undefined, getCalibrationBankByLang(language)),
  );
  // La prueba terminó: se queda abierta esta pantalla de resultado
  // hasta que la persona toca el botón — nada se cierra solo.
  const [result, setResult] = useState<{ theta: number } | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  // Reiniciar sesión adaptativa si cambia la prop de idioma (sin useEffect sincrónico)
  if (language !== prevLanguage) {
    setPrevLanguage(language);
    setSession(initCatSession(language, undefined, getCalibrationBankByLang(language)));
    setResult(null);
  }

  // Al aparecer la pantalla de resultado el foco va a su único botón.
  useEffect(() => {
    if (result) continueRef.current?.focus();
  }, [result]);

  const handleSkip = useCallback(() => {
    skipCatSession(session);
    if (onClose) {
      onClose();
    } else {
      onDone();
    }
  }, [session, onClose, onDone]);

  const handleAnswer = useCallback(
    (known: boolean) => {
      if (!session.currentItem || result) return;
      const next = submitCatAnswer(session, known, getCalibrationBankByLang(language));
      setSession(next);

      if (next.isComplete) {
        setResult({ theta: next.theta });
        onComplete?.({ theta: next.theta, history: next.history });
      }
    },
    [session, result, onComplete, language],
  );

  // Atajos de teclado para respuesta ultra-rápida (< 1.5 s por palabra).
  // En la pantalla de resultado Escape equivale al botón: cerrar hecho.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (result) {
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
        return;
      }

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
  }, [handleAnswer, handleSkip, result, onDone]);

  const langLabel =
    session.lang === "en"
      ? "Ajuste rápido · Inglés (15 s)"
      : "Ajuste rápido · Español (15 s)";

  return (
    <Sheet label="Ajuste rápido de vocabulario" onClose={result ? onDone : handleSkip}>
      <div
        className="cat-calibration-card"
        role="region"
        aria-label="Ajuste adaptativo de vocabulario"
      >
        <div className="cat-calibration-header">
          <span className="cat-lang-badge">{langLabel}</span>
          {result ? null : (
            <button
              type="button"
              className="cat-skip-btn"
              onClick={handleSkip}
              aria-label="Saltar e ir al libro"
            >
              Saltar e ir al libro →
            </button>
          )}
        </div>

        {result ? (
          <div
            className="cat-celebration-stage"
            role="status"
            aria-live="polite"
          >
            <div className="cat-celebration-icon" aria-hidden="true">
              <Icon name="sparkles" size={24} />
            </div>
            <p className="cat-celebration-msg">
              {languageName(session.lang)} listo · Nivel estimado:{" "}
              {catLevelLabel(result.theta)}
            </p>
            <p className="cat-celebration-sub">
              Lecta ajustará las ayudas de cada capítulo a tu nivel.
            </p>
            <button
              type="button"
              ref={continueRef}
              className="cat-action-btn cat-action-btn--primary cat-continue-btn"
              onClick={onDone}
            >
              {hasPendingBook ? "Continuar al libro →" : "Listo"}
            </button>
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
