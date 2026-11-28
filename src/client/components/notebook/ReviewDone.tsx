// Cierre de sesión «Terminado por hoy.» (Fase 5, V2): cuántas palabras se
// repasaron, cuándo vuelve la siguiente y la racha del compañero.
import {
  findEpisodicHighlightRange,
  renderHighlightedContext,
} from "../../lib/word-highlight";


// consumen por esta vía histórica.
export { findEpisodicHighlightRange, renderHighlightedContext };
export { getStabilitySegments, safeStability } from "../../lib/notebook-model";
import { formatInterval } from "../../lib/relative-time";
import { PracticeCompanionHeader } from "../PracticeCompanionHeader";

import type { UseReviewSessionResult } from "../../hooks/useReviewSession";
import type { UsePracticeCompanionResult } from "../../hooks/usePracticeCompanion";

type ReviewDoneProps = {
  review: UseReviewSessionResult;
  practiceCompanion: UsePracticeCompanionResult;
  /** Racha de días de lectura, solo si el compañero está activo. */
  streakDays?: number;
  /** Palabras que ya tocan repasar al cerrar (el resto de la cola o las
   *  que no entraron en la tanda). */
  pendingCount: number;
  onClose: () => void;
};

// Qué sigue tras el repaso. «Vuelve en ahora» salía cuando quedaban
// vencidas o una fallada volvía en segundos: se dice lo que pasa.
export function nextReviewNote(
  pendingCount: number,
  nextDue: number,
  finishedAt: number | null,
): string {
  if (pendingCount > 0)
    return pendingCount === 1
      ? " Te queda 1 palabra para repasar."
      : ` Te quedan ${pendingCount} palabras para repasar.`;
  if (!Number.isFinite(nextDue) || finishedAt === null) return " Nada pendiente por ahora.";
  const wait = nextDue - finishedAt;
  if (wait < 60_000) return " La próxima vuelve en un momento.";
  return ` La próxima vuelve en ${formatInterval(wait)}.`;
}

export function ReviewDone({
  review,
  practiceCompanion,
  streakDays,
  pendingCount,
  onClose,
}: ReviewDoneProps) {
  const { finishedAt, nextDue, queueTotal, setQueue } = review;
  const { combo, companionMode, updateCompanionMode } = practiceCompanion;

  return (
    <div className="nb-done">
      <PracticeCompanionHeader
        pose="celebrate"
        speech={`¡Repaso terminado! Afianzaste ${queueTotal} ${queueTotal === 1 ? "palabra" : "palabras"} para tu próximo capítulo.`}
        combo={combo}
        mode={companionMode}
        onModeChange={updateCompanionMode}
      />
      <p className="nb-done-title">Terminado por hoy.</p>
      <p className="meta">
        {queueTotal} {queueTotal === 1 ? "palabra repasada" : "palabras repasadas"}.
        {nextReviewNote(pendingCount, nextDue, finishedAt)}
        {streakDays && streakDays > 1 ? ` Racha de ${streakDays} días.` : ""}
      </p>

      <div className="nb-done-actions">
        <button
          type="button"
          className="btn btn--primary game-return-reading-btn"
          onClick={onClose}
        >
          Volver a mi lectura
        </button>
        <button type="button" className="btn--quiet" onClick={() => setQueue(null)}>
          Ver el Herbario
        </button>
      </div>
    </div>
  );
}
