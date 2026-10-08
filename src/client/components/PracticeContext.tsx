import { useState } from "react";
import { smartContextSnippet } from "../lib/practice";

export interface PracticeContextProps {
  text: string;
  target?: string;
  language?: string;
  className?: string;
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
}: PracticeContextProps) {
  const [expanded, setExpanded] = useState(false);
  const { snippet, isTrimmed } = smartContextSnippet(text, target, { language });

  if (!text) return null;

  const baseClass = `card-context${className ? ` ${className}` : ""}`;

  if (!isTrimmed) {
    return <p className={baseClass}>“{text}”</p>;
  }

  return (
    <div className="card-context-box">
      <p className={baseClass}>“{snippet}”</p>
      <button
        type="button"
        className="btn--quiet card-context-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? "Ocultar contexto completo ▴" : "Ver contexto del libro ▾"}
      </button>
      {expanded ? (
        <p className={`${baseClass} card-context--full`}>“{text}”</p>
      ) : null}
    </div>
  );
}
