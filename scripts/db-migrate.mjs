// Aplica los archivos db/migrations/*.sql en orden al DATABASE_URL del
// .env, registrando los ya aplicados en lecta_schema_migrations para no
// repetirlos. Idempotente: correrlo dos veces no cambia nada.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL no está definida. Usa `pnpm db:migrate` (lee .env).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a la base ${rows[0].db}`);

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

  const files = readdirSync("db/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (done.has(file)) {
      console.log(`· ${file} (ya aplicada)`);
      continue;
    }
    const statements = readFileSync(`db/migrations/${file}`, "utf8")
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
} finally {
  await client.end();
}
