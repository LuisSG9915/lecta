import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from "ts-fsrs";
import { requestRetentionFor } from "./fsrs-light";

export {
  RETENTION_BY_HORIZON,
  RETENTION_HORIZON_KEY,
  hydrateRetentionHorizon,
  isDue,
  Rating,
  isReviewDueWord,
  loadRetentionHorizon,
  requestRetentionFor,
  saveRetentionHorizon,
  setActiveRetentionHorizon,
  type RetentionHorizon,
} from "./fsrs-light";

export type { Card, Grade };

const schedulers = new Map<number, ReturnType<typeof fsrs>>();

function schedulerFor(requestRetention: number): ReturnType<typeof fsrs> {
  const clamped = Number(Math.max(0.75, Math.min(0.97, requestRetention)).toFixed(2));
  let instance = schedulers.get(clamped);
  if (!instance) {
    instance = fsrs(generatorParameters({ enable_fuzz: true, request_retention: clamped }));
    schedulers.set(clamped, instance);
  }
  return instance;
}

function sanitizeCard(card: Card | undefined, now: Date): Card {
  if (!card || typeof card !== "object") return createEmptyCard(now);
  const empty = createEmptyCard(now);
  let stability =
    typeof card.stability === "number" && Number.isFinite(card.stability) && card.stability > 0
      ? card.stability
      : 0;
  let difficulty =
    typeof card.difficulty === "number" && Number.isFinite(card.difficulty) && card.difficulty > 0
      ? Math.min(10, Math.max(1, card.difficulty))
      : 0;
  // En FSRS un estado válido exige que stability y difficulty sean ambos > 0, o ambos 0 (tarjeta nueva).
  if (stability === 0 || difficulty === 0) {
    stability = 0;
    difficulty = 0;
  }
  const reps =
    typeof card.reps === "number" && Number.isInteger(card.reps) && card.reps >= 0
      ? card.reps
      : empty.reps;
  const lapses =
    typeof card.lapses === "number" && Number.isInteger(card.lapses) && card.lapses >= 0
      ? card.lapses
      : empty.lapses;
  const state =
    stability === 0 && difficulty === 0
      ? 0
      : typeof card.state === "number" && [0, 1, 2, 3].includes(card.state)
        ? card.state
        : 1;
  return {
    ...empty,
    ...card,
    stability,
    difficulty,
    reps,
    lapses,
    state,
  };
}

export function scheduleReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  options?: { requestRetention?: number },
): Card {
  const current: Card = sanitizeCard(card, now);
  const retention = options?.requestRetention ?? requestRetentionFor();
  return schedulerFor(retention).next(current, now, rating).card;
}

// Tarjeta nueva que vence de inmediato: la primera exposición guiada
// («Aprender») o la captura desde el lector la crea vacía, y la primera
// calificación real del lector es la que fija dificultad y estabilidad.
export function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export { scheduleCapturedReview } from "./reviews";
