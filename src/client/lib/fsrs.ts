import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type { Card, Grade };
export { Rating };

export function scheduleReview(card: Card | undefined, rating: Grade, now = new Date()) {
  const current: Card = card ?? createEmptyCard(now);
  return scheduler.next(current, now, rating).card;
}

export function isDue(card: Card | undefined, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}
