// Tope diario invisible de IA para Lecta+ y la prueba (F11,
// docs/designs/2026-11-25-monetizacion-lecta-plus.md): scope "ai-daily" en
// `lecta_ai_quota` con bucket de día (mismo día que la cortesía). Sin
// migración. Falla ABIERTA si la tabla falta: nunca bloquea a quien paga.
import { AI_DAILY_SCOPE, courtesyBucketHour } from "../shared/plan";
import { isMissingColumnError, isMissingTableError, type WorkerEnv } from "./db";
import { consumeRateUnits, refundRateUnits } from "./rate-limit";

export type DailyAiGuard =
  | { deny: { error: string }; refund: () => Promise<void> }
  | { deny?: undefined; refund: () => Promise<void> };

/**
 * Descuenta 1 del día. `limit` null (free) no hace nada. Si el diario
 * rechaza, devuelve la unidad por hora (`hourlyScope`) y `deny` con el
 * mismo texto del tope por hora. `refund` usa el mismo instante que el
 * consumo: cruzando la medianoche vuelve al bucket del día consumido.
 */
export async function guardDailyAi(
  env: WorkerEnv,
  userId: string,
  limit: number | null | undefined,
  hourlyScope: string,
  hourlyMessage: string,
  now = Date.now(),
): Promise<DailyAiGuard> {
  const noop = async () => undefined;
  if (limit == null) return { refund: noop };
  const bucket = courtesyBucketHour(now);
  let ok: boolean;
  try {
    ok = await consumeRateUnits(env, userId, 1, limit, AI_DAILY_SCOPE, bucket);
  } catch (err) {
    if (isMissingTableError(err) || isMissingColumnError(err)) return { refund: noop };
    throw err;
  }
  if (!ok) {
    await refundRateUnits(env, userId, 1, hourlyScope, Math.floor(now / 3_600_000));
    return { deny: { error: hourlyMessage }, refund: noop };
  }
  return { refund: () => refundRateUnits(env, userId, 1, AI_DAILY_SCOPE, bucket) };
}
