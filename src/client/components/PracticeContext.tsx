import { useState } from "react";
import { smartContextSnippet } from "../lib/practice";

export interface PracticeContextProps {
  text: string;
  target?: string;
  language?: string;
  className?: string;
  slotTarget?: boolean;
}

function renderContent(
  rawText: string,
  target?: string,
  slotTarget?: boolean,
) {
  if (!target || !slotTarget) return rawText;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = rawText.split(regex);
  if (parts.length <= 1) return rawText;

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
}: PracticeContextProps) {
  const [expanded, setExpanded] = useState(false);
  const { snippet, isTrimmed } = smartContextSnippet(text, target, { language });

  if (!text) return null;

  const baseClass = `card-context${className ? ` ${className}` : ""}`;

  if (!isTrimmed) {
    return <p className={baseClass}>“{renderContent(text, target, slotTarget)}”</p>;
  }

  return (
    <div className="card-context-box">
      <p className={baseClass}>“{renderContent(snippet, target, slotTarget)}”</p>
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
          “{renderContent(text, target, slotTarget)}”
        </p>
      ) : null}
    </div>
  );
}
