import { withClient, type WorkerEnv } from "./db";

const HOUR_MS = 3_600_000;
const ENRICH_UNITS_PER_HOUR = 60;

// Cuota por (cuenta, alcance, hora natural). El incremento y la
// verificación del tope ocurren en una sola sentencia: dos peticiones
// simultáneas no pueden leer el mismo total y colarse las dos.
// RETURNING vacío = la fila no se insertó ni actualizó porque el
// límite ya estaba alcanzado.
export async function consumeRateUnits(
  env: WorkerEnv,
  userId: string,
  units: number,
  limit = ENRICH_UNITS_PER_HOUR,
  scope = "enrich",
  bucketOverride?: number,
): Promise<boolean> {
  return (await consumeRateUnitsAt(env, userId, units, limit, scope, bucketOverride)).ok;
}

/** Como `consumeRateUnits`, pero devuelve también el bucket usado, para reintegrar en el mismo. */
export async function consumeRateUnitsAt(
  env: WorkerEnv,
  userId: string,
  units: number,
  limit = ENRICH_UNITS_PER_HOUR,
  scope = "enrich",
  // Cuota con ventana propia (p. ej. el mes de la cortesía de IA): por
  // defecto la hora natural.
  bucketOverride?: number,
): Promise<{ ok: boolean; bucketHour: number }> {
  const now = Date.now();
  const bucketHour = bucketOverride ?? Math.floor(now / HOUR_MS);
  const result = await withClient(env, (client) =>
    client.query<{ units_used: number | string }>(
      `INSERT INTO lecta_ai_quota (user_id, scope, bucket_hour, units_used, updated_at)
       VALUES ($1, $5, $2, $3, $4)
       ON CONFLICT (user_id, scope, bucket_hour)
       DO UPDATE SET
         units_used = lecta_ai_quota.units_used + EXCLUDED.units_used,
         updated_at = EXCLUDED.updated_at
       WHERE lecta_ai_quota.units_used + EXCLUDED.units_used <= $6
       RETURNING units_used`,
      [userId, bucketHour, units, now, scope, limit],
    ),
  );
  return { ok: Boolean(result?.rows[0]), bucketHour };
}

/** Devuelve unidades al mismo bucket (best-effort, nunca baja de 0). */
export async function refundRateUnits(
  env: WorkerEnv,
  userId: string,
  units: number,
  scope: string,
  bucketHour: number,
): Promise<void> {
  try {
    await withClient(env, (client) =>
      client.query(
        `UPDATE lecta_ai_quota SET units_used = GREATEST(units_used - $4, 0), updated_at = $5
         WHERE user_id = $1 AND scope = $2 AND bucket_hour = $3`,
        [userId, scope, bucketHour, units, Date.now()],
      ),
    );
  } catch {
    // Un reintegro fallido solo cuesta una unidad al usuario.
  }
}
