import pg from "pg";

export type WorkerEnv = {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  DEEPSEEK_API_KEY?: string;
  AI_GATEWAY_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  BOOKS?: R2Bucket;
  ENRICHMENT_WORKFLOW?: Workflow<{ forms: string[]; language?: string }>;
};

// La conexión vive solo dentro de la petición: los Workers no pueden
// compartir sockets entre invocaciones. En producción se usa el
// connectionString de Hyperdrive; en desarrollo local, DATABASE_URL.
export function getConnectionString(env: WorkerEnv) {
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  if (hyperdrive?.startsWith("postgres")) return hyperdrive;
  return env.DATABASE_URL;
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
