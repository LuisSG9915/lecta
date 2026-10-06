import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type { Card, Grade };
export { Rating };

export function scheduleReview(card: Card | undefined, rating: Grade, now = new Date()) {
  const current: Card = card ?? createEmptyCard(now);
  return scheduler.next(current, now, rating).card;
}

// Tarjeta nueva que vence de inmediato: la primera exposición guiada
// («Aprender») la crea así para que la palabra entre a la cola de
// repaso sin inventar una calificación.
export function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export function isDue(card: Card | undefined, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}
