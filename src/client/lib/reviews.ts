import {
  captureDbScope,
  saveReview,
  withDb,
  wordKey,
  type DbScope,
  type SavedReview,
  type SavedWord,
} from "./idb";
import { newCard } from "./fsrs";
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

/**
 * Programa la palabra capturada (guardada o en aprendizaje) en la cola de repaso FSRS.
 * Se invoca exclusivamente cuando el usuario guarda intencionalmente una palabra o la marca para aprender,
 * evitando ensuciar la cola de repaso por simples consultas de lectura.
 */
export async function scheduleCapturedReview(
  word: string,
  bookId?: string,
  sentence?: string,
  language = "es",
  scope?: DbScope,
): Promise<void> {
  const bound = scope ?? captureDbScope();
  await withDb(bound, async (db) => {
    const key = wordKey(language, word);
    const existing = await db.get("savedWords", key);
    if (!existing) return;
    const now = Date.now();
    const card = existing.card ?? newCard();
    const updated: SavedWord = {
      ...existing,
      card,
      context: sentence || existing.context,
      bookHash: bookId || existing.bookHash,
      updatedAt: now,
    };
    await db.put("savedWords", updated);
  }).catch(() => {});
}

