import { saveReview, type SavedReview } from "./idb";
import { pushReviewsToServer } from "./reading-sync";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";

export { REVIEW_KINDS, REVIEW_RATINGS } from "../../shared/reading-data";
export type { ReviewKind, ReviewRating } from "../../shared/reading-data";

// Anota un repaso en el historial: primero queda en el dispositivo y
// el envío al servidor va detrás, sin bloquear la pantalla (local
// primero). El historial es anexable; la sincronización completa lo
// que falte cuando vuelva la conexión.
export async function recordReview(input: {
  language: string;
  form: string;
  kind: ReviewKind;
  rating: ReviewRating;
  hints?: number;
}): Promise<SavedReview> {
  const saved = await saveReview({
    ...input,
    hints: input.hints ?? 0,
    createdAt: Date.now(),
  });
  void pushReviewsToServer([saved]);
  return saved;
}
