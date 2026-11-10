// Genera el diccionario local descargable public/dict/dict-<lang>-v1.bin
// a partir del catálogo de lecta_dev — la misma fuente que el servidor para
// que lema, pos y glosas coincidan en ambos lados. La extensión es .bin a
// propósito: con .gz los servidores de desarrollo (vite) sirven
// Content-Encoding: gzip y el fetch llega ya descomprimido, rompiendo la
// verificación de SHA-256 que el cliente hace sobre los bytes crudos.
//
//   node --env-file=.env scripts/lexicon-pack.mjs --lang=es|en
//
// Formato (una línea por registro, UTF-8):
//   #lecta-dict v1 <lang>             ← cabecera
//   E<TAB>lema<TAB>pos<TAB>def1<US>def2<US>def3   ← hasta 3 acepciones
//   F<TAB>forma<TAB>lema              ← flexión → lema (solo formas ≠ lema)
// <US> = U+001F (separador de unidad; las glosas lo saneamos a espacio).
//
// Políticas:
//   · Acepciones: Wikcionario si la ficha tiene (CC BY-SA 4.0 + GFDL, el
//     dato que la licencia permite redistribuir); si no, acepciones sin
//     fuente (semilla propia de db/seed.sql — p. ej. «casa»). Las de
//     origen IA quedan fuera por política de calidad.
//   · es: formas solo de lemas con zipf ≥ 2.0 — el millón de flexiones de
//     lemas raros del Wikcionario haría la descarga y la importación
//     pesadísimas; sus lemas sí van (la palabra suelta resuelve, la flexión
//     rara cae a la IA como hasta hoy). en: todas las formas con ficha
//     (el catálogo es chico y la lista no cubre todos los lemas).
//   · Por lema se fusionan las fichas de cada pos: pos = la primera ficha y
//     acepciones concatenadas (sustantivo antes que verbo por orden
//     alfabético del pos en español). Tope de 3 acepciones y 180 chars.
//   · Salida con gzip -9 y SHA-256 del .gz impreso para copiar al cliente.

import { createWriteStream, readFileSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pg from "pg";

const VERSION = 4;
const LANG = process.argv
  .map((arg) => /^--lang=([a-z]{2})$/.exec(arg)?.[1])
  .find(Boolean) ?? "es";
if (!["es", "en"].includes(LANG)) {
  console.error(`Idioma no soportado: ${JSON.stringify(LANG)} — usa es o en.`);
  process.exit(1);
}
const OUT = `public/dict/dict-${LANG}-v${VERSION}.bin`;

const MAX_SENSES = 3;
const MAX_DEF_CHARS = 180;
// Formas flexionadas solo de lemas frecuentes (ver cabecera).
const FORM_ZIPF_MIN = LANG === "es" ? 2.0 : null;

const US = "\u001F"; // separador de unidad entre acepciones
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

// Regla por ficha: si hay acepción de Wikcionario se usa solo esa; si
// no hay ninguna, entran las de origen propio (source IS NULL). Las IA
// nunca se empaquetan.
const HAS_WK = `EXISTS (
  SELECT 1 FROM lexicon_senses w
  WHERE w.entry_id = e.id AND w.source = 'wiktionary' AND w.status = 'ok'
        AND btrim(w.definition) <> ''
)`;
const SENSE_OK = `btrim(s.definition) <> '' AND CASE WHEN ${HAS_WK}
  THEN s.source = 'wiktionary' AND s.status = 'ok'
  ELSE s.source IS NULL
END`;
const SENSED = `EXISTS (
  SELECT 1 FROM lexicon_senses s
  WHERE s.entry_id = e.id AND ${SENSE_OK}
)`;

// Fichas con acepción, con sus primeras 3 glosas por pos. El orden
// dentro del lema refleja el del servidor (lexicon.ts): freq_rank
// primero — así «casa» abre con el sustantivo (vivienda), no con la
// sección de verbo del Wikcionario; al empatar manda la ficha más
// documentada («ser» verbo antes que la abreviatura SER).
const { rows: entryRows } = await client.query(
  `SELECT e.lemma, e.pos, e.freq_rank,
          (SELECT count(*) FROM lexicon_senses s
            WHERE s.entry_id = e.id AND ${SENSE_OK}) AS nsenses,
          (SELECT string_agg(d, E'\\u001F' ORDER BY o) FROM (
             SELECT s.sense_order AS o, s.definition AS d
             FROM lexicon_senses s
             WHERE s.entry_id = e.id AND ${SENSE_OK}
             ORDER BY s.sense_order LIMIT ${MAX_SENSES}) x) AS defs
   FROM lexicon_entries e
   WHERE e.language = $1 AND ${SENSED}
   ORDER BY e.lemma, e.freq_rank NULLS LAST, nsenses DESC, e.pos`,
  [LANG],
);

// Formas flexionadas → lema (formas de lemas con acepción).
const formQuery = `
  SELECT DISTINCT f.form, e.lemma
  FROM lexicon_forms f
  JOIN lexicon_entries e ON e.id = f.entry_id
  WHERE f.language = $1 AND f.form <> e.lemma AND ${SENSED}
    ${FORM_ZIPF_MIN != null ? "AND e.zipf >= $2" : ""}
  ORDER BY f.form`;
const { rows: formRows } = await client.query(
  formQuery,
  FORM_ZIPF_MIN != null ? [LANG, FORM_ZIPF_MIN] : [LANG],
);
await client.end();

// Fusiona las fichas de un mismo lema (varias pos) en una sola línea E:
// pos de la primera ficha y acepciones concatenadas hasta el tope.
const merged = [];
for (const row of entryRows) {
  const lemma = sanitize(row.lemma);
  if (!lemma) continue;
  let current = merged[merged.length - 1];
  if (!current || current.lemma !== lemma) {
    current = { lemma, pos: row.pos ? sanitize(row.pos) : "", defs: [] };
    merged.push(current);
  }
  for (const def of (row.defs ?? "").split(US)) {
    const d = sanitize(def);
    if (d && current.defs.length < MAX_SENSES) current.defs.push(d);
  }
}

function* lines() {
  yield `#lecta-dict v${VERSION} ${LANG}`;
  for (const entry of merged) {
    const defs = entry.defs.filter(Boolean);
    if (defs.length)
      yield `E\t${entry.lemma}\t${entry.pos}\t${defs.join(US)}`;
  }
  for (const row of formRows) {
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
    `  ${merged.length} lemas · ${formRows.length} formas · ${size} bytes\n` +
    `  sha256: ${sha256}`,
);
