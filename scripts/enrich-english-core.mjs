// Genera entradas para ENGLISH_CORE_LEXICON usando IA (DeepSeek).
//
// Uso:
//   node --env-file=.env scripts/enrich-english-core.mjs [--limit=N] [--concurrency=5]
//
// Lee candidatos de data/lexicon/en-core-candidates.txt (uno por línea),
// salta los que ya están en src/shared/english-core-lexicon.ts o en el
// archivo de salida, y escribe las nuevas entradas en
// src/shared/english-core-lexicon.generated.ts (formato listo para merge).
//
// Reanudable: guarda progreso en scripts/.enrich-english-core.progress.json.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CORE_FILE = path.join(ROOT, "src/shared/english-core-lexicon.ts");
const CANDIDATES_FILE = path.join(ROOT, "data/lexicon/en-core-candidates.txt");
const OUTPUT_FILE = path.join(ROOT, "src/shared/english-core-lexicon.generated.ts");
const PROGRESS_FILE = path.join(ROOT, "scripts/.enrich-english-core.progress.json");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 5;

const API_KEY = process.env.DEEPSEEK_API_KEY;
const GATEWAY_URL = process.env.AI_GATEWAY_URL || "https://api.deepseek.com";
const BASE_URL = GATEWAY_URL.replace(/\/+$/, "");

if (!API_KEY) {
  console.error("Falta DEEPSEEK_API_KEY en el entorno.");
  process.exit(1);
}

// Palabras ya presentes en el core.
function presentWords() {
  const src = fs.readFileSync(CORE_FILE, "utf8");
  const set = new Set([...src.matchAll(/^\s{2}([a-z][a-z'-]*):/gm)].map((m) => m[1]));
  // También las del archivo generado si existe.
  if (fs.existsSync(OUTPUT_FILE)) {
    const out = fs.readFileSync(OUTPUT_FILE, "utf8");
    for (const m of out.matchAll(/^\s{2}([a-z][a-z'-]*):/gm)) set.add(m[1]);
  }
  return set;
}

const progress = fs.existsSync(PROGRESS_FILE)
  ? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
  : { done: [], failed: [] };
const doneSet = new Set(progress.done);

function saveProgress() {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

const candidates = fs
  .readFileSync(CANDIDATES_FILE, "utf8")
  .split("\n")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const present = presentWords();
const todo = candidates
  .filter((w) => !present.has(w) && !doneSet.has(w))
  .slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`Candidatos: ${candidates.length}, presentes: ${present.size}, por hacer: ${todo.length}`);

async function callAI(word) {
  const prompt = `Given the English word "${word}", return a JSON object with:
- "pos": part of speech in Spanish (sustantivo, verbo, adjetivo, adverbio, preposición, conjunción, interjección, pronombre, determinante, locución).
- "translation": concise Spanish translation (2-5 words max).
- "definition": a clear Spanish definition in one sentence (max 120 characters).

Only output valid JSON, no markdown, no explanation.`;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
  // Extraer JSON del contenido (puede venir con ```json ... ```).
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Sin JSON: ${content.slice(0, 100)}`);
  const obj = JSON.parse(jsonMatch[0]);
  if (!obj.definition || !obj.pos) throw new Error(`JSON incompleto: ${JSON.stringify(obj)}`);
  return {
    pos: String(obj.pos).toLowerCase(),
    translation: String(obj.translation || "").trim(),
    definition: String(obj.definition).trim(),
  };
}

function escapeTs(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function appendEntry(word, entry) {
  const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(word) ? word : `"${word}"`;
  const block = `  ${key}: {\n    pos: "${escapeTs(entry.pos)}",\n    translation: "${escapeTs(entry.translation)}",\n    definition: "${escapeTs(entry.definition)}",\n  },\n`;
  fs.appendFileSync(OUTPUT_FILE, block);
}

// Inicializar archivo de salida si no existe.
if (!fs.existsSync(OUTPUT_FILE)) {
  fs.writeFileSync(
    OUTPUT_FILE,
    "// Generado por scripts/enrich-english-core.mjs — NO editar a mano.\n// Merge en src/shared/english-core-lexicon.ts tras revisión.\nexport const GENERATED_ENTRIES = {\n",
  );
}

// Worker pool.
let idx = 0;
let completed = 0;
const total = todo.length;

async function worker() {
  while (idx < todo.length) {
    const i = idx++;
    const word = todo[i];
    try {
      const entry = await callAI(word);
      appendEntry(word, entry);
      progress.done.push(word);
      completed++;
      console.log(`[${completed}/${total}] OK ${word} → ${entry.pos}: ${entry.definition.slice(0, 60)}`);
    } catch (e) {
      progress.failed.push(word);
      console.error(`[${completed + progress.failed.length}/${total}] FAIL ${word}: ${e.message}`);
    }
    if ((completed + progress.failed.length) % 10 === 0) saveProgress();
    // Pausa pequeña para no saturar.
    await new Promise((r) => setTimeout(r, 200));
  }
}

const workers = Array.from({ length: CONCURRENCY }, () => worker());
await Promise.all(workers);

// Cerrar el objeto.
if (fs.existsSync(OUTPUT_FILE)) {
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  if (!content.trim().endsWith("};")) {
    fs.appendFileSync(OUTPUT_FILE, "};\n");
  }
}
saveProgress();
console.log(`Terminado. OK: ${progress.done.length}, FAIL: ${progress.failed.length}`);

