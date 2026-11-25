// Planes de cuenta (docs/designs/2026-11-12-planes-y-landing.md). Regla
// compartida por cliente y worker: qué plan desbloquea Lecta+ y qué pelaje
// vale como pelaje inicial.
import { COMPANION_COAT_IDS, type CompanionCoatId } from "./companion-data";

export type UserPlan = "free" | "lecta_plus" | "founder_lifetime";

export const USER_PLANS: readonly UserPlan[] = ["free", "lecta_plus", "founder_lifetime"];

/** Gracia tras `plan_expires_at` antes de volver a `free` (pagos reintentados). */
export const PLAN_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function hasLectaPlus(plan: UserPlan | null | undefined): boolean {
  return plan === "lecta_plus" || plan === "founder_lifetime";
}

/** Cualquier valor desconocido cae a `free`: nunca se regala Lecta+ por error. */
export function normalizePlan(value: unknown): UserPlan {
  return USER_PLANS.includes(value as UserPlan) ? (value as UserPlan) : "free";
}

export function isStarterCoat(value: unknown): value is CompanionCoatId {
  return typeof value === "string" && COMPANION_COAT_IDS.includes(value as CompanionCoatId);
}

/**
 * Plan efectivo a una fecha: `lecta_plus` vencido (más la gracia) es `free`.
 * `founder_lifetime` no vence.
 */
export function effectivePlan(
  plan: UserPlan,
  expiresAt: number | null | undefined,
  now: number,
): UserPlan {
  if (plan !== "lecta_plus") return plan;
  if (expiresAt == null || !Number.isFinite(expiresAt)) return plan;
  return expiresAt + PLAN_GRACE_MS < now ? "free" : plan;
}

/**
 * Prueba inversa (docs/designs/2026-11-24-prueba-inversa-y-cortesia-diaria.md):
 * una cuenta free tiene Lecta+ los primeros 14 días, contados desde el alta o
 * desde el lanzamiento si la cuenta es anterior. Sin gracia ni tarjeta.
 */
export const REVERSE_TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
export const REVERSE_TRIAL_START = Date.UTC(2026, 10, 25);

/** Fin de la prueba inversa para una fecha de alta (ms); null sin fecha válida. */
export function reverseTrialEndsAt(createdAt: number | null | undefined): number | null {
  if (createdAt == null || !Number.isFinite(createdAt)) return null;
  return Math.max(createdAt, REVERSE_TRIAL_START) + REVERSE_TRIAL_MS;
}

/** Consultas de IA de cortesía al día (UTC) para cuentas free. */
export const FREE_AI_COURTESY_LIMIT = 3;

/** Alcance en `lecta_ai_quota` donde se cuenta la cortesía (sin migración). */
export const FREE_AI_COURTESY_SCOPE = "free-courtesy";

const HOUR_MS = 3_600_000;

/**
 * `bucket_hour` fijo del día UTC de `now`: el inicio del día expresado en
 * horas desde la época (la unidad que usa `lecta_ai_quota`). Todas las
 * consultas del día comparten fila; las 00:00 UTC arrancan otra.
 */
export function courtesyBucketHour(now: number): number {
  return Math.floor(now / (24 * HOUR_MS)) * 24;
}

/** Cortesías que quedan dado lo usado hoy (nunca negativo). */
export function freeAiRemaining(used: number): number {
  const n = Number.isFinite(used) ? Math.floor(used) : FREE_AI_COURTESY_LIMIT;
  return Math.max(0, FREE_AI_COURTESY_LIMIT - Math.max(0, n));
}
