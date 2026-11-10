// Enriquece con IA las entries stub (sin acepciones, pos NULL) que aparecen
// en los manifiestos de vocabulario de los libros del catálogo en inglés.
//
// A diferencia de enrich-english-ia.mjs (fuente: dump eswiktionario, pos
// conocido), aquí el POS lo determina la IA porque los stubs no lo tienen.
// La escritura es sobre la entry stub existente: UPDATE de pos + INSERT de
// sense, o fusión en la entry (lemma,pos) ya existente cuando la hay —
// así los entry_id referenciados por los manifiestos se conservan.
//
// Uso:
//   node --env-file=.env scripts/enrich-stubs-catalogo.mjs                 # dry-run, reporta objetivos
//   node --env-file=.env scripts/enrich-stubs-catalogo.mjs --apply --db=dev --limit=100
//   node --env-file=.env scripts/enrich-stubs-catalogo.mjs --apply --db=dev
//   node --env-file=.env scripts/enrich-stubs-catalogo.mjs --apply --db=prod
//
// --apply --db=dev escribe en lecta_dev; --db=prod en lecta. Sin --apply
// no se llama a la IA ni se escribe nada.
//
// Reanudable: scripts/.enrich-stubs-catalogo.progress.json (ids de entry).

import fs from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";

const ROOT = process.cwd();
const SEED_FILE = path.join(ROOT, "catalog-seed/catalog.seed.json");
const SEED_DIR = path.join(ROOT, "catalog-seed");
const PROGRESS_FILE = path.join(ROOT, "scripts/.enrich-stubs-catalogo.progress.json");

const args = process.argv.slice(2);
const get = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : null;
};
const LIMIT = get("limit") ? Number(get("limit")) : Infinity;
const CONCURRENCY = get("concurrency") ? Number(get("concurrency")) : 4;
const APPLY = args.includes("--apply");
const DB_ARG = get("db");
// Progreso por base: el default es compartido; --progress=<archivo> permite
// corridas independientes (p. ej. dev ya hecho, prod pendiente).
const PROGRESS = get("progress")
  ? path.join(ROOT, get("progress"))
  : PROGRESS_FILE;

if (APPLY && DB_ARG !== "dev" && DB_ARG !== "prod") {
  console.error("--apply requiere --db=dev o --db=prod");
  process.exit(1);
}

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (APPLY && !API_KEY) {
  console.error("Falta DEEPSEEK_API_KEY en el entorno.");
  process.exit(1);
}

const AI_BASE = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const PROMPT_VERSION = "stub-catalog-v1";
const MAX_DEF_CHARS = 480;

// POS canónicos tal como los guarda lexicon_entries.language='en'.
const VALID_POS = [
  "sustantivo", "verbo", "adjetivo", "adverbio", "pronombre",
  "preposición", "conjunción", "interjección", "determinante",
  "nombre propio", "numeral", "locución", "contracción", "abreviatura",
];

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");

const POS_LOOKUP = new Map();
for (const p of VALID_POS) POS_LOOKUP.set(norm(p), p);
// Variantes plausibles que devuelve la IA.
for (const [k, v] of Object.entries({
  nombre: "sustantivo", nombres: "sustantivo",
  "nombre propio": "nombre propio", "nombres propios": "nombre propio",
  nombrepropio: "nombre propio",
  locuciones: "locución", locucion: "locución",
  numerales: "numeral", numero: "numeral",
  contracciones: "contracción", abreviaturas: "abreviatura",
  determinantes: "determinante", interjecciones: "interjección",
  conjunciones: "conjunción", preposiciones: "preposición",
})) POS_LOOKUP.set(norm(k), v);

function canonicalPos(raw) {
  return POS_LOOKUP.get(norm(raw)) ?? null;
}

// ---------- IA ----------

async function generateEntry(lemma, books) {
  const bookHint = books.length
    ? `Aparece en: ${books.slice(0, 4).join(", ")}.`
    : "";
  const prompt = `Eres un lexicógrafo. Define la palabra inglesa "${lemma}" para un lector de novelas.
${bookHint}
Responde SOLO JSON válido, sin markdown:
{
  "pos": "categoría gramatical en español",
  "translation": "traducción corta de 2-4 palabras",
  "definition": "definición clara en español de una oración, máximo 120 caracteres"
}
pos debe ser una de: ${VALID_POS.join(", ")}. Si es un nombre de persona, lugar o personaje, usa "nombre propio". Elige el uso más frecuente si tiene varios.`;

  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Sin JSON: ${content.slice(0, 100)}`);
  const obj = JSON.parse(jsonMatch[0]);
  const pos = canonicalPos(obj.pos);
  const definition = String(obj.definition ?? "").trim().slice(0, MAX_DEF_CHARS);
  if (!pos || !definition) throw new Error(`JSON incompleto o pos inválido: ${obj.pos}`);
  return { pos, translation: String(obj.translation ?? "").trim(), definition };
}

// ---------- Objetivos ----------

function loadTargets() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const enIds = new Set(
    seed.books.filter((b) => b.language === "en").map((b) => b.id),
  );
  // lemma -> { ids:Set, books:Set(títulos), zipf }
  const byLemma = new Map();
  const titleById = new Map(seed.books.map((b) => [b.id, b.title ?? b.id]));
  for (const id of enIds) {
    const file = path.join(SEED_DIR, `${id}.vocab.json`);
    if (!existsSync(file)) continue;
    const vocab = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const e of vocab.entries ?? []) {
      const lemma = String(e.lemma ?? "").toLowerCase();
      if (!lemma) continue;
      let t = byLemma.get(lemma);
      if (!t) {
        t = { lemma, ids: new Set(), books: new Set(), zipf: null };
        byLemma.set(lemma, t);
      }
      t.ids.add(String(e.id));
      t.books.add(titleById.get(id) ?? id);
      if (e.zipf != null && (t.zipf == null || e.zipf > t.zipf)) t.zipf = e.zipf;
    }
  }
  return [...byLemma.values()];
}

async function findStubs(pool, candidates) {
  const ids = candidates.flatMap((c) => [...c.ids]);
  const { rows } = await pool.query(
    `SELECT e.id::text AS id, e.lemma, e.zipf, e.freq_rank
     FROM lexicon_entries e
     WHERE e.id = ANY($1::int8[]) AND e.language = 'en'
       AND NOT EXISTS (SELECT 1 FROM lexicon_senses s WHERE s.entry_id = e.id)`,
    [ids],
  );
  const stubById = new Map(rows.map((r) => [String(r.id), r]));
  const targets = [];
  for (const c of candidates) {
    const stubs = [...c.ids].filter((id) => stubById.has(id));
    if (!stubs.length) continue;
    targets.push({
      lemma: c.lemma,
      books: [...c.books],
      zipf: c.zipf,
      entries: stubs.map((id) => ({
        id,
        lemma: stubById.get(id).lemma,
        zipf: stubById.get(id).zipf,
      })),
    });
  }
  return targets;
}

// ---------- Escritura ----------

// Devuelve 'updated' (pos+sense en el stub) o 'merged' (fusionado en la
// entry lemma+pos ya existente). Cada llamada usa su propia conexión del
// pool: las transacciones BEGIN/COMMIT nunca se entrelazan.
async function applyEntry(pool, stubId, lemma, ai) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tgt } = await client.query(
      `SELECT id::text AS id FROM lexicon_entries
       WHERE language = 'en' AND lemma = $1 AND pos IS NOT DISTINCT FROM $2
         AND id <> $3::int8
       LIMIT 1`,
      [lemma, ai.pos, stubId],
    );

    if (tgt.length) {
      const tId = tgt[0].id;
      const { rows: dup } = await client.query(
        `SELECT 1 FROM lexicon_senses
         WHERE entry_id = $1::int8 AND btrim(definition) = btrim($2) LIMIT 1`,
        [tId, ai.definition],
      );
      if (!dup.length) {
        await client.query(
          `INSERT INTO lexicon_senses (entry_id, sense_order, definition)
           VALUES ($1::int8,
             (SELECT COALESCE(MAX(sense_order), 0) + 1 FROM lexicon_senses
              WHERE entry_id = $1::int8), $2)`,
          [tId, ai.definition],
        );
      }
      // Las forms que ya existen en el destino se descartan; el resto se remapea.
      await client.query(
        `DELETE FROM lexicon_forms f
         WHERE f.entry_id = $1::int8 AND EXISTS (
           SELECT 1 FROM lexicon_forms g
           WHERE g.language = f.language AND g.form = f.form AND g.entry_id = $2::int8)`,
        [stubId, tId],
      );
      await client.query(
        `UPDATE lexicon_forms SET entry_id = $2::int8 WHERE entry_id = $1::int8`,
        [stubId, tId],
      );
      await client.query(`DELETE FROM lexicon_entries WHERE id = $1::int8`, [stubId]);
      await client.query("COMMIT");
      return "merged";
    }

    const upd = await client.query(
      `UPDATE lexicon_entries
       SET pos = $2, source = 'ia', model_version = $3, prompt_version = $4
       WHERE id = $1::int8 AND pos IS NULL`,
      [stubId, ai.pos, MODEL, PROMPT_VERSION],
    );
    if (!upd.rowCount) throw new Error("el stub ya no tiene pos NULL");
    await client.query(
      `INSERT INTO lexicon_senses (entry_id, sense_order, definition)
       VALUES ($1::int8, 1, $2) ON CONFLICT DO NOTHING`,
      [stubId, ai.definition],
    );
    await client.query("COMMIT");
    return "updated";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Progreso ----------

function loadProgress() {
  if (!existsSync(PROGRESS)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done);
  } catch {
    return new Set();
  }
}

function saveProgress(doneSet) {
  fs.writeFileSync(PROGRESS, JSON.stringify({ done: [...doneSet] }, null, 2));
}

// ---------- Main ----------

const prodUrl = process.env.DATABASE_URL;
if (!prodUrl || !/\/lecta(\?|$)/.test(prodUrl)) {
  console.error("DATABASE_URL no apunta a lecta (prod).");
  process.exit(1);
}
const devUrl = prodUrl.replace(/\/lecta(?=\?|$)/, "/lecta_dev");

const candidates = loadTargets();
console.log(`Candidatos desde manifiestos EN: ${candidates.length} lemas`);

const url = APPLY ? (DB_ARG === "dev" ? devUrl : prodUrl) : devUrl;
const dbName = APPLY ? (DB_ARG === "dev" ? "lecta_dev" : "lecta") : "lecta_dev";
const pool = new pg.Pool({ connectionString: url, max: CONCURRENCY });
const { rows: dbRows } = await pool.query("SELECT current_database() AS db");
console.log(`Conectado a ${dbRows[0].db} (${dbName}) ${APPLY ? "" : "— dry-run"}`);

const targets = await findStubs(pool, candidates);
const totalEntries = targets.reduce((n, t) => n + t.entries.length, 0);
console.log(
  `Entries stub sin acepción en ${dbName}: ${totalEntries} ` +
    `(${targets.length} lemas, ${targets.filter((t) => t.zipf != null).length} con zipf)`,
);

if (!APPLY) {
  const porZipf = [...targets].sort((a, b) => (b.zipf ?? 0) - (a.zipf ?? 0));
  console.log("Top 15 por zipf:");
  for (const t of porZipf.slice(0, 15)) {
    console.log(`  ${t.lemma} (zipf ${t.zipf ?? "?"}, ${t.entries.length} entry, ${t.books.slice(0, 2).join(" / ")})`);
  }
  await pool.end();
  process.exit(0);
}

const doneSet = loadProgress();
let pending = [];
for (const t of targets) {
  const entries = t.entries.filter((e) => !doneSet.has(e.id));
  if (entries.length) pending.push({ ...t, entries });
}
if (LIMIT !== Infinity) {
  let acc = 0;
  const cut = [];
  for (const t of pending) {
    if (acc >= LIMIT) break;
    cut.push(t);
    acc += t.entries.length;
  }
  pending = cut;
  console.log(`--limit=${LIMIT}: procesando ${acc} entries`);
}
const pendingEntries = pending.reduce((n, t) => n + t.entries.length, 0);
console.log(`Pendientes: ${pendingEntries} entries en ${pending.length} lemas (progreso previo: ${doneSet.size})`);
if (!pendingEntries) {
  console.log("Nada pendiente.");
  await pool.end();
  process.exit(0);
}

const stats = { updated: 0, merged: 0, failed: 0 };
const aiCache = new Map();
let idx = 0;
let completed = 0;

async function worker() {
  while (idx < pending.length) {
    const t = pending[idx++];
    let ai = aiCache.get(t.lemma);
    if (!ai) {
      try {
        ai = await generateEntry(t.lemma, t.books);
        aiCache.set(t.lemma, ai);
      } catch (e) {
        stats.failed += t.entries.length;
        console.error(`  AI FAIL ${t.lemma}: ${e.message}`);
        continue;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    for (const entry of t.entries) {
      try {
        const how = await applyEntry(pool, entry.id, entry.lemma ?? t.lemma, ai);
        stats[how === "merged" ? "merged" : "updated"]++;
        doneSet.add(entry.id);
        completed++;
      } catch (e) {
        stats.failed++;
        console.error(`  WRITE FAIL ${t.lemma} (${entry.id}): ${e.message}`);
      }
    }
    if (completed % 25 === 0 || completed >= pendingEntries) {
      console.log(`[${completed}/${pendingEntries}] ${t.lemma} → ${ai.pos}: ${ai.definition.slice(0, 60)}`);
      saveProgress(doneSet);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
saveProgress(doneSet);
console.log(
  `\nTerminado en ${dbName}. updated: ${stats.updated}, merged: ${stats.merged}, failed: ${stats.failed}`,
);
await pool.end();
