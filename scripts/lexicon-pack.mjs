// Genera el diccionario local descargable public/dict/dict-<lang>-v6.bin
// a partir del catálogo de lecta_dev — la misma fuente que el servidor para
// que lema, pos y glosas coincidan en ambos lados. La extensión es .bin a
// propósito: con .gz los servidores de desarrollo (vite) sirven
// Content-Encoding: gzip y el fetch llega ya descomprimido, rompiendo la
// verificación de SHA-256 que el cliente hace sobre los bytes crudos.
//
//   node --env-file=.env scripts/lexicon-pack.mjs --lang=es|en
//
// Formato (una línea por registro, UTF-8):
//   #lecta-dict v6 <lang>             <- cabecera
//   E<TAB>lema<TAB>pos<TAB>def1<US>def2<US>def3<TAB>ipa   <- hasta 3 acepciones + IPA (5º campo, vacío si zipf<3)
//   F<TAB>forma<TAB>lema              <- flexión -> lema (solo formas != lema)
// <US> = U+001F (separador de unidad; las glosas lo saneamos a espacio).
//
// Políticas:
//   . Acepciones: Wikcionario si la ficha tiene (CC BY-SA 4.0 + GFDL, el
//     dato que la licencia permite redistribuir); si no, acepciones sin
//     fuente (semilla propia de db/seed.sql - p. ej. casa). Las de
//     origen IA quedan fuera por política de calidad.
//   . es: formas solo de lemas con zipf >= 2.0
//   . en: todas las formas con ficha
//   . Por lema se fusionan las fichas de cada pos.
//   . Tope de 3 acepciones y 180 chars.
//   . IPA: solo lemas con zipf >= 3 llevan IPA (5º campo). El resto campo vacío.
//   . Salida con gzip -9 y SHA-256 del .gz impreso para copiar al cliente.

import { createWriteStream, readFileSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pg from "pg";

const VERSION = 6;
const LANG = process.argv
  .map((arg) => /^--lang=([a-z]{2})$/.exec(arg)?.[1])
  .find(Boolean) ?? "es";
if (!["es", "en"].includes(LANG)) {
  console.error(`Idioma no soportado: ${JSON.stringify(LANG)} - usa es o en.`);
  process.exit(1);
}
const OUT = `public/dict/dict-${LANG}-v${VERSION}.bin`;

const MAX_SENSES = 3;
const MAX_DEF_CHARS = 180;
const FORM_ZIPF_MIN = LANG === "es" ? 2.0 : null;

const US = "\u001F";
const sanitize = (raw) =>
  String(raw ?? "")
    .replace(/[\t\n\r]/g, " ")
    .replaceAll(US, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEF_CHARS);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows: dbRows } = await client.query("SELECT current_database() AS db");
console.log(`Conectado a ${dbRows[0].db}`);

// Query 1: entries
const { rows: entryRows } = await client.query(
  `SELECT id::text AS id, lemma, pos, freq_rank, zipf, ipa
   FROM lexicon_entries
   WHERE language = $1`,
  [LANG],
);

// Query 2: senses
const { rows: senseRows } = await client.query(
  `SELECT s.entry_id::text AS entry_id, s.sense_order, s.definition, s.source, s.status
   FROM lexicon_senses s
   JOIN lexicon_entries e ON e.id = s.entry_id
   WHERE e.language = $1`,
  [LANG],
);

// Query 3: forms
const formQuery = `
  SELECT DISTINCT f.form, e.lemma, e.zipf
  FROM lexicon_forms f
  JOIN lexicon_entries e ON e.id = f.entry_id
  WHERE f.language = $1 AND f.form <> e.lemma
  ORDER BY f.form`;
const { rows: formRows } = await client.query(formQuery, [LANG]);
await client.end();

// Agrupar senses por entry
const sensesByEntry = new Map();
for (const s of senseRows) {
  const list = sensesByEntry.get(s.entry_id) ?? [];
  list.push(s);
  sensesByEntry.set(s.entry_id, list);
}

// Determinar entries sensed y sus defs
const entryData = [];
for (const e of entryRows) {
  const senses = sensesByEntry.get(e.id) ?? [];
  const hasWk = senses.some(
    (s) => s.source === "wiktionary" && s.status === "ok" && String(s.definition ?? "").trim() !== "",
  );
  const filtered = senses.filter((s) => {
    const def = String(s.definition ?? "").trim();
    if (!def) return false;
    if (hasWk) return s.source === "wiktionary" && s.status === "ok";
    return s.source === null;
  });
  if (filtered.length === 0) continue;
  const defs = filtered
    .sort((a, b) => (a.sense_order ?? 0) - (b.sense_order ?? 0))
    .map((s) => sanitize(s.definition))
    .filter(Boolean)
    .slice(0, MAX_SENSES);
  if (defs.length === 0) continue;
  entryData.push({
    lemma: e.lemma,
    pos: e.pos,
    freq_rank: e.freq_rank,
    zipf: e.zipf,
    ipa: e.ipa,
    nsenses: filtered.length,
    defs,
  });
}

// Ordenar por lemma, freq_rank NULLS LAST, nsenses DESC, pos
entryData.sort((a, b) => {
  if (a.lemma !== b.lemma) return a.lemma < b.lemma ? -1 : 1;
  const fa = a.freq_rank == null ? Infinity : a.freq_rank;
  const fb = b.freq_rank == null ? Infinity : b.freq_rank;
  if (fa !== fb) return fa - fb;
  if (b.nsenses !== a.nsenses) return b.nsenses - a.nsenses;
  const pa = a.pos ?? "";
  const pb = b.pos ?? "";
  return pa < pb ? -1 : pa > pb ? 1 : 0;
});

// Fusionar por lema
const merged = [];
for (const row of entryData) {
  const lemma = sanitize(row.lemma);
  if (!lemma) continue;
  let current = merged[merged.length - 1];
  if (!current || current.lemma !== lemma) {
    current = {
      lemma,
      pos: row.pos ? sanitize(row.pos) : "",
      defs: [],
      zipf: row.zipf,
      ipa: row.ipa ? sanitize(row.ipa) : "",
    };
    merged.push(current);
  }
  for (const d of row.defs) {
    if (d && current.defs.length < MAX_SENSES) current.defs.push(d);
  }
  if (!current.ipa && row.ipa) current.ipa = sanitize(row.ipa);
  if (current.zipf == null && row.zipf != null) current.zipf = row.zipf;
}

// Formas: filtrar por zipf y por lema con línea E (restaura SENSED).
const sensedLemmas = new Set(merged.map((m) => m.lemma));
const filteredForms = formRows.filter((r) => {
  if (FORM_ZIPF_MIN != null && (r.zipf ?? 0) < FORM_ZIPF_MIN) return false;
  if (!sensedLemmas.has(sanitize(r.lemma))) return false;
  return true;
});

function* lines() {
  yield `#lecta-dict v${VERSION} ${LANG}`;
  for (const entry of merged) {
    const defs = entry.defs.filter(Boolean);
    if (defs.length) {
      const ipa = (entry.zipf ?? 0) >= 3 ? (entry.ipa ?? "") : "";
      yield `E\t${entry.lemma}\t${entry.pos}\t${defs.join(US)}\t${ipa}`;
    }
  }
  for (const row of filteredForms) {
    const form = sanitize(row.form);
    const lemma = sanitize(row.lemma);
    if (form && lemma) yield `F\t${form}\t${lemma}`;
  }
}

const source = Readable.from(
  (function* () {
    for (const line of lines()) yield Buffer.from(`${line}\n`, "utf8");
  })(),
);
await pipeline(source, createGzip({ level: 9 }), createWriteStream(OUT));

const { size } = statSync(OUT);
const sha256 = createHash("sha256").update(readFileSync(OUT)).digest("hex");
console.log(
  `Listo: ${OUT}\n` +
    `  ${merged.length} lemas · ${filteredForms.length} formas · ${size} bytes\n` +
    `  sha256: ${sha256}`,
);
