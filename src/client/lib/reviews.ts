import {
  captureDbScope,
  saveReview,
  type DbScope,
  type SavedReview,
} from "./idb";
import { pushReviewsToServer } from "./reading-sync";
import { award, localDayKey } from "./game";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";

export { REVIEW_KINDS, REVIEW_RATINGS } from "../../shared/reading-data";
export type { ReviewKind, ReviewRating } from "../../shared/reading-data";

// Anota un repaso en el historial: primero queda en el dispositivo y
// el envío al servidor va detrás, sin bloquear la pantalla (local
// primero). El historial es anexable; la sincronización completa lo
// que falte cuando vuelva la conexión.
export async function recordReview(
  input: {
    language: string;
    form: string;
    kind: ReviewKind;
    rating: ReviewRating;
    hints?: number;
  },
  scope?: DbScope,
): Promise<SavedReview> {
  const bound = scope ?? captureDbScope();
  const saved = await saveReview(
    {
      ...input,
      hints: input.hints ?? 0,
      createdAt: Date.now(),
    },
    bound,
  );
  void pushReviewsToServer([saved], bound);
  // El premio toma el id y la fecha del repaso guardado: estable ante
  // reintentos y con el día local del emisor congelado.
  void award({ kind: "review", rating: input.rating }, bound, {
    id: `review:${saved.id}`,
    at: saved.createdAt,
    dayKey: localDayKey(saved.createdAt),
  });
  return saved;
}
