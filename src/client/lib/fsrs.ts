import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import { loadSessionValue, saveSessionValue, type DbScope } from "./idb";

export type { Card, Grade };
export { Rating };

// Horizonte declarado del lector: cuánta retención quiere conservar en
// cada repaso. Más exigencia acorta los intervalos; menos, los alarga.
export type RetentionHorizon = "relaxed" | "standard" | "intensive";

export const RETENTION_HORIZON_KEY = "lecta:retention_horizon:v1";

export const RETENTION_BY_HORIZON: Record<RetentionHorizon, number> = {
  relaxed: 0.85,
  standard: 0.9,
  intensive: 0.93,
};

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

let activeRetentionHorizon: RetentionHorizon = "standard";

const isRetentionHorizon = (value: unknown): value is RetentionHorizon =>
  value === "relaxed" || value === "standard" || value === "intensive";

export function loadRetentionHorizon(): RetentionHorizon {
  return activeRetentionHorizon;
}

export function setActiveRetentionHorizon(horizon: RetentionHorizon): void {
  activeRetentionHorizon = horizon;
}

export async function saveRetentionHorizon(
  horizon: RetentionHorizon,
  scope?: DbScope,
): Promise<void> {
  setActiveRetentionHorizon(horizon);
  await saveSessionValue(RETENTION_HORIZON_KEY, horizon, scope);
}

export async function hydrateRetentionHorizon(scope?: DbScope): Promise<void> {
  try {
    const raw = await loadSessionValue(RETENTION_HORIZON_KEY, scope);
    setActiveRetentionHorizon(isRetentionHorizon(raw) ? raw : "standard");
  } catch {
    setActiveRetentionHorizon("standard");
  }
}

export function requestRetentionFor(
  horizon: RetentionHorizon = loadRetentionHorizon(),
): number {
  return RETENTION_BY_HORIZON[horizon] ?? RETENTION_BY_HORIZON.standard;
}

export function scheduleReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  options?: { requestRetention?: number },
): Card {
  const current: Card = card ?? createEmptyCard(now);
  const retention = options?.requestRetention ?? requestRetentionFor();
  return schedulerFor(retention).next(current, now, rating).card;
}

// Tarjeta nueva que vence de inmediato: la primera exposición guiada
// («Aprender») o la captura desde el lector la crea vacía, y la primera
// calificación real del lector es la que fija dificultad y estabilidad.
export function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export function isDue(card: Card | undefined, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}

export { scheduleCapturedReview } from "./reviews";
