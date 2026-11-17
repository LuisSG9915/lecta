// Resumen semanal de lectura por correo (a demanda). El usuario lo pide
// desde Cuenta; el worker agrega la última semana y lo envía por Resend.
// Sin cron ni fan-out por ahora (alcance mínimo): una llamada por usuario.
import { Hono } from "hono";
import { withClient, type WorkerEnv } from "./db";
import { getSession } from "./session";
import { escapeHtml } from "./kindle/views";

export const weeklyDigest = new Hono<{ Bindings: WorkerEnv }>();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const sendDigestEmail = async (
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

const buildDigestHtml = (data: {
  minutes: number;
  words: number;
  reviews: number;
  books: number;
}) => {
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
  <p style="color:#5a554e;font-size:14px;">Sigue leyendo en <a href="https://lectal.app" style="color:#b3472a;">lectal.app</a>.</p>
</body>
</html>`;
};

weeklyDigest.post("/api/digest/weekly", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "No autenticado." }, 401);
  const userId = session.user.id;
  const email = session.user.email;
  if (!email) return context.json({ error: "Sin correo." }, 400);

  const weekStart = Date.now() - WEEK_MS;
  let minutes = 0;
  let words = 0;
  let reviews = 0;
  let books = 0;

  try {
    await withClient(context.env, async (client) => {
      const r1 = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(ended_at - started_at), 0)::text AS total
           FROM lecta_user_activity WHERE user_id = $1 AND started_at >= $2`,
        [userId, weekStart],
      );
      minutes = Math.round(Number(r1.rows[0]?.total ?? 0) / 60000);
      const r2 = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM lecta_user_words WHERE user_id = $1 AND saved_at >= $2 AND deleted = false`,
        [userId, weekStart],
      );
      words = Number(r2.rows[0]?.n ?? 0);
      const r3 = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM lecta_user_reviews WHERE user_id = $1 AND created_at >= $2`,
        [userId, weekStart],
      );
      reviews = Number(r3.rows[0]?.n ?? 0);
      const r4 = await client.query<{ n: string }>(
        `SELECT COUNT(DISTINCT book_hash)::text AS n FROM lecta_user_activity WHERE user_id = $1 AND started_at >= $2`,
        [userId, weekStart],
      );
      books = Number(r4.rows[0]?.n ?? 0);
    }, false);
  } catch {
    return context.json({ error: "No se pudo agregar los datos." }, 500);
  }

  const html = buildDigestHtml({ minutes, words, reviews, books });
  const sent = await sendDigestEmail(
    context.env,
    email,
    html,
    "Tu semana en Lecta",
  );
  if (!sent) return context.json({ ok: false, reason: "email_not_configured" }, 503);
  return context.json({ ok: true, minutes, words, reviews, books });
});