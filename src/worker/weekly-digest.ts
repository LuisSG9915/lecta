// Resumen semanal de lectura por correo (a demanda + cron). El usuario lo
// pide desde Cuenta o lo recibe si tiene el opt-in activo. Agrega la
// última semana por usuario y envía por Resend.
import { Hono } from "hono";
import { hasLectaPlus } from "../shared/plan";
import { readCachedCoach } from "./coach";
import { withClient, type WorkerEnv } from "./db";
import { loadUserPlan } from "./plan-store";
import { getSession } from "./session";
import { escapeHtml } from "./kindle/views";

export const weeklyDigest = new Hono<{ Bindings: WorkerEnv }>();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type DigestData = {
  minutes: number;
  words: number;
  reviews: number;
  books: number;
};

// Semana sin actividad (o lectura fallida, que también deja todo en 0): el
// cron no la envía; un resumen vacío se lee como spam.
export const isEmptyDigest = (data: DigestData) =>
  data.minutes === 0 && data.words === 0 && data.reviews === 0 && data.books === 0;

export const buildUserDigest = async (
  env: WorkerEnv,
  userId: string,
): Promise<DigestData> => {
  const weekStart = Date.now() - WEEK_MS;
  const data: DigestData = { minutes: 0, words: 0, reviews: 0, books: 0 };
  await withClient(env, async (client) => {
    const r1 = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(ended_at - started_at), 0)::text AS total
         FROM lecta_user_activity WHERE user_id = $1 AND started_at >= $2`,
      [userId, weekStart],
    );
    data.minutes = Math.round(Number(r1.rows[0]?.total ?? 0) / 60000);
    const r2 = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM lecta_user_words WHERE user_id = $1 AND saved_at >= $2 AND deleted = false`,
      [userId, weekStart],
    );
    data.words = Number(r2.rows[0]?.n ?? 0);
    const r3 = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM lecta_user_reviews WHERE user_id = $1 AND created_at >= $2`,
      [userId, weekStart],
    );
    data.reviews = Number(r3.rows[0]?.n ?? 0);
    const r4 = await client.query<{ n: string }>(
      `SELECT COUNT(DISTINCT book_hash)::text AS n FROM lecta_user_activity WHERE user_id = $1 AND started_at >= $2`,
      [userId, weekStart],
    );
    data.books = Number(r4.rows[0]?.n ?? 0);
  }, false);
  return data;
};

export const buildDigestHtml = (data: DigestData, unsubscribeUrl: string, coachText?: string | null) => {
  const h = Math.floor(data.minutes / 60);
  const m = data.minutes % 60;
  const timeStr = h > 0 ? `${h} h ${m} min` : `${m} min`;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Tu semana en Lecta</title></head>
<body style="font-family:Georgia,serif;background:#faf7f2;color:#1f1d1a;padding:24px;max-width:560px;margin:0 auto;">
  <h1 style="font-size:22px;margin:0 0 8px;">Tu semana en Lecta</h1>
  <p style="color:#5a554e;margin:0 0 20px;">Un resumen de tu lectura de los últimos 7 días.</p>
  <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
    <tr><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;">Tiempo leído</td><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;text-align:right;font-weight:600;">${escapeHtml(timeStr)}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;">Palabras guardadas</td><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;text-align:right;font-weight:600;">${data.words}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;">Repasos hechos</td><td style="padding:8px 0;border-bottom:1px solid #e3ddd2;text-align:right;font-weight:600;">${data.reviews}</td></tr>
    <tr><td style="padding:8px 0;">Libros leídos</td><td style="padding:8px 0;text-align:right;font-weight:600;">${data.books}</td></tr>
  </table>
  ${coachText ? `<h2 style="font-size:16px;margin:0 0 6px;">Tu coach</h2>
  <p style="margin:0 0 20px;">${escapeHtml(coachText)}</p>` : ""}
  <p style="color:#5a554e;font-size:14px;">Sigue leyendo en <a href="https://lectal.app" style="color:#b3472a;">lectal.app</a>.</p>
  <p style="color:#9a958e;font-size:12px;margin-top:24px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#9a958e;">Darse de baja del resumen semanal</a></p>
</body>
</html>`;
};

export const sendDigestEmail = async (
  env: WorkerEnv,
  to: string,
  html: string,
  subject: string,
): Promise<boolean> => {
  if (!env.RESEND_API_KEY) return false;
  const from = env.RESEND_FROM_EMAIL ?? "Lecta <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// ---------- Preferencias ----------
weeklyDigest.get("/api/digest/preferences", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "No autenticado." }, 401);
  const userId = session.user.id;
  let optIn = false;
  try {
    await withClient(context.env, async (client) => {
      const r = await client.query<{ digest_opt_in: boolean }>(
        `SELECT digest_opt_in FROM lecta_user_plan WHERE user_id = $1`,
        [userId],
      );
      if (r.rows[0]) optIn = Boolean(r.rows[0].digest_opt_in);
    }, false);
  } catch {
    // tabla ausente o error: degradar a false
  }
  return context.json({ optIn });
});

weeklyDigest.post("/api/digest/preferences", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "No autenticado." }, 401);
  const userId = session.user.id;
  let body: { optIn?: unknown };
  try {
    body = (await context.req.json()) as { optIn?: unknown };
  } catch {
    body = {};
  }
  const optIn = body.optIn === true;
  let token: string | null = null;
  try {
    await withClient(context.env, async (client) => {
      if (optIn) {
        token = crypto.randomUUID();
        await client.query(
          `INSERT INTO lecta_user_plan (user_id, plan, digest_opt_in, digest_unsubscribe_token, created_at, updated_at)
           VALUES ($1, 'free', true, $2, $3, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             digest_opt_in = true,
             digest_unsubscribe_token = $2,
             updated_at = $3`,
          [userId, token, Date.now()],
        );
      } else {
        await client.query(
          `INSERT INTO lecta_user_plan (user_id, plan, digest_opt_in, digest_unsubscribe_token, created_at, updated_at)
           VALUES ($1, 'free', false, NULL, $2, $2)
           ON CONFLICT (user_id) DO UPDATE SET
             digest_opt_in = false,
             digest_unsubscribe_token = NULL,
             updated_at = $2`,
          [userId, Date.now()],
        );
      }
    }, false);
  } catch {
    return context.json({ error: "No se pudo guardar la preferencia." }, 500);
  }
  return context.json({ optIn, token: optIn ? token : null });
});

// ---------- Baja por token (pública) ----------
weeklyDigest.get("/api/digest/unsubscribe", async (context) => {
  const token = context.req.query("token") ?? "";
  if (!token) {
    return context.html("<p>Token inválido.</p>", 400);
  }
  let ok = false;
  try {
    await withClient(context.env, async (client) => {
      const res = await client.query(
        `UPDATE lecta_user_plan
            SET digest_opt_in = false,
                digest_unsubscribe_token = NULL,
                updated_at = $2
          WHERE digest_unsubscribe_token = $1`,
        [token, Date.now()],
      );
      ok = (res.rowCount ?? 0) > 0;
    }, false);
  } catch {
    ok = false;
  }
  const html = ok
    ? `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Baja</title></head><body style="font-family:Georgia,serif;padding:24px;max-width:480px;margin:0 auto;"><h1>Te has dado de baja</h1><p>Ya no recibirás el resumen semanal por correo. Puedes volver a activarlo desde tu cuenta en Lecta.</p><p><a href="https://lectal.app">Volver a Lecta</a></p></body></html>`
    : `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Baja</title></head><body style="font-family:Georgia,serif;padding:24px;max-width:480px;margin:0 auto;"><h1>Enlace no válido</h1><p>Este enlace de baja no es válido o ya se usó.</p><p><a href="https://lectal.app">Volver a Lecta</a></p></body></html>`;
  return context.html(html, ok ? 200 : 404);
});

// ---------- Envío on-demand ----------
weeklyDigest.post("/api/digest/weekly", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "No autenticado." }, 401);
  const userId = session.user.id;
  const email = session.user.email;
  if (!email) return context.json({ error: "Sin correo." }, 400);

  const data = await buildUserDigest(context.env, userId);
  // Token para baja (si existe) o generar uno efímero.
  let token: string | null = null;
  try {
    await withClient(context.env, async (client) => {
      const r = await client.query<{ digest_unsubscribe_token: string | null }>(
        `SELECT digest_unsubscribe_token FROM lecta_user_plan WHERE user_id = $1`,
        [userId],
      );
      token = r.rows[0]?.digest_unsubscribe_token ?? null;
      if (!token) {
        token = crypto.randomUUID();
        await client.query(
          `INSERT INTO lecta_user_plan (user_id, plan, digest_opt_in, digest_unsubscribe_token, created_at, updated_at)
           VALUES ($1, 'free', false, $2, $3, $3)
           ON CONFLICT (user_id) DO UPDATE SET digest_unsubscribe_token = $2, updated_at = $3`,
          [userId, token, Date.now()],
        );
      }
    }, false);
  } catch {
    token = crypto.randomUUID();
  }
  let coachText: string | null = null;
  try {
    const snap = await loadUserPlan(context.env, userId);
    if (snap && hasLectaPlus(snap.plan)) {
      const cached =
        (await readCachedCoach(context.env, userId)) ??
        (await readCachedCoach(context.env, userId, Date.now() - WEEK_MS));
      coachText = cached?.text ?? null;
    }
  } catch {
    coachText = null;
  }
  const base = "https://lectal.app";
  const unsubUrl = `${base}/api/digest/unsubscribe?token=${encodeURIComponent(token ?? "")}`;
  const html = buildDigestHtml(data, unsubUrl, coachText);
  const sent = await sendDigestEmail(context.env, email, html, "Tu semana en Lecta");
  if (!sent) return context.json({ ok: false, reason: "email_not_configured" }, 503);
  return context.json({ ok: true, ...data });
});