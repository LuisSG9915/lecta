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
  BOOKS?: R2Bucket;
  ENRICHMENT_WORKFLOW?: Workflow<{ forms: string[]; language?: string }>;
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

export async function withClient<T>(env: WorkerEnv, run: (client: pg.Client) => Promise<T>) {
  const connectionString = getConnectionString(env);
  if (!connectionString) return undefined;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

