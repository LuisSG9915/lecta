import { useCallback, useEffect, useState } from "react";
import {
  canonicalGrammarCategory,
  GRAMMAR_CATEGORIES,
  type GrammarCategory,
} from "../lib/grammar";
import { conciseMeaning } from "../lib/practice";
import { PracticeContext } from "./PracticeContext";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";

export interface GrammarGameProps {
  readonly targetWord: string;
  readonly meaning?: string;
  readonly pos?: string | null;
  readonly context?: string;
  readonly language?: string;
  readonly disabled?: boolean;
  readonly hintText?: string | null;
  readonly hintBusy?: boolean;
  readonly onAskHint?: () => void;
  readonly onSolve: () => void;
  readonly onWrong: () => void;
}

export function GrammarGame({
  targetWord,
  meaning,
  pos,
  context,
  language = "es",
  disabled = false,
  hintText,
  hintBusy = false,
  onAskHint,
  onSolve,
  onWrong,
}: GrammarGameProps) {
  const correctCategory = canonicalGrammarCategory(pos);
  const [selected, setSelected] = useState<GrammarCategory | null>(null);
  const [status, setStatus] = useState<"idle" | "correct" | "wrong">("idle");
  const [feedback, setFeedback] = useState<string | null>(null);

  const handlePick = useCallback(
    (catId: GrammarCategory) => {
      if (disabled || status === "correct") return;

      setSelected(catId);
      if (correctCategory && catId === correctCategory) {
        setStatus("correct");
        triggerPurrHaptic();
        playCompanionSound("purr");
        const info = GRAMMAR_CATEGORIES.find((c) => c.id === catId);
        setFeedback(`¡Exacto! «${targetWord}» es un ${info?.label.toLowerCase() ?? catId}. ✨`);
        window.setTimeout(() => {
          onSolve();
        }, 500);
      } else {
        setStatus("wrong");
        triggerHaptic();
        const wrongInfo = GRAMMAR_CATEGORIES.find((c) => c.id === catId);
        const correctInfo = GRAMMAR_CATEGORIES.find((c) => c.id === correctCategory);
        setFeedback(
          correctInfo
            ? `Casi. «${targetWord}» no es un ${wrongInfo?.label.toLowerCase() ?? catId}: ${correctInfo.hint}`
            : `Casi. ¡Prueba con otra categoría gramatical!`,
        );
        onWrong();
      }
    },
    [disabled, status, correctCategory, targetWord, onSolve, onWrong],
  );

  // Atajos de teclado: 1, 2, 3, 4 o S, V, A, D
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled || status === "correct") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "1" || key === "s") {
        event.preventDefault();
        handlePick("sustantivo");
      } else if (key === "2" || key === "v") {
        event.preventDefault();
        handlePick("verbo");
      } else if (key === "3" || key === "a") {
        event.preventDefault();
        handlePick("adjetivo");
      } else if (key === "4" || key === "d") {
        event.preventDefault();
        handlePick("adverbio");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, status, handlePick]);

  return (
    <div className="grammar-game" role="region" aria-label="Juego de categoría gramatical">
      <div className="index-card nb-card grammar-card">
        <p className="grammar-card-prompt meta">
          ¿Qué tipo de palabra es?
        </p>
        <p className="grammar-target-word">
          <strong>{targetWord}</strong>
        </p>
        {meaning ? (
          <p className="grammar-meaning" title={meaning}>
            {conciseMeaning(meaning, 80)}
          </p>
        ) : null}

        {context ? (
          <PracticeContext
            text={context}
            target={targetWord}
            language={language}
          />
        ) : null}
      </div>

      <div
        className="grammar-grid"
        role="group"
        aria-label="Categorías gramaticales"
      >
        {GRAMMAR_CATEGORIES.map((cat) => {
          const isSelected = selected === cat.id;
          const isCorrect = isSelected && status === "correct";
          const isWrong = isSelected && status === "wrong";

          return (
            <button
              key={cat.id}
              type="button"
              className={`btn grammar-cat-btn${
                isCorrect ? " is-correct" : isWrong ? " is-wrong" : ""
              }`}
              disabled={disabled || status === "correct"}
              aria-pressed={isSelected}
              onClick={() => handlePick(cat.id)}
            >
              <div className="grammar-cat-head">
                <span className="grammar-cat-icon" aria-hidden="true">
                  {cat.icon}
                </span>
                <span className="grammar-cat-shortcut" aria-hidden="true">
                  [{cat.shortcut}]
                </span>
              </div>
              <span className="grammar-cat-label">{cat.label}</span>
              <span className="grammar-cat-desc">{cat.question}</span>
            </button>
          );
        })}
      </div>

      {feedback ? (
        <p
          className={`grammar-feedback${
            status === "correct" ? " is-correct" : status === "wrong" ? " is-wrong" : ""
          }`}
          role="status"
        >
          {feedback}
        </p>
      ) : null}

      <div className="grammar-actions">
        {onAskHint ? (
          <button
            type="button"
            className="btn--quiet grammar-hint-btn"
            disabled={disabled || hintBusy || status === "correct"}
            onClick={onAskHint}
          >
            {hintBusy ? "Consultando a Michi…" : "💡 Pedir pista a Michi"}
          </button>
        ) : null}
      </div>

      {hintText ? (
        <div className="scramble-hint-box" role="status">
          <strong>Pista:</strong> {hintText}
        </div>
      ) : null}

      <p className="meta nb-keys-hint">
        Pulsa [1] Sustantivo · [2] Verbo · [3] Adjetivo · [4] Adverbio
      </p>
    </div>
  );
}
