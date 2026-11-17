import {
  captureDbScope,
  knowledgeKey,
  saveReview,
  withDb,
  wordKey,
  type DbScope,
  type SavedReview,
  type SavedWord,
} from "./idb";
import { isReviewDueWord, newCard, Rating, scheduleReview } from "./fsrs";
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
    id?: string;
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
      id: input.id,
      language: input.language,
      form: input.form,
      kind: input.kind,
      rating: input.rating,
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

/** Resultado del reto: lo que el lector hizo antes de acertar. */
export type EpisodicOutcome = { errorCount?: number; usedHint?: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nota FSRS de un reto de cierre o micro-cloze. Elegir entre opciones
 * vale lo mismo que en el Cuaderno (`Hard`); cualquier error o pista es
 * un fallo (`Again`). Nunca `Good`: el ejercicio deja reintentar.
 */
export function episodicRating(outcome?: EpisodicOutcome): typeof Rating.Again | typeof Rating.Hard {
  const failed = (outcome?.errorCount ?? 0) > 0 || outcome?.usedHint === true;
  return failed ? Rating.Again : Rating.Hard;
}

/**
 * Registra en FSRS un reto resuelto al cerrar un capítulo (o el micro-cloze).
 *
 * - Palabra ya presentada y vencida (`isReviewDueWord`): se califica con
 *   `episodicRating`.
 * - Palabra sin repasos que aún no tocaba (nueva o recién consultada): el
 *   reto es codificación, no repaso. Se crea o conserva la tarjeta sin
 *   calificar, se marca como presentada y su primera recuperación queda
 *   para mañana.
 * - Palabra con repasos y no vencida: un fallo sí se registra (`Again`); un
 *   acierto no toca la tarjeta, porque adelantar el repaso no es espaciar.
 *
 * Solo deja evento de repaso (y su XP) cuando la tarjeta se calificó.
 *
 * Nunca revive una palabra que el lector quitó, ni da de alta una que
 * declaró conocida («Ya la sé») o que solo vio en la hoja de preparación
 * (`pre-chapter-primed`): el alta al Cuaderno necesita una consulta. La
 * palabra se busca por forma y, si no, por lema entre las guardadas, así
 * que otra flexión avanza la tarjeta que ya existe.
 */
export async function consolidateEpisodicWord(
  item: {
    lemma: string;
    surfaceForm?: string;
    lang?: string;
    shortGloss?: string;
    chapterSentence?: string;
    partOfSpeech?: string;
    source?: "pre-chapter-primed" | "in-chapter-lookup" | "notebook-reencounter";
  },
  bookHash?: string,
  scope?: DbScope,
  outcome?: EpisodicOutcome,
): Promise<SavedWord | null> {
  const bound = scope ?? captureDbScope();
  const language = (item.lang || "es").slice(0, 2).toLowerCase() || "es";
  const form = (item.surfaceForm || item.lemma || "").trim().toLowerCase();
  const lemma = (item.lemma || form).trim().toLowerCase();
  if (!form) return null;
  const now = new Date();
  const nowMs = now.getTime();
  const rating = episodicRating(outcome);
  let graded = false;

  const stored = await withDb(bound, async (db) => {
    const formK = wordKey(language, form);
    const lemmaK = wordKey(language, lemma);
    const byKey =
      (await db.get("savedWords", formK)) ??
      (lemmaK !== formK ? await db.get("savedWords", lemmaK) : undefined);
    if (byKey?.deleted) return null;
    const existing =
      byKey ??
      (await db.getAll("savedWords")).find(
        (w) => !w.deleted && w.language === language && (w.lemma || w.form) === lemma,
      );
    if (!existing) {
      if (item.source === "pre-chapter-primed") return null;
      const declared = await db.get("knowledge", knowledgeKey(language, lemma));
      if (declared && !declared.deleted && declared.known) return null;
    }
    const active = existing;
    const reps = active?.card?.reps ?? 0;
    let nextCard: SavedWord["card"];
    if ((active && isReviewDueWord(active, now)) || (reps > 0 && rating === Rating.Again)) {
      nextCard = scheduleReview(active?.card, rating, now);
      graded = true;
    } else if (reps === 0) {
      const tomorrow = new Date(nowMs + DAY_MS);
      const base = active?.card ?? newCard(now);
      const due = new Date(base.due).getTime() > tomorrow.getTime() ? base.due : tomorrow;
      nextCard = { ...base, due };
    } else {
      return active ?? null;
    }
    const updated: SavedWord = existing
      ? {
          ...existing,
          meaning: existing.meaning || item.shortGloss || undefined,
          context: existing.context || item.chapterSentence || undefined,
          pos: existing.pos ?? item.partOfSpeech ?? null,
          bookHash: existing.bookHash || bookHash,
          presentedAt: existing.presentedAt ?? nowMs,
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
          presentedAt: nowMs,
          card: nextCard,
          savedAt: nowMs,
          updatedAt: nowMs,
        };
    await db.put("savedWords", updated);
    return updated;
  }).catch(() => null);

  if (stored && stored.updatedAt === nowMs) {
    void pushWordsToServer([stored], bound);
  }
  if (graded) {
    await recordReview(
      {
        language,
        form,
        kind: "context",
        rating: rating === Rating.Again ? "again" : "hard",
        hints: outcome?.usedHint ? 1 : 0,
      },
      bound,
    ).catch(() => undefined);
  }
  return stored;
}


/**
 * Reconsultar en el libro una palabra que ya pasó por repaso dice «no la
 * recordé»: FSRS registra `Again` (sin XP), como mucho una vez al día por
 * palabra. Si hoy ya hubo un repaso de esa tarjeta, no se castiga de nuevo.
 * Devuelve la palabra actualizada o null si no correspondía.
 */
export async function recordLookupLapse(
  word: SavedWord,
  scope?: DbScope,
  now = new Date(),
): Promise<SavedWord | null> {
  if (word.deleted || (word.card?.reps ?? 0) <= 0 || !word.card) return null;
  const today = localDayKey(now.getTime());
  const last = word.card.last_review ? new Date(word.card.last_review).getTime() : 0;
  if (last && localDayKey(last) === today) return null;
  const bound = scope ?? captureDbScope();
  const card = scheduleReview(word.card, Rating.Again, now);
  const stored = await withDb(bound, async (db) => {
    const current = await db.get("savedWords", word.key);
    if (!current || current.deleted) return null;
    const updated: SavedWord = { ...current, card, updatedAt: now.getTime() };
    await db.put("savedWords", updated);
    return updated;
  }).catch(() => null);
  if (!stored) return null;
  void pushWordsToServer([stored], bound);
  await recordReview(
    { language: stored.language, form: stored.form, kind: "context", rating: "again", hints: 0 },
    bound,
    { award: false },
  ).catch(() => undefined);
  return stored;
}

// Reencuentro pasivo: la palabra guardada apareció en el texto que se está
// leyendo y no fue consultada. Se anota como repaso «reencounter» (sin XP ni
// grado FSRS) para que cuente como exposición. Dedup por id: una sola vez
// por palabra y día local; los reintentos del mismo día son no-op.
export async function recordPassiveReencounter(
  word: SavedWord,
  scope?: DbScope,
  now = new Date(),
): Promise<SavedReview | null> {
  if (word.deleted) return null;
  if ((word.card?.reps ?? 0) <= 0 && !(word.presentedAt ?? 0)) return null;
  const bound = scope ?? captureDbScope();
  const day = localDayKey(now.getTime());
  const id = `reencounter:${word.language}:${word.form.toLowerCase()}:${day}`;
  const existing = await withDb(bound, (db) => db.get("reviews", id)).catch(() => null);
  if (existing) return existing as SavedReview;
  const saved = await recordReview(
    { id, language: word.language, form: word.form, kind: "reencounter", rating: "known", hints: 0 },
    bound,
    { award: false },
  ).catch(() => null);
  return saved ?? null;
}
