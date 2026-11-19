// Cortesía de IA para cuentas free (decisión cerrada 2026-11): 5 consultas al
// mes calendario UTC, contadas en `lecta_ai_quota` con scope "free-courtesy"
// y un bucket_hour fijo por mes. Sin migración. Falla CERRADA: si la tabla o
// una columna faltan (42P01/42703) o no hay base, quedan 0 restantes.
import {
  FREE_AI_COURTESY_LIMIT,
  FREE_AI_COURTESY_SCOPE,
  courtesyBucketHour,
  freeAiRemaining,
} from "../shared/plan";
import { isMissingColumnError, isMissingTableError, withClient, type WorkerEnv } from "./db";
import { consumeRateUnits } from "./rate-limit";

const isMissing = (err: unknown) => isMissingTableError(err) || isMissingColumnError(err);

/**
 * Descuenta 1 de forma atómica. `true` = consumida; `false` = agotada, sin
 * base o sin tabla (cerrada). Otros errores se propagan.
 */
export async function consumeFreeAiCourtesy(
  env: WorkerEnv,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  try {
    return await consumeRateUnits(
      env,
      userId,
      1,
      FREE_AI_COURTESY_LIMIT,
      FREE_AI_COURTESY_SCOPE,
      courtesyBucketHour(now),
    );
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

/** Devuelve el uso (la IA falló): best-effort, nunca baja de 0. */
export async function refundFreeAiCourtesy(
  env: WorkerEnv,
  userId: string,
  now = Date.now(),
): Promise<void> {
  try {
    await withClient(env, (client) =>
      client.query(
        `UPDATE lecta_ai_quota SET units_used = GREATEST(units_used - 1, 0), updated_at = $4
         WHERE user_id = $1 AND scope = $2 AND bucket_hour = $3`,
        [userId, FREE_AI_COURTESY_SCOPE, courtesyBucketHour(now), now],
      ),
    );
  } catch {
    // Un reintegro fallido solo cuesta una cortesía al usuario.
  }
}

type QueryClient = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Restantes este mes con un cliente ya abierto; sin tabla → 0 (cerrada). */
export async function readFreeAiRemaining(
  client: QueryClient,
  userId: string,
  now = Date.now(),
): Promise<number> {
  try {
    const res = (await client.query(
      "SELECT units_used FROM lecta_ai_quota WHERE user_id = $1 AND scope = $2 AND bucket_hour = $3",
      [userId, FREE_AI_COURTESY_SCOPE, courtesyBucketHour(now)],
    )) as { rows?: Array<{ units_used?: unknown }> };
    const used = res.rows?.[0]?.units_used;
    return freeAiRemaining(used === undefined ? 0 : Number(used));
  } catch (err) {
    if (isMissing(err)) return 0;
    throw err;
  }
}
