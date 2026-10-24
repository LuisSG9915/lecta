import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import {
  getConnectionString,
  logPostgresError,
  withClient,
  type WorkerEnv,
} from "./db";

type EmailContent = { subject: string; intro: string };

/**
 * Borra un prefijo de R2 paginando con cursor. R2 lista como máximo
 * 1000 objetos por página y delete() acepta como máximo 1000 claves:
 * una sola llamada dejaría huérfanos los libros de usuarios con más
 * de mil objetos.
 */
export async function purgeR2Prefix(
  bucket: R2Bucket,
  prefix: string,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/**
 * Purga todo lo asociado a una cuenta: ambos prefijos de R2 (EPUBs
 * propios y libros de usuario), user_books y los códigos de Kindle.
 * Los códigos expirados de cualquier cuenta se limpian de paso.
 */
export async function purgeUserData(
  env: WorkerEnv,
  userId: string,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const tasks: Promise<unknown>[] = [
    withClient(env, async (client) => {
      await client.query("DELETE FROM user_books WHERE user_id = $1", [userId]);
      await client.query(
        "DELETE FROM kindle_link_codes WHERE user_id = $1 OR expires_at < $2",
        [userId, nowSec],
      );
    }),
  ];
  if (env.BOOKS) {
    tasks.push(purgeR2Prefix(env.BOOKS, `books/${userId}/`));
    tasks.push(purgeR2Prefix(env.BOOKS, `user-books/${userId}/`));
  }
  await Promise.all(tasks);
}

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
      logPostgresError("pool", err);
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
          await purgeUserData(env, user.id);
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
