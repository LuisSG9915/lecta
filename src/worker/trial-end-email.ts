// Correo único al vencer la prueba inversa de Lecta+ (Día 15, fase E9).
// Llega una sola vez a cuentas verificadas cuya prueba terminó en las últimas
// 48 h y registraron actividad real (aiUses + wordsSaved + cloudBooks > 0).
// Sin migración de DB: idempotencia por lecta_plan_events ('app:trial-end-email')
// y baja en un clic reutilizando reengage_opt_out / reengageToken.
import { REVERSE_TRIAL_MS, REVERSE_TRIAL_START } from "../shared/plan";
import { USER_AI_SCOPES } from "./ai-units";
import { isMissingColumnError, isMissingTableError, withClient, type WorkerEnv } from "./db";
import { escapeHtml } from "./kindle/views";
import { recordLandingEvent, recordPlanEvent } from "./landing-events";
import { reengageToken } from "./reengage";

export const TRIAL_END_EMAIL_EVENT = "app:trial-end-email";
export const TRIAL_END_EMAIL_WINDOW_MS = 48 * 3_600_000;
export const TRIAL_END_EMAIL_BATCH = 100;
export const BASE_URL = "https://lectal.app";
export const TRIAL_END_CTA_URL = `${BASE_URL}/?carne=1&src=trial_end`;
const SEND_DELAY_MS = 600;

type QueryClient = {
  query: <R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[]; rowCount?: number | null }>;
};

export type TrialUsage = {
  aiUses: number;
  wordsSaved: number;
  cloudBooks: number;
};

const unsubscribeUrl = (userId: string, token: string) =>
  `${BASE_URL}/api/reengage/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;

export const TRIAL_END_ELIGIBLE_SQL = `
  SELECT u.id, u.email,
         (GREATEST((extract(epoch from u."createdAt") * 1000)::INT8, $1::INT8) + $2::INT8) AS trial_ends_at
    FROM "user" u
    LEFT JOIN lecta_user_plan p ON p.user_id = u.id
   WHERE u."emailVerified"
     AND u.email IS NOT NULL
     AND u.email NOT LIKE '%@smoke.test' AND u.email NOT LIKE '%@example.com' AND u.email NOT LIKE 'smoke%'
     AND (p.plan IS NULL OR p.plan = 'free')
     AND p.stripe_subscription_id IS NULL
     AND p.stripe_customer_id IS NULL
     AND NOT COALESCE(p.reengage_opt_out, false)
     AND (GREATEST((extract(epoch from u."createdAt") * 1000)::INT8, $1::INT8) + $2::INT8) BETWEEN $3::INT8 AND $4::INT8
     AND NOT EXISTS (
       SELECT 1 FROM lecta_plan_events e
        WHERE e.user_id = u.id AND e.event = '${TRIAL_END_EMAIL_EVENT}'
     )
   ORDER BY trial_ends_at ASC
   LIMIT ${TRIAL_END_EMAIL_BATCH}`;

export function isTrialActive(usage: TrialUsage): boolean {
  return usage.aiUses + usage.wordsSaved + usage.cloudBooks > 0;
}

export async function readTrialUsage(
  client: QueryClient,
  userId: string,
  trialEndsAt: number,
): Promise<TrialUsage> {
  const start = trialEndsAt - REVERSE_TRIAL_MS;
  const res = await client.query<{
    ai_uses: unknown;
    words_saved: unknown;
    cloud_books: unknown;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(units_used), 0) FROM lecta_ai_quota
         WHERE user_id = $1 AND scope = ANY($2::STRING[])
           AND bucket_hour >= $3 AND bucket_hour <= $4)::INT8 AS ai_uses,
       (SELECT count(*) FROM lecta_user_words
         WHERE user_id = $1 AND deleted = false
           AND saved_at >= $5 AND saved_at <= $6)::INT8 AS words_saved,
       (SELECT count(*) FROM user_books
         WHERE user_id = $1 AND paper_only = false AND has_file = true)::INT8 AS cloud_books`,
    [
      userId,
      [...USER_AI_SCOPES],
      Math.floor(start / 3_600_000),
      Math.floor(trialEndsAt / 3_600_000),
      start,
      trialEndsAt,
    ],
  );
  const row = res.rows[0];
  return {
    aiUses: Number(row?.ai_uses) || 0,
    wordsSaved: Number(row?.words_saved) || 0,
    cloudBooks: Number(row?.cloud_books) || 0,
  };
}

export function trialEndSubject(): string {
  return "Terminaron tus 14 días de prueba en Lecta+";
}

export function buildTrialEndHtml(usage: TrialUsage, unsubUrl: string): string {
  const items: string[] = [];
  if (usage.aiUses > 0) {
    items.push(
      `<li>${usage.aiUses} ${usage.aiUses === 1 ? "consulta con IA" : "consultas con IA"} mientras leías</li>`,
    );
  }
  if (usage.wordsSaved > 0) {
    items.push(
      `<li>${usage.wordsSaved} ${usage.wordsSaved === 1 ? "palabra guardada" : "palabras guardadas"} en tu Herbario</li>`,
    );
  }
  if (usage.cloudBooks > 0) {
    items.push(
      `<li>${usage.cloudBooks} ${usage.cloudBooks === 1 ? "libro sincronizado" : "libros sincronizados"} en tu Biblioteca</li>`,
    );
  }
  const usageList = items.length > 0 ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;">${items.join("")}</ul>` : "";
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(trialEndSubject())}</title></head>
<body style="font-family:Georgia,serif;background:#faf7f2;color:#1f1d1a;padding:24px;max-width:560px;margin:0 auto;">
  <h1 style="font-size:22px;margin:0 0 16px;">Terminaron tus 14 días de prueba en Lecta+</h1>
  <p style="margin:0 0 12px;">Esto es lo que construiste durante tus dos semanas de lectura:</p>
  ${usageList}
  <p style="margin:0 0 20px;">Tus libros, tu Herbario y tu avance siguen guardados en tu cuenta gratuita. Si quieres conservar las ayudas sin límite ni cortes de cuota, puedes activar Lecta+ en tu Carné.</p>
  <p style="margin:0 0 24px;"><a href="${escapeHtml(TRIAL_END_CTA_URL)}" style="background:#b3472a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Ver mi Carné de Lecta+</a></p>
  <p style="color:#9a958e;font-size:12px;margin-top:24px;">Este es un aviso único al terminar tu prueba de Lecta+. <a href="${escapeHtml(unsubUrl)}" style="color:#9a958e;">No recibir estos avisos</a>.</p>
</body>
</html>`;
}

async function sendTrialEndEmail(
  env: WorkerEnv,
  to: string,
  subject: string,
  html: string,
  unsubUrl: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
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

/**
 * Envío diario del correo único de fin de prueba para cuentas activas en Día 15.
 * Cada fallo por cuenta se absorbe en silencio; sin Resend, secreto o columnas
 * pendientes no envía nada.
 */
export async function runTrialEndEmails(
  env: WorkerEnv,
  now = Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<{ sent: number; eligible: number; skippedInactive: number }> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!env.RESEND_API_KEY || !secret) {
    return { sent: 0, eligible: 0, skippedInactive: 0 };
  }
  let users: Array<{ id: string; email: string; trial_ends_at: number | string }>;
  try {
    users =
      (await withClient(env, (client) =>
        (client as unknown as QueryClient)
          .query<{ id: string; email: string; trial_ends_at: number | string }>(
            TRIAL_END_ELIGIBLE_SQL,
            [
              REVERSE_TRIAL_START,
              REVERSE_TRIAL_MS,
              now - TRIAL_END_EMAIL_WINDOW_MS,
              now,
            ],
          )
          .then((r) => r.rows),
      )) ?? [];
  } catch (err) {
    if (!isMissingColumnError(err) && !isMissingTableError(err)) {
      console.error("trial-end-email: no se pudo leer elegibles", err);
    }
    return { sent: 0, eligible: 0, skippedInactive: 0 };
  }
  if (!users.length) return { sent: 0, eligible: 0, skippedInactive: 0 };

  let sent = 0;
  let skippedInactive = 0;
  const nowDate = new Date(now);
  for (const user of users) {
    let attemptedSend = false;
    try {
      const trialEndsAt = Number(user.trial_ends_at) || now;
      const usage = await withClient(env, (c) =>
        readTrialUsage(c as unknown as QueryClient, user.id, trialEndsAt),
      );
      if (!usage || !isTrialActive(usage)) {
        skippedInactive += 1;
        continue;
      }
      attemptedSend = true;
      const unsub = unsubscribeUrl(user.id, await reengageToken(secret, user.id));
      const ok = await sendTrialEndEmail(
        env,
        user.email,
        trialEndSubject(),
        buildTrialEndHtml(usage, unsub),
        unsub,
      );
      if (ok) {
        await recordPlanEvent(env, user.id, TRIAL_END_EMAIL_EVENT, nowDate);
        await recordLandingEvent(
          env,
          { event: TRIAL_END_EMAIL_EVENT, source: "free" },
          nowDate,
        );
        sent += 1;
      }
    } catch {
      // falla en silencio por cuenta
    }
    if (attemptedSend) await sleep(SEND_DELAY_MS);
  }
  return { sent, eligible: users.length, skippedInactive };
}
