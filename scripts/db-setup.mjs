import { readFileSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL no está definida. Usa `pnpm db:setup` (lee .env).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a la base ${rows[0].db}`);

  for (const file of ["db/schema.sql", "db/seed.sql"]) {
    const statements = readFileSync(file, "utf8")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await client.query(statement);
    console.log(`Aplicado ${file}`);
  }

  const { rows: counts } = await client.query(
    "SELECT (SELECT count(*) FROM lexicon_entries) AS entradas, (SELECT count(*) FROM lexicon_forms) AS formas, (SELECT count(*) FROM lexicon_senses) AS acepciones",
  );
  console.log(counts[0]);
} finally {
  await client.end();
}
