import { getConnectionString, type WorkerEnv } from "./db";
import { createScopedAuth, closePoolSafe } from "./auth";

export function hasSessionCookie(headers: Headers | Record<string, string>): boolean {
  const cookieHeader =
    headers instanceof Headers ? headers.get("cookie") : headers["cookie"] ?? headers["Cookie"];
  if (cookieHeader && /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/i.test(cookieHeader)) {
    return true;
  }
  const authHeader =
    headers instanceof Headers ? headers.get("authorization") : headers["authorization"] ?? headers["Authorization"];
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return true;
  }
  return false;
}

export type SessionContext = {
  env: WorkerEnv;
  req: { raw: Request; url: string };
  executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
  // Opcional: los handlers de Hono ya traen `c.header`; si existe, los
  // set-cookie que Better Auth encola durante getSession se anexan a la
  // respuesta y el navegador renueva el caché firmado de sesión.
  header?: (name: string, value: string, options?: { append?: boolean }) => void;
};

export class SessionInfraError extends Error {
  readonly status = 503;
  readonly code = "DB_UNAVAILABLE";
  constructor(message = "Database temporarily unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionInfraError";
  }
}

const INFRA_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "53300",
  "DB_UNAVAILABLE",
]);

const INFRA_PATTERNS = [
  /connection terminated unexpectedly/i,
  /this socket has been closed/i,
  /timeout expired/i,
  /connect ECONNREFUSED/i,
  /terminating connection due to administrator command/i,
];

export function isSessionInfraError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof SessionInfraError) return true;
  const anyErr = err as { code?: unknown; message?: unknown; body?: { code?: unknown } };
  const code = String(anyErr.code ?? "");
  if (INFRA_CODES.has(code)) return true;
  // Better Auth atrapa el error de la base al leer la sesión y lanza un
  // APIError 500 sin causa: FAILED_TO_GET_SESSION es su forma de «la base
  // no respondió», no una sesión inválida (esa devuelve null).
  if (anyErr.body?.code === "FAILED_TO_GET_SESSION") return true;
  const msg = String(anyErr.message ?? "");
  return INFRA_PATTERNS.some((pattern) => pattern.test(msg));
}

// Sesión compartida por las rutas de datos del usuario. Devuelve null
// sin base configurada, sin cookie de sesión o sin sesión válida — quien llama responde 401.
// Si ocurre un fallo de infraestructura o base de datos (Postgres caído, timeout, etc.),
// lanza SessionInfraError para que el servidor responda con 503 en lugar de 401.
// Las llamadas del cliente declaran la cuenta que las originó con
// `x-lecta-user-id`: si el encabezado no coincide con la sesión
// auténtica, la petición viajaba con una cookie ya renovada (la sesión
// cambió mientras estaba en vuelo) y no debe leer ni escribir nada —
// también se rechaza.
export const getSession = async (context: SessionContext) => {
  if (!getConnectionString(context.env)) return null;
  if (!hasSessionCookie(context.req.raw.headers)) return null;

  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  const { auth, closePool } = createScopedAuth(context.env, baseURL);
  try {
    let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
    try {
      const result = await auth.api.getSession({
        headers: context.req.raw.headers,
        returnHeaders: true,
      });
      session = result?.response ?? null;
      // auth.api.getSession devuelve datos, no una Response: los
      // set-cookie que encola (session_data renovada, cookies viejas
      // expiradas) hay que pasarlos a la respuesta real o el navegador
      // jamás recibe el caché renovado y cada request volvería a
      // consultar la sesión en la base.
      const setCookies = result?.headers?.getSetCookie?.() ?? [];
      for (const cookie of setCookies) {
        context.header?.("set-cookie", cookie, { append: true });
      }
    } catch (err) {
      if (isSessionInfraError(err)) {
        throw new SessionInfraError("Servicio temporalmente no disponible", { cause: err });
      }
      return null;
    }
    if (!session) return null;
    const expected = context.req.raw.headers.get("x-lecta-user-id");
    if (expected && expected !== session.user.id) return null;
    return session;
  } finally {
    await closePoolSafe(closePool, context);
  }
};

export const getSessionUser = async (context: SessionContext) => {
  const session = await getSession(context);
  return session?.user ?? null;
};
