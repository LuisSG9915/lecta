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
  onClose: () => void;
};

export function ReviewDone({ review, practiceCompanion, streakDays, onClose }: ReviewDoneProps) {
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
        {Number.isFinite(nextDue) && finishedAt !== null
          ? ` Vuelve en ${formatInterval(nextDue - finishedAt)}.`
          : " Nada pendiente por ahora."}
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
          Ver el cuaderno
        </button>
      </div>
    </div>
  );
}
