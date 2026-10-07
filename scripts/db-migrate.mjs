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

export async function migrate(
  client,
  migrationsDir = MIGRATIONS_DIR,
  target = process.env.LECTA_MIGRATE_TARGET || DEFAULT_DATABASE,
) {
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
    for (const statement of statements) await client.query(statement);
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
    console.error("DATABASE_URL no está definida. Usa `pnpm db:migrate` (lee .env).");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await migrate(client);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
