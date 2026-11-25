// API REST de Stripe sin SDK (docs/designs/2026-11-12-planes-y-landing.md).
// Módulo sin dependencias de sesión: lo usan billing.ts y auth.ts (borrado de
// cuenta) sin crear un ciclo auth → billing → session → auth.
import type { WorkerEnv } from "./db";
import { loadUserPlan } from "./plan-store";

export const STRIPE_API = "https://api.stripe.com/v1";
export const STRIPE_VERSION = "2025-03-31.basil";

// ---------- Llamadas a la API REST de Stripe ----------

export async function stripeRequest(
  env: WorkerEnv,
  method: "GET" | "POST" | "DELETE",
  path: string,
  form?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY ?? ""}`,
      "stripe-version": STRIPE_VERSION,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

/**
 * Cancela la suscripción al borrar la cuenta. Cuenta como éxito si Stripe ya
 * no la tiene (404 / resource_missing) o si ya estaba cancelada; lanza ante
 * cualquier otro error para abortar el borrado.
 */
export async function cancelSubscriptionForDeletion(
  env: WorkerEnv,
  subscriptionId: string,
): Promise<void> {
  const result = await stripeRequest(env, "DELETE", `/subscriptions/${subscriptionId}`);
  if (result.ok) return;
  const error = (result.body.error ?? {}) as { code?: string; message?: string };
  const alreadyGone =
    result.status === 404 ||
    error.code === "resource_missing" ||
    /canceled/i.test(error.message ?? "");
  if (alreadyGone) return;
  throw new Error("No se pudo cancelar tu suscripción. Inténtalo de nuevo antes de eliminar la cuenta.");
}

/**
 * Antes de borrar la cuenta: cancela la suscripción de Stripe si existe. Se
 * omite sin suscripción o si el plan efectivo ya es free con el periodo
 * vencido. Lanza (y aborta el borrado) solo ante un error real de Stripe.
 */
export async function cancelBillingForDeletion(
  env: WorkerEnv,
  userId: string,
  nowMs = Date.now(),
): Promise<void> {
  const plan = await loadUserPlan(env, userId);
  if (!plan?.stripeSubscriptionId) return;
  // Periodo vencido: la fila ya es free (en prueba inversa sale lecta_plus
  // con trialEndsAt, pero la suscripción igual terminó).
  const lapsed = plan.plan === "free" || plan.trialEndsAt !== null;
  if (lapsed && plan.expiresAt !== null && plan.expiresAt < nowMs) return;
  await cancelSubscriptionForDeletion(env, plan.stripeSubscriptionId);
}
