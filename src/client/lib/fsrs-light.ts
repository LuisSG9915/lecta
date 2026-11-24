import type { Card, Grade, Rating as TsFsrsRating } from "ts-fsrs";
import { getActiveUserId, loadSessionValue, saveSessionValue, type DbScope } from "./idb";

// Copia de `Rating` de ts-fsrs: importar el enum real arrastraba toda la librería
// (61 kB) al arranque. fsrs.test.ts comprueba que los valores coinciden.
export const Rating = { Manual: 0, Again: 1, Hard: 2, Good: 3, Easy: 4 } as const satisfies Record<keyof typeof TsFsrsRating, number>;
export type Rating = TsFsrsRating;
export type { Card, Grade };

// Parte de fsrs.ts sin el planificador de ts-fsrs: lo que necesita el arranque
// (vencimiento y horizonte de retención) sin arrastrar la librería al bundle inicial.

// Horizonte declarado del lector: cuánta retención quiere conservar en
// cada repaso. Más exigencia acorta los intervalos; menos, los alarga.
export type RetentionHorizon = "relaxed" | "standard" | "intensive";

export const RETENTION_HORIZON_KEY = "lecta:retention_horizon:v1";

export const RETENTION_BY_HORIZON: Record<RetentionHorizon, number> = {
  relaxed: 0.85,
  standard: 0.9,
  intensive: 0.93,
};

// El ritmo pertenece a la cuenta: una entrada por usuario para que un
// repaso no programe con el ritmo de la cuenta anterior mientras la base
// acaba de cambiar. Sin sesión manda el lector anónimo.
let anonHorizon: RetentionHorizon = "standard";
const horizonsByUser = new Map<string, RetentionHorizon>();

const isRetentionHorizon = (value: unknown): value is RetentionHorizon =>
  value === "relaxed" || value === "standard" || value === "intensive";

export function loadRetentionHorizon(): RetentionHorizon {
  const owner = getActiveUserId();
  return owner ? (horizonsByUser.get(owner) ?? "standard") : anonHorizon;
}

export function setActiveRetentionHorizon(horizon: RetentionHorizon, userId?: string | null): void {
  const owner = userId === undefined ? getActiveUserId() : userId;
  if (owner) horizonsByUser.set(owner, horizon);
  else anonHorizon = horizon;
}

export async function saveRetentionHorizon(
  horizon: RetentionHorizon,
  scope?: DbScope,
): Promise<void> {
  setActiveRetentionHorizon(horizon, scope?.userId ?? undefined);
  await saveSessionValue(RETENTION_HORIZON_KEY, horizon, scope);
}

export async function hydrateRetentionHorizon(scope?: DbScope): Promise<void> {
  const raw = await loadSessionValue(RETENTION_HORIZON_KEY, scope).catch(() => null);
  setActiveRetentionHorizon(isRetentionHorizon(raw) ? raw : "standard", scope?.userId ?? undefined);
}

export function requestRetentionFor(
  horizon: RetentionHorizon = loadRetentionHorizon(),
): number {
  return RETENTION_BY_HORIZON[horizon] ?? RETENTION_BY_HORIZON.standard;
}

export function isDue(card: Card | undefined, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}

export function isReviewDueWord(
  word: { card?: Card; presentedAt?: number | null; deleted?: boolean },
  now = new Date(),
): boolean {
  if (word.deleted) return false;
  const hasBeenIntroduced = (word.card?.reps ?? 0) > 0 || (word.presentedAt ?? 0) > 0;
  return hasBeenIntroduced && isDue(word.card, now);
}
