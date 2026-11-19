// Genera el diccionario local descargable public/dict/dict-<lang>-v7.bin
// a partir del catálogo de lecta_dev — la misma fuente que el servidor para
// que lema, pos y glosas coincidan en ambos lados. La extensión es .bin a
// propósito: con .gz los servidores de desarrollo (vite) sirven
// Content-Encoding: gzip y el fetch llega ya descomprimido, rompiendo la
// verificación de SHA-256 que el cliente hace sobre los bytes crudos.
//
//   node --env-file=.env scripts/lexicon-pack.mjs --lang=es|en
//
// Formato (una línea por registro, UTF-8):
//   #lecta-dict v7 <lang>             <- cabecera
//   E<TAB>lema<TAB>pos<TAB>def1<US>def2<US>def3<TAB>ipa<TAB>ej1<US>ej2<US>ej3
//        hasta 3 acepciones + IPA (5º campo, vacío si zipf<3) + ejemplos
//        (6º campo, una casilla por acepción, vacía si no hay; el campo se
//        omite entero si el lema no lleva ejemplo — el parser tolera 5 cols)
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
//   . Tope de 3 acepciones y 180 chars (al truncar se corta en límite de
//     palabra y se añade «…»).
//   . Ejemplos: solo lemas con zipf >= 3, máx. 1 por lema (el de la primera
//     acepción que lo tenga), <=120 chars en es y <=80 en en, cortado en
//     límite de palabra con «…».
//   . Si el v7 pesa >15 % más que el v6 (gzip) el script sale con código 1.
//   . IPA: solo lemas con zipf >= 3 llevan IPA (5º campo). El resto campo vacío.
//   . Salida con gzip -9 y SHA-256 del .gz impreso para copiar al cliente.

import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pg from "pg";

const VERSION = 7;
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
const EXAMPLE_ZIPF_MIN = 3;
const MAX_EXAMPLE_CHARS = LANG === "es" ? 120 : 80;
const MAX_GROWTH = 0.15;

const US = "\u001F";
// Recorta a max chars cortando en límite de palabra y añadiendo «…»; nunca
// parte una palabra a medias (si no hay espacio, corta duro).
const truncate = (text, max) => {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const cut = room.lastIndexOf(" ");
  const head = (cut > 0 ? room.slice(0, cut) : room).replace(/[\s,;:.\-–—]+$/u, "");
  return `${head}…`;
};
const sanitize = (raw, max = MAX_DEF_CHARS) =>
  truncate(
    String(raw ?? "")
      .replace(/[\t\n\r]/g, " ")
      .replaceAll(US, " ")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  );

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
  `SELECT s.entry_id::text AS entry_id, s.sense_order, s.definition, s.example, s.source, s.status
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
    .map((s) => ({ d: sanitize(s.definition), x: sanitize(s.example, MAX_EXAMPLE_CHARS) }))
    .filter((s) => s.d)
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
  for (const sense of row.defs) {
    if (sense.d && current.defs.length < MAX_SENSES) current.defs.push(sense);
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
    const senses = entry.defs.filter((s) => s.d);
    if (senses.length) {
      const frequent = (entry.zipf ?? 0) >= EXAMPLE_ZIPF_MIN;
      const ipa = frequent ? (entry.ipa ?? "") : "";
      // Un solo ejemplo por lema: el de la primera acepción que lo tenga.
      const exIndex = frequent ? senses.findIndex((s) => s.x) : -1;
      const tail = exIndex >= 0
        ? `\t${senses.map((s, i) => (i === exIndex ? s.x : "")).join(US)}`
        : "";
      yield `E\t${entry.lemma}\t${entry.pos}\t${senses.map((s) => s.d).join(US)}\t${ipa}${tail}`;
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
const prevOut = `public/dict/dict-${LANG}-v${VERSION - 1}.bin`;
const prevSize = existsSync(prevOut) ? statSync(prevOut).size : null;
const sha256 = createHash("sha256").update(readFileSync(OUT)).digest("hex");
console.log(
  `Listo: ${OUT}\n` +
    `  ${merged.length} lemas · ${filteredForms.length} formas · ${size} bytes\n` +
    `  sha256: ${sha256}`,
);
if (prevSize != null) {
  const growth = size / prevSize - 1;
  console.log(`  gzip v${VERSION - 1}: ${prevSize} -> v${VERSION}: ${size} (${(growth * 100).toFixed(1)} %)`);
  if (growth > MAX_GROWTH) {
    console.error(`v${VERSION} supera +${MAX_GROWTH * 100} % del v${VERSION - 1}: revisar recortes.`);
    process.exit(1);
  }
}
