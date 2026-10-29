import pg from "pg";

export type WorkerEnv = {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  DEEPSEEK_API_KEY?: string;
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_FROM_EMAIL?: string;
  /** Correo del dueño: abre /api/error-reports y recibe el digest de errores. */
  LECTA_OWNER_EMAIL?: string;
  BOOKS?: R2Bucket;
  BOOKS_BUCKET?: R2Bucket;
  MODELS_BUCKET?: R2Bucket;
  TTS_MODEL_CDN_URL?: string;
  ENRICHMENT_WORKFLOW?: Workflow<{ forms: string[]; language?: string }>;
  DB?: D1Database;
};

// La conexión vive solo dentro de la petición: los Workers no pueden
// compartir sockets entre invocaciones. En producción se usa el
// connectionString de Hyperdrive; en desarrollo local, DATABASE_URL.
export function getConnectionString(env?: WorkerEnv) {
  const hyperdrive = env?.HYPERDRIVE?.connectionString;
  if (hyperdrive?.startsWith("postgres")) return hyperdrive;
  return env?.DATABASE_URL;
}

// Tamaño de lote para escrituras de sincronización masiva: en lugar de
// un único INSERT con un jsonb de 500-1000 filas (declaración pesada
// que retiene la conexión y roza límites de tamaño), se fragmenta en
// varios INSERT sobre el mismo cliente. 120 queda dentro del rango
// 100-150 que Hyperdrive tolera bien por declaración.
export const SYNC_CHUNK_ROWS = 120;

export function chunks<T>(items: readonly T[], size = SYNC_CHUNK_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Los cierres de socket del ciclo de vida (el request terminó y el pool
// cerró la conexión) no son fallos: registrarlos solo llena los logs.
const EXPECTED_SOCKET_CLOSURES =
  /this socket has been closed|connection terminated/i;

export function logPostgresError(
  kind: "client" | "pool",
  err: unknown,
): void {
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  if (EXPECTED_SOCKET_CLOSURES.test(msg)) return;
  console.error(`Postgres ${kind} error:`, msg);
}

export async function withClient<T>(env: WorkerEnv, run: (client: pg.Client) => Promise<T>) {
  const connectionString = getConnectionString(env);
  if (!connectionString) return undefined;
  const client = new pg.Client({ connectionString });
  if (typeof client.on === "function") {
    client.on("error", (err) => {
      // Evita crash del proceso por error no capturado en eventos de socket
      logPostgresError("client", err);
    });
  }
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Borra todo el progreso, vocabulario, anotaciones y biblioteca del usuario
 * dentro de una transacción sin eliminar el registro del usuario (Better Auth)
 * ni reiniciar la tabla lecta_ai_quota (para evitar que se reinicie la cuenta
 * repetidamente para eludir cuotas de IA).
 */
export async function resetAccountDataDb(
  clientOrEnv: pg.Client | WorkerEnv,
  userId: string,
): Promise<void> {
  const runQueries = async (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => {
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM lecta_user_reviews WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_knowledge WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_annotations WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_positions WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_activity WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_companion_baselines WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_companion_events WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_companion_fields WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_companion_receipts WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM lecta_user_words WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM user_books WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM kindle_link_codes WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  };

  if ("query" in clientOrEnv && typeof clientOrEnv.query === "function") {
    await runQueries(clientOrEnv);
  } else {
    const env = clientOrEnv as WorkerEnv;
    if (getConnectionString(env)) {
      await withClient(env, runQueries);
    } else if (env.DB) {
      await env.DB.prepare("DELETE FROM user_books WHERE user_id = ?").bind(userId).run().catch(() => null);
      await env.DB.prepare("DELETE FROM kindle_link_codes WHERE user_id = ?").bind(userId).run().catch(() => null);
    }
  }
}


