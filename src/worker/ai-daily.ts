// Tope diario invisible de IA para Lecta+ y la prueba (F11,
// docs/designs/2026-11-25-monetizacion-lecta-plus.md): scope "ai-daily" en
// `lecta_ai_quota` con bucket de día (mismo día que la cortesía). Sin
// migración. Falla ABIERTA si la tabla falta: nunca bloquea a quien paga.
import { AI_DAILY_SCOPE, courtesyBucketHour } from "../shared/plan";
import { isMissingColumnError, isMissingTableError, type WorkerEnv } from "./db";
import { consumeRateUnits, refundRateUnits } from "./rate-limit";

export const DAILY_AI_LIMIT_MESSAGE = "Por hoy llegaste al tope de uso de IA. Vuelve mañana.";

export type DailyAiGuard =
  | { deny: { error: string }; refund: () => Promise<void> }
  | { deny?: undefined; refund: () => Promise<void> };

/**
 * Descuenta 1 del día. `limit` null (free) no hace nada. Si el diario
 * rechaza, devuelve la unidad por hora (`hourlyScope`) y `deny` con
 * `DAILY_AI_LIMIT_MESSAGE` (texto propio, sin hablar de planes). `refund` usa el mismo instante que el
 * consumo: cruzando la medianoche vuelve al bucket del día consumido.
 */
export async function guardDailyAi(
  env: WorkerEnv,
  userId: string,
  limit: number | null | undefined,
  hourlyScope: string,
  opts: {
    now?: number;
    // Bucket por hora que usó el consumo previo (`consumeRateUnitsAt`); sin él se recalcula.
    hourlyBucket?: number;
  } = {},
): Promise<DailyAiGuard> {
  const { now = Date.now(), hourlyBucket } = opts;
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
    await refundRateUnits(env, userId, 1, hourlyScope, hourlyBucket ?? Math.floor(now / 3_600_000));
    return { deny: { error: DAILY_AI_LIMIT_MESSAGE }, refund: noop };
  }
  return { refund: () => refundRateUnits(env, userId, 1, AI_DAILY_SCOPE, bucket) };
}
