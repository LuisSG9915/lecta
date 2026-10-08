import { useCallback, useEffect, useState } from "react";
import {
  prepareSentenceBuilder,
  scrambleSentenceTokens,
  type SentenceToken,
} from "../lib/grammar";
import { conciseMeaning } from "../lib/practice";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";

export interface SentenceBuilderGameProps {
  readonly targetWord: string;
  readonly meaning?: string;
  readonly sentence: string;
  readonly language?: string;
  readonly disabled?: boolean;
  readonly hintText?: string | null;
  readonly hintBusy?: boolean;
  readonly onAskHint?: () => void;
  readonly onSolve: () => void;
  readonly onWrong?: () => void;
}

export function SentenceBuilderGame({
  targetWord,
  meaning,
  sentence,
  disabled = false,
  hintText,
  hintBusy = false,
  onAskHint,
  onSolve,
  onWrong,
}: SentenceBuilderGameProps) {
  const prepared = prepareSentenceBuilder(sentence, targetWord) ?? {
    originalTokens: sentence.split(/\s+/).slice(0, 6).filter(Boolean),
    targetWordIndex: 0,
  };
  const originalTokens = prepared.originalTokens;

  const [available, setAvailable] = useState<SentenceToken[]>(() =>
    scrambleSentenceTokens(originalTokens),
  );
  const [placed, setPlaced] = useState<SentenceToken[]>([]);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const checkOrder = useCallback(
    (currentPlaced: SentenceToken[]) => {
      if (currentPlaced.length < originalTokens.length) {
        setFeedback(null);
        return;
      }

      const matches = currentPlaced.every(
        (token, idx) => token.text === originalTokens[idx],
      );

      if (matches) {
        setIsCorrect(true);
        triggerPurrHaptic();
        playCompanionSound("purr");
        setFeedback("¡Excelente! Oración construida con la sintaxis correcta. ✨🎯");
        window.setTimeout(() => {
          onSolve();
        }, 600);
      } else {
        setIsShaking(true);
        triggerHaptic();
        setFeedback("El orden no es del todo correcto. Toca una palabra para moverla o reordenar.");
        onWrong?.();
        window.setTimeout(() => {
          setIsShaking(false);
        }, 450);
      }
    },
    [originalTokens, onSolve, onWrong],
  );

  const placeToken = useCallback(
    (token: SentenceToken) => {
      if (disabled || isCorrect) return;
      triggerHaptic();
      setAvailable((prev) => prev.filter((t) => t.id !== token.id));
      const nextPlaced = [...placed, token];
      setPlaced(nextPlaced);
      checkOrder(nextPlaced);
    },
    [disabled, isCorrect, placed, checkOrder],
  );

  const unplaceToken = useCallback(
    (token: SentenceToken) => {
      if (disabled || isCorrect) return;
      triggerHaptic();
      setPlaced((prev) => prev.filter((t) => t.id !== token.id));
      setAvailable((prev) => [...prev, token]);
      setFeedback(null);
    },
    [disabled, isCorrect],
  );

  const popLastToken = useCallback(() => {
    if (disabled || isCorrect || placed.length === 0) return;
    const last = placed[placed.length - 1];
    unplaceToken(last);
  }, [disabled, isCorrect, placed, unplaceToken]);

  const resetAll = useCallback(() => {
    if (disabled || isCorrect || placed.length === 0) return;
    setPlaced([]);
    setAvailable(scrambleSentenceTokens(originalTokens));
    setFeedback(null);
  }, [disabled, isCorrect, placed.length, originalTokens]);

  const shuffleAvailable = useCallback(() => {
    if (disabled || isCorrect || available.length <= 1) return;
    setAvailable((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  }, [disabled, isCorrect, available.length]);

  const giveAutoHint = useCallback(() => {
    if (disabled || isCorrect || placed.length >= originalTokens.length) return;
    const nextTargetWord = originalTokens[placed.length];
    const candidate = available.find((t) => t.text === nextTargetWord);
    if (candidate) {
      placeToken(candidate);
    }
  }, [disabled, isCorrect, placed.length, originalTokens, available, placeToken]);

  // Teclado
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled || isCorrect) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        popLastToken();
        return;
      }

      // Teclas 1-9 para seleccionar token del banco
      const num = parseInt(event.key, 10);
      if (!isNaN(num) && num >= 1 && num <= available.length) {
        event.preventDefault();
        placeToken(available[num - 1]);
        return;
      }

      // Si pulsa una letra, buscar si coincide con la primera letra de algún disponible
      const pressedChar = event.key.toLowerCase();
      const match = available.find((t) => t.text.toLowerCase().startsWith(pressedChar));
      if (match) {
        event.preventDefault();
        placeToken(match);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, isCorrect, available, popLastToken, placeToken]);

  return (
    <div className="sentence-builder-game" role="region" aria-label="Juego de ordenar la oración">
      <div className="index-card nb-card sentence-builder-card">
        <p className="sentence-card-prompt meta">
          Ordena la oración para «<strong>{targetWord}</strong>»:
        </p>
        {meaning ? (
          <p className="sentence-meaning" title={meaning}>
            {conciseMeaning(meaning, 80)}
          </p>
        ) : null}

        {/* Zona de la oración en construcción */}
        <div
          className={`sentence-construction-zone${isShaking ? " is-shaking" : ""}${
            isCorrect ? " is-correct" : ""
          }`}
          aria-live="polite"
        >
          {placed.length === 0 ? (
            <span className="sentence-empty-placeholder meta">
              Toca las palabras de abajo en el orden gramatical correcto…
            </span>
          ) : (
            placed.map((token, idx) => (
              <button
                key={token.id}
                type="button"
                className={`sentence-chip is-placed${
                  token.text.toLowerCase().includes(targetWord.toLowerCase())
                    ? " is-target-word"
                    : ""
                }`}
                disabled={disabled || isCorrect}
                title="Toca para quitar"
                onClick={() => unplaceToken(token)}
              >
                <span className="sentence-chip-num">{idx + 1}</span>
                <span className="sentence-chip-text">{token.text}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Banco de fichas disponibles */}
      <div
        className="sentence-pool"
        role="group"
        aria-label="Palabras disponibles para ordenar"
      >
        {available.map((token, idx) => (
          <button
            key={token.id}
            type="button"
            className="btn sentence-pool-btn"
            disabled={disabled || isCorrect}
            onClick={() => placeToken(token)}
          >
            <span className="sentence-pool-key" aria-hidden="true">
              {idx + 1}
            </span>
            <span className="sentence-pool-text">{token.text}</span>
          </button>
        ))}
      </div>

      {feedback ? (
        <p
          className={`grammar-feedback${
            isCorrect ? " is-correct" : isShaking ? " is-wrong" : ""
          }`}
          role="status"
        >
          {feedback}
        </p>
      ) : null}

      {/* Acciones del juego */}
      <div className="sentence-actions">
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isCorrect || available.length <= 1}
          onClick={shuffleAvailable}
          title="Barajar palabras restantes"
        >
          🔀 Barajar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isCorrect || placed.length === 0}
          onClick={popLastToken}
          title="Borrar última palabra colocada"
        >
          ⌫ Borrar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isCorrect || placed.length === 0}
          onClick={resetAll}
          title="Reiniciar oración"
        >
          Reiniciar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isCorrect || placed.length >= originalTokens.length}
          onClick={giveAutoHint}
          title="Colocar la siguiente palabra correcta"
        >
          💡 Pista
        </button>
        {onAskHint ? (
          <button
            type="button"
            className="btn--quiet sentence-action-btn"
            disabled={disabled || hintBusy || isCorrect}
            onClick={onAskHint}
          >
            {hintBusy ? "Consultando…" : "🐱 Michi"}
          </button>
        ) : null}
      </div>

      {hintText ? (
        <div className="scramble-hint-box" role="status">
          <strong>Pista de Michi:</strong> {hintText}
        </div>
      ) : null}

      <p className="meta nb-keys-hint">
        Toca las fichas para armar la frase · [1-{available.length || 1}] para seleccionar · [Backspace] para borrar
      </p>
    </div>
  );
}
