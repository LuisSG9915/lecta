// Copia el catálogo léxico inglés de lecta_dev → lecta (Fase B del plan
// docs/plan-diccionario-ingles.md) minimizando la ventana sin datos:
//
//   1) Inserta los datos de dev con language='en_new' (invisible para las
//      consultas, que filtran language='en'); el catálogo viejo sigue
//      sirviendo mientras tanto.
//   2) --swap: borra las entradas 'en' viejas de prod (cascade a
//      senses/forms) y renombra 'en_new' → 'en' en sentencias sueltas
//      (CockroachDB reintenta solo las sentencias únicas; la txn única de
//      ~365k filas abortaba). Ventana sin definiciones en inglés: segundos.
//
// Verificado antes de escribir: 0 colisiones de id, 19 011/19 011 pares
// (lemma,pos) de prod cubiertos en dev con sentidos, 0 duplicados en dev.
// Backup previo en artifacts/lexicon-en-prod-backup-*.json.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const ART = path.join(ROOT, "artifacts");
const SWAP = process.argv.includes("--swap");
const CHUNK = 3000;

const prodUrl = process.env.DATABASE_URL;
if (!prodUrl || !/\/lecta(\?|$)/.test(prodUrl)) {
  console.error("DATABASE_URL no apunta a lecta (prod).");
  process.exit(1);
}
const devUrl = prodUrl.replace(/\/lecta(?=\?|$)/, "/lecta_dev");

const prod = new pg.Client({ connectionString: prodUrl });
const dev = new pg.Client({ connectionString: devUrl });
await prod.connect();
await dev.connect();

async function insertRows(client, table, columns, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((row, r) => {
      const ph = columns.map((_, c) => `$${r * columns.length + c + 1}`).join(",");
      values.push(`(${ph})`);
      for (const col of columns) params.push(row[col]);
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(",")}`,
      params,
    );
  }
  console.log(`  ${table}: ${rows.length} filas`);
}

const ENTRY_COLS = ["id", "language", "lemma", "pos", "freq_rank", "zipf", "source", "status", "model_version", "prompt_version"];
const SENSE_COLS = ["entry_id", "sense_order", "definition", "example", "status", "reports", "source"];
const FORM_COLS = ["language", "form", "entry_id", "source", "ambiguous"];

if (SWAP) {
  // Guardia: solo intercambiar si 'en_new' está completo (misma cuenta que dev).
  const [newCount, devCount] = await Promise.all([
    prod.query("SELECT count(*) n FROM lexicon_entries WHERE language='en_new'"),
    dev.query("SELECT count(*) n FROM lexicon_entries WHERE language='en'"),
  ]);
  if (newCount.rows[0].n !== devCount.rows[0].n) {
    console.error(`Abortado: prod tiene ${newCount.rows[0].n} 'en_new' pero dev tiene ${devCount.rows[0].n} 'en'. Corre primero la fase de inserción.`);
    process.exit(1);
  }
  console.log(`swap: ${newCount.rows[0].n} entries 'en_new' verificadas contra dev`);
  // La txn única de ~365k filas aborta en CockroachDB (serializable).
  // Sentencias sueltas: CRDB las reintenta solo y la ventana sin 'en' es
  // de segundos (el español no se toca). Orden obligado: borrar antes de
  // renombrar por la unique (language, lemma, pos).
  console.log("swap: borrando 'en' viejo (sentencia única, auto-retry)…");
  const del = await prod.query("DELETE FROM lexicon_entries WHERE language='en'");
  console.log(`  entries 'en' viejas borradas: ${del.rowCount}`);
  console.log("renombrando entries 'en_new' → 'en'…");
  const ue = await prod.query("UPDATE lexicon_entries SET language='en' WHERE language='en_new'");
  console.log(`  entries renombradas: ${ue.rowCount}`);
  console.log("renombrando forms 'en_new' → 'en'…");
  const uf = await prod.query("UPDATE lexicon_forms SET language='en' WHERE language='en_new'");
  console.log(`  forms renombrados: ${uf.rowCount}`);
  const e = await prod.query("SELECT count(*) n FROM lexicon_entries WHERE language='en'");
  const s = await prod.query(`SELECT count(*) n FROM lexicon_senses s JOIN lexicon_entries e2 ON e2.id=s.entry_id WHERE e2.language='en'`);
  const f = await prod.query("SELECT count(*) n FROM lexicon_forms WHERE language='en'");
  console.log(`prod final: entries=${e.rows[0].n} senses=${s.rows[0].n} forms=${f.rows[0].n}`);
  await prod.end();
  await dev.end();
  process.exit(0);
}

fs.mkdirSync(ART, { recursive: true });

// 1. Backup de lo que prod tiene hoy en inglés (siempre, con sello de tiempo)
const bEntries = (await prod.query("SELECT * FROM lexicon_entries WHERE language='en' ORDER BY id")).rows;
const bSenses = (await prod.query(`SELECT s.* FROM lexicon_senses s JOIN lexicon_entries e ON e.id = s.entry_id WHERE e.language='en'`)).rows;
const bForms = (await prod.query("SELECT * FROM lexicon_forms WHERE language='en'")).rows;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(ART, `lexicon-en-prod-backup-${stamp}.json`);
fs.writeFileSync(backupFile, JSON.stringify({ entries: bEntries, senses: bSenses, forms: bForms }));
console.log(`backup: ${bEntries.length}/${bSenses.length}/${bForms.length} → ${backupFile}`);

// 2. Datos de dev (inglés) → insertar como 'en_new'
const entries = (await dev.query(
  `SELECT id, language, lemma, pos, freq_rank, zipf, source, status, model_version, prompt_version
   FROM lexicon_entries WHERE language='en' ORDER BY id`,
)).rows.map((r) => ({ ...r, language: "en_new" }));
const senses = (await dev.query(
  `SELECT s.entry_id, s.sense_order, s.definition, s.example, s.status, s.reports, s.source
   FROM lexicon_senses s JOIN lexicon_entries e ON e.id = s.entry_id WHERE e.language='en'`,
)).rows;
console.log(`dev: ${entries.length} entries, ${senses.length} senses`);

// Limpieza de un intento previo a medias (no debería haber 'en_new' aún)
const prev = await prod.query("SELECT count(*) n FROM lexicon_entries WHERE language='en_new'");
if (Number(prev.rows[0].n) > 0) {
  console.error(`Ya hay ${prev.rows[0].n} entries 'en_new' en prod — aborta para no duplicar.`);
  process.exit(1);
}

console.log("insertando entries (en_new)…");
await insertRows(prod, "lexicon_entries", ENTRY_COLS, entries);
console.log("insertando senses…");
await insertRows(prod, "lexicon_senses", SENSE_COLS, senses);

// Forms por lotes de entries (acota memoria)
let formsTotal = 0;
for (let i = 0; i < entries.length; i += CHUNK) {
  const ids = entries.slice(i, i + CHUNK).map((r) => r.id);
  const forms = (await dev.query(
    "SELECT language, form, entry_id, source, ambiguous FROM lexicon_forms WHERE language='en' AND entry_id = ANY($1::bigint[])",
    [ids],
  )).rows.map((r) => ({ ...r, language: "en_new" }));
  await insertRows(prod, "lexicon_forms", FORM_COLS, forms);
  formsTotal += forms.length;
  console.log(`  forms lote ${i / CHUNK + 1}: +${forms.length} (acum ${formsTotal})`);
}

const en = await prod.query("SELECT count(*) n FROM lexicon_entries WHERE language='en'");
const enn = await prod.query("SELECT count(*) n FROM lexicon_entries WHERE language='en_new'");
const fNew = await prod.query("SELECT count(*) n FROM lexicon_forms WHERE language='en_new'");
console.log(`prod: 'en'=${en.rows[0].n} (viejas, intactas) · 'en_new'=${enn.rows[0].n} entries, forms=${fNew.rows[0].n}`);
console.log("Listo para el swap: node --env-file=.env scripts/sync-lexicon-en-prod.mjs --swap");

await prod.end();
await dev.end();
