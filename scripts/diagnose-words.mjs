// Diagnóstico de palabras reales (Fase 4 del plan de Lecta).
// SOLO LECTURA: corre dentro de una transacción READ ONLY con
// statement_timeout; aun así no ejecuta nada de escritura.
//
// Uso:
//   node scripts/diagnose-words.mjs --user <userId> --book <bookHash>
//     [--url <connectionString>] [--out artifacts/diagnose-words.json]
//
// Conexión: --url o LECTA_DIAG_URL (o DATABASE_URL como último
// recurso). Nunca se imprime ni se lee .env directamente: quien corre
// decide la cadena — `node --env-file=.env …` la carga sin exponerla.
//
// Qué hace, en orden:
//   1. Abre transacción de solo lectura con límite de tiempo.
//   2. Verifica current_database() y el esquema de las tablas
//      esperadas; ante cualquier sorpresa se detiene sin consultar.
//   3. Corre la consulta aprobada del plan (sin cambios): palabras
//      vivas del usuario+libro sin meaning, con dos banderas:
//      definición disponible en catálogo y acepción guardada vigente.
//   4. Escribe el snapshot mínimo en JSON (stdout o --out).
//
// La pata complementaria (IndexedDB de esa cuenta) se hace a mano en
// devtools: ver la nota al final del archivo.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const USAGE =
  "Uso: node scripts/diagnose-words.mjs --user <userId> --book <bookHash> [--url <dsn>] [--out <archivo>]\n" +
  "     node scripts/diagnose-words.mjs --list  → solo conteos por cuenta/libro, para elegir el objetivo";

const parseArgs = (argv) => {
  const out = { user: null, book: null, url: null, outFile: null, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--user") out.user = value;
    else if (flag === "--book") out.book = value;
    else if (flag === "--url") out.url = value;
    else if (flag === "--out") out.outFile = value;
    else if (flag === "--list") out.list = true;
    if (flag.startsWith("--") && flag !== "--list") i += 1;
  }
  return out;
};

// Para elegir el objetivo del diagnóstico sin leer contenido: solo
// ids de cuenta y libro con su conteo de palabras sin significado.
const LIST_TARGETS_SQL = `
SELECT user_id, book_hash, COUNT(*)::INT8 AS pending
FROM lecta.lecta_user_words
WHERE deleted = false AND btrim(coalesce(meaning, '')) = ''
GROUP BY user_id, book_hash
ORDER BY pending DESC, user_id
LIMIT 50`;

export const DIAGNOSE_WORDS_SQL = `
SELECT w.form, w.lemma,
       w.sense_entry_id::STRING AS sense_entry_id,
       w.sense_order, w.saved_at, w.updated_at,
       EXISTS (
         SELECT 1 FROM lecta_dev.lexicon_forms f
         JOIN lecta_dev.lexicon_senses s ON s.entry_id = f.entry_id
         WHERE f.language = w.language AND f.form = lower(w.form)
           AND btrim(coalesce(s.definition, '')) <> ''
       ) AS catalog_has_definition,
       EXISTS (
         SELECT 1 FROM lecta_dev.lexicon_senses s
         WHERE s.entry_id = w.sense_entry_id
           AND s.sense_order = w.sense_order
           AND btrim(coalesce(s.definition, '')) <> ''
       ) AS saved_sense_exists
FROM lecta.lecta_user_words w
WHERE w.user_id = $1 AND w.book_hash = $2 AND w.deleted = false
  AND btrim(coalesce(w.meaning, '')) = ''
ORDER BY w.form`;

// Las tablas que la consulta toca deben ser alcanzables desde esta
// conexión. information_schema solo lista la base activa, así que se
// prueba con `LIMIT 0` sobre el nombre calificado — lectura de
// esquema sin traer filas; si falta alguna, se detiene sin consultar.
const EXPECTED_TABLES = [
  "lecta.lecta_user_words",
  "lecta_dev.lexicon_forms",
  "lecta_dev.lexicon_senses",
];

export async function diagnose(client, { user, book, list = false }) {
  // Candado de solo lectura: la sesión no puede escribir aunque un
  // cambio futuro del script lo intentara.
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");
  try {
    const { rows: where } = await client.query(
      "SELECT current_database() AS db, current_schema() AS schema",
    );
    const location = where[0] ?? {};
    console.log(`Conectado a base=${location.db} esquema=${location.schema}`);

    const missing = [];
    for (const table of EXPECTED_TABLES) {
      try {
        await client.query(`SELECT 1 FROM ${table} LIMIT 0`);
      } catch {
        missing.push(table);
      }
    }
    if (missing.length)
      throw new Error(
        `Tablas esperadas no alcanzables: ${missing.join(", ")}. ` +
          `Se detiene sin consultar — revisa que la conexión apunte al cluster correcto.`,
      );

    if (list) {
      const { rows } = await client.query(LIST_TARGETS_SQL);
      return {
        checkedAt: new Date().toISOString(),
        database: location.db,
        targets: rows.map((row) => ({
          user: row.user_id,
          book: row.book_hash,
          pending: Number(row.pending),
        })),
      };
    }

    const { rows } = await client.query(DIAGNOSE_WORDS_SQL, [user, book]);
    return {
      checkedAt: new Date().toISOString(),
      database: location.db,
      user,
      book,
      total: rows.length,
      rows: rows.map((row) => ({
        form: row.form,
        lemma: row.lemma,
        senseEntryId: row.sense_entry_id ?? null,
        senseOrder: row.sense_order ?? null,
        savedAt: Number(row.saved_at),
        updatedAt: Number(row.updated_at),
        catalogHasDefinition: row.catalog_has_definition === true,
        savedSenseExists: row.saved_sense_exists === true,
      })),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? process.env.LECTA_DIAG_URL ?? process.env.DATABASE_URL;
  if ((!args.list && (!args.user || !args.book)) || !url) {
    console.error(USAGE);
    if (!url)
      console.error(
        "Falta la cadena de conexión: --url, LECTA_DIAG_URL o DATABASE_URL.",
      );
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const snapshot = await diagnose(client, args);
    const json = JSON.stringify(snapshot, null, 2);
    if (args.outFile) {
      mkdirSync(dirname(args.outFile), { recursive: true });
      writeFileSync(args.outFile, `${json}\n`);
      console.log(
        `Snapshot en ${args.outFile}: ${snapshot.total} palabra(s) sin significado.`,
      );
    } else {
      process.stdout.write(`${json}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// ── Pata IndexedDB (manual, en devtools del navegador) ─────────────
// Con la cuenta correspondiente iniciada en Lecta, pegar en la
// consola (ajustar BOOK_HASH):
//
//   const BOOK_HASH = "<hash del libro>";
//   const db = await new Promise((res, rej) => {
//     // la base por cuenta es lecta:u:<userId>; el nombre sale de
//     // indexedDB.databases() si hay duda.
//     const req = indexedDB.open("lecta:u:<userId>");
//     req.onsuccess = () => res(req.result); req.onerror = rej;
//   });
//   const tx = db.transaction("savedWords");
//   const all = await new Promise((res) => {
//     const r = tx.objectStore("savedWords").getAll();
//     r.onsuccess = () => res(r.result);
//   });
//   console.table(
//     all.filter((w) => w.bookHash === BOOK_HASH && !w.deleted)
//        .map((w) => ({
//          form: w.form, lemma: w.lemma,
//          hasMeaning: !!w.meaning?.trim(),
//          senseEntryId: w.senseEntryId ?? null,
//          senseOrder: w.senseOrder ?? null,
//          hasCard: !!w.card,
//          savedAt: w.savedAt, updatedAt: w.updatedAt,
//        })),
//   );
//
// Solo lectura: getAll jamás escribe. No exportar el EPUB, cookies ni
// contexto de lectura — solo la tabla de arriba.
