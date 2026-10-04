import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { getConnectionString, type WorkerEnv } from "./db";

type EmailContent = { subject: string; intro: string };

async function sendViaResend(
  env: WorkerEnv,
  email: string,
  url: string,
  content: EmailContent,
) {
  if (!env.RESEND_API_KEY) {
    console.log(`[correo] para ${email}: ${url}`);
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
      subject: content.subject,
      html: `<p>Hola,</p><p>${content.intro}</p><p><a href="${url}">${url}</a></p><p>Si no lo pediste, ignora este correo.</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[correo] Resend falló para ${email}: ${response.status} ${detail}`);
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
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendViaResend(env, user.email, url, {
          subject: "Restablece tu contraseña de Lecta",
          intro: "Usa este enlace para elegir una nueva contraseña:",
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) => {
          await sendViaResend(env, user.email, url, {
            subject: "Confirma el borrado de tu cuenta de Lecta",
            intro:
              "Confirma que quieres borrar tu cuenta. Se eliminarán tus libros, tu vocabulario y tus sesiones:",
          });
        },
        beforeDelete: async (user) => {
          const bucket = env.BOOKS;
          if (!bucket) return;
          const listed = await bucket.list({ prefix: `books/${user.id}/` });
          await Promise.all(listed.objects.map((object) => bucket.delete(object.key)));
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 600,
        sendMagicLink: async ({ email, url }) => {
          await sendViaResend(env, email, url, {
            subject: "Tu enlace para entrar a Lecta",
            intro: "Usa este enlace para entrar a Lecta:",
          });
        },
      }),
    ],
  });
}
