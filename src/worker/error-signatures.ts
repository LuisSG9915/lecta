// Errores agrupados por huella (migración 018).
//
// Objetivo: convertir «un montón de líneas en Workers Logs» en «esta firma
// falló 412 veces en v0.2.6, la última a las 03:12». Tres piezas:
//
// 1. `fingerprint` — SHA-256 truncado de `name|code|ruta_normalizada|frame0`.
//    La ruta se normaliza antes de hashear (`/reader/book-98123` ⇒ `/reader/:id`)
//    para que el mismo bug no se fragmente por libro o capítulo.
// 2. `recordErrorSignature` — UPSERT que suma `hits` sobre la fila del día:
//    una fila por (día, firma), no por evento. El techo lo pone el rate limit
//    por isolate (30/min) de `client-errors.ts`.
// 3. `listErrorSignatures` / `purgeErrorSignatures` / `collectErrorDigest` —
//    lo que consume el apartado de Diagnóstico y el cron de las 05:00.
//
// Además guarda, para depurar, una muestra corta de los 3 primeros frames y el
// último mensaje (este solo si el usuario activó «incluir mensaje del error»:
// puede contener texto del libro que estaba leyendo).

import { withClient, type WorkerEnv } from "./db";
import { normalizeRouteForSignature } from "./client-errors";

/** Días que se conservan en la tabla antes de que el cron los borre. */
export const ERROR_SIGNATURE_KEEP_DAYS = 30;
/** Ventana máxima que se puede pedir desde Diagnóstico. */
export const ERROR_SIGNATURE_MAX_DAYS = 30;
/** Caracteres de la muestra de frames (`a.js:1:2 -> b.js:3:4`). */
export const ERROR_SAMPLE_MAX = 200;
/** Mensaje máximo guardado junto a la firma. */
export const ERROR_MESSAGE_MAX = 200;
/** Mínimo de repeticiones para que el digest avise de una firma. */
export const ERROR_DIGEST_MIN_HITS = 5;

export interface ErrorSignatureInput {
  name: string;
  code: string;
  route: string;
  version: string;
  /** Frames limpios (`archivo.js:línea:columna`), de más cercano a más lejano. */
  frames?: string[];
  /** Solo si el usuario lo autorizó en Diagnóstico. */
  message?: string;
}

export interface ErrorSignatureRow {
  signature: string;
  day: string;
  route: string;
  name: string;
  code: string;
  version: string;
  hits: number;
  sampleFrames: string;
  lastMessage: string | null;
  firstSeen: string;
  lastSeen: string;
}

function shortHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 truncado a 16 hex: estable entre despliegues, corto para la UI. */
export async function fingerprint(input: ErrorSignatureInput): Promise<string> {
  const route = normalizeRouteForSignature(input.route);
  const seed = [input.name, input.code, route, input.frames?.[0] ?? ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return shortHex(new Uint8Array(digest).slice(0, 8));
}

function sampleFrames(frames?: string[]): string {
  if (!frames || frames.length === 0) return "";
  return frames.slice(0, 3).join(" -> ").slice(0, ERROR_SAMPLE_MAX);
}

/**
 * Suma un fallo a la fila de hoy. Devuelve si se escribió algo: sin conexión
 * a la base devuelve `false` y el llamador no puede romperse por eso.
 */
export async function recordErrorSignature(
  env: WorkerEnv,
  input: ErrorSignatureInput,
  now: Date = new Date(),
): Promise<boolean> {
  const signature = await fingerprint(input);
  const day = now.toISOString().slice(0, 10);
  const frames = sampleFrames(input.frames);
  const message = input.message ? input.message.slice(0, ERROR_MESSAGE_MAX) : null;

  const written = await withClient(env, async (client) => {
    await client.query(
      `INSERT INTO lecta_error_signatures
         (bucket_day, signature, route, name, code, version, hits,
          sample_frames, last_message, first_seen, last_seen)
       VALUES ($1::DATE, $2, $3, $4, $5, $6, 1, $7, $8, now(), now())
       ON CONFLICT (bucket_day, signature) DO UPDATE SET
         hits          = lecta_error_signatures.hits + 1,
         last_seen     = now(),
         version       = excluded.version,
         route         = excluded.route,
         sample_frames = COALESCE(
           NULLIF(excluded.sample_frames, ''),
           lecta_error_signatures.sample_frames
         ),
         last_message  = COALESCE(excluded.last_message, lecta_error_signatures.last_message)`,
      [
        day,
        signature,
        normalizeRouteForSignature(input.route),
        input.name,
        input.code,
        input.version,
        frames,
        message,
      ],
    );
    return true;
  });

  return written === true;
}

/**
 * Firmas de los últimos `days` días, de la más repetida a la menos.
 * Agrupa por firma: una incidencia es una fila aunque viva en varios días.
 */
export async function listErrorSignatures(
  env: WorkerEnv,
  days: number = 7,
): Promise<ErrorSignatureRow[]> {
  const window = Math.min(
    Math.max(Number.isFinite(days) ? Math.trunc(days) : 7, 1),
    ERROR_SIGNATURE_MAX_DAYS,
  );

  const rows = await withClient(env, async (client) => {
    const result = await client.query(
      `SELECT signature,
              max(bucket_day)::STRING  AS day,
              max(route)               AS route,
              max(name)                AS name,
              max(code)                AS code,
              max(version)             AS version,
              sum(hits)::INT8          AS hits,
              max(sample_frames)       AS sample_frames,
              max(last_message)        AS last_message,
              min(first_seen)::STRING  AS first_seen,
              max(last_seen)::STRING   AS last_seen
         FROM lecta_error_signatures
        WHERE bucket_day >= current_date - $1::INT8
        GROUP BY signature
        ORDER BY hits DESC, last_seen DESC
        LIMIT 100`,
      [window],
    );
    return result.rows as Array<Record<string, unknown>>;
  });

  if (!rows) return [];

  return rows.map((row) => ({
    signature: String(row.signature),
    day: String(row.day),
    route: String(row.route),
    name: String(row.name),
    code: String(row.code ?? ""),
    version: String(row.version ?? ""),
    hits: Number(row.hits ?? 0),
    sampleFrames: String(row.sample_frames ?? ""),
    lastMessage: row.last_message ? String(row.last_message) : null,
    firstSeen: String(row.first_seen),
    lastSeen: String(row.last_seen),
  }));
}

/** Borra lo que ya no se va a mirar. Lo llama el cron diario. */
export async function purgeErrorSignatures(
  env: WorkerEnv,
  keepDays: number = ERROR_SIGNATURE_KEEP_DAYS,
): Promise<number> {
  const deleted = await withClient(env, async (client) => {
    const result = await client.query(
      `DELETE FROM lecta_error_signatures
        WHERE bucket_day < current_date - $1::INT8`,
      [Math.max(1, Math.trunc(keepDays))],
    );
    return result.rowCount ?? 0;
  });
  return deleted ?? 0;
}

export interface ErrorDigestRow {
  signature: string;
  name: string;
  route: string;
  version: string;
  hits: number;
  sampleFrames: string;
}

/** Firmas de ayer que superan el umbral: lo que merece un correo. */
export async function collectErrorDigest(
  env: WorkerEnv,
  minHits: number = ERROR_DIGEST_MIN_HITS,
): Promise<ErrorDigestRow[]> {
  const rows = await withClient(env, async (client) => {
    const result = await client.query(
      `SELECT signature,
              max(name)          AS name,
              max(route)         AS route,
              max(version)       AS version,
              sum(hits)::INT8    AS hits,
              max(sample_frames) AS sample_frames
         FROM lecta_error_signatures
        WHERE bucket_day >= current_date - 1
        GROUP BY signature
       HAVING sum(hits) >= $1::INT8
        ORDER BY hits DESC
        LIMIT 20`,
      [Math.max(1, Math.trunc(minHits))],
    );
    return result.rows as Array<Record<string, unknown>>;
  });

  if (!rows) return [];

  return rows.map((row) => ({
    signature: String(row.signature),
    name: String(row.name),
    route: String(row.route),
    version: String(row.version ?? ""),
    hits: Number(row.hits ?? 0),
    sampleFrames: String(row.sample_frames ?? ""),
  }));
}

/**
 * Aviso por correo con Resend. Sin `RESEND_API_KEY` o sin `LECTA_OWNER_EMAIL`
 * no hace nada: el digest es opcional, no un requisito para arrancar.
 */
export async function sendErrorDigest(
  env: WorkerEnv,
  rows: ErrorDigestRow[],
): Promise<boolean> {
  const to = env.LECTA_OWNER_EMAIL?.trim();
  if (!env.RESEND_API_KEY || !to || rows.length === 0) return false;

  const lines = rows.map(
    (row) =>
      `· ${row.hits}× ${row.name} en ${row.route} (v${row.version || "?"})\n  ${row.signature}${row.sampleFrames ? `\n  ${row.sampleFrames}` : ""}`,
  );
  const text = `Errores agrupados en las últimas 24 h:\n\n${lines.join("\n\n")}\n\nAbre Diagnóstico → Salud de la aplicación para ver el detalle.`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from:
          env.RESEND_FROM_EMAIL ??
          env.RESEND_FROM ??
          "Lecta <onboarding@resend.dev>",
        to: [to],
        subject: `Lecta: ${rows.length} firma(s) de error sobre el umbral`,
        text,
      }),
    });
    if (!response.ok) {
      console.error(`[digest-errores] Resend rechazó el envío (${response.status})`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
