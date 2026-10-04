import { getConnectionString, type WorkerEnv } from "./db";
import { createAuth } from "./auth";

// Sesión compartida por las rutas de datos del usuario. Devuelve null
// sin base configurada o sin sesión válida — quien llama responde 401.
export const getSession = async (context: {
  env: WorkerEnv;
  req: { raw: Request; url: string };
}) => {
  if (!getConnectionString(context.env)) return null;
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  return createAuth(context.env, baseURL).api
    .getSession({ headers: context.req.raw.headers })
    .catch(() => null);
};
