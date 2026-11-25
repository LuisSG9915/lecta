import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import {
  DISPOSABLE_EMAIL_MESSAGE,
  isDisposableEmail,
} from "../shared/email-normalize";
import { invalidateUserPlan } from "./plan-store";
import { cancelBillingForDeletion } from "./stripe";
import {
  getConnectionString,
  logPostgresError,
  resetAccountDataDb,
  withClient,
  type WorkerEnv,
} from "./db";

export { resetAccountDataDb };

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

/**
 * Turnstile en el registro y en el enlace mágico (el que manda correo a
 * cualquier dirección): frena cuentas en masa y el bombardeo de correos
 * que quema la reputación de Resend. Fuera quedan `sign-in/email` (el
 * portal Kindle entra por ahí sin JS; lo cubre el freno por IP) y el
 * reset de contraseña (solo escribe a cuentas existentes). Sin
 * `TURNSTILE_SECRET_KEY` no se exige: así el cliente que manda el token
 * se despliega antes y el secret enciende la exigencia.
 */
export const CAPTCHA_ENDPOINTS = ["/sign-up/email", "/sign-in/magic-link"];

function captchaPlugins(env: WorkerEnv) {
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secretKey) return [];
  return [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey,
      endpoints: CAPTCHA_ENDPOINTS,
      allowedHostnames: ["lectal.app"],
    }),
  ];
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
    advanced: {
      database: {
        // La instancia vive una petición, así que la validación de esquema
        // (introspección del catálogo, 0,4–1,2 s y ~260 lecturas de
        // comentarios) se repetía en cada una: era la sentencia más cara
        // del cluster. El esquema lo garantiza `pnpm db:auth`.
        validateSchema: false,
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        // 5 min: acota la ventana en que una sesión revocada sigue
        // válida desde el caché firmado, sin consultar la base.
        maxAge: 5 * 60,
      },
    },
    // F12: correos temporales no abren cuenta. Solo el ALTA: el before de
    // /sign-up/email corre antes de tocar la base y databaseHooks cubre la
    // creación por enlace mágico; el inicio de sesión de cuentas existentes
    // nunca pasa por aquí.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && isDisposableEmail(email)) {
          throw new APIError("BAD_REQUEST", {
            code: "DISPOSABLE_EMAIL",
            message: DISPOSABLE_EMAIL_MESSAGE,
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (typeof user.email === "string" && isDisposableEmail(user.email)) {
              throw new APIError("BAD_REQUEST", {
                code: "DISPOSABLE_EMAIL",
                message: DISPOSABLE_EMAIL_MESSAGE,
              });
            }
          },
        },
      },
    },
    // Verificación obligatoria del correo (2026-11-23): sin ella cualquiera
    // registraba una dirección ajena con contraseña. El registro manda el
    // enlace y no abre sesión hasta confirmarlo; entrar con contraseña sin
    // verificar reenvía el enlace (sendOnSignIn) y responde 403
    // EMAIL_NOT_VERIFIED. El enlace mágico verifica al usarlo.
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendViaResend(env, user.email, url, {
          subject: "Confirma tu correo en Lecta",
          intro: "Abre este enlace para confirmar tu correo y entrar a Lecta:",
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
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
          // Primero Stripe: si la cancelación falla, el borrado se aborta y
          // la persona no queda pagando una cuenta que ya no existe.
          await cancelBillingForDeletion(env, user.id);
          await purgeUserData(env, user.id);
          invalidateUserPlan(user.id);
        },
      },
    },
    plugins: [
      ...captchaPlugins(env),
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
