import pg from "pg";

export type WorkerEnv = {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  /** Binding con caché activado (max_age 60s). Solo para lecturas stale-tolerantes\n   * (catálogo compartido, guías publicadas). NUNCA para auth/sesiones/permisos. */
  HYPERDRIVE_CACHED?: { connectionString: string };
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
  /** Stripe (docs/designs/2026-11-12-planes-y-landing.md): sin SDK, fetch directo. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY_ID?: string;
  STRIPE_PRICE_YEARLY_ID?: string;
  BOOKS?: R2Bucket;
  /** «Series y películas»: SubDL (subtítulos) y OMDb (metadatos/póster). */
  SUBDL_API_KEY?: string;
  OMDB_API_KEY?: string;
  /** Assets estáticos; el Worker les devuelve lo que no es ruta suya. */
  ASSETS?: Fetcher;
  TTS_MODEL_CDN_URL?: string;
  ENRICHMENT_WORKFLOW?: Workflow<{ forms: string[]; language?: string }>;
};

// La conexión vive solo dentro de la petición: los Workers no pueden
// compartir sockets entre invocaciones. En producción se usa el
// connectionString de Hyperdrive; en desarrollo local, DATABASE_URL.
export function getConnectionString(env?: WorkerEnv, cached = false) {
  const binding = cached ? env?.HYPERDRIVE_CACHED : env?.HYPERDRIVE;
  const hyperdrive = binding?.connectionString;
  if (hyperdrive?.startsWith("postgres")) return hyperdrive;
  // En dev (sin Hyperdrive) cae a DATABASE_URL (sin caché, igual que antes).
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

export async function withClient<T>(env: WorkerEnv, run: (client: pg.Client) => Promise<T>, cached = false) {
  const connectionString = getConnectionString(env, cached);
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

// 42P01 = tabla inexistente: lecta_account_state llega con la migración
// 023 y el worker puede desplegar antes — sin la tabla, leer el sello
// devuelve 0 y escribirlo se omite, igual que antes de la migración.
export const isMissingTableError = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "42P01";

// 42703 = columna inexistente: shared/shared_at/paper_only llegan con la
// migración 024 y el worker puede desplegar antes — como con las tablas,
// la ausencia degrada la comunidad a «aún no disponible» en vez de
// romper la ruta del libro.
export const isMissingColumnError = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "42703";

/**
 * Sello del último «borrar datos de la cuenta» en epoch ms; 0 si la
 * cuenta nunca se reinició. Vive en lecta_account_state, fuera de las
 * tablas que el reset vacía — es la señal con que otro dispositivo se
 * entera de que su copia local ya no vale.
 */
export async function readAccountResetAt(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<number> {
  try {
    const res = (await client.query(
      "SELECT reset_at FROM lecta_account_state WHERE user_id = $1",
      [userId],
    )) as { rows?: Array<{ reset_at?: unknown }> };
    const stamp = Number(res.rows?.[0]?.reset_at);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  } catch (err) {
    if (isMissingTableError(err)) return 0;
    throw err;
  }
}

/**
 * Borra todo el progreso, vocabulario, anotaciones y biblioteca del usuario
 * dentro de una transacción sin eliminar el registro del usuario (Better Auth)
 * ni reiniciar la tabla lecta_ai_quota (para evitar que se reinicie la cuenta
 * repetidamente para eludir cuotas de IA). En la misma transacción deja el
 * sello del reinicio: cualquier escritura que llegue después con una marca
 * anterior se rechaza, así un dispositivo con copia vieja no resucita lo
 * borrado. Devuelve el sello en epoch ms.
 */
export async function resetAccountDataDb(
  clientOrEnv: pg.Client | WorkerEnv,
  userId: string,
): Promise<number> {
  const resetAt = Date.now();
  const runQueries = async (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => {
    await client.query("BEGIN");
    try {
      // El sello se escribe ANTES de los borrados: su fila queda
      // bloqueada por esta transacción y un writer con la guardia
      // (SELECT ... FOR UPDATE sobre la misma fila) espera a nuestro
      // COMMIT — al despertar ve el sello nuevo y aborta. Si el writer
      // ganó antes, sus filas ya comitearon y los DELETEs de abajo las
      // barren igual que al resto.
      // El SAVEPOINT es vital: sin la tabla (despliegue antes que la
      // migración) el error envenenaría la transacción completa.
      await client.query("SAVEPOINT lecta_reset_marker");
      try {
        await client.query(
          `INSERT INTO lecta_account_state (user_id, reset_at)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET reset_at = excluded.reset_at`,
          [userId, resetAt],
        );
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
        await client.query("ROLLBACK TO SAVEPOINT lecta_reset_marker").catch(() => undefined);
      }
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
    }
  }
  return resetAt;
}


