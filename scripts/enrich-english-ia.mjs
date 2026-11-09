// Enriquecimiento masivo de inglés con IA para el catálogo léxico.
//
// Fase B del plan docs/plan-diccionario-ingles.md. Lee el dump
// data/lexicon/en-wiktionary.jsonl.gz (eswiktionario, sección «Inglés»:
// palabras inglesas con glosas ya en español) y, para los lemas que aún
// no tienen acepción en el catálogo, genera/afina la definición con DeepSeek
// e inserta en lexicon_entries / lexicon_senses / lexicon_forms.
//
// Uso:
//   node --env-file=.env scripts/enrich-english-ia.mjs [--limit=N] [--concurrency=4] [--dry-run]
//
// Reanudable: guarda progreso en scripts/.enrich-english-ia.progress.json
// (lemas ya procesados). Para apuntar a lecta_dev, usar DATABASE_URL de esa
// base (no tocar lecta sin autorización expresa).

import fs from "node:fs";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import pg from "pg";

const ROOT = process.cwd();
const DUMP_FILE = path.join(ROOT, "data/lexicon/en-wiktionary.jsonl.gz");
const PROGRESS_FILE = path.join(ROOT, "scripts/.enrich-english-ia.progress.json");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 4;
const DRY_RUN = args["dry-run"] === true;

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("Falta DEEPSEEK_API_KEY en el entorno.");
  process.exit(1);
}

const MAX_DEF_CHARS = 480;

const POS_MAP = {
  noun: "sustantivo",
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
  contraction: "contracción",
  abbrev: "abreviatura",
  unknown: null,
};

const SKIP_POS = new Set([
  "character", "symbol", "syllable", "infix", "prefix", "suffix", "affix",
]);

// ---------- IA ----------

const AI_BASE = "https://api.deepseek.com";

async function generateDefinition(word, pos) {
  const posEs = POS_MAP[pos] ?? "sustantivo";
  const prompt = `Define la palabra inglesa "${word}" (${posEs}) en español, para un lector de novelas. Devuelve SOLO JSON válido, sin markdown:
{
  "pos": "${posEs}",
  "translation": "traducción corta de 2-4 palabras",
  "definition": "definición clara de una oración, máximo 120 caracteres"
}`;

  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
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
  if (!obj.definition || !obj.pos) throw new Error(`JSON incompleto`);
  return {
    pos: String(obj.pos).toLowerCase(),
    translation: String(obj.translation || "").trim(),
    definition: String(obj.definition).trim().slice(0, MAX_DEF_CHARS),
  };
}

// ---------- Base de datos ----------

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")).done);
  } catch {
    return new Set();
  }
}

function saveProgress(doneSet) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done: [...doneSet] }, null, 2));
}

function cleanGloss(raw) {
  return String(raw ?? "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEF_CHARS);
}

function senseText(sense) {
  const glosses = (sense.glosses ?? []).map(cleanGloss).filter(Boolean);
  return glosses.join("; ").slice(0, MAX_DEF_CHARS) || null;
}

// Inserta una entrada completa (entry + sense + form) en una transacción.
async function insertEntry(client, word, pos, definition) {
  const posEs = POS_MAP[pos] ?? "sustantivo";

  // Insertar o recuperar la entrada.
  let entryId;
  const { rows: existing } = await client.query(
    `SELECT id::text AS id FROM lexicon_entries
     WHERE language='en' AND lemma=$1 AND pos IS NOT DISTINCT FROM $2`,
    [word, posEs],
  );
  if (existing.length > 0) {
    entryId = existing[0].id;
  } else {
    const { rows: created } = await client.query(
      `INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, zipf, source, status)
       VALUES ('en', $1, $2, NULL, NULL, 'ia', 'ok')
       RETURNING id::text AS id`,
      [word, posEs],
    );
    entryId = created[0].id;
  }

  // Sentido.
  await client.query(
    `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example)
     VALUES ($1, 1, $2, NULL)
     ON CONFLICT DO NOTHING`,
    [entryId, definition],
  );

  // Forma base.
  await client.query(
    `INSERT INTO lexicon_forms (language, form, entry_id)
     VALUES ('en', $1, $2)
     ON CONFLICT DO NOTHING`,
    [word, entryId],
  );

  return entryId;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: dbRows } = await client.query("SELECT current_database() AS db");
  console.log(`Conectado a ${dbRows[0].db} ${DRY_RUN ? "(solo lectura)" : ""}`);

  // Lemas que ya tienen acepción en el catálogo: no los tocamos.
  const { rows: existing } = await client.query(
    `SELECT e.lemma, e.pos FROM lexicon_entries e
     JOIN lexicon_senses s ON s.entry_id = e.id
     WHERE e.language = 'en' AND btrim(s.definition) <> ''
     GROUP BY e.lemma, e.pos`,
  );
  const hasSense = new Set(
    existing.map((r) => `${r.lemma}|${r.pos ?? ""}`),
  );
  console.log(`Lemas con acepción en catálogo: ${hasSense.size}`);

  const doneSet = loadProgress();
  console.log(`Progreso previo: ${doneSet.size} lemas procesados.`);

  // Leer el dump en streaming y encolar lo que falta.
  const input = createReadStream(DUMP_FILE);
  const stream = input.pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  const queue = [];
  let linesRead = 0;
  let skippedExisting = 0;
  let skippedPos = 0;

  for await (const line of lines) {
    linesRead += 1;
    if (linesRead > LIMIT) break;

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    const word = typeof row.word === "string" ? row.word.trim() : "";
    const pos = typeof row.pos === "string" ? row.pos : null;
    const langCode = row.lang_code;

    if (!word || /\s/.test(word) || !/\p{L}/u.test(word)) continue;
    if (langCode && langCode !== "en") continue;
    if (!pos || SKIP_POS.has(pos)) { skippedPos++; continue; }

    const key = `${word}|${pos}`;
    if (hasSense.has(key) || doneSet.has(key)) {
      skippedExisting++;
      continue;
    }

    const gloss = senseText(row.senses?.[0]);
    queue.push({ word, pos, gloss });
  }

  console.log(`Lemas para procesar: ${queue.length} (saltados existentes: ${skippedExisting}, pos no válida: ${skippedPos})`);

  if (DRY_RUN) {
    console.log("DRY-RUN: no se escribirá nada. Primeros 15:");
    queue.slice(0, 15).forEach((q) =>
      console.log(`  ${q.word} (${q.pos}) → ${q.gloss ?? "<sin glosa>"}`)
    );
    await client.end();
    return;
  }

  // Procesar con concurrencia limitada.
  const results = [];
  let idx = 0;
  let completed = 0;

  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const item = queue[i];
      try {
        const def = await generateDefinition(item.word, item.pos);
        results.push({ ...item, ...def });
        doneSet.add(`${item.word}|${item.pos}`);
        completed++;
        if (completed % 25 === 0) {
          console.log(`[${completed}/${queue.length}] ${item.word} → ${def.definition.slice(0, 60)}`);
          saveProgress(doneSet);
        }
      } catch (e) {
        console.error(`  FAIL ${item.word}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Insertar en lotes (una transacción por entrada).
  const stats = { inserted: 0, skipped: 0, failed: 0 };
  for (const r of results) {
    try {
      await client.query("BEGIN");
      await insertEntry(client, r.word, r.pos, r.definition);
      await client.query("COMMIT");
      stats.inserted++;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      stats.failed++;
      console.error(`  INSERT FAIL ${r.word}: ${e.message}`);
    }
    if ((stats.inserted + stats.failed) % 50 === 0) {
      console.log(`Insertados: ${stats.inserted}, fallos: ${stats.failed}`);
      saveProgress(doneSet);
    }
  }

  saveProgress(doneSet);
  console.log(`\nTerminado. Insertados: ${stats.inserted}, fallos: ${stats.failed}`);
  console.log(`Total procesado en esta sesión: ${completed}/${queue.length}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
