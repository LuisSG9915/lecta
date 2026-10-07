// Genera public/lexicon/locuciones.es.json: el índice estático de
// locuciones que el lector consulta en el cliente (fase B). Lee el
// mismo dump del Wikcionario que lexicon-wiktionary.mjs, pero se
// queda con lo que ese loader descarta: entradas cuyo lema tiene
// espacio (locuciones, proverbios, compuestos como «media luna»)
// más los sinónimos con espacio que apuntan a una entrada propia
// («morder el anzuelo» → sentido de «picar el anzuelo»).
//
// Uso: node scripts/lexicon-phrases.mjs  (regenerar solo cuando se
// actualice el dump; el JSON se commitea, el dump está gitignored).
//
// Salida: { version: 1, entries: [{p, pos, d}] } — p = lema de la
// locución, pos = vocabulario del catálogo, d = hasta 2 glosas.

import { createReadStream } from "node:fs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const MAX_DEF_CHARS = 480;
const MAX_DEFS = 2;
const OUT = "public/lexicon/locuciones.es.json";

// Mismo mapa del loader: lo que no es vocabulario legible se descarta.
const POS_MAP = {
  noun: "sustantivo",
  name: "nombre propio",
  verb: "verbo",
  adj: "adjetivo",
  adv: "adverbio",
  pron: "pronombre",
  prep: "preposición",
  conj: "conjunción",
  intj: "interjección",
  article: "determinante",
  det: "determinante",
  num: "numeral",
  participle: "participio",
  particle: "partícula",
  phrase: "locución",
  prep_phrase: "locución",
  proverb: "proverbio",
  contraction: "contracción",
  abbrev: "abreviatura",
  unknown: null,
};

const file = ["data/lexicon/es-wiktionary.jsonl.gz", "data/lexicon/es-wiktionary.jsonl"].find(
  (path) => existsSync(path),
);
if (!file) {
  console.error("Falta data/lexicon/es-wiktionary.jsonl.gz");
  process.exit(1);
}

const cleanGloss = (raw) =>
  String(raw ?? "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEF_CHARS);

const senseGloss = (sense) => {
  const glosses = (sense.glosses ?? []).map(cleanGloss).filter(Boolean);
  return glosses.join("; ").slice(0, MAX_DEF_CHARS);
};

const hasSpace = (word) => typeof word === "string" && /\s/.test(word) && /\p{L}/u.test(word);
const keyOf = (word) => word.replace(/\s+/g, " ").trim().toLowerCase();

// Clave = lema normalizado; alias=true marca sinónimos emitidos y
// permite que una entrada propia que llegue después lo reemplace.
const out = new Map();
const stats = { entries: 0, aliases: 0, aliasDupes: 0, noGloss: 0, skippedPos: 0 };

const emit = (key, record) => {
  const prev = out.get(key);
  if (prev && !prev.alias) {
    if (record.alias) stats.aliasDupes += 1;
    return; // la entrada propia siempre gana al alias
  }
  out.set(key, record);
};

const stream = createReadStream(file).pipe(
  file.endsWith(".gz") ? createGunzip() : (await import("node:stream")).PassThrough(),
);
const rl = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of rl) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  const word = row.word;
  if (typeof word !== "string") continue;
  const pos = Object.hasOwn(POS_MAP, row.pos) ? POS_MAP[row.pos] : null;
  const rowIsPhrase = hasSpace(word);
  const rowHasSynonymPhrases = (row.synonyms ?? []).some((syn) => hasSpace(syn.word));
  if (!rowIsPhrase && !rowHasSynonymPhrases) continue;
  if (pos === null) {
    if (rowIsPhrase) stats.skippedPos += 1;
    // Un lema simple sin pos mapeada puede igual alojar sinónimos
    // con espacio: se emiten como «locución» con la glosa del sinónimo.
  }

  const defs = (row.senses ?? []).map(senseGloss).filter(Boolean).slice(0, MAX_DEFS);
  if (rowIsPhrase) {
    if (defs.length) {
      emit(keyOf(word), { p: word, pos, d: defs, alias: false });
      stats.entries += 1;
    } else {
      stats.noGloss += 1;
    }
  }

  for (const syn of row.synonyms ?? []) {
    if (!hasSpace(syn.word)) continue;
    const key = keyOf(syn.word);
    if (key === keyOf(word)) continue;
    const sense = cleanGloss(syn.sense);
    const aliasDefs = sense ? [sense] : defs.slice(0, 1);
    if (!aliasDefs.length) continue;
    emit(key, {
      p: syn.word,
      // Si el canónico es una locución heredamos su pos; si es un
      // lema simple («picar» → «picar el anzuelo») la forma con
      // espacio es locución por definición.
      pos: rowIsPhrase ? pos : "locución",
      d: aliasDefs,
      alias: true,
    });
    stats.aliases += 1;
  }
}

const entries = [...out.values()]
  .map(({ p, pos, d }) => ({ p, pos, d }))
  .sort((a, b) => a.p.localeCompare(b.p, "es"));

mkdirSync("public/lexicon", { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ version: 1, entries })}\n`);
console.log(`escrito ${OUT}: ${entries.length} entradas`);
console.log(`  propias ${stats.entries} · alias ${stats.aliases} · sin glosa ${stats.noGloss} · pos descartada ${stats.skippedPos} · alias sobre propia ${stats.aliasDupes}`);
