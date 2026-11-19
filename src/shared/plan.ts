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

/** Consultas de IA de cortesía al mes (calendario UTC) para cuentas free. */
export const FREE_AI_COURTESY_LIMIT = 5;

/** Alcance en `lecta_ai_quota` donde se cuenta la cortesía (sin migración). */
export const FREE_AI_COURTESY_SCOPE = "free-courtesy";

const HOUR_MS = 3_600_000;

/**
 * `bucket_hour` fijo del mes UTC de `now`: el inicio del mes expresado en
 * horas desde la época (la unidad que usa `lecta_ai_quota`). Todas las
 * consultas del mes comparten fila; el 1.º a 00:00 UTC arranca otra.
 */
export function courtesyBucketHour(now: number): number {
  const d = new Date(now);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / HOUR_MS);
}

/** Cortesías que quedan dado lo usado este mes (nunca negativo). */
export function freeAiRemaining(used: number): number {
  const n = Number.isFinite(used) ? Math.floor(used) : FREE_AI_COURTESY_LIMIT;
  return Math.max(0, FREE_AI_COURTESY_LIMIT - Math.max(0, n));
}
