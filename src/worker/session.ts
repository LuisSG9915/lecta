import { getConnectionString, type WorkerEnv } from "./db";
import { createAuth } from "./auth";

// Sesión compartida por las rutas de datos del usuario. Devuelve null
// sin base configurada o sin sesión válida — quien llama responde 401.
// Las llamadas del cliente declaran la cuenta que las originó con
// `x-lecta-user-id`: si el encabezado no coincide con la sesión
// auténtica, la petición viajaba con una cookie ya renovada (la sesión
// cambió mientras estaba en vuelo) y no debe leer ni escribir nada —
// también se rechaza.
export const getSession = async (context: {
  env: WorkerEnv;
  req: { raw: Request; url: string };
}) => {
  if (!getConnectionString(context.env)) return null;
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  const session = await createAuth(context.env, baseURL).api
    .getSession({ headers: context.req.raw.headers })
    .catch(() => null);
  if (!session) return null;
  const expected = context.req.raw.headers.get("x-lecta-user-id");
  if (expected && expected !== session.user.id) return null;
  return session;
};
