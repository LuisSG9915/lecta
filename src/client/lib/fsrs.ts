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

export function scheduleReview(card: Card | undefined, rating: Grade, now = new Date()) {
  const current: Card = card ?? createEmptyCard(now);
  return scheduler.next(current, now, rating).card;
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
