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
