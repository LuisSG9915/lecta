// Aplica los archivos db/migrations/*.sql en orden al DATABASE_URL del
// .env, registrando los ya aplicados en lecta_schema_migrations para no
// repetirlos. Idempotente: correrlo dos veces no cambia nada.
// Barrera de entorno: solo corre sobre lecta_dev por omisión. Otra base
// (p. ej. producción) exige nombrarla expresa en LECTA_MIGRATE_TARGET y
// que coincida con current_database() — nunca «cualquier base».
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = "db/migrations";
const DEFAULT_DATABASE = "lecta_dev";
const DEFAULT_MIGRATE_TIMEOUT_MS = 120_000;

function isTimeoutError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return (
    code === "57014" ||
    /timeout|timed out|canceling statement due to statement timeout/i.test(message)
  );
}

function normalizeTableName(raw) {
  const cleaned = String(raw ?? "").replace(/"/g, "");
  const table = cleaned.split(".").pop();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : null;
}

// Tabla sobre la que actúa un DDL que puede quedarse esperando si la
// tabla tiene schema_locked=true. CREATE TABLE no cuenta: la tabla aún
// no existe. Las sentencias que gestionan el lock explícitamente se
// dejan pasar para poder desbloquear/bloquear desde una migración.
export function extractDdlTable(statement) {
  if (/schema_locked/i.test(statement)) return null;

  const index = statement.match(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s]+\s+ON\s+(?:TABLE\s+)?("?[A-Za-z_][\w."]*)/i,
  );
  if (index) return normalizeTableName(index[1]);

  const alter = statement.match(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?!IF\b)("?[A-Za-z_][\w."]*)/i,
  );
  if (alter) return normalizeTableName(alter[1]);

  const drop = statement.match(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?!IF\b)("?[A-Za-z_][\w."]*)/i,
  );
  if (drop) return normalizeTableName(drop[1]);

  return null;
}

// Antes de ejecutar el DDL: si la tabla está protegida, fallar con una
// instrucción clara en vez de esperar indefinidamente (Cockroach deja la
// sentencia en espera, sin error, hasta que se desbloquee).
export async function assertTableUnlocked(client, statement) {
  const table = extractDdlTable(statement);
  if (!table) return;

  let ddl;
  try {
    const result = await client.query(`SHOW CREATE TABLE ${table}`);
    ddl = Object.values(result.rows[0] ?? {}).join("\n");
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `No se pudo verificar schema_locked de ${table} (tiempo agotado). Revisa la tabla antes de migrar.`,
        { cause: error },
      );
    }
    // La tabla no existe: CREATE TABLE la creará o el DDL fallará solo.
    return;
  }

  if (/schema_locked\s*=\s*true/i.test(ddl)) {
    throw new Error(
      `La tabla ${table} tiene schema_locked=true. Desbloquéala solo para esta migración y vuelve a bloquearla después:\n` +
        `  ALTER TABLE ${table} SET (schema_locked = false);\n` +
        `  ...migración...\n` +
        `  ALTER TABLE ${table} SET (schema_locked = true);`,
    );
  }
}

export async function migrate(
  client,
  migrationsDir = MIGRATIONS_DIR,
  target = process.env.LECTA_MIGRATE_TARGET || DEFAULT_DATABASE,
) {
  const timeoutMs =
    Number(process.env.LECTA_MIGRATE_TIMEOUT_MS) || DEFAULT_MIGRATE_TIMEOUT_MS;
  // current_database() antes de cualquier escritura: si la conexión
  // apunta a otra base se aborta sin ejecutar ni una línea de SQL.
  const { rows } = await client.query("SELECT current_database() AS db");
  const db = rows[0]?.db;
  if (db !== target)
    throw new Error(
      `Este migrador solo corre sobre ${target}; la conexión apunta a ${db}. Revisa DATABASE_URL.`,
    );
  console.log(`Conectado a la base ${db}`);

  await client.query(
    `CREATE TABLE IF NOT EXISTS lecta_schema_migrations (
       name STRING PRIMARY KEY,
       applied_at INT8 NOT NULL
     )`,
  );
  const { rows: applied } = await client.query(
    "SELECT name FROM lecta_schema_migrations",
  );
  const done = new Set(applied.map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (done.has(file)) {
      console.log(`· ${file} (ya aplicada)`);
      continue;
    }
    const statements = readFileSync(`${migrationsDir}/${file}`, "utf8")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await assertTableUnlocked(client, statement);
      try {
        await client.query(statement);
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new Error(
            `La sentencia de ${file} excedió el tiempo límite (${timeoutMs} ms). ` +
              "Si la tabla tiene schema_locked=true, desbloquéala explícitamente antes de migrar.",
            { cause: error },
          );
        }
        throw error;
      }
    }
    await client.query(
      "INSERT INTO lecta_schema_migrations (name, applied_at) VALUES ($1, $2)",
      [file, Date.now()],
    );
    console.log(`✓ ${file}`);
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile?.(".env");
    } catch {
      /* ignore */
    }
  }

  const isRemote = process.argv.includes("--remote") || process.argv.includes("--prod");
  const isLocal = process.argv.includes("--local") || process.argv.includes("--dev");

  if (isRemote) {
    process.env.LECTA_MIGRATE_TARGET = "lecta";
    if (process.env.DATABASE_URL_PROD) {
      process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
    } else if (process.env.DATABASE_URL?.includes("/lecta_dev")) {
      process.env.DATABASE_URL = process.env.DATABASE_URL.replace("/lecta_dev", "/lecta");
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL no está definida. Usa `pnpm db:migrate` (lee .env).");
    process.exit(1);
  }

  const target = isRemote
    ? "lecta"
    : isLocal
      ? "lecta_dev"
      : process.env.LECTA_MIGRATE_TARGET || DEFAULT_DATABASE;

  const timeoutMs =
    Number(process.env.LECTA_MIGRATE_TIMEOUT_MS) || DEFAULT_MIGRATE_TIMEOUT_MS;
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
  });
  await client.connect();
  try {
    await client
      .query(
        `CREATE OR REPLACE FUNCTION unixepoch() RETURNS INT8 AS $$
           SELECT extract(epoch from now())::INT8;
         $$ LANGUAGE SQL;`,
      )
      .catch(() => {});

    await migrate(client, MIGRATIONS_DIR, target);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
