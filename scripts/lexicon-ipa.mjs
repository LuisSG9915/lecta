// Backfill de pronunciación IPA en el catálogo léxico desde el dump
// kaikki (sounds[].ipa). El loader lexicon-wiktionary.mjs es
// insert-if-not-exists y NO rellena filas existentes, por eso este
// script dedicado hace UPDATE por lema. Idempotente.
//
//   node --env-file=.env scripts/lexicon-ipa.mjs [--lang=es|en] [--limit=N]
//
// Política de IPA:
//   · Por registro, tomar el primer sounds[].ipa no vacío, preferir
//     los que no tienen tags regionales (raw_tags/tags); si ninguno
//     está sin tags, el primero con tags.
//   · Quitar /…/ o […] y guardar el IPA desnudo.
//   · Un IPA por lema: actualiza todas las filas (pos) del lema.
//
// Licencia de los datos: CC BY-SA 4.0 + GFDL (docs/licencias-lexico.md).

import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import pg from "pg";

const LANG = process.argv
  .map((arg) => /^--lang=([a-z]{2})$/.exec(arg)?.[1])
  .find(Boolean) ?? "es";
const KAIKKI_LANG_NAME = { es: "Español", en: "Inglés" }[LANG];
if (!KAIKKI_LANG_NAME) {
  console.error(`Idioma no soportado: ${JSON.stringify(LANG)}.`);
  process.exit(1);
}
const LIMIT = process.argv
  .map((arg) => /^--limit=(\d+)$/.exec(arg)?.[1])
  .find(Boolean);

const file = [`data/lexicon/${LANG}-wiktionary.jsonl.gz`, `data/lexicon/${LANG}-wiktionary.jsonl`]
  .find(existsSync);
if (!file) {
  console.error(
    `Falta data/lexicon/${LANG}-wiktionary.jsonl.gz — descárgalo de\n` +
      `  https://kaikki.org/eswiktionary/${KAIKKI_LANG_NAME}/kaikki.org-dictionary-${KAIKKI_LANG_NAME}.jsonl.gz`,
  );
  process.exit(1);
}

const pickIpa = (row) => {
  const sounds = Array.isArray(row.sounds) ? row.sounds : [];
  const candidates = sounds
    .map((s) => ({ ipa: typeof s?.ipa === "string" ? s.ipa.trim() : "", tags: s?.raw_tags ?? s?.tags }))
    .filter((c) => c.ipa);
  if (!candidates.length) return null;
  const untagged = candidates.find((c) => !Array.isArray(c.tags) || c.tags.length === 0);
  const chosen = (untagged ?? candidates[0]).ipa;
  return chosen.replace(/^[/[]+/, "").replace(/[/\]]+$/, "").trim() || null;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a ${rows[0].db} · origen ${file}`);

  const ipaByLemma = new Map();
  const input = createReadStream(file);
  const stream = file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let stats = { lines: 0, skipped: 0, withIpa: 0 };
  for await (const line of lines) {
    stats.lines += 1;
    if (LIMIT && stats.lines > Number(LIMIT)) break;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      stats.skipped += 1;
      continue;
    }
    const word = typeof row.word === "string" ? row.word.trim() : "";
    if (!word || /\s/.test(word) || !/\p{L}/u.test(word) ||
        (row.lang_code && row.lang_code !== LANG)) {
      stats.skipped += 1;
      continue;
    }
    const ipa = pickIpa(row);
    if (!ipa) continue;
    const lemma = word.toLowerCase();
    if (!ipaByLemma.has(lemma)) ipaByLemma.set(lemma, ipa);
    stats.withIpa += 1;
  }

  console.log(`Registros: ${stats.lines}; con IPA: ${stats.withIpa}; lemas únicos: ${ipaByLemma.size}.`);

  const entries = [...ipaByLemma.entries()];
  const BATCH = 1000;
  let updated = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const valuesSql = batch.map((_, idx) => `($${idx * 2 + 1}::STRING, $${idx * 2 + 2}::STRING)`).join(", ");
    const params = batch.flatMap(([lemma, ipa]) => [lemma, ipa]);
    const sql = `UPDATE lexicon_entries AS e SET ipa = v.ipa
      FROM (VALUES ${valuesSql}) AS v(lemma, ipa)
      WHERE e.language = $${params.length + 1} AND e.lemma = v.lemma`;
    params.push(LANG);
    const r = await client.query(sql, params);
    updated += r.rowCount ?? 0;
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: +${r.rowCount} filas (total ${updated})`);
  }

  const { rows: counts } = await client.query(
    "SELECT count(*)::int AS n FROM lexicon_entries WHERE language = $1 AND ipa IS NOT NULL",
    [LANG],
  );
  console.log(`Lemas con IPA en ${LANG}: ${counts[0].n}.`);
  console.log("Listo.");
} finally {
  await client.end();
}
