import { useState } from "react";
import { smartContextSnippet } from "../lib/practice";
import { findEpisodicHighlightRange } from "../lib/word-highlight";

export interface PracticeContextProps {
  text: string;
  target?: string;
  language?: string;
  className?: string;
  slotTarget?: boolean;
  // Resalta la palabra objetivo (o su flexión) dentro de la cita:
  // en la ficha de «Aprender» y en los modos que no ocultan la forma.
  highlightTarget?: boolean;
  lemma?: string;
}

function renderContent(
  rawText: string,
  target?: string,
  slotTarget?: boolean,
  highlightTarget?: boolean,
  lemma?: string,
) {
  if (target && slotTarget) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = rawText.split(regex);
    if (parts.length > 1) {
      const lowerTarget = target.toLowerCase();
      return parts.map((part, i) =>
        part.toLowerCase() === lowerTarget ? (
          <span key={i} className="context-slot-illuminated" title="Palabra a descifrar">
            &nbsp;______&nbsp;
          </span>
        ) : (
          part
        ),
      );
    }
    return rawText;
  }

  if (target && highlightTarget) {
    const range = findEpisodicHighlightRange(rawText, target, lemma);
    if (!range) return rawText;
    return (
      <>
        {rawText.slice(0, range.start)}
        <mark className="nb-word-quote-highlight">
          {rawText.slice(range.start, range.end)}
        </mark>
        {rawText.slice(range.end)}
      </>
    );
  }

  return rawText;
}

// Muestra el contexto de forma ligera y ágil: si la cita es un
// párrafo largo del libro, presenta un micro-extracto centrado en la
// palabra clave para no agobiar la lectura, con un botón sutil para
// desplegar la cita íntegra solo si la persona lo desea.
export function PracticeContext({
  text,
  target,
  language = "es",
  className = "",
  slotTarget = false,
  highlightTarget = false,
  lemma,
}: PracticeContextProps) {
  const [expanded, setExpanded] = useState(false);
  const { snippet, isTrimmed } = smartContextSnippet(text, target, { language });

  if (!text) return null;

  const baseClass = `card-context${className ? ` ${className}` : ""}`;

  if (!isTrimmed) {
    return (
      <p className={baseClass}>
        “{renderContent(text, target, slotTarget, highlightTarget, lemma)}”
      </p>
    );
  }

  return (
    <div className="card-context-box">
      <p className={baseClass}>
        “{renderContent(snippet, target, slotTarget, highlightTarget, lemma)}”
      </p>
      <button
        type="button"
        className="btn--quiet card-context-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? "Ocultar contexto completo ▴" : "Ver contexto del libro ▾"}
      </button>
      {expanded ? (
        <p className={`${baseClass} card-context--full`}>
          “{renderContent(text, target, slotTarget, highlightTarget, lemma)}”
        </p>
      ) : null}
    </div>
  );
}
