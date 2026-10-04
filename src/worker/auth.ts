import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { getConnectionString, type WorkerEnv } from "./db";

async function sendViaResend(env: WorkerEnv, email: string, url: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[magic-link] para ${email}: ${url}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:
        env.RESEND_FROM_EMAIL ?? env.RESEND_FROM ?? "Lecta <onboarding@resend.dev>",
      to: [email],
      subject: "Tu enlace para entrar a Lecta",
      html: `<p>Hola,</p><p>Usa este enlace para entrar a Lecta:</p><p><a href="${url}">${url}</a></p><p>Si no lo pediste, ignora este correo.</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[magic-link] Resend falló para ${email}: ${response.status} ${detail}`);
    throw new Error(`No se pudo enviar el enlace (${response.status})`);
  }
}

export function createAuth(env: WorkerEnv, baseURL: string) {
  const pool = new pg.Pool({ connectionString: getConnectionString(env), max: 1 });
  return betterAuth({
    database: {
      db: new Kysely({ dialect: new PostgresDialect({ pool }) }),
      type: "postgres",
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    emailAndPassword: { enabled: true },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendViaResend(env, email, url);
        },
      }),
    ],
  });
}
