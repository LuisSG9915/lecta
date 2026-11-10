// Reconcilia en `lecta` (prod) el enriquecimiento de stubs del catálogo
// que quedó a medias cuando se agotó el saldo de DeepSeek.
//
// Estado: lecta_dev ya tiene las 4 737 entries stub del catálogo EN
// enriquecidas (pos + sense). En prod ~2 850 se enriquecieron antes del
// corte; el resto sigue stub. Este script copia el resultado de dev SIN
// nuevas llamadas a IA:
//
//   1) UPDATE de pos/source/model_version/prompt_version en los stubs
//      que prod no llegó a tocar (dev es la fuente de verdad).
//   2) UPDATE de pos en las ~29 entries donde la IA respondió distinto
//      en cada corrida (temp 0.3 no es determinista) + su definición.
//   3) INSERT de senses que prod no tiene (anti-join por
//      entry_id+sense_order sobre TODO el catálogo en de dev).
//   4) Replica la única fusión de dev ('could' → could|verbo) en prod.
//
// Uso:
//   node --env-file=.env scripts/sync-stubs-enrich-prod.mjs          # dry-run
//   node --env-file=.env scripts/sync-stubs-enrich-prod.mjs --apply  # escribe en lecta
//
// Requiere DATABASE_URL apuntando a lecta (prod); lecta_dev se deriva.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const BACKUP_DIR = path.join(ROOT, "artifacts");
const APPLY = process.argv.includes("--apply");

const prodUrl = process.env.DATABASE_URL;
if (!prodUrl || !/\/lecta(\?|$)/.test(prodUrl)) {
  console.error("DATABASE_URL no apunta a lecta (prod).");
  process.exit(1);
}
const devUrl = prodUrl.replace(/\/lecta(?=\?|$)/, "/lecta_dev");

const dev = new pg.Client({ connectionString: devUrl });
const prod = new pg.Client({ connectionString: prodUrl });
await dev.connect();
await prod.connect();
const { rows: dbCheck } = await prod.query("SELECT current_database() AS db");
console.log(`Destino: ${dbCheck[0].db} ${APPLY ? "(ESCRITURA)" : "(dry-run)"}`);

// ---------- 1) Estado dev: entries enriquecidas por la corrida ----------
const { rows: devEntries } = await dev.query(
  `SELECT id::text AS id, lemma, pos, source, model_version, prompt_version
   FROM lexicon_entries
   WHERE language = 'en' AND prompt_version = 'stub-catalog-v1'`,
);
console.log(`dev: ${devEntries.length} entries marcadas stub-catalog-v1`);

// ---------- 2) Estado prod de esas entries ----------
const ids = devEntries.map((r) => r.id);
const prodStates = new Map();
for (let i = 0; i < ids.length; i += 2000) {
  const { rows } = await prod.query(
    `SELECT e.id::text AS id, e.pos, e.lemma,
            (SELECT count(*)::int FROM lexicon_senses s WHERE s.entry_id = e.id) AS ns
     FROM lexicon_entries e WHERE e.id = ANY($1::int8[])`,
    [ids.slice(i, i + 2000)],
  );
  for (const r of rows) prodStates.set(r.id, r);
}

const toUpdate = []; // pos NULL en prod → copiar campos de dev
const toFixPos = []; // pos distinto → alinear a dev
const alreadyOk = [];
const missingInProd = [];
for (const d of devEntries) {
  const p = prodStates.get(d.id);
  if (!p) { missingInProd.push(d.id); continue; }
  if (p.pos === null || p.ns === 0) toUpdate.push(d);
  else if (p.pos !== d.pos) toFixPos.push({ dev: d, prod: p });
  else alreadyOk.push(d.id);
}
console.log(
  `prod: ${alreadyOk.length} ya correctas | ${toUpdate.length} stubs por actualizar | ` +
    `${toFixPos.length} pos divergentes | ${missingInProd.length} ausentes`,
);
if (missingInProd.length) console.log(`  ¡OJO! ausentes en prod: ${missingInProd.slice(0, 10)}`);

// ---------- 3) Sentidos: dev → prod ----------
// Anti-join: senses de entries 'en' en dev que prod no tiene (por
// entry_id+sense_order). Cubre stubs, fusiones y el sense extra de targets.
const { rows: senseDiff } = await dev.query(
  `SELECT d.entry_id, d.sense_order, d.definition, d.example,
          d.status, d.reports, d.source
   FROM lexicon_senses d
   JOIN lexicon_entries e ON e.id = d.entry_id AND e.language = 'en'
   WHERE NOT EXISTS (
     SELECT 1 FROM lecta.lexicon_senses p
     WHERE p.entry_id = d.entry_id AND p.sense_order = d.sense_order
   )`,
);
console.log(`senses en dev que faltan en prod: ${senseDiff.length}`);

// Definiciones divergentes (mismo entry_id+sense_order, texto distinto):
// la IA no es determinista — puede discrepar en pos O solo en el texto.
// Se comparan las defs de order=1 de TODAS las entries de la corrida.
const devDefs = new Map();
for (let i = 0; i < ids.length; i += 2000) {
  const { rows } = await dev.query(
    `SELECT entry_id::text AS id, definition FROM lexicon_senses
     WHERE entry_id = ANY($1::int8[]) AND sense_order = 1`,
    [ids.slice(i, i + 2000)],
  );
  for (const r of rows) devDefs.set(r.id, r.definition);
}
const prodDefs = new Map();
for (let i = 0; i < ids.length; i += 2000) {
  const { rows } = await prod.query(
    `SELECT entry_id::text AS id, definition FROM lexicon_senses
     WHERE entry_id = ANY($1::int8[]) AND sense_order = 1`,
    [ids.slice(i, i + 2000)],
  );
  for (const r of rows) prodDefs.set(r.id, r.definition);
}
const defFixes = [];
for (const [id, devDef] of devDefs) {
  const prodDef = prodDefs.get(id);
  if (prodDef != null && prodDef !== devDef) {
    defFixes.push({ id, definition: devDef });
  }
}
console.log(`defs divergentes a alinear con dev: ${defFixes.length}`);

// ---------- 4) Fusiones dev→prod ----------
// Entries 'en' que dev ya no tiene pero que los manifiestos referenciaban:
// en la práctica solo 'could' (stub …049 → could|verbo). Se detecta
// cruzando las forms del stub en prod contra las entries destino en dev.
const { rows: devGoneCheck } = await dev.query(
  `SELECT count(*)::int AS n FROM lexicon_entries WHERE id = 1224384343554818049::int8`,
);
const couldMergedInDev = Number(devGoneCheck[0].n) === 0;
let couldMerge = null;
if (couldMergedInDev) {
  const { rows: pStub } = await prod.query(
    `SELECT lemma, pos FROM lexicon_entries WHERE id = 1224384343554818049::int8`,
  );
  if (pStub.length && pStub[0].pos === null) {
    // Target: entry dev del MISMO lemma con pos asignado (la fusionada).
    const { rows: targets } = await dev.query(
      `SELECT e.id::text AS id FROM lexicon_entries e
       WHERE e.language = 'en' AND e.lemma = $1 AND e.pos IS NOT NULL
       ORDER BY e.freq_rank NULLS LAST LIMIT 1`,
      [pStub[0].lemma],
    );
    if (targets.length) {
      couldMerge = {
        stubId: "1224384343554818049",
        lemma: pStub[0].lemma,
        targetId: targets[0].id,
      };
    }
  }
}
console.log(`fusión 'could' a replicar: ${couldMerge ? `stub → ${couldMerge.targetId}` : "no aplica"}`);

// ---------- 5) Escritura ----------
if (!APPLY) {
  console.log("\nDry-run: nada escrito. Usa --apply para ejecutar.");
  await dev.end();
  await prod.end();
  process.exit(0);
}

const backup = {
  at: new Date().toISOString(),
  toUpdate: toUpdate.map((d) => ({ id: d.id, lemma: d.lemma, pos: d.pos })),
  toFixPos: toFixPos.map(({ dev: d, prod: p }) => ({
    id: d.id, lemma: d.lemma, from: p.pos, to: d.pos,
  })),
  sensesToInsert: senseDiff.length,
  defFixes,
  couldMerge,
};
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(
  BACKUP_DIR,
  `lexicon-stubs-prod-reconcile-${backup.at.replace(/[:.]/g, "-")}.json`,
);
fs.writeFileSync(backupFile, JSON.stringify(backup));
console.log(`respaldo: ${backupFile}`);

await prod.query("BEGIN");
try {
  // 5a) stubs: copiar campos desde dev
  for (const d of toUpdate) {
    await prod.query(
      `UPDATE lexicon_entries
       SET pos = $2, source = $3, model_version = $4, prompt_version = $5
       WHERE id = $1::int8 AND pos IS NULL`,
      [d.id, d.pos, d.source, d.model_version, d.prompt_version],
    );
  }
  // 5b) divergentes: alinear pos a dev (guardia: el par lemma+pos debe estar libre)
  for (const { dev: d } of toFixPos) {
    const res = await prod.query(
      `UPDATE lexicon_entries e SET pos = $2
       WHERE e.id = $1::int8 AND e.pos IS DISTINCT FROM $2
         AND NOT EXISTS (
           SELECT 1 FROM lexicon_entries x
           WHERE x.language = 'en' AND x.lemma = e.lemma AND x.pos = $2 AND x.id <> e.id
         )`,
      [d.id, d.pos],
    );
    if (!res.rowCount) console.log(`  pos fix omitido (conflicto): ${d.lemma} → ${d.pos}`);
  }
  // 5c) senses: insertar las que faltan
  for (let i = 0; i < senseDiff.length; i += 500) {
    const chunk = senseDiff.slice(i, i + 500);
    const values = [];
    const params = [];
    chunk.forEach((s, r) => {
      const ph = ["$" + (r * 7 + 1), "$" + (r * 7 + 2), "$" + (r * 7 + 3),
        "$" + (r * 7 + 4), "$" + (r * 7 + 5), "$" + (r * 7 + 6), "$" + (r * 7 + 7)].join(",");
      values.push(`(${ph})`);
      params.push(s.entry_id, s.sense_order, s.definition, s.example, s.status, s.reports, s.source);
    });
    await prod.query(
      `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example, status, reports, source)
       VALUES ${values.join(",")}
       ON CONFLICT (entry_id, sense_order) DO NOTHING`,
      params,
    );
  }
  // 5d) definiciones divergentes → texto de dev
  for (const f of defFixes) {
    await prod.query(
      `UPDATE lexicon_senses SET definition = $2
       WHERE entry_id = $1::int8 AND sense_order = 1`,
      [f.id, f.definition],
    );
  }
  // 5e) fusión 'could'
  if (couldMerge) {
    const { stubId, targetId } = couldMerge;
    await prod.query(
      `DELETE FROM lexicon_forms f
       WHERE f.entry_id = $1::int8 AND EXISTS (
         SELECT 1 FROM lexicon_forms g
         WHERE g.language = f.language AND g.form = f.form AND g.entry_id = $2::int8)`,
      [stubId, targetId],
    );
    await prod.query(
      `UPDATE lexicon_forms SET entry_id = $2::int8 WHERE entry_id = $1::int8`,
      [stubId, targetId],
    );
    await prod.query(`DELETE FROM lexicon_entries WHERE id = $1::int8`, [stubId]);
  }
  await prod.query("COMMIT");
  console.log("escritura OK");
} catch (err) {
  await prod.query("ROLLBACK").catch(() => {});
  console.error("FALLO, rollback:", err.message);
  process.exit(1);
}

// ---------- 6) Verificación ----------
const { rows: v1 } = await prod.query(
  `SELECT count(*)::int AS n FROM lexicon_entries e
   WHERE e.language = 'en' AND e.pos IS NULL
     AND EXISTS (SELECT 1 FROM lecta_dev.lexicon_entries d
                 WHERE d.id = e.id AND d.prompt_version = 'stub-catalog-v1')`,
);
const { rows: v2 } = await prod.query(
  `SELECT count(*)::int AS n FROM lexicon_senses s
   LEFT JOIN lexicon_entries e ON e.id = s.entry_id WHERE e.id IS NULL`,
);
const { rows: v3 } = await prod.query(
  `SELECT count(*)::int AS n FROM lexicon_forms f
   LEFT JOIN lexicon_entries e ON e.id = f.entry_id WHERE e.id IS NULL`,
);
console.log(
  `verificación: stubs pendientes=${v1[0].n} | senses huérfanas=${v2[0].n} | forms huérfanas=${v3[0].n}`,
);
await dev.end();
await prod.end();
