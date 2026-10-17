#!/usr/bin/env node
// Auditoría local de consumo DeepSeek del primer capítulo narrativo.
// Dry-run por defecto: extrae formas, consulta el catálogo en solo
// lectura y congela candidatos. Con --live usa la API real sólo para
// evaluar prompts (máx. 40 llamadas totales), nunca inserta fichas.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { isStopword } from "../src/shared/stopwords.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EPUB = process.argv.includes("--epub")
  ? process.argv[process.argv.indexOf("--epub") + 1]
  : "fixtures/real.epub";
const TARGET_SECTION = process.argv.includes("--section")
  ? process.argv[process.argv.indexOf("--section") + 1]
  : "OEBPS/Text/Cap001.xhtml";
const OUT_DIR = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(ROOT, "artifacts", "ai-token-audit");
const LIVE = process.argv.includes("--live");
const SUMMARIZE = process.argv.includes("--summarize");
const SAMPLE_LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 20);
const MAX_ATTEMPTS = 40;
const LANGUAGE = "es";
const THRESHOLD = 3.5;
const AUTO_CAP = 20;
const PREDICT_CAP = 40;
const MODEL = "deepseek-flash";
const VERSION = "enrich-audit-2026-10-05";
// Tarifas DeepSeek Flash publicadas: USD por millón de tokens.
const RATES = {
  offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
};

const BASELINE_SYSTEM = `Eres un lexicógrafo de español. Para una palabra dada, devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"lemma":"<lema en minúsculas>","pos":"<categoría>","freqRank":<número entero estimado de frecuencia: 1 es la palabra más común; null si no sabes>,"forms":["<formas flexionadas comunes, en minúsculas>"],"senses":[{"definition":"<definición breve en español>","example":"<oración de ejemplo en español>"}]}
Reglas: "pos" debe ser una de: sustantivo, verbo, adjetivo, adverbio, pronombre, preposición, conjunción, interjección, determinante, locución. Incluye de 1 a 3 acepciones, de la más común a la menos. No inventes acepciones raras. Si la forma es flexionada (plural, conjugación, género), "lemma" es la forma base e incluye la forma consultada en "forms".`;

const OPTIMIZED_SYSTEM = `Eres lexicógrafo de español. Responde SOLO JSON válido con:
{"lemma":"lema minúsculas","pos":"categoría","freqRank":entero|null,"forms":["hasta 20 formas flexionadas"],"senses":[{"definition":"<=160 caracteres","example":"<=200 caracteres"}]}
pos ∈ sustantivo, verbo, adjetivo, adverbio, pronombre, preposición, conjunción, interjección, determinante, locución. 1-3 acepciones, común→rara. Sin acepciones raras ni texto extra. Si es flexión, lemma es la base e incluye la forma consultada en forms.`;

const htmlEntities = {
  quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " ",
};
const decodeHtml = (value) =>
  value.replace(/&(quot|apos|amp|lt|gt|nbsp);/g, (_, name) => htmlEntities[name]);

const sectionText = (html) =>
  decodeHtml(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "\n"),
  ).trim();

const uniqueWords = (text) => {
  const words = [];
  for (const part of new Intl.Segmenter(LANGUAGE, { granularity: "word" }).segment(text))
    if (part.isWordLike) words.push(part.segment);
  return words;
};

const capitalOnly = (words) => {
  const capitalized = new Set();
  const lowercased = new Set();
  for (const surface of words) {
    const first = surface.charAt(0);
    if (!first) continue;
    const lower = surface.toLowerCase();
    if (first.toLowerCase() === first) lowercased.add(lower);
    else capitalized.add(lower);
  }
  return new Set([...capitalized].filter((form) => !lowercased.has(form)));
};

const dedupeKey = (entry) => entry.entry_id ?? `${entry.lemma}::${entry.pos ?? ""}`;
const byRarity = (a, b) =>
  (a.zipf ?? Number.POSITIVE_INFINITY) - (b.zipf ?? Number.POSITIVE_INFINITY) ||
  a.form.localeCompare(b.form);

const predict = (forms, entriesByForm) => {
  const predictedKeys = new Set();
  const candidates = [];
  const missing = [];
  let knownCount = 0;
  for (const form of forms) {
    const entries = entriesByForm[form] ?? [];
    if (!entries.length) {
      missing.push(form);
      continue;
    }
    const pick = entries.some((entry) => entry.zipf != null && entry.zipf >= THRESHOLD)
      ? undefined
      : entries
          .filter((entry) => !predictedKeys.has(dedupeKey(entry)))
          .sort((a, b) => (b.zipf ?? -1) - (a.zipf ?? -1))[0];
    if (pick) {
      predictedKeys.add(dedupeKey(pick));
      candidates.push({ form, entry: pick });
    } else knownCount += 1;
  }
  candidates.sort(byRarity);
  const predicted = candidates.slice(0, PREDICT_CAP);
  knownCount += candidates.length - predicted.length;
  return { predicted, missing, knownCount, total: forms.length };
};

const legacyCandidates = (prediction, capitalOnlySet) =>
  [
    ...new Set([
      ...prediction.missing,
      ...prediction.predicted.filter((item) => !item.entry.senses?.length).map((item) => item.form),
    ]),
  ]
    .filter((form) => !capitalOnlySet.has(form))
    .slice(0, AUTO_CAP);

const improvedCandidates = (prediction, capitalOnlySet) => {
  const selected = [];
  const entrySeen = new Set();
  const formSeen = new Set();
  const add = (form, entry) => {
    if (!form || capitalOnlySet.has(form) || formSeen.has(form)) return;
    const entryKey = entry?.entry_id ? `id:${entry.entry_id}` : null;
    if (entryKey && entrySeen.has(entryKey)) return;
    formSeen.add(form);
    if (entryKey) entrySeen.add(entryKey);
    selected.push({
      form,
      // La primera forma consultada evita seguir lemas dudosos del
      // catálogo (p. ej. «abajo» enlazado a «abajar»); la deduplicación
      // del servidor sigue siendo por entrada.
      promptForm: form,
      catalogLemma: entry?.lemma ?? null,
      entryId: entry?.entry_id ?? null,
      zipf: entry?.zipf ?? null,
      reason: entry ? "entry_without_senses" : "missing",
    });
  };
  for (const item of prediction.predicted)
    if (!item.entry.senses?.length) add(item.form, item.entry);
  for (const form of prediction.missing) add(form, null);
  return selected.slice(0, AUTO_CAP);
};

const usageNumber = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const readUsage = (data) => ({
  promptTokens: usageNumber(data?.usage?.prompt_tokens),
  completionTokens: usageNumber(data?.usage?.completion_tokens),
  totalTokens: usageNumber(data?.usage?.total_tokens),
  cacheHitTokens: usageNumber(
    data?.usage?.prompt_cache_hit_tokens ?? data?.usage?.prompt_tokens_details?.cached_tokens,
  ),
  cacheMissTokens: usageNumber(data?.usage?.prompt_cache_miss_tokens),
  reasoningTokens: usageNumber(data?.usage?.completion_tokens_details?.reasoning_tokens),
});

const addUsage = (target, usage) => {
  for (const key of [
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "cacheHitTokens",
    "cacheMissTokens",
    "reasoningTokens",
  ]) {
    if (typeof usage?.[key] === "number") target[key] += usage[key];
  }
  if (typeof usage?.completionTokens === "number")
    target.maxCompletionTokens = Math.max(
      target.maxCompletionTokens,
      usage.completionTokens,
    );
};

const cost = (usage, rate) =>
  (usage.cacheHitTokens * rate.cacheHit +
    usage.cacheMissTokens * rate.cacheMiss +
    usage.completionTokens * rate.output) /
  1_000_000;

const summarizeCalls = (calls) => {
  const variants = {};
  for (const call of calls) {
    const bucket = variants[call.variant] ??= {
      calls: 0,
      ok: 0,
      failed: 0,
      truncated: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      reasoningTokens: 0,
      maxCompletionTokens: 0,
      durationMs: 0,
      maxDurationMs: 0,
    };
    bucket.calls += 1;
    if (call.result?.ok) bucket.ok += 1;
    else bucket.failed += 1;
    if (call.result?.finishReason === "length") bucket.truncated += 1;
    addUsage(bucket, call.result?.usage);
    if (typeof call.result?.durationMs === "number") {
      bucket.durationMs += call.result.durationMs;
      bucket.maxDurationMs = Math.max(bucket.maxDurationMs, call.result.durationMs);
    }
  }
  for (const bucket of Object.values(variants)) {
    bucket.avgDurationMs = bucket.calls ? Math.round(bucket.durationMs / bucket.calls) : null;
    bucket.costUsd = {
      offPeak: cost(bucket, RATES.offPeak),
      peak: cost(bucket, RATES.peak),
    };
    delete bucket.durationMs;
  }
  const baseline = variants.baseline;
  const optimized = variants.optimized;
  const comparison = baseline && optimized
    ? {
        tokenDelta: optimized.totalTokens - baseline.totalTokens,
        tokenDeltaPct: baseline.totalTokens
          ? (optimized.totalTokens - baseline.totalTokens) / baseline.totalTokens
          : null,
        costDeltaUsd: {
          offPeak: optimized.costUsd.offPeak - baseline.costUsd.offPeak,
          peak: optimized.costUsd.peak - baseline.costUsd.peak,
        },
      }
    : null;
  return { ratesPerMillionUsd: RATES, variants, comparison };
};

async function askDeepSeek(system, user, maxTokens) {
  const base = (process.env.AI_GATEWAY_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const started = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      ...(process.env.AI_GATEWAY_KEY ? { "cf-aig-authorization": `Bearer ${process.env.AI_GATEWAY_KEY}` } : {}),
      ...(base.includes("gateway.ai.cloudflare.com") ? { "cf-aig-collect-log-payload": "false" } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      thinking: { type: "disabled" },
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const durationMs = Date.now() - started;
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "invalid-json", status: response.status, durationMs };
  }
  if (!response.ok) return { ok: false, reason: "api-error", status: response.status, durationMs };
  const choice = data?.choices?.[0];
  return {
    ok: true,
    status: response.status,
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: data?.model ?? null,
    usage: readUsage(data),
    durationMs,
  };
}

async function loadCatalog(forms) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const [{ db }] = (await client.query("SELECT current_database() AS db")).rows;
    if (db !== "lecta_dev") throw new Error(`Base inesperada: ${db}`);
    const { rows } = await client.query(
      `SELECT f.form AS queried_form, e.id::text AS entry_id, e.lemma, e.pos,
              e.freq_rank, e.zipf, s.definition, s.example, s.sense_order
       FROM lexicon_forms f
       JOIN lexicon_entries e ON e.id = f.entry_id
       LEFT JOIN lexicon_senses s ON s.entry_id = e.id
       WHERE f.language = $1 AND f.form = ANY($2)
       ORDER BY f.form, e.freq_rank NULLS LAST, s.sense_order`,
      [LANGUAGE, forms],
    );
    const grouped = new Map();
    for (const row of rows) {
      const list = grouped.get(row.queried_form) ?? new Map();
      const key = `${row.lemma}::${row.pos ?? ""}`;
      const entry = list.get(key) ?? {
        entry_id: row.entry_id,
        lemma: row.lemma,
        pos: row.pos,
        freqRank: row.freq_rank,
        zipf: row.zipf == null ? null : Number(row.zipf),
        senses: [],
      };
      if (row.definition)
        entry.senses.push({
          definition: row.definition,
          example: row.example,
          senseOrder: row.sense_order == null ? null : Number(row.sense_order),
        });
      list.set(key, entry);
      grouped.set(row.queried_form, list);
    }
    return Object.fromEntries([...grouped].map(([form, map]) => [form, [...map.values()]]));
  } finally {
    await client.end().catch(() => undefined);
  }
}

const CHARS_PER_TOKEN_ES = 3.8;

const ZERO_FRICTION_SCENARIOS = [
  {
    task: 'word_context',
    label: 'Tarjeta Única WordPanel (1 toque)',
    sampleInputChars: 190,
    promptOverheadChars: 95,
    maxOutputTokens: 75,
    callsPerSession: 6,
  },
  {
    task: 'paragraph_translate',
    label: 'Doble Toque Traducir Párrafo (EN -> ES)',
    sampleInputChars: 520,
    promptOverheadChars: 75,
    maxOutputTokens: 260,
    callsPerSession: 4,
  },
  {
    task: 'page_recap',
    label: '🐱 ¿En qué me quedé? (15s sin spoilers)',
    sampleInputChars: 2100,
    promptOverheadChars: 130,
    maxOutputTokens: 140,
    callsPerSession: 1,
  },
  {
    task: 'character_cards',
    label: '👥 ¿Quién está en esta página?',
    sampleInputChars: 1200,
    promptOverheadChars: 115,
    maxOutputTokens: 120,
    callsPerSession: 1,
  },
];

const TASK_BUDGETS = {
  word_context: { maxInputChars: 280, maxOutputTokens: 75, temperature: 0.15 },
  paragraph_translate: { maxInputChars: 900, maxOutputTokens: 260, temperature: 0.10 },
  page_recap: { maxInputChars: 2400, maxOutputTokens: 140, temperature: 0.25 },
  character_cards: { maxInputChars: 1600, maxOutputTokens: 120, temperature: 0.20 },
};

export function runZeroFrictionTokenAudit() {
  let totalSessionInputTokens = 0;
  let totalSessionOutputTokens = 0;

  for (const s of ZERO_FRICTION_SCENARIOS) {
    const budget = TASK_BUDGETS[s.task];
    if (budget && s.maxOutputTokens > budget.maxOutputTokens) {
      throw new Error(
        `Presupuesto excedido en ${s.task}: maxOutputTokens=${s.maxOutputTokens} supera el tope de ${budget.maxOutputTokens}`,
      );
    }
  }

  const rows = ZERO_FRICTION_SCENARIOS.map((s) => {
    const estInputTokens = Math.ceil(
      (s.sampleInputChars + s.promptOverheadChars) / CHARS_PER_TOKEN_ES,
    );
    const sessionIn = estInputTokens * s.callsPerSession;
    const sessionOut = s.maxOutputTokens * s.callsPerSession;
    totalSessionInputTokens += sessionIn;
    totalSessionOutputTokens += sessionOut;

    return {
      Tarea: s.label,
      'Tokens Entrada/Llamada': estInputTokens,
      'Tope Salida (maxOutputTokens)': s.maxOutputTokens,
      'Llamadas/Sesión': s.callsPerSession,
      'Total Tokens/Sesión': sessionIn + sessionOut,
    };
  });

  console.log("\n==================================================================");
  console.log("       LECTA — AUDITORÍA ZERO-FRICTION DE TOKENS (FASE 3)");
  console.log("==================================================================");
  console.table(rows);
  console.log(
    `📊 Presupuesto Total Estimado por Sesión de Lectura: ${
      totalSessionInputTokens + totalSessionOutputTokens
    } tokens (Entrada: ${totalSessionInputTokens}, Salida máx: ${totalSessionOutputTokens})\n`,
  );
}

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      process.loadEnvFile?.(path.join(ROOT, ".env"));
    }
  } catch {}

  runZeroFrictionTokenAudit();

  await mkdir(OUT_DIR, { recursive: true });
  if (SUMMARIZE) {
    const callsPath = path.join(OUT_DIR, "calls.json");
    const callsFile = JSON.parse(await readFile(callsPath, "utf8"));
    const summary = summarizeCalls(callsFile.calls ?? []);
    await writeFile(
      path.join(OUT_DIR, "summary.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), model: callsFile.model ?? MODEL, summary }, null, 2),
    );
    console.log(`Resumen A/B: ${OUT_DIR}/summary.json`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const epubPath = path.resolve(ROOT, EPUB);
  let epubBytes;
  try {
    epubBytes = await readFile(epubPath);
  } catch (err) {
    console.warn(`Aviso: No se pudo leer EPUB (${epubPath}): ${err.message}`);
    return;
  }
  const epubSha = createHash("sha256").update(epubBytes).digest("hex");
  const zip = new ZipReader(new BlobReader(new Blob([epubBytes])));
  const entries = await zip.getEntries();
  const sectionEntry = entries.find((entry) => entry.filename === TARGET_SECTION);
  if (!sectionEntry) throw new Error(`No existe la sección ${TARGET_SECTION}`);
  const html = await sectionEntry.getData(new TextWriter());
  await zip.close();
  const text = sectionText(html);
  const words = uniqueWords(text);
  const surface = [...new Set(words)];
  const forms = [...new Set(words.map((word) => word.toLowerCase()))].filter(
    (form) => !isStopword(form, LANGUAGE),
  );
  const capitals = capitalOnly(words);

  let catalog;
  try {
    catalog = await loadCatalog(forms);
  } catch (err) {
    console.warn(`Aviso: No se pudo conectar a la base de datos para la auditoría de catálogo (${err.message}). Omitiendo captura.`);
    return;
  }
  const prediction = predict(forms, catalog);
  const legacy = legacyCandidates(prediction, capitals);
  const improved = improvedCandidates(prediction, capitals);
  const selected = improved.slice(0, Math.min(SAMPLE_LIMIT, MAX_ATTEMPTS / 2));

  const manifest = {
    version: VERSION,
    book: { path: path.relative(ROOT, epubPath), bytes: epubBytes.length, sha256: epubSha },
    target: { section: TARGET_SECTION, textSha256: createHash("sha256").update(text).digest("hex") },
    scenario: { language: LANGUAGE, threshold: THRESHOLD, saved: 0, knowledge: 0 },
    counts: {
      textChars: text.length,
      wordTokens: words.length,
      surfaceForms: surface.length,
      uniqueForms: forms.length,
      capitalOnly: capitals.size,
      catalogForms: Object.keys(catalog).length,
      predicted: prediction.predicted.length,
      missing: prediction.missing.length,
      noSensesPredicted: prediction.predicted.filter((item) => !item.entry.senses?.length).length,
      legacyCandidates: legacy.length,
      improvedCandidates: improved.length,
    },
    candidates: {
      legacy,
      improved: improved.map(({ form, promptForm, catalogLemma, entryId, reason }) => ({
        form,
        promptForm,
        catalogLemma,
        entryId,
        reason,
      })),
    },
    catalog,
  };
  await writeFile(path.join(OUT_DIR, "capture.json"), JSON.stringify(manifest, null, 2));
  console.log(`Captura lista: ${OUT_DIR}/capture.json`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  console.log(`Seleccionadas para A/B: ${selected.length}`);

  if (!LIVE) return;
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("Falta DEEPSEEK_API_KEY");
  let attempts = 0;
  const calls = [];
  for (const [index, candidate] of selected.entries()) {
    const user = `Palabra: «${candidate.promptForm}» (idioma: ${LANGUAGE})`;
    const order = index % 2 === 0 ? ["baseline", "optimized"] : ["optimized", "baseline"];
    for (const variant of order) {
      if (attempts >= MAX_ATTEMPTS) break;
      attempts += 1;
      const system = variant === "baseline" ? BASELINE_SYSTEM : OPTIMIZED_SYSTEM;
      const result = await askDeepSeek(system, user, variant === "baseline" ? 8192 : 768);
      calls.push({
        attempt: attempts,
        form: candidate.form,
        promptForm: candidate.promptForm,
        entryId: candidate.entryId,
        variant,
        userPromptChars: user.length,
        systemPromptChars: system.length,
        maxTokens: variant === "baseline" ? 8192 : 768,
        result,
      });
      console.log(`${attempts}/${MAX_ATTEMPTS} ${variant} ${candidate.form}: ${result.ok ? "ok" : result.reason}`);
    }
  }
  const summary = summarizeCalls(calls);
  await writeFile(
    path.join(OUT_DIR, "calls.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, calls, summary }, null, 2),
  );
  console.log(`Resultados A/B: ${OUT_DIR}/calls.json`);
}

await main();
