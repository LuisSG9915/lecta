// Plegable «Más formas de practicar» (Fase 5, V2): los modos libres, el taller
// con el gato y el resto de ejercicios en una sola rejilla, cerrada por defecto.
import {
  type PracticeMode,
  EXTRA_MODES,
} from "../../lib/notebook-model";


import Icon from "../Icon";
import PlanNote from "../PlanNote";


type FreeModesProps = {
  /** Cuántas palabras de la cola puede cumplir cada modo. */
  eligibleCount: Record<PracticeMode, number>;
  /** Palabras ya presentadas y vencidas: sin ellas todos los modos están apagados. */
  reviewWordCount: number;
  /** Palabras por aprender: cambia el motivo del aviso cuando no hay nada que practicar. */
  learnableCount: number;
  /** Aviso suave cuando un modo no pudo armar su cola. */
  practiceNote: string;
  onStartPractice: (mode: PracticeMode) => void | Promise<void>;
  onToggleWorkshop: () => void;
  /** Cuenta free: los modos libres son de Lecta+ (se ven apagados con nota). */
  locked?: boolean;
};

export function FreeModes({
  eligibleCount,
  reviewWordCount,
  learnableCount,
  practiceNote,
  onStartPractice,
  onToggleWorkshop,
  locked = false,
}: FreeModesProps) {
  return (
    <details className="nb-free-modes">
      <summary className="nb-free-modes-label">Más formas de practicar</summary>
      <div className="nb-free-modes-grid" role="group" aria-label="Modos de juego libres">
        <button
          type="button"
          className="nb-free-mode-card"
          onClick={() => void onStartPractice("cloze")}
          disabled={locked || eligibleCount.cloze === 0}
          title="Hueco en el Libro · Contexto rápido"
        >
          <span className="nb-free-mode-icon" aria-hidden="true"><Icon name="book" size={16} /></span>
          <div className="nb-free-mode-info">
            <strong className="nb-free-mode-name">Hueco en el Libro</strong>
            <span className="nb-free-mode-time">Contexto rápido</span>
          </div>
        </button>

        <button
          type="button"
          className="nb-free-mode-card"
          onClick={() => void onStartPractice("scramble")}
          disabled={locked || eligibleCount.scramble === 0}
          title="Sílabas de Tinta · Descifrar palabra"
        >
          <span className="nb-free-mode-icon" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
          <div className="nb-free-mode-info">
            <strong className="nb-free-mode-name">Sílabas de Tinta</strong>
            <span className="nb-free-mode-time">Descifrar palabra</span>
          </div>
        </button>

        <button
          type="button"
          className="nb-free-mode-card"
          onClick={() => void onStartPractice("syntax")}
          disabled={locked || eligibleCount.syntax === 0}
          title="Telar de Frases · Ordenar oración"
        >
          <span className="nb-free-mode-icon" aria-hidden="true"><Icon name="strategy" size={16} /></span>
          <div className="nb-free-mode-info">
            <strong className="nb-free-mode-name">Telar de Frases</strong>
            <span className="nb-free-mode-time">Ordenar frase</span>
          </div>
        </button>

        <button
          type="button"
          className="nb-free-mode-card"
          onClick={() => void onStartPractice("match")}
          disabled={locked || eligibleCount.match === 0}
          title="Parejas · Une cada palabra con su significado"
        >
          <span className="nb-free-mode-icon" aria-hidden="true"><Icon name="bookmark" size={16} /></span>
          <div className="nb-free-mode-info">
            <strong className="nb-free-mode-name">Parejas</strong>
            <span className="nb-free-mode-time">Palabra ↔ significado</span>
          </div>
        </button>

        <button
          type="button"
          className="nb-free-mode-card"
          onClick={onToggleWorkshop}
          disabled={locked || reviewWordCount === 0}
          title="Taller con el Gato IA · Generativo"
        >
          <span className="nb-free-mode-icon" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
          <div className="nb-free-mode-info">
            <strong className="nb-free-mode-name">Taller con el Gato IA</strong>
            <span className="nb-free-mode-time">Generativo</span>
          </div>
        </button>

        {EXTRA_MODES.map(({ id, name, hint, icon }) => (
            <button
              key={id}
              type="button"
              className="nb-free-mode-card"
              onClick={() => void onStartPractice(id)}
              disabled={locked || eligibleCount[id] === 0}
              title={`${name} · ${hint}`}
            >
              <span className="nb-free-mode-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
              <div className="nb-free-mode-info">
                <strong className="nb-free-mode-name">{name}</strong>
                <span className="nb-free-mode-time">{hint}</span>
              </div>
            </button>
          ))}
      </div>
      {locked ? (
        <PlanNote
          title="Los modos libres son de Lecta+."
          detail="Tu repaso diario y tu Herbario siguen aquí, sin límite."
        />
      ) : reviewWordCount === 0 ? (
        // Todos los botones quedan deshabilitados: se explica por qué.
        <p className="meta nb-practice-note" role="status">
          {learnableCount > 0
            ? "Los modos libres usan palabras que ya viste. Aprende primero las nuevas."
            : "No hay palabras para practicar todavía."}
        </p>
      ) : practiceNote ? (
        <p className="meta nb-practice-note" role="status">{practiceNote}</p>
      ) : null}
    </details>
  );
}
