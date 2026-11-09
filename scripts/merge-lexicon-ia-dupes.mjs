// Fusiona las entries léxicas inglesas enriquecidas por IA/AI que quedaron
// duplicadas bajo el POS equivocado ('sustantivo') cuando ya existe la entry
// correcta (lemma, pos real) en el catálogo.
//
// Para cada par (E duplicada → T correcta):
//   1) Mueve los sentidos de E a T (sense_order correlativo tras el máximo de T,
//      saltando definiciones idénticas ya presentes en T).
//   2) Remapea las formas de E a T; las que ya existan en T se descartan
//      (PK de lexicon_forms es (language, form, entry_id)).
//   3) Rellena freq_rank/zipf de T con los de E solo donde T los tiene nulos.
//   4) Borra E (sus sentidos/formas ya se movieron; el resto hace cascade).
//
// La lista de pares se recalcula aquí mismo desde el dump kaikki
// (data/lexicon/en-wiktionary.jsonl.gz), igual que scripts/fix-lexicon-pos.mjs.
// Solo entran pares con POS único en el dump y (lemma,pos destino) existente.
//
// Uso:
//   node --env-file=.env scripts/merge-lexicon-ia-dupes.mjs                 # dry-run
//   node --env-file=.env scripts/merge-lexicon-ia-dupes.mjs --apply --db=dev
//   node --env-file=.env scripts/merge-lexicon-ia-dupes.mjs --apply --db=prod
//
// --db=dev escribe en lecta_dev; --db=prod en lecta. Sin --db, dry-run en ambas.
// Antes de escribir hace un respaldo JSON en artifacts/lexicon-merge-backup-*.json.

import pg from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import { createReadStream } from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbArg = args.find((a) => a.startsWith("--db="))?.split("=")[1];
const proposalPath = args.find((a) => a.startsWith("--proposal="))?.split("=")[1];
if (dbArg && !["dev", "prod"].includes(dbArg)) {
  console.error("--db debe ser dev o prod");
  process.exit(1);
}
if (proposalPath && !existsSync(proposalPath)) {
  console.error(`No existe la propuesta: ${proposalPath}`);
  process.exit(1);
}

const POS_MAP = {
  noun: "sustantivo", verb: "verbo", adj: "adjetivo", adv: "adverbio",
  pron: "pronombre", prep: "preposición", conj: "conjunción",
  intj: "interjección", article: "determinante", det: "determinante",
  num: "numeral", participle: "participio", particle: "partícula",
  phrase: "locución", prep_phrase: "locución", name: "nombre propio",
  contraction: "contracción", abbrev: "abreviatura",
};

const prodUrl = process.env.DATABASE_URL;
if (!prodUrl || !/\/lecta(\?|$)/.test(prodUrl)) {
  console.error("DATABASE_URL no apunta a lecta (prod).");
  process.exit(1);
}
const devUrl = prodUrl.replace(/\/lecta(?=\?|$)/, "/lecta_dev");

async function loadDumpPos() {
  const map = new Map();
  const s = createReadStream("data/lexicon/en-wiktionary.jsonl.gz").pipe(zlib.createGunzip());
  const r = readline.createInterface({ input: s });
  await new Promise((resolve) => {
    r.on("line", (l) => {
      try {
        const o = JSON.parse(l);
        const w = (o.word || "").toLowerCase();
        const p = o.pos;
        if (w && p) {
          if (!map.has(w)) map.set(w, new Set());
          map.get(w).add(p);
        }
      } catch { /* línea inválida */ }
    });
    r.on("close", resolve);
  });
  return map;
}

async function findPairs(client, dumpPos) {
  const { rows: entries } = await client.query(
    `SELECT id::text AS id, lemma, pos, source, freq_rank, zipf
     FROM lexicon_entries WHERE language = 'en' AND source IN ('ia','ai')`,
  );
  const { rows: all } = await client.query(
    `SELECT id::text AS id, lemma, pos FROM lexicon_entries WHERE language = 'en'`,
  );
  const byPair = new Map(all.map((r) => [`${r.lemma}::${r.pos ?? ""}`, r.id]));
  const pairs = [];
  for (const e of entries) {
    const set = dumpPos.get(e.lemma.toLowerCase());
    if (!set || set.size !== 1) continue;
    const target = POS_MAP[[...set][0]];
    if (!target || target === e.pos) continue;
    const tId = byPair.get(`${e.lemma}::${target}`);
    if (tId && tId !== e.id) pairs.push({ eId: e.id, tId, lemma: e.lemma, from: e.pos, to: target, source: e.source });
  }
  return pairs;
}

async function mergePair(client, p, stats) {
  // Sentidos de E.
  const { rows: esenses } = await client.query(
    `SELECT sense_order, definition, example, source, status, reports
     FROM lexicon_senses WHERE entry_id = $1::int8 ORDER BY sense_order`, [p.eId]);
  const { rows: tsenses } = await client.query(
    `SELECT definition FROM lexicon_senses WHERE entry_id = $1::int8`, [p.tId]);
  const have = new Set(tsenses.map((r) => r.definition));
  const { rows: [{ maxOrder }] } = await client.query(
    `SELECT COALESCE(MAX(sense_order), 0)::int AS "maxOrder" FROM lexicon_senses WHERE entry_id = $1::int8`, [p.tId]);

  let next = Number(maxOrder) + 1;
  const toInsert = [];
  for (const s of esenses) {
    if (have.has(s.definition)) { stats.sensesDup++; continue; }
    toInsert.push([p.tId, next, s.definition, s.example, s.source, s.status, s.reports]);
    have.add(s.definition);
    next++;
    stats.sensesMoved++;
  }
  if (toInsert.length) {
    const tuples = toInsert.map((_, j) =>
      `($${j * 7 + 1}::int8, $${j * 7 + 2}::int, $${j * 7 + 3}::text, $${j * 7 + 4}::text, $${j * 7 + 5}::text, $${j * 7 + 6}::text, $${j * 7 + 7}::int)`);
    const params = toInsert.flatMap((t) => [t[0], t[1], t[2], t[3] ?? null, t[4] ?? null, t[5] ?? null, t[6] ?? 0]);
    await client.query(
      `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example, source, status, reports)
       VALUES ${tuples.join(",")}`, params);
  }

  // Formas: remap a T salvo duplicados (language, form, entry_id).
  const remap = await client.query(
    `UPDATE lexicon_forms f SET entry_id = $2::int8
     WHERE f.entry_id = $1::int8 AND f.language = 'en'
       AND NOT EXISTS (SELECT 1 FROM lexicon_forms x
                       WHERE x.language = 'en' AND x.form = f.form AND x.entry_id = $2::int8)`,
    [p.eId, p.tId]);
  stats.formsMoved += remap.rowCount ?? 0;
  const delForms = await client.query(
    `DELETE FROM lexicon_forms WHERE entry_id = $1::int8 AND language = 'en'`, [p.eId]);
  stats.formsDup += delForms.rowCount ?? 0;

  // Frecuencia: rellenar nulos de T con los de E.
  await client.query(
    `UPDATE lexicon_entries T SET
       freq_rank = COALESCE(T.freq_rank, E.freq_rank),
       zipf     = COALESCE(T.zipf, E.zipf)
     FROM lexicon_entries E WHERE T.id = $1::int8 AND E.id = $2::int8`, [p.tId, p.eId]);

  // Borrar la duplicada.
  await client.query(`DELETE FROM lexicon_entries WHERE id = $1::int8`, [p.eId]);
  stats.entriesDeleted++;
}

async function backupPairs(client, pairs) {
  const ids = pairs.map((p) => p.eId);
  const out = { at: new Date().toISOString(), pairs: [] };
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const tuples = slice.map((_, j) => `($${j + 1}::int8)`).join(",");
    const { rows: senses } = await client.query(
      `SELECT entry_id::text AS entry_id, sense_order, definition, example, source, status, reports
       FROM lexicon_senses WHERE entry_id IN (${tuples}) ORDER BY entry_id, sense_order`, slice);
    const { rows: forms } = await client.query(
      `SELECT entry_id::text AS entry_id, language, form, source, ambiguous
       FROM lexicon_forms WHERE entry_id IN (${tuples})`, slice);
    const byE = new Map();
    for (const s of senses) { const k = s.entry_id; if (!byE.has(k)) byE.set(k, { senses: [], forms: [] }); byE.get(k).senses.push(s); }
    for (const f of forms) { const k = f.entry_id; if (!byE.has(k)) byE.set(k, { senses: [], forms: [] }); byE.get(k).forms.push(f); }
    for (const id of slice) out.pairs.push({ entryId: id, ...(byE.get(id) ?? { senses: [], forms: [] }) });
  }
  return out;
}

// Modo propuesta: pares 'merge' (target existe) + updates 'update' (target no existe),
// resueltos contra el estado actual de la base.
async function findPairsFromProposal(client, proposal) {
  const { rows: all } = await client.query(
    `SELECT id::text AS id, lemma, pos FROM lexicon_entries WHERE language = 'en'`,
  );
  const byPair = new Map(all.map((r) => [`${r.lemma}::${r.pos ?? ""}`, r.id]));
  const pairs = [];
  const updates = [];
  const skipped = [];
  for (const item of proposal) {
    if (item.decision === "merge") {
      const tId = byPair.get(`${item.lemma}::${item.target}`);
      if (tId && tId !== item.id) pairs.push({ eId: item.id, tId, lemma: item.lemma, from: "sustantivo", to: item.target, source: item.source });
      else skipped.push(`${item.lemma}::${item.target}`);
    } else if (item.decision === "update") {
      updates.push({ id: item.id, lemma: item.lemma, target: item.target });
    }
  }
  return { pairs, updates, skipped };
}

async function verify(client) {
  const q = async (sql) => (await client.query(sql)).rows[0];
  return {
    orphanSenses: (await q(`SELECT count(*)::int n FROM lexicon_senses s LEFT JOIN lexicon_entries e ON e.id=s.entry_id WHERE e.id IS NULL`)).n,
    orphanForms: (await q(`SELECT count(*)::int n FROM lexicon_forms f LEFT JOIN lexicon_entries e ON e.id=f.entry_id WHERE e.id IS NULL`)).n,
    enEntries: (await q(`SELECT count(*)::int n FROM lexicon_entries WHERE language='en'`)).n,
    iaAiEntries: (await q(`SELECT count(*)::int n FROM lexicon_entries WHERE language='en' AND source IN ('ia','ai')`)).n,
  };
}

const dumpPos = proposalPath ? null : await loadDumpPos();
if (dumpPos) console.log(`dump: ${dumpPos.size} lemas`);
const proposal = proposalPath ? JSON.parse(readFileSync(proposalPath, "utf8")) : null;

const targets = apply && dbArg ? [{ name: dbArg === "dev" ? "lecta_dev" : "lecta", url: dbArg === "dev" ? devUrl : prodUrl }]
  : [{ name: "lecta_dev", url: devUrl }, { name: "lecta", url: prodUrl }];

for (const t of targets) {
  const client = new pg.Client({ connectionString: t.url });
  await client.connect();
  try {
    const before = await verify(client);
    const { pairs, updates, skipped } = proposal
      ? await findPairsFromProposal(client, proposal)
      : { pairs: await findPairs(client, dumpPos), updates: [], skipped: [] };
    if (skipped?.length) console.log(`[${t.name}] omitidos (target ya no existe): ${skipped.length}`);
    console.log(`[${t.name}] pares a fusionar: ${pairs.length} | updates de pos: ${updates.length} | entries ia/ai: ${before.iaAiEntries}`);
    if (!pairs.length && !updates.length) continue;
    if (!apply) { console.log(`[${t.name}] dry-run (sin escritura).`); continue; }

    const backup = await backupPairs(client, [...pairs, ...updates.map((u) => ({ eId: u.id }))]);
    const file = `artifacts/lexicon-merge-backup-${t.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(backup));
    console.log(`[${t.name}] respaldo: ${file}`);

    const stats = { sensesMoved: 0, sensesDup: 0, formsMoved: 0, formsDup: 0, entriesDeleted: 0, updatesApplied: 0 };
    const CHUNK = 40;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      await client.query("BEGIN");
      try {
        for (const p of slice) await mergePair(client, p, stats);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`chunk ${i / CHUNK} falló: ${err.message}`, { cause: err });
      }
      if ((i / CHUNK) % 5 === 0) console.log(`[${t.name}] ${i + slice.length}/${pairs.length} pares…`);
    }

    // Updates de POS sin target existente (guardia NOT EXISTS + idempotente).
    for (const u of updates) {
      const res = await client.query(
        `UPDATE lexicon_entries E SET pos = $2
         WHERE E.id = $1::int8 AND E.language = 'en' AND E.pos = 'sustantivo'
           AND NOT EXISTS (SELECT 1 FROM lexicon_entries x
                           WHERE x.language = 'en' AND x.lemma = E.lemma AND x.pos = $2 AND x.id <> E.id)`,
        [u.id, u.target]);
      stats.updatesApplied += res.rowCount ?? 0;
    }
    const after = await verify(client);
    console.log(`[${t.name}] stats:`, JSON.stringify(stats));
    console.log(`[${t.name}] verificación:`, JSON.stringify(after));
  } catch (err) {
    console.error(`[${t.name}] ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}
console.log(apply ? "Listo." : "Dry-run: usa --apply --db=dev|prod para escribir.");
