import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  prepareSentenceBuilder,
  scrambleSentenceTokens,
  type SentenceToken,
} from "../lib/grammar";
import { splitSentenceIntoSyntacticChunks } from "../lib/syntactic-lines";
import { conciseMeaning } from "../lib/practice";
import { generateClozeOptions } from "../lib/game";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import { speakWord } from "../lib/speech";

export interface SentenceBuilderGameProps {
  readonly targetWord: string;
  readonly meaning?: string;
  readonly sentence?: string;
  readonly language?: string;
  readonly disabled?: boolean;
  readonly hintText?: string | null;
  readonly hintBusy?: boolean;
  readonly onAskHint?: () => void;
  readonly onSolve: (metrics?: {
    responseTimeMs: number;
    errorCount: number;
    usedHint: boolean;
  }) => void;
  readonly onWrong?: () => void;
  // Fase 2: Consolidación episódica
  readonly mode?: "syntax" | "cloze";
  readonly chapterSentence?: string;
  readonly shortGloss?: string;
  readonly options?: string[];
  readonly autoPronounceOnSolve?: boolean;
}

export interface SplitSentenceTargetResult {
  prefix: string;
  matchedWord: string;
  suffix: string;
}

/**
 * Divide la cita del capítulo en prefijo, palabra objetivo y sufijo
 * para presentar un hueco elegante en el minijuego de consolidación.
 */
export function splitSentenceAtTarget(
  sentence: string,
  targetWord: string,
): SplitSentenceTargetResult {
  const cleanTarget = targetWord.trim();
  if (!cleanTarget || !sentence?.trim()) {
    return { prefix: sentence ?? "", matchedWord: cleanTarget, suffix: "" };
  }

  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})([^\\p{L}\\p{N}]|$)`, "u");
  const match = sentence.match(regex);
  if (match && match.index !== undefined) {
    const beforeBoundary = match[1];
    const matched = match[2];
    const matchStart = match.index + beforeBoundary.length;
    const matchEnd = matchStart + matched.length;
    return {
      prefix: sentence.slice(0, matchStart),
      matchedWord: matched,
      suffix: sentence.slice(matchEnd),
    };
  }

  const lowerSentence = sentence.toLowerCase();
  const lowerTarget = cleanTarget.toLowerCase();
  const idx = lowerSentence.indexOf(lowerTarget);
  if (idx !== -1) {
    return {
      prefix: sentence.slice(0, idx),
      matchedWord: sentence.slice(idx, idx + cleanTarget.length),
      suffix: sentence.slice(idx + cleanTarget.length),
    };
  }

  return {
    prefix: sentence.trim() + " ",
    matchedWord: cleanTarget,
    suffix: "",
  };
}

function renderChunkWithHighlight(text: string, targetWord: string) {
  if (!targetWord?.trim()) return text;
  const cleanTarget = targetWord.trim();
  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;

  const targetLower = cleanTarget.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase() === targetLower ? (
      <span key={i} className="sentence-target-highlight">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function SentenceBuilderGame({
  targetWord,
  meaning,
  sentence,
  language = "es",
  disabled = false,
  hintText,
  hintBusy = false,
  onAskHint,
  onSolve,
  onWrong,
  mode,
  chapterSentence,
  shortGloss,
  options,
  autoPronounceOnSolve = true,
}: SentenceBuilderGameProps) {
  const isClozeMode =
    mode === "cloze" ||
    Boolean(options && options.length > 0) ||
    (Boolean(chapterSentence) && mode !== "syntax");

  const effectiveSentence = chapterSentence?.trim()
    ? chapterSentence
    : sentence?.trim()
      ? sentence
      : `Encontramos en la lectura la palabra ${targetWord}.`;

  const effectiveMeaning = shortGloss?.trim() || meaning?.trim() || "";
  const isForeign = Boolean(language && !language.toLowerCase().startsWith("es"));

  // -------------------------------------------------------------------------
  // MODO CLOZE (Hueco Contextual Episódico)
  // -------------------------------------------------------------------------
  const split = useMemo(
    () => splitSentenceAtTarget(effectiveSentence, targetWord),
    [effectiveSentence, targetWord],
  );

  const clozeOptions = useMemo(() => {
    if (options && options.length > 0) return options;
    return generateClozeOptions(targetWord, { lang: language, count: 3 }).options;
  }, [options, targetWord, language]);

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [wrongOptions, setWrongOptions] = useState<Set<string>>(() => new Set());
  const [isClozeSolved, setIsClozeSolved] = useState(false);
  const [isClozeShaking, setIsClozeShaking] = useState(false);

  // Sincronizar clave de Cloze
  const currentClozeKey = `${targetWord}:${effectiveSentence}:${clozeOptions.join(",")}`;
  const [prevClozeKey, setPrevClozeKey] = useState(currentClozeKey);
  if (currentClozeKey !== prevClozeKey) {
    setPrevClozeKey(currentClozeKey);
    setSelectedOption(null);
    setWrongOptions(new Set());
    setIsClozeSolved(false);
    setIsClozeShaking(false);
  }

  // -------------------------------------------------------------------------
  // MODO SYNTAX (Telar de Frases / Ordenar Fragmentos)
  // -------------------------------------------------------------------------
  const originalTokens = useMemo(() => {
    const rawWords = effectiveSentence.trim().split(/\s+/).filter(Boolean);
    if (rawWords.length > 5) {
      return splitSentenceIntoSyntacticChunks(effectiveSentence);
    }
    const prepared = prepareSentenceBuilder(effectiveSentence, targetWord);
    return prepared ? prepared.originalTokens : rawWords.slice(0, 6);
  }, [effectiveSentence, targetWord]);

  const [available, setAvailable] = useState<SentenceToken[]>(() =>
    scrambleSentenceTokens(originalTokens),
  );
  const [placed, setPlaced] = useState<SentenceToken[]>([]);
  const [isSyntaxCorrect, setIsSyntaxCorrect] = useState(false);
  const [isSyntaxShaking, setIsSyntaxShaking] = useState(false);
  const [syntaxFeedback, setSyntaxFeedback] = useState<string | null>(null);

  const startTimeRef = useRef<number>(0);
  const errorCountRef = useRef<number>(0);
  const usedHintRef = useRef<boolean>(false);

  // Sincronizar estado cuando cambia la oración en modo syntax
  const currentTokensKey = originalTokens.join(" ");
  const [prevTokensKey, setPrevTokensKey] = useState(currentTokensKey);
  if (currentTokensKey !== prevTokensKey) {
    setPrevTokensKey(currentTokensKey);
    setAvailable(scrambleSentenceTokens(originalTokens));
    setPlaced([]);
    setIsSyntaxCorrect(false);
    setIsSyntaxShaking(false);
    setSyntaxFeedback(null);
  }

  const activeResetKey = isClozeMode ? currentClozeKey : currentTokensKey;
  useEffect(() => {
    startTimeRef.current = Date.now();
    errorCountRef.current = 0;
    usedHintRef.current = false;
  }, [activeResetKey]);

  // Selección de opción en Cloze
  const handleSelectClozeOption = useCallback(
    (opt: string) => {
      if (disabled || isClozeSolved || wrongOptions.has(opt)) return;
      setSelectedOption(opt);
      const isTarget = opt.trim().toLowerCase() === targetWord.trim().toLowerCase();

      if (isTarget) {
        setIsClozeSolved(true);
        triggerPurrHaptic();
        playCompanionSound("purr");

        if (isForeign && autoPronounceOnSolve !== false) {
          void speakWord(split.matchedWord || targetWord, language).catch(() => {});
        }

        const elapsed =
          startTimeRef.current > 0
            ? Math.max(100, Date.now() - startTimeRef.current)
            : 500;
        const metrics = {
          responseTimeMs: elapsed,
          errorCount: errorCountRef.current,
          usedHint: usedHintRef.current,
        };
        window.setTimeout(() => {
          onSolve(metrics);
        }, 700);
      } else {
        setIsClozeShaking(true);
        triggerHaptic();
        errorCountRef.current += 1;
        setWrongOptions((prev) => new Set([...prev, opt]));
        onWrong?.();
        window.setTimeout(() => {
          setIsClozeShaking(false);
        }, 500);
      }
    },
    [
      disabled,
      isClozeSolved,
      wrongOptions,
      targetWord,
      isForeign,
      autoPronounceOnSolve,
      split.matchedWord,
      language,
      onSolve,
      onWrong,
    ],
  );

  const handleClozeHint = useCallback(() => {
    if (disabled || isClozeSolved) return;
    usedHintRef.current = true;
    triggerHaptic();
    const targetLower = targetWord.trim().toLowerCase();
    const wrongAvailable = clozeOptions.filter(
      (opt) => opt.trim().toLowerCase() !== targetLower && !wrongOptions.has(opt),
    );
    if (wrongAvailable.length > 0) {
      setWrongOptions((prev) => new Set([...prev, wrongAvailable[0]]));
    }
    onAskHint?.();
  }, [disabled, isClozeSolved, targetWord, clozeOptions, wrongOptions, onAskHint]);

  // Atajos de teclado para Cloze (teclas 1, 2, 3)
  useEffect(() => {
    if (!isClozeMode || disabled || isClozeSolved) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const num = parseInt(event.key, 10);
      if (!isNaN(num) && num >= 1 && num <= clozeOptions.length) {
        event.preventDefault();
        handleSelectClozeOption(clozeOptions[num - 1]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isClozeMode, disabled, isClozeSolved, clozeOptions, handleSelectClozeOption]);

  // Manejadores de modo Syntax
  const checkOrder = useCallback(
    (currentPlaced: SentenceToken[]) => {
      if (currentPlaced.length < originalTokens.length) {
        setSyntaxFeedback(null);
        return;
      }

      const matches = currentPlaced.every(
        (token, idx) => token.text === originalTokens[idx],
      );

      if (matches) {
        setIsSyntaxCorrect(true);
        triggerPurrHaptic();
        playCompanionSound("purr");

        if (isForeign && autoPronounceOnSolve !== false) {
          void speakWord(targetWord, language).catch(() => {});
        }

        const elapsed =
          startTimeRef.current > 0
            ? Math.max(100, Date.now() - startTimeRef.current)
            : 500;
        const metrics = {
          responseTimeMs: elapsed,
          errorCount: errorCountRef.current,
          usedHint: usedHintRef.current,
        };
        window.setTimeout(() => {
          onSolve(metrics);
        }, 600);
      } else {
        setIsSyntaxShaking(true);
        triggerHaptic();
        errorCountRef.current += 1;
        setSyntaxFeedback(
          "El orden no es del todo correcto. Toca una palabra para moverla o reordenar.",
        );
        onWrong?.();
        window.setTimeout(() => {
          setIsSyntaxShaking(false);
        }, 450);
      }
    },
    [originalTokens, isForeign, autoPronounceOnSolve, targetWord, language, onSolve, onWrong],
  );

  const placeToken = useCallback(
    (token: SentenceToken) => {
      if (disabled || isSyntaxCorrect) return;
      triggerHaptic();
      setAvailable((prev) => prev.filter((t) => t.id !== token.id));
      const nextPlaced = [...placed, token];
      setPlaced(nextPlaced);
      checkOrder(nextPlaced);
    },
    [disabled, isSyntaxCorrect, placed, checkOrder],
  );

  const unplaceToken = useCallback(
    (token: SentenceToken) => {
      if (disabled || isSyntaxCorrect) return;
      triggerHaptic();
      setPlaced((prev) => prev.filter((t) => t.id !== token.id));
      setAvailable((prev) => [...prev, token]);
      setSyntaxFeedback(null);
    },
    [disabled, isSyntaxCorrect],
  );

  const popLastToken = useCallback(() => {
    if (disabled || isSyntaxCorrect || placed.length === 0) return;
    const last = placed[placed.length - 1];
    unplaceToken(last);
  }, [disabled, isSyntaxCorrect, placed, unplaceToken]);

  const resetAll = useCallback(() => {
    if (disabled || isSyntaxCorrect || placed.length === 0) return;
    setPlaced([]);
    setAvailable(scrambleSentenceTokens(originalTokens));
    setSyntaxFeedback(null);
  }, [disabled, isSyntaxCorrect, placed.length, originalTokens]);

  const shuffleAvailable = useCallback(() => {
    if (disabled || isSyntaxCorrect || available.length <= 1) return;
    setAvailable((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  }, [disabled, isSyntaxCorrect, available.length]);

  const giveAutoHint = useCallback(() => {
    if (disabled || isSyntaxCorrect || placed.length >= originalTokens.length) return;
    usedHintRef.current = true;
    const nextTargetWord = originalTokens[placed.length];
    const candidate = available.find((t) => t.text === nextTargetWord);
    if (candidate) {
      placeToken(candidate);
    }
  }, [disabled, isSyntaxCorrect, placed.length, originalTokens, available, placeToken]);

  // Teclado para modo Syntax
  useEffect(() => {
    if (isClozeMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled || isSyntaxCorrect) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        popLastToken();
        return;
      }

      const num = parseInt(event.key, 10);
      if (!isNaN(num) && num >= 1 && num <= available.length) {
        event.preventDefault();
        placeToken(available[num - 1]);
        return;
      }

      const pressedChar = event.key.toLowerCase();
      const match = available.find((t) =>
        t.text.toLowerCase().startsWith(pressedChar),
      );
      if (match) {
        event.preventDefault();
        placeToken(match);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isClozeMode, disabled, isSyntaxCorrect, available, popLastToken, placeToken]);

  // -------------------------------------------------------------------------
  // RENDER: VISTA CLOZE (Hueco Contextual)
  // -------------------------------------------------------------------------
  if (isClozeMode) {
    const targetLower = targetWord.trim().toLowerCase();
    return (
      <div
        className="sentence-builder-game sentence-cloze-game"
        role="region"
        aria-label="Juego de completar el espacio contextual"
      >
        <div className="index-card nb-card sentence-builder-card sentence-cloze-card">
          <p className="sentence-card-prompt meta">
            <span className="sentence-card-title">Cita del Capítulo:</span> Completa el espacio para «<strong>{targetWord}</strong>»:
          </p>

          <div className="sentence-cloze-quote-wrapper">
            <p className="sentence-cloze-quote">
              “{split.prefix}
              <span
                className={`sentence-cloze-slot${isClozeSolved ? " is-filled" : " is-blank"}${
                  isClozeShaking ? " is-shaking" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                {isClozeSolved ? (split.matchedWord || targetWord) : "······"}
              </span>
              {split.suffix}”
            </p>
          </div>

          {effectiveMeaning ? (
            <p
              className="sentence-meaning sentence-cloze-gloss"
              title={effectiveMeaning}
            >
              <span className="sentence-cloze-gloss-label">
                {isForeign ? "Traducción:" : "Significado:"}
              </span>{" "}
              {conciseMeaning(effectiveMeaning, 120)}
            </p>
          ) : null}
        </div>

        {/* 3 Opciones morfológicamente coherentes */}
        <div
          className="sentence-cloze-options"
          role="group"
          aria-label="Opciones para completar el espacio"
        >
          {clozeOptions.map((opt, idx) => {
            const isOptWrong = wrongOptions.has(opt);
            const isOptSelected = selectedOption === opt;
            const isOptCorrect =
              isClozeSolved && (opt.trim().toLowerCase() === targetLower || isOptSelected);
            return (
              <button
                key={opt}
                type="button"
                className={`btn sentence-pool-btn sentence-cloze-option-btn${
                  isOptCorrect ? " is-correct" : isOptSelected && isOptWrong ? " is-wrong is-selected" : ""
                }${isOptWrong ? " is-wrong" : ""}`}
                disabled={disabled || isClozeSolved || isOptWrong}
                onClick={() => handleSelectClozeOption(opt)}
              >
                <span className="sentence-pool-key" aria-hidden="true">
                  {idx + 1}
                </span>
                <span className="sentence-pool-text">{opt}</span>
              </button>
            );
          })}
        </div>

        {/* Acciones de ayuda */}
        <div className="sentence-actions">
          <button
            type="button"
            className="btn--quiet sentence-action-btn"
            disabled={disabled || isClozeSolved}
            onClick={handleClozeHint}
            title="Descartar una opción incorrecta"
          >
            💡 Descartar opción
          </button>
          {onAskHint ? (
            <button
              type="button"
              className="btn--quiet sentence-action-btn"
              disabled={disabled || hintBusy || isClozeSolved}
              onClick={() => {
                usedHintRef.current = true;
                onAskHint();
              }}
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
          Toca una opción para encajarla en la cita · Pulsa [1-{clozeOptions.length}]
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: VISTA SYNTAX (Telar de Frases original)
  // -------------------------------------------------------------------------
  return (
    <div
      className="sentence-builder-game"
      role="region"
      aria-label="Juego de ordenar la oración"
    >
      <div className="index-card nb-card sentence-builder-card">
        <p className="sentence-card-prompt meta">
          <span className="sentence-card-title">Telar de Frases:</span> Ordena los fragmentos para «<strong>{targetWord}</strong>»:
        </p>
        {effectiveMeaning ? (
          <p className="sentence-meaning" title={effectiveMeaning}>
            {conciseMeaning(effectiveMeaning, 80)}
          </p>
        ) : null}

        {/* Zona de la oración en construcción */}
        <div
          className={`sentence-construction-zone${isSyntaxShaking ? " is-shaking" : ""}${
            isSyntaxCorrect ? " is-correct" : ""
          }`}
          aria-live="polite"
        >
          {placed.length === 0 ? (
            <span className="sentence-empty-placeholder meta">
              Toca los fragmentos de abajo en el orden literario correcto…
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
                disabled={disabled || isSyntaxCorrect}
                title="Toca para quitar"
                onClick={() => unplaceToken(token)}
              >
                <span className="sentence-chip-num">{idx + 1}</span>
                <span className="sentence-chip-text">
                  {renderChunkWithHighlight(token.text, targetWord)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Banco de fichas disponibles */}
      <div
        className="sentence-pool"
        role="group"
        aria-label="Fragmentos disponibles para ordenar"
      >
        {available.map((token, idx) => (
          <button
            key={token.id}
            type="button"
            className="btn sentence-pool-btn"
            disabled={disabled || isSyntaxCorrect}
            onClick={() => placeToken(token)}
          >
            <span className="sentence-pool-key" aria-hidden="true">
              {idx + 1}
            </span>
            <span className="sentence-pool-text">
              {renderChunkWithHighlight(token.text, targetWord)}
            </span>
          </button>
        ))}
      </div>

      {syntaxFeedback ? (
        <p
          className={`grammar-feedback${
            isSyntaxCorrect ? " is-correct" : isSyntaxShaking ? " is-wrong" : ""
          }`}
          role="status"
        >
          {syntaxFeedback}
        </p>
      ) : null}

      {/* Acciones del juego */}
      <div className="sentence-actions">
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isSyntaxCorrect || available.length <= 1}
          onClick={shuffleAvailable}
          title="Barajar palabras restantes"
        >
          🔀 Barajar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isSyntaxCorrect || placed.length === 0}
          onClick={popLastToken}
          title="Borrar última palabra colocada"
        >
          ⌫ Borrar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isSyntaxCorrect || placed.length === 0}
          onClick={resetAll}
          title="Reiniciar oración"
        >
          Reiniciar
        </button>
        <button
          type="button"
          className="btn--quiet sentence-action-btn"
          disabled={disabled || isSyntaxCorrect || placed.length >= originalTokens.length}
          onClick={giveAutoHint}
          title="Colocar la siguiente palabra correcta"
        >
          💡 Pista
        </button>
        {onAskHint ? (
          <button
            type="button"
            className="btn--quiet sentence-action-btn"
            disabled={disabled || hintBusy || isSyntaxCorrect}
            onClick={() => {
              usedHintRef.current = true;
              onAskHint();
            }}
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
