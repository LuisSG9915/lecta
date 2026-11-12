// Lectura y escritura del plan de cuenta (lecta_user_plan, migración 027).
// Los middlewares viven aparte (plan-middleware.ts) para que las pruebas
// puedan mockear `loadUserPlan` sin que la consulta pase por `withClient`.
import { effectivePlan, normalizePlan, type UserPlan } from "../shared/plan";
import type { CompanionCoatId } from "../shared/companion-data";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";

type QueryClient = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

export type UserPlanSnapshot = {
  plan: UserPlan;
  starterCoat: string | null;
  expiresAt: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** true si la tabla aún no existe (42P01): el plan es un fail-open. */
  degraded: boolean;
};

const DEGRADED: UserPlanSnapshot = {
  plan: "founder_lifetime",
  starterCoat: null,
  expiresAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  degraded: true,
};

const FREE: UserPlanSnapshot = {
  plan: "free",
  starterCoat: null,
  expiresAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  degraded: false,
};

const toStamp = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Plan efectivo de la cuenta. Sin fila → `free`. `lecta_plus` vencido más la
 * gracia → `free`. Sin tabla (42P01, worker desplegado antes que la 027) →
 * `founder_lifetime` con `degraded`. Cualquier otro error se propaga.
 * Dentro de una transacción ya abierta, `inTransaction` envuelve la lectura
 * en un SAVEPOINT: un 42P01 no debe abortar la transacción de quien llama.
 */
export async function getUserPlan(
  client: QueryClient,
  userId: string,
  opts: { inTransaction?: boolean; now?: number } = {},
): Promise<UserPlanSnapshot> {
  const sql =
    "SELECT plan, starter_coat, stripe_customer_id, stripe_subscription_id, plan_expires_at " +
    "FROM lecta_user_plan WHERE user_id = $1";
  if (opts.inTransaction) await client.query("SAVEPOINT lecta_plan_read");
  let res: { rows?: Array<Record<string, unknown>> };
  try {
    res = (await client.query(sql, [userId])) as typeof res;
    if (opts.inTransaction) await client.query("RELEASE SAVEPOINT lecta_plan_read");
  } catch (err) {
    if (opts.inTransaction) await client.query("ROLLBACK TO SAVEPOINT lecta_plan_read");
    if (isMissingTableError(err)) return { ...DEGRADED };
    throw err;
  }
  const row = res.rows?.[0];
  if (!row) return { ...FREE };
  const expiresAt = toStamp(row.plan_expires_at);
  return {
    plan: effectivePlan(normalizePlan(row.plan), expiresAt, opts.now ?? Date.now()),
    starterCoat: toText(row.starter_coat),
    expiresAt,
    stripeCustomerId: toText(row.stripe_customer_id),
    stripeSubscriptionId: toText(row.stripe_subscription_id),
    degraded: false,
  };
}

/**
 * Única puerta para middlewares y rutas. `undefined` si no hay cadena de
 * conexión (withClient no abre nada): quien llama responde 503.
 */
export async function loadUserPlan(
  env: WorkerEnv,
  userId: string,
): Promise<UserPlanSnapshot | undefined> {
  return withClient(env, (client) => getUserPlan(client, userId));
}

export type StarterCoatResult = "written" | "exists" | "unavailable";

/** Escribe el pelaje inicial una sola vez (solo si aún es NULL). */
export async function setStarterCoat(
  client: QueryClient,
  userId: string,
  coat: CompanionCoatId,
  now = Date.now(),
): Promise<StarterCoatResult> {
  try {
    const res = (await client.query(
      `INSERT INTO lecta_user_plan (user_id, plan, starter_coat, created_at, updated_at)
       VALUES ($1, 'free', $2, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET starter_coat = EXCLUDED.starter_coat,
         updated_at = EXCLUDED.updated_at
       WHERE lecta_user_plan.starter_coat IS NULL
       RETURNING starter_coat`,
      [userId, coat, now],
    )) as { rows?: unknown[] };
    return (res.rows?.length ?? 0) > 0 ? "written" : "exists";
  } catch (err) {
    if (isMissingTableError(err)) return "unavailable";
    throw err;
  }
}

export type StripePlanPatch = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planExpiresAt: number | null;
};

/**
 * Única escritura de plan desde Stripe: deja `lecta_plus` con su
 * vencimiento. Nunca rebaja a un `founder_lifetime`. El paso a `free` lo
 * decide solo `getUserPlan` con la gracia.
 */
export async function upsertPlanFromStripe(
  client: QueryClient,
  userId: string,
  patch: StripePlanPatch,
  now = Date.now(),
): Promise<void> {
  await client.query(
    `INSERT INTO lecta_user_plan
       (user_id, plan, stripe_customer_id, stripe_subscription_id, plan_expires_at, created_at, updated_at)
     VALUES ($1, 'lecta_plus', $2, $3, $4, $5, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       plan = CASE WHEN lecta_user_plan.plan = 'founder_lifetime'
                   THEN lecta_user_plan.plan ELSE 'lecta_plus' END,
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, lecta_user_plan.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, lecta_user_plan.stripe_subscription_id),
       plan_expires_at = EXCLUDED.plan_expires_at,
       updated_at = EXCLUDED.updated_at`,
    [
      userId,
      patch.stripeCustomerId ?? null,
      patch.stripeSubscriptionId ?? null,
      patch.planExpiresAt,
      now,
    ],
  );
}
