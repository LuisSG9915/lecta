// Borra de `lecta` (prod) las copias dormidas del catálogo compartido.
//
// El worker lee el catálogo solo de `lecta_dev` (`CATALOG = "lecta_dev."`
// en src/worker/lexicon.ts y src/worker/catalog.ts). Las tablas homónimas
// de `lecta` no las lee nadie, pero ocupan almacenamiento y mantienen viva
// la recolección automática de estadísticas sobre ~1 M de filas.
//
// NO es una migración de db/migrations: `pnpm db:migrate` corre los mismos
// archivos sobre `lecta_dev`, y ahí estas tablas son el catálogo real.
//
// Barreras:
//   - Exige current_database() = 'lecta' (si no, sale 1 sin tocar nada).
//   - Exige que la copia de `lecta_dev` exista y tenga filas en cada tabla.
//   - Exige que ninguna FK de fuera del conjunto apunte a estas tablas.
//   - Sin --apply solo lee (dry-run).
//
// Uso (DATABASE_URL apunta a `lecta`):
//   node --env-file=.env scripts/drop-dormant-prod-catalog.mjs           # dry-run
//   node --env-file=.env scripts/drop-dormant-prod-catalog.mjs --apply   # borra
//
// Antes de --apply: mirar SHOW JOBS (un `SCHEMA CHANGE GC` en espera
// encola cualquier DDL hasta 75 min) y no correr otras migraciones el
// mismo día. Tras el DROP, el GC de cada tabla también ocupa la cola.
import pg from "pg";

const TARGET = "lecta";
const SOURCE = "lecta_dev";
// Hijas antes que padres: lexicon_forms/senses/items apuntan a entries.
export const DORMANT_TABLES = [
  "lexicon_items",
  "lexicon_forms",
  "lexicon_senses",
  "lexicon_entries",
  "lexicon_sources",
  "gutenberg_books",
];
const STATEMENT_TIMEOUT_MS = Number(process.env.LECTA_MIGRATE_TIMEOUT_MS) || 600_000;

async function countRows(client, db, table) {
  try {
    const { rows } = await client.query(
      `SELECT count(*)::INT8 AS n FROM ${db}.public.${table} AS OF SYSTEM TIME follower_read_timestamp()`,
    );
    return Number(rows[0].n);
  } catch {
    return null;
  }
}

async function foreignReferences(client) {
  const list = DORMANT_TABLES.map((t) => `'${t}'`).join(",");
  const { rows } = await client.query(
    `SELECT tc.table_name AS child, tc.constraint_name AS name, ccu.table_name AS parent
       FROM ${TARGET}.information_schema.table_constraints tc
       JOIN ${TARGET}.information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name IN (${list})
        AND tc.table_name NOT IN (${list})`,
  );
  return rows;
}

async function isLocked(client, table) {
  const { rows } = await client.query(`SHOW CREATE TABLE ${TARGET}.public.${table}`);
  return /schema_locked\s*=\s*true/i.test(Object.values(rows[0] ?? {}).join("\n"));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT current_database() AS db");
    if (rows[0]?.db !== TARGET) {
      throw new Error(
        `Este script solo corre sobre ${TARGET}; la conexión apunta a ${rows[0]?.db}. ` +
          `En ${SOURCE} estas tablas son el catálogo real.`,
      );
    }
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const plan = [];
    for (const table of DORMANT_TABLES) {
      const prod = await countRows(client, TARGET, table);
      const dev = await countRows(client, SOURCE, table);
      plan.push({ table, prod, dev });
    }
    console.table(plan);

    const missingSource = plan.filter(
      (p) => p.prod !== null && p.table !== "lexicon_items" && !(p.dev > 0),
    );
    if (missingSource.length) {
      throw new Error(
        `${SOURCE} no tiene copia con filas de: ${missingSource.map((p) => p.table).join(", ")}. No se borra nada.`,
      );
    }
    const refs = await foreignReferences(client);
    if (refs.length) {
      throw new Error(`Hay FK externas hacia el catálogo: ${JSON.stringify(refs)}. No se borra nada.`);
    }

    const present = plan.filter((p) => p.prod !== null).map((p) => p.table);
    if (!present.length) {
      console.log("Nada que borrar: ninguna tabla dormida existe en lecta.");
      return;
    }
    if (!apply) {
      console.log(`Dry-run: se borrarían de ${TARGET}: ${present.join(", ")}. Repite con --apply.`);
      return;
    }

    for (const table of present) {
      const fq = `${TARGET}.public.${table}`;
      if (await isLocked(client, table)) {
        await client.query(`ALTER TABLE ${fq} SET (schema_locked = false)`);
        console.log(`· ${table} desbloqueada`);
      }
      await client.query(`DROP TABLE ${fq}`);
      console.log(`✓ ${table} borrada`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
