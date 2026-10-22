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
    // Sin servicio de correo el enlace no se puede entregar: fallar es
    // honesto. Nunca registrar el enlace (lleva un token de sesión) ni
    // el correo del destinatario.
    throw new Error("El servicio de correo no está configurado.");
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
    // Solo la operación y el código: el cuerpo de Resend puede traer
    // datos del destinatario y el enlace con token jamás se registra.
    console.error(`[correo] envío rechazado por Resend (${response.status})`);
    throw new Error(`No se pudo enviar el enlace (${response.status})`);
  }
}

export function createScopedAuth(env: WorkerEnv, baseURL: string) {
  const pool = new pg.Pool({ connectionString: getConnectionString(env), max: 1 });
  if (typeof pool.on === "function") {
    pool.on("error", (err) => {
      // Evita crash del proceso por error no capturado en eventos de socket (ej. ENOTFOUND transitorio)
      console.error("Postgres pool error:", err.message);
    });
  }
  const closePool = async () => {
    try {
      if (typeof pool.end === "function") {
        await pool.end();
      }
    } catch {
      // noop
    }
  };
  const auth = betterAuth({
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
  return { auth, pool, closePool };
}

export async function closePoolSafe(
  closePool: () => Promise<void>,
  contextOrExecutionCtx?: unknown,
): Promise<void> {
  let delegated = false;
  try {
    const ctx =
      (contextOrExecutionCtx as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } })
        ?.executionCtx ??
      (contextOrExecutionCtx as { waitUntil?: (p: Promise<unknown>) => void });
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(closePool());
      delegated = true;
    }
  } catch {
    delegated = false;
  }
  if (!delegated) {
    await closePool();
  }
}

export function createAuth(env: WorkerEnv, baseURL: string) {
  const { auth, closePool } = createScopedAuth(env, baseURL);
  (auth as unknown as { closePool: () => Promise<void> }).closePool = closePool;
  return auth;
}
