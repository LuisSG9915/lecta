export type LectaConfig = {
  baseUrl: string;
  cookie?: string;
  email?: string;
  password?: string;
  timeoutMs: number;
};

export const DEFAULT_BASE_URL = "https://lecta.luis-sg9915.workers.dev";

const clean = (value: string | undefined) => value?.trim() || undefined;

/**
 * Configuración del servidor MCP. Todo se lee del entorno para que las
 * credenciales no viajen por argumentos de línea de comandos (visibles
 * en `ps` y en los logs del cliente MCP).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LectaConfig {
  const rawBase = clean(env.LECTA_BASE_URL) ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new Error(`LECTA_BASE_URL no es una URL válida: ${rawBase}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("LECTA_BASE_URL debe usar http o https.");
  }

  const timeout = Number(env.LECTA_TIMEOUT_MS);
  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    cookie: clean(env.LECTA_COOKIE),
    email: clean(env.LECTA_EMAIL),
    password: env.LECTA_PASSWORD || undefined,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1000 ? timeout : 20_000,
  };
}
