import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type { Card, Grade };
export { Rating };

export type CaptureSource = "pre_reading" | "reader_tap" | "repeated_lookup";

export const CAPTURE_SOURCE_PARAMS: Record<
  CaptureSource,
  { difficulty: number; stability: number }
> = {
  pre_reading: { difficulty: 4.5, stability: 2.0 },
  reader_tap: { difficulty: 5.5, stability: 1.0 },
  repeated_lookup: { difficulty: 7.2, stability: 0.4 },
};

/**
 * Multiplicador episódico según la calificación FSRS cuando se consolida en contexto narrativo real:
 * - Easy (4): x1.35
 * - Good (3): x1.20
 * - Hard/Again (<=2): x1.00
 */
export function computeEpisodicMultiplier(rating: Grade): number {
  if (rating === Rating.Easy) return 1.35;
  if (rating === Rating.Good) return 1.20;
  return 1.0;
}

export function scheduleReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  options?: { episodicMultiplier?: number },
) {
  const current: Card = card ?? createEmptyCard(now);
  const nextCard = scheduler.next(current, now, rating).card;
  if (options?.episodicMultiplier && options.episodicMultiplier > 1 && rating >= Rating.Good) {
    nextCard.stability = Number((nextCard.stability * options.episodicMultiplier).toFixed(4));
  }
  return nextCard;
}

export function scheduleEpisodicReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  customMultiplier?: number,
): Card {
  const multiplier = customMultiplier ?? computeEpisodicMultiplier(rating);
  return scheduleReview(card, rating, now, { episodicMultiplier: multiplier });
}

export function newCardWithSource(
  source: CaptureSource,
  now = new Date(),
): Card {
  const card = createEmptyCard(now);
  const params = CAPTURE_SOURCE_PARAMS[source];
  if (params) {
    card.difficulty = params.difficulty;
    card.stability = params.stability;
  }
  return card;
}

// Tarjeta nueva que vence de inmediato: la primera exposición guiada
// («Aprender») o la captura desde el lector la crea con parámetros iniciales
// adaptados al origen de la captura (pre_reading, reader_tap, repeated_lookup).
export function newCard(now = new Date(), source?: CaptureSource): Card {
  if (source) {
    return newCardWithSource(source, now);
  }
  return createEmptyCard(now);
}

export function isDue(card: Card | undefined, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}
