import {
  captureDbScope,
  saveReview,
  withDb,
  wordKey,
  type DbScope,
  type SavedReview,
  type SavedWord,
} from "./idb";
import { newCard, Rating, scheduleReview } from "./fsrs";
import { pushReviewsToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";
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
  options: { award?: boolean } = {},
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
  // Una declaración («Ya la sé») queda en el historial pero no paga XP ni cuenta como repaso.
  if (options.award !== false) {
    void award({ kind: "review", rating: input.rating }, bound, {
      id: `review:${saved.id}`,
      at: saved.createdAt,
      dayKey: localDayKey(saved.createdAt),
    });
  }
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

/**
 * Consolida en FSRS (Rating.Good) una palabra resuelta al cerrar un capítulo.
 * Si la palabra ya estaba en el Cuaderno, avanza su tarjeta; si provenía de una
 * consulta o preparación del capítulo, la incorpora al Cuaderno con su primer
 * repaso completado y registra un único evento de repaso (con su XP).
 */
export async function consolidateEpisodicWord(
  item: {
    lemma: string;
    surfaceForm?: string;
    lang?: string;
    shortGloss?: string;
    chapterSentence?: string;
    partOfSpeech?: string;
  },
  bookHash?: string,
  scope?: DbScope,
): Promise<SavedWord | null> {
  const bound = scope ?? captureDbScope();
  const language = (item.lang || "es").slice(0, 2).toLowerCase() || "es";
  const form = (item.surfaceForm || item.lemma || "").trim().toLowerCase();
  const lemma = (item.lemma || form).trim().toLowerCase();
  if (!form) return null;
  const now = new Date();
  const nowMs = now.getTime();

  const stored = await withDb(bound, async (db) => {
    const formK = wordKey(language, form);
    const lemmaK = wordKey(language, lemma);
    const existing =
      (await db.get("savedWords", formK)) ??
      (lemmaK !== formK ? await db.get("savedWords", lemmaK) : undefined);
    const nextCard = scheduleReview(
      existing && !existing.deleted ? existing.card : undefined,
      Rating.Good,
      now,
    );
    const updated: SavedWord = existing
      ? {
          ...existing,
          deleted: false,
          meaning: existing.meaning || item.shortGloss || undefined,
          context: existing.context || item.chapterSentence || undefined,
          pos: existing.pos ?? item.partOfSpeech ?? null,
          bookHash: existing.bookHash || bookHash,
          card: nextCard,
          updatedAt: nowMs,
        }
      : {
          key: formK,
          language,
          form,
          lemma,
          pos: item.partOfSpeech ?? null,
          meaning: item.shortGloss || undefined,
          context: item.chapterSentence || undefined,
          bookHash,
          card: nextCard,
          savedAt: nowMs,
          updatedAt: nowMs,
        };
    await db.put("savedWords", updated);
    return updated;
  }).catch(() => null);

  if (stored) {
    void pushWordsToServer([stored], bound);
  }
  await recordReview(
    {
      language,
      form,
      kind: "context",
      rating: "good",
      hints: 0,
    },
    bound,
  ).catch(() => undefined);
  return stored;
}

