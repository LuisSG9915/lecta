// Pre-enriquecimiento del catálogo: genera fichas (pos + acepciones +
// formas flexionadas) con DeepSeek para lemas medidos que aún no tienen
// ninguna, para que la tarjeta «Antes de leer» y la calibración
// muestren definiciones desde el primer día. Misma validación e
// inserción que el worker (src/worker/ai.ts + lexicon.ts), solo que
// corre local contra el DATABASE_URL pasado por entorno.
//
//   DATABASE_URL="postgres://…/lecta" node scripts/lexicon-enrich.mjs [total]
//
// Toma `total` lemas (por defecto 1000) repartidos por bandas de zipf
// de 2.0 a 5.0 — las bandas de la muestra de calibración — eligiendo
// los más frecuentes de cada banda (los que más aparecen en libros).
// Idempotente: solo toma lemas sin acepciones.

import pg from "pg";

const TOTAL = Number(process.argv[2]) || 1000;
const CONCURRENCY = 8;
const LANG = "es";
const MODEL = "deepseek-flash";
const PROMPT_VERSION = "enrich-1";
const MAX_TOKENS = 768;

const POS_VALUES = new Set([
  "sustantivo", "verbo", "adjetivo", "adverbio", "pronombre",
  "preposición", "conjunción", "interjección", "determinante", "locución",
]);

const SYSTEM_PROMPT = `Eres un lexicógrafo de español. Para una palabra dada, devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"lemma":"<lema en minúsculas>","pos":"<categoría>","freqRank":<número entero estimado de frecuencia: 1 es la palabra más común; null si no sabes>,"forms":["<formas flexionadas comunes, en minúsculas>"],"senses":[{"definition":"<definición breve en español>","example":"<oración de ejemplo en español>"}]}
Reglas: "pos" debe ser una de: sustantivo, verbo, adjetivo, adverbio, pronombre, preposición, conjunción, interjección, determinante, locución. Incluye de 1 a 3 acepciones, de la más común a la menos. No inventes acepciones raras. Si la forma es flexionada (plural, conjugación, género), "lemma" es la forma base e incluye la forma consultada en "forms".`;

// Misma forma de salida que validateEnrichment (worker/ai.ts).
const validate = (data) => {
  if (typeof data !== "object" || data === null) return null;
  const lemma = typeof data.lemma === "string" ? data.lemma.trim().toLowerCase() : "";
  const pos = typeof data.pos === "string" ? data.pos.trim().toLowerCase() : "";
  if (!lemma || !POS_VALUES.has(pos)) return null;
  const forms = Array.isArray(data.forms)
    ? data.forms.filter((f) => typeof f === "string" && f.trim().length > 0 && f.length <= 60)
    : [];
  const senses = Array.isArray(data.senses)
    ? data.senses
        .map((s) => (typeof s === "object" && s !== null ? s : {}))
        .filter((s) => typeof s.definition === "string" && s.definition.trim().length > 0)
        .slice(0, 3)
        .map((s) => ({
          definition: s.definition.trim(),
          example: typeof s.example === "string" && s.example.trim() ? s.example.trim() : null,
        }))
    : [];
  if (!senses.length) return null;
  const freqRank =
    typeof data.freqRank === "number" && Number.isInteger(data.freqRank) && data.freqRank > 0
      ? data.freqRank
      : null;
  return { lemma, pos, freqRank, forms, senses };
};

const apiBase = (process.env.AI_GATEWAY_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
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
const metrics = {
  calls: 0,
  ok: 0,
  invalid: 0,
  truncated: 0,
  apiError: 0,
  dbFailed: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  reasoningTokens: 0,
  maxCompletionTokens: 0,
  durationMs: 0,
};
const sum = (key, value) => {
  if (typeof value === "number") metrics[key] += value;
};
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Falta DEEPSEEK_API_KEY en el entorno.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en el entorno.");
  process.exit(1);
}

async function askDeepSeek(lemma) {
  const startedAt = Date.now();
  metrics.calls += 1;
  let response;
  try {
    response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(process.env.AI_GATEWAY_KEY
          ? { "cf-aig-authorization": `Bearer ${process.env.AI_GATEWAY_KEY}` }
          : {}),
        // Métricas sí, payload no: las fichas pueden derivar de texto
        // consultado por el usuario y no deben quedar en logs del gateway.
        ...(process.env.AI_GATEWAY_URL?.trim()
          ? { "cf-aig-collect-log-payload": "false" }
          : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Palabra: «${lemma}» (idioma: ${LANG})` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    metrics.apiError += 1;
    return { outcome: "api-error" };
  }
  const durationMs = Date.now() - startedAt;
  metrics.durationMs += durationMs;
  if (!response.ok) {
    metrics.apiError += 1;
    return { outcome: "api-error", status: response.status, durationMs };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    metrics.apiError += 1;
    return { outcome: "api-error", status: response.status, durationMs };
  }
  const usage = readUsage(data);
  for (const key of [
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "cacheHitTokens",
    "cacheMissTokens",
    "reasoningTokens",
  ]) sum(key, usage[key]);
  if (usage.completionTokens != null)
    metrics.maxCompletionTokens = Math.max(
      metrics.maxCompletionTokens,
      usage.completionTokens,
    );

  const choice = data.choices?.[0];
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const content = choice?.message?.content;
  if (finishReason === "length") {
    metrics.truncated += 1;
    return { outcome: "truncated", usage, finishReason, durationMs };
  }
  if (!content) {
    metrics.apiError += 1;
    return { outcome: "api-error", usage, finishReason, durationMs };
  }
  try {
    const enrichment = validate(JSON.parse(content));
    if (!enrichment) {
      metrics.invalid += 1;
      return { outcome: "invalid", usage, finishReason, durationMs };
    }
    metrics.ok += 1;
    return { outcome: "ok", enrichment, usage, finishReason, durationMs };
  } catch {
    metrics.invalid += 1;
    return { outcome: "invalid", usage, finishReason, durationMs };
  }
}

// Inserta la ficha como insertEnrichment, pero sobre la entrada que YA
// existe en el catálogo (lema con pos NULL): la completa en vez de
// crear una duplicada. Si el lema devuelto no existe, inserta nueva.
async function insertEnrichment(client, enrichment, requestedForm) {
  await client.query("BEGIN");
  try {
    const { rows: existing } = await client.query(
      `SELECT id, pos FROM lexicon_entries WHERE language = $1 AND lemma = $2`,
      [LANG, enrichment.lemma],
    );
    let entryId;
    if (existing.length) {
      // La ficha ya cargada tiene pos NULL: se queda la del modelo.
      // Si hubiera varias entradas del mismo lema, se completa la de
      // pos NULL; si todas tienen pos, se crea una nueva solo cuando
      // el pos difiere de las existentes (homonimia por categoría).
      const target =
        existing.find((row) => row.pos === null) ??
        (existing.some((row) => row.pos === enrichment.pos) ? existing.find((row) => row.pos === enrichment.pos) : null);
      if (target) {
        entryId = target.id;
        await client.query(
          `UPDATE lexicon_entries
           SET pos = COALESCE(pos, $2),
               freq_rank = COALESCE(freq_rank, $3),
               status = 'ok', model_version = $4, prompt_version = $5
           WHERE id = $1`,
          [entryId, enrichment.pos, enrichment.freqRank, MODEL, PROMPT_VERSION],
        );
      } else {
        await client.query(
          `INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, source, status, model_version, prompt_version)
           VALUES ($1, $2, $3, $4, 'ai', 'ok', $5, $6)
           ON CONFLICT DO NOTHING`,
          [LANG, enrichment.lemma, enrichment.pos, enrichment.freqRank, MODEL, PROMPT_VERSION],
        );
        const { rows } = await client.query(
          `SELECT id FROM lexicon_entries WHERE language=$1 AND lemma=$2 AND pos IS NOT DISTINCT FROM $3`,
          [LANG, enrichment.lemma, enrichment.pos],
        );
        entryId = rows[0]?.id;
      }
    } else {
      await client.query(
        `INSERT INTO lexicon_entries (language, lemma, pos, freq_rank, source, status, model_version, prompt_version)
         VALUES ($1, $2, $3, $4, 'ai', 'ok', $5, $6)`,
        [LANG, enrichment.lemma, enrichment.pos, enrichment.freqRank, MODEL, PROMPT_VERSION],
      );
      const { rows } = await client.query(
        `SELECT id FROM lexicon_entries WHERE language=$1 AND lemma=$2 ORDER BY id DESC LIMIT 1`,
        [LANG, enrichment.lemma],
      );
      entryId = rows[0]?.id;
    }
    if (!entryId) throw new Error("sin entry id");

    for (const form of new Set([requestedForm, enrichment.lemma, ...enrichment.forms])) {
      await client.query(
        `INSERT INTO lexicon_forms (language, form, entry_id, source)
         VALUES ($1, lower($2), $3, 'ai')
         ON CONFLICT DO NOTHING`,
        [LANG, form, entryId],
      );
    }
    for (const [index, sense] of enrichment.senses.entries()) {
      await client.query(
        `INSERT INTO lexicon_senses (entry_id, sense_order, definition, example, status)
         VALUES ($1, $2, $3, $4, 'ok')
         ON CONFLICT DO NOTHING`,
        [entryId, index + 1, sense.definition, sense.example],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Lemas con zipf medido y sin ninguna acepción, repartidos en las 6
// bandas de la calibración (2.0–5.0); dentro de cada banda van los más
// frecuentes primero, que son los que más aparecen en libros reales.
async function pickLemmas(client, total) {
  const perBand = Math.ceil(total / 6);
  const { rows } = await client.query(
    `WITH cand AS (
       SELECT e.id, e.lemma, e.zipf,
              floor((e.zipf - 2.0) / 0.5)::int4 AS band,
              row_number() OVER (
                PARTITION BY floor((e.zipf - 2.0) / 0.5)
                ORDER BY e.zipf DESC
              ) AS pick
       FROM lexicon_entries e
       WHERE e.language = $1
         AND e.zipf >= 2.0 AND e.zipf < 5.0
         AND NOT EXISTS (SELECT 1 FROM lexicon_senses s WHERE s.entry_id = e.id)
     )
     SELECT lemma, zipf FROM cand WHERE pick <= $2 ORDER BY zipf DESC`,
    [LANG, perBand],
  );
  return rows.slice(0, total);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows: [{ db }] } = await client.query("SELECT current_database() AS db");
console.log(`Conectado a ${db}`);

const lemmas = await pickLemmas(client, TOTAL);
console.log(`${lemmas.length} lemas por enriquecer`);

let done = 0;
let failed = 0;
const queue = [...lemmas];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    const worker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await worker.connect();
    try {
      while (queue.length) {
        const { lemma } = queue.shift();
        try {
          const ai = await askDeepSeek(lemma);
          if (ai.outcome === "ok" && ai.enrichment) {
            await insertEnrichment(worker, ai.enrichment, lemma);
            done += 1;
          } else {
            failed += 1;
          }
        } catch {
          metrics.dbFailed += 1;
          failed += 1;
        }
        if ((done + failed) % 50 === 0)
          console.log(`  ${done} con ficha, ${failed} fallidos, quedan ${queue.length}`);
      }
    } finally {
      await worker.end();
    }
  }),
);
console.log(`Listo: ${done} lemas con ficha nueva, ${failed} fallidos.`);
console.log(`Uso DeepSeek agregado: ${JSON.stringify(metrics)}`);
await client.end();
