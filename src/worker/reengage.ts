// Correo de regreso a los 7 días de inactividad
// (docs/designs/2026-11-24-correo-de-regreso.md). Opt-out: llega a toda cuenta
// verificada salvo baja; uno por ausencia y como máximo uno cada 30 días.
// Lo dispara el cron diario (index.ts). La baja va firmada con HMAC, sin
// columna de token: GET muestra una confirmación y POST da de baja (los
// escáneres de correo abren los GET); POST también atiende el
// List-Unsubscribe-Post de un clic.
import { Hono } from "hono";
import { isMissingColumnError, withClient, type WorkerEnv } from "./db";
import { escapeHtml } from "./kindle/views";
import { getSession } from "./session";

const DAY = 86_400_000;
export const REENGAGE_AFTER_MS = 7 * DAY;
export const REENGAGE_WINDOW_MS = 14 * DAY;
export const REENGAGE_COOLDOWN_MS = 30 * DAY;
export const REENGAGE_BATCH = 200;
const BASE_URL = "https://lectal.app";
const SEND_DELAY_MS = 600;

type QueryClient = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;
};

// ---------- Firma de la baja ----------

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function reengageToken(secret: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`reengage:${userId}`)));
}

export async function verifyReengageToken(secret: string, userId: string, token: string): Promise<boolean> {
  if (!secret || !userId || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = await reengageToken(secret, userId);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

const unsubscribeUrl = (userId: string, token: string) =>
  `${BASE_URL}/api/reengage/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;

// ---------- Contenido ----------

export type ReengageData = { title: string | null; progress: number | null; dueWords: number };

/** Progreso 0–1 (o ya en %) a porcentaje entero, o null si no hay. */
export function progressPercent(value: unknown): number | null {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, Math.round(n <= 1 ? n * 100 : n));
}

export function reengageSubject(data: ReengageData): string {
  return data.title ? `«${data.title}» te espera` : "Tu libro te espera en Lecta";
}

export function buildReengageHtml(data: ReengageData, unsubUrl: string): string {
  const book = data.title ? `«${escapeHtml(data.title)}»` : "tu libro";
  const progressLine =
    data.progress !== null
      ? `<p style="margin:0 0 12px;">Dejaste ${book} en el ${data.progress}%.</p>`
      : `<p style="margin:0 0 12px;">Dejaste ${book} a medias.</p>`;
  const wordsLine =
    data.dueWords > 0
      ? `<p style="margin:0 0 20px;">${data.dueWords} ${data.dueWords === 1 ? "palabra de tu Cuaderno te espera" : "palabras de tu Cuaderno te esperan"} para repasar.</p>`
      : "";
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Tu libro te espera</title></head>
<body style="font-family:Georgia,serif;background:#faf7f2;color:#1f1d1a;padding:24px;max-width:560px;margin:0 auto;">
  <h1 style="font-size:22px;margin:0 0 16px;">Hace una semana que no lees</h1>
  ${progressLine}
  ${wordsLine}
  <p style="margin:0 0 24px;"><a href="${BASE_URL}/?src=regreso" style="background:#b3472a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Seguir leyendo</a></p>
  <p style="color:#9a958e;font-size:12px;margin-top:24px;">Te escribimos una sola vez cuando dejas de leer una semana. <a href="${escapeHtml(unsubUrl)}" style="color:#9a958e;">No volver a recibir este correo</a>.</p>
</body>
</html>`;
}

// ---------- Elegibles y datos ----------

const lastOf = (table: string) =>
  `COALESCE((SELECT synced_at FROM ${table} WHERE user_id = u.id ORDER BY synced_at DESC LIMIT 1), 0)`;

// Un LIMIT 1 por tabla usa los índices (user_id, …, synced_at) de la 015;
// un UNION ALL agrupado recorrería las seis tablas enteras.
export const ELIGIBLE_SQL = `
  SELECT u.id, u.email, a.last
    FROM "user" u
    LEFT JOIN lecta_user_plan p ON p.user_id = u.id
    CROSS JOIN LATERAL (
      SELECT GREATEST(${[
        "lecta_user_positions",
        "lecta_user_words",
        "lecta_user_reviews",
        "lecta_user_activity",
        "lecta_user_annotations",
        "lecta_user_knowledge",
      ]
        .map(lastOf)
        .join(", ")}) AS last
    ) a
   WHERE u."emailVerified"
     AND u.email NOT LIKE '%@smoke.test' AND u.email NOT LIKE '%@example.com' AND u.email NOT LIKE 'smoke%'
     AND NOT COALESCE(p.reengage_opt_out, false)
     AND a.last BETWEEN $2 AND $1
     AND (p.reengage_sent_at IS NULL OR (p.reengage_sent_at < a.last AND p.reengage_sent_at < $3))
   ORDER BY a.last
   LIMIT ${REENGAGE_BATCH}`;

type CatalogTitles = Map<string, string>;

async function loadCatalogTitles(env: WorkerEnv): Promise<CatalogTitles> {
  const titles: CatalogTitles = new Map();
  try {
    const obj = await env.BOOKS?.get("catalog/index.json");
    const index = obj ? ((await obj.json()) as { books?: Array<{ epubSha256?: string; title?: string }> }) : null;
    for (const book of index?.books ?? []) {
      if (book.epubSha256 && book.title) titles.set(book.epubSha256, book.title);
    }
  } catch {
    // Sin índice: el correo dice «tu libro».
  }
  return titles;
}

async function readUserData(client: QueryClient, userId: string, catalog: CatalogTitles): Promise<ReengageData> {
  const pos = await client.query<{ book_hash: string; progress: unknown }>(
    `SELECT book_hash, progress FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  const hash = pos.rows[0]?.book_hash ?? null;
  let title: string | null = null;
  if (hash) {
    const own = await client.query<{ title: string | null }>(
      `SELECT title FROM user_books WHERE user_id = $1 AND book_id = $2`,
      [userId, hash],
    );
    title = own.rows[0]?.title?.trim() || catalog.get(hash) || null;
  }
  // Vencidas y ya vistas (primera exposición o un repaso), como isReviewDueWord.
  const due = await client.query<{ n: number | string }>(
    `SELECT count(*)::INT8 AS n FROM lecta_user_words
      WHERE user_id = $1 AND deleted = false
        AND card ? 'due' AND (card->>'due')::timestamptz <= now()
        AND (presented_at IS NOT NULL OR COALESCE((card->>'reps')::INT8, 0) > 0)`,
    [userId],
  );
  return {
    title,
    progress: progressPercent(pos.rows[0]?.progress),
    dueWords: Number(due.rows[0]?.n ?? 0),
  };
}

async function sendReengageEmail(env: WorkerEnv, to: string, subject: string, html: string, unsubUrl: string) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL ?? "Lecta <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const markSent = (client: QueryClient, userId: string, at: number) =>
  client.query(
    `INSERT INTO lecta_user_plan (user_id, plan, reengage_sent_at, created_at, updated_at)
     VALUES ($1, 'free', $2, $2, $2)
     ON CONFLICT (user_id) DO UPDATE SET reengage_sent_at = EXCLUDED.reengage_sent_at,
       updated_at = EXCLUDED.updated_at`,
    [userId, at],
  );

/**
 * Corrida del cron. Cada fallo por cuenta es silencioso; sin columnas (42703),
 * sin Resend o sin secreto no envía nada. `sleep` inyectable en pruebas.
 */
export async function runReengage(
  env: WorkerEnv,
  now = Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ sent: number; eligible: number }> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!env.RESEND_API_KEY || !secret) return { sent: 0, eligible: 0 };
  let users: Array<{ id: string; email: string }>;
  try {
    users =
      (await withClient(env, (client) =>
        (client as unknown as QueryClient)
          .query<{ id: string; email: string }>(ELIGIBLE_SQL, [
            now - REENGAGE_AFTER_MS,
            now - REENGAGE_WINDOW_MS,
            now - REENGAGE_COOLDOWN_MS,
          ])
          .then((r) => r.rows),
      )) ?? [];
  } catch (err) {
    if (!isMissingColumnError(err)) console.error("reengage: no se pudo leer elegibles", err);
    return { sent: 0, eligible: 0 };
  }
  if (!users.length) return { sent: 0, eligible: 0 };
  const catalog = await loadCatalogTitles(env);
  let sent = 0;
  for (const user of users) {
    try {
      await withClient(env, async (c) => {
        const client = c as unknown as QueryClient;
        const data = await readUserData(client, user.id, catalog);
        const unsub = unsubscribeUrl(user.id, await reengageToken(secret, user.id));
        const ok = await sendReengageEmail(env, user.email, reengageSubject(data), buildReengageHtml(data, unsub), unsub);
        if (ok) {
          await markSent(client, user.id, now);
          sent += 1;
        }
      });
    } catch {
      // falla en silencio por cuenta
    }
    await sleep(SEND_DELAY_MS);
  }
  return { sent, eligible: users.length };
}

// ---------- Baja ----------

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Georgia,serif;padding:24px;max-width:480px;margin:0 auto;">${body}<p><a href="${BASE_URL}">Volver a Lecta</a></p></body></html>`;

export const reengage = new Hono<{ Bindings: WorkerEnv }>();

const readParams = (url: string) => {
  const q = new URL(url).searchParams;
  return { userId: q.get("u") ?? "", token: q.get("t") ?? "" };
};

reengage.get("/api/reengage/unsubscribe", async (c) => {
  const { userId, token } = readParams(c.req.url);
  if (!(await verifyReengageToken(c.env.BETTER_AUTH_SECRET ?? "", userId, token))) {
    return c.html(page("Enlace no válido", "<h1>Enlace no válido</h1><p>Este enlace de baja no es válido.</p>"), 404);
  }
  const action = `/api/reengage/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
  return c.html(
    page(
      "Darse de baja",
      `<h1>¿Dejar de recibir el correo de regreso?</h1><p>Es el aviso que te enviamos cuando llevas una semana sin leer.</p><form method="post" action="${escapeHtml(action)}"><button type="submit" style="padding:10px 18px;">Sí, darme de baja</button></form>`,
    ),
  );
});

// Casilla de «Tú»: activo salvo baja. Sin la 033 (42703) se muestra activo
// y guardar responde 503.
reengage.get("/api/reengage/preferences", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "No autenticado." }, 401);
  let enabled = true;
  try {
    await withClient(c.env, async (client) => {
      const r = await client.query<{ reengage_opt_out: boolean }>(
        "SELECT reengage_opt_out FROM lecta_user_plan WHERE user_id = $1",
        [session.user.id],
      );
      if (r.rows[0]) enabled = !r.rows[0].reengage_opt_out;
    });
  } catch {
    // tabla o columna ausente: activo por defecto
  }
  return c.json({ enabled });
});

reengage.post("/api/reengage/preferences", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "No autenticado." }, 401);
  const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
  const enabled = body?.enabled !== false;
  const now = Date.now();
  try {
    await withClient(c.env, (client) =>
      client.query(
        `INSERT INTO lecta_user_plan (user_id, plan, reengage_opt_out, created_at, updated_at)
         VALUES ($1, 'free', $2, $3, $3)
         ON CONFLICT (user_id) DO UPDATE SET reengage_opt_out = EXCLUDED.reengage_opt_out,
           updated_at = EXCLUDED.updated_at`,
        [session.user.id, !enabled, now],
      ),
    );
  } catch {
    return c.json({ error: "No se pudo guardar la preferencia." }, 503);
  }
  return c.json({ enabled });
});

reengage.post("/api/reengage/unsubscribe", async (c) => {
  const { userId, token } = readParams(c.req.url);
  if (!(await verifyReengageToken(c.env.BETTER_AUTH_SECRET ?? "", userId, token))) {
    return c.html(page("Enlace no válido", "<h1>Enlace no válido</h1><p>Este enlace de baja no es válido.</p>"), 404);
  }
  try {
    const now = Date.now();
    await withClient(c.env, (client) =>
      client.query(
        `INSERT INTO lecta_user_plan (user_id, plan, reengage_opt_out, created_at, updated_at)
         VALUES ($1, 'free', true, $2, $2)
         ON CONFLICT (user_id) DO UPDATE SET reengage_opt_out = true, updated_at = EXCLUDED.updated_at`,
        [userId, now],
      ),
    );
  } catch {
    return c.html(page("Inténtalo más tarde", "<h1>No pudimos darte de baja</h1><p>Inténtalo de nuevo en unos minutos.</p>"), 503);
  }
  return c.html(page("Te diste de baja", "<h1>Listo</h1><p>Ya no recibirás el correo de regreso.</p>"));
});
