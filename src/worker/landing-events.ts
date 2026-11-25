// Embudo de la landing (/inicio/): contadores por día, evento y fuente
// (migración 028). Mismo trato que los errores de cliente:
// - **Sin sesión, sin cookies, sin IP guardada.** Solo se suma `hits`.
// - **Allowlist estricta** de eventos; cualquier otra cosa se descarta en
//   silencio y el endpoint responde 204 igual.
// - **Tope por isolate** por IP, para que un bucle no escriba sin freno.
// - `signup` no entra por el endpoint: lo escribe el worker cuando una cuenta
//   reclama por primera vez el gato elegido en la landing.

import { isPlanFeature } from "../shared/plan";
import { withClient, type WorkerEnv } from "./db";

export const LANDING_EVENT_MAX_BODY_BYTES = 512;
export const LANDING_EVENT_LIMIT_PER_MINUTE = 60;
export const LANDING_SOURCE_MAX = 32;
export const LANDING_KEEP_DAYS = 90;

/** Eventos que acepta `POST /api/landing-events`. */
export const LANDING_EVENTS = new Set([
  "view",
  "cta:nav",
  "cta:hero",
  "cta:picker",
  "cta:plan-free",
  "cta:plan-plus",
  "cta:close",
  "cta:sticky",
  "cta:try-es",
  "cta:try-en",
  "demo_open",
  "demo_save",
  "demo_reveal",
  "pick_cat",
  "price_toggle",
  "app:paywall",
  "app:carne-open",
  "app:trial-end-view",
  "app:trial-end-cta",
  "app:recap-locked",
]);

/** Días de aviso de la prueba inversa (`app:trial-warning:<dia>`). */
export const TRIAL_WARNING_DAYS = ["1", "2", "3"] as const;

/** Estático o con sufijo validado contra una lista cerrada; nunca texto libre. */
export function isAllowedLandingEvent(event: string): boolean {
  if (LANDING_EVENTS.has(event)) return true;
  if (event.startsWith("app:plannote:")) return isPlanFeature(event.slice("app:plannote:".length));
  if (event.startsWith("app:trial-warning:")) {
    return (TRIAL_WARNING_DAYS as readonly string[]).includes(event.slice("app:trial-warning:".length));
  }
  return false;
}

export type LandingEvent = { event: string; source: string };

/**
 * `utm_source` o dominio de referencia ⇒ etiqueta corta y estable.
 * Minúsculas, solo `[a-z0-9._-]`, sin `www.`; vacío o inválido ⇒ `direct`.
 */
export function normalizeLandingSource(raw: unknown): string {
  if (typeof raw !== "string") return "direct";
  const value = raw.trim().toLowerCase().replace(/^www\./, "");
  if (!value || value.length > LANDING_SOURCE_MAX) return "direct";
  if (!/^[a-z0-9._-]+$/.test(value)) return "direct";
  return value;
}

/** Valida el cuerpo; `null` = descartar en silencio. */
export function parseLandingEvent(raw: unknown): LandingEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "event" && key !== "source") return null;
  }
  if (typeof input.event !== "string" || !isAllowedLandingEvent(input.event)) return null;
  return { event: input.event, source: normalizeLandingSource(input.source) };
}

const minuteBuckets = new Map<string, { window: number; count: number }>();
const MAX_TRACKED_CLIENTS = 5_000;

/** Ventana fija de 1 minuto por IP. Freno a escrituras, no seguridad. */
export function allowLandingEvent(ip: string, now: number): boolean {
  const window = Math.floor(now / 60_000);
  let bucket = minuteBuckets.get(ip);
  if (!bucket || bucket.window !== window) {
    if (!bucket && minuteBuckets.size >= MAX_TRACKED_CLIENTS) minuteBuckets.clear();
    bucket = { window, count: 0 };
  }
  bucket.count += 1;
  minuteBuckets.set(ip, bucket);
  return bucket.count <= LANDING_EVENT_LIMIT_PER_MINUTE;
}

/** Solo para pruebas. */
export function resetLandingLimiter(): void {
  minuteBuckets.clear();
}

/** Suma 1 a la fila del día. Sin base o sin tabla devuelve `false`. */
export async function recordLandingEvent(
  env: WorkerEnv,
  input: LandingEvent,
  now: Date = new Date(),
): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const written = await withClient(env, async (client) => {
    await client.query(
      `INSERT INTO lecta_landing_daily (bucket_day, event, source, hits)
       VALUES ($1::DATE, $2, $3, 1)
       ON CONFLICT (bucket_day, event, source) DO UPDATE SET
         hits = lecta_landing_daily.hits + 1`,
      [day, input.event, input.source],
    );
    return true;
  });
  return written === true;
}

/** Retención. Lo llama el cron diario. */
export async function purgeLandingEvents(
  env: WorkerEnv,
  keepDays: number = LANDING_KEEP_DAYS,
): Promise<number> {
  const deleted = await withClient(env, async (client) => {
    const result = await client.query(
      `DELETE FROM lecta_landing_daily WHERE bucket_day < current_date - $1::INT8`,
      [Math.max(1, Math.trunc(keepDays))],
    );
    return result.rowCount ?? 0;
  });
  return deleted ?? 0;
}
