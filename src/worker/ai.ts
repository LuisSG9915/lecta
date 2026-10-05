import type { ValidatedEnrichment } from "./lexicon";
import type { WorkerEnv } from "./db";

// Modelo y versión del prompt se guardan en cada entrada creada para
// poder auditar o regenerar contenido por versión.
export const ENRICHMENT_MODEL = "deepseek-flash";
export const ENRICHMENT_PROMPT_VERSION = "enrich-1";
export const ITEM_PROMPT_VERSION = "item-v1";
export const VERIFY_PROMPT_VERSION = "verify-v1";

const POS_VALUES = new Set([
  "sustantivo",
  "verbo",
  "adjetivo",
  "adverbio",
  "pronombre",
  "preposición",
  "conjunción",
  "interjección",
  "determinante",
  "locución",
]);

const SYSTEM_PROMPT = `Eres un lexicógrafo de español. Para una palabra dada, devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"lemma":"<lema en minúsculas>","pos":"<categoría>","freqRank":<número entero estimado de frecuencia: 1 es la palabra más común; null si no sabes>,"forms":["<formas flexionadas comunes, en minúsculas>"],"senses":[{"definition":"<definición breve en español>","example":"<oración de ejemplo en español>"}]}
Reglas: "pos" debe ser una de: sustantivo, verbo, adjetivo, adverbio, pronombre, preposición, conjunción, interjección, determinante, locución. Incluye de 1 a 3 acepciones, de la más común a la menos. No inventes acepciones raras. Si la forma es flexionada (plural, conjugación, género), "lemma" es la forma base e incluye la forma consultada en "forms".`;

export function validateEnrichment(data: unknown): ValidatedEnrichment | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  const lemma = typeof raw.lemma === "string" ? raw.lemma.trim().toLowerCase() : "";
  const pos = typeof raw.pos === "string" ? raw.pos.trim().toLowerCase() : "";
  if (!lemma || !POS_VALUES.has(pos)) return null;
  const forms = Array.isArray(raw.forms)
    ? raw.forms.filter((f): f is string => typeof f === "string" && f.trim().length > 0 && f.length <= 60)
    : [];
  const senses = Array.isArray(raw.senses)
    ? raw.senses
        .map((s) => (typeof s === "object" && s !== null ? (s as Record<string, unknown>) : {}))
        .filter((s) => typeof s.definition === "string" && s.definition.trim().length > 0)
        .slice(0, 3)
        .map((s) => ({
          definition: (s.definition as string).trim(),
          example: typeof s.example === "string" && s.example.trim() ? s.example.trim() : null,
        }))
    : [];
  if (!senses.length) return null;
  const freqRank =
    typeof raw.freqRank === "number" && Number.isInteger(raw.freqRank) && raw.freqRank > 0
      ? raw.freqRank
      : null;
  return { lemma, pos, freqRank, forms, senses };
}

export type DeepSeekOperation = "enrich" | "item" | "verify";

// Techo de tokens de salida por operación. En la muestra A/B de
// enriquecimiento el máximo observado fue 343; 768 deja margen sin
// devolver el default ilimitado. Ítem y verificación siguen acotados
// a sus respuestas breves; revisar con los eventos lecta.ai_call.
export const AI_CALL_LIMITS = {
  enrich: 768,
  item: 256,
  verify: 128,
} as const satisfies Record<DeepSeekOperation, number>;

export type DeepSeekCallOptions = {
  operation: DeepSeekOperation;
  promptVersion: string;
  maxTokens: number;
};

// Contadores de tokens reportados por la API. Cada campo queda en null
// si la respuesta no lo trae o no es un entero finito >= 0.
// reasoningTokens se reporta aparte pero NO se suma: completion_tokens
// ya lo incluye según la documentación de DeepSeek.
export type DeepSeekUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  reasoningTokens: number | null;
};

export type DeepSeekResult =
  | {
      ok: true;
      content: string;
      usage: DeepSeekUsage;
      model: string | null;
      finishReason: string | null;
      durationMs: number;
    }
  | { ok: false; reason: "not-configured" | "api-error" };

type DeepSeekResponse = {
  model?: string;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

const toNonNegativeInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

// Acepta tanto los campos prompt_cache_* propios de DeepSeek como el
// detalle prompt_tokens_details.cached_tokens del formato OpenAI.
function mapUsage(raw: DeepSeekResponse["usage"]): DeepSeekUsage {
  return {
    promptTokens: toNonNegativeInt(raw?.prompt_tokens),
    completionTokens: toNonNegativeInt(raw?.completion_tokens),
    totalTokens: toNonNegativeInt(raw?.total_tokens),
    cacheHitTokens:
      toNonNegativeInt(raw?.prompt_cache_hit_tokens) ??
      toNonNegativeInt(raw?.prompt_tokens_details?.cached_tokens),
    cacheMissTokens: toNonNegativeInt(raw?.prompt_cache_miss_tokens),
    reasoningTokens: toNonNegativeInt(
      raw?.completion_tokens_details?.reasoning_tokens,
    ),
  };
}

// Llamada JSON única a DeepSeek: todas las funciones IA (fichas,
// ítems, corrección) pasan por aquí para compartir modelo, gateway y
// timeout. Devuelve el content crudo; validar el JSON es cosa del
// llamador (parseItem, parseVerify, validateEnrichment). Las métricas
// (usage, model, finish_reason, duración) se devuelven al llamador para
// que decida qué registrar: aquí nunca se registra el prompt, el
// contenido ni las credenciales.
export async function callDeepSeek(
  env: WorkerEnv,
  prompt: { system: string; user: string },
  options: DeepSeekCallOptions,
): Promise<DeepSeekResult> {
  if (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)
    throw new Error(
      `callDeepSeek(${options.operation}): maxTokens debe ser un entero positivo`,
    );
  if (!env.DEEPSEEK_API_KEY) return { ok: false, reason: "not-configured" };

  const gatewayUrl = env.AI_GATEWAY_URL?.trim();
  const apiBase = (gatewayUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        ...(env.AI_GATEWAY_KEY
          ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_KEY}` }
          : {}),
        // Solo con AI Gateway: pide no guardar el payload en los logs
        // del gateway (los prompts pueden contener texto del usuario).
        ...(gatewayUrl ? { "cf-aig-collect-log-payload": "false" } : {}),
      },
      body: JSON.stringify({
        model: ENRICHMENT_MODEL,
        temperature: 0.1,
        max_tokens: options.maxTokens,
        // El modo thinking viene activado por defecto en la API actual;
        // para fichas breves en JSON solo encarece y retrasa, y además
        // ignora temperature.
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    // Red caída o timeout del AbortSignal: misma categoría que un 5xx.
    return { ok: false, reason: "api-error" };
  }

  if (!response.ok) return { ok: false, reason: "api-error" };

  let data: DeepSeekResponse;
  try {
    data = (await response.json()) as DeepSeekResponse;
  } catch {
    // HTTP 200 con cuerpo que no es JSON válido.
    return { ok: false, reason: "api-error" };
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) return { ok: false, reason: "api-error" };
  return {
    ok: true,
    content,
    usage: mapUsage(data.usage),
    model: typeof data.model === "string" ? data.model : null,
    finishReason:
      typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    durationMs: Date.now() - startedAt,
  };
}

export type AiCallOutcome =
  | "ok"
  | "invalid"
  | "truncated"
  | "not-configured"
  | "api-error";

// Evento de consumo para observabilidad: atribución por operación y
// tokens reportados, jamás prompt, contenido, credenciales ni usuario.
export function logAiCall(
  options: DeepSeekCallOptions,
  result: DeepSeekResult,
  outcome: AiCallOutcome,
) {
  console.info(
    JSON.stringify({
      event: "lecta.ai_call",
      operation: options.operation,
      promptVersion: options.promptVersion,
      outcome,
      model: result.ok ? result.model : null,
      finishReason: result.ok ? result.finishReason : null,
      durationMs: result.ok ? result.durationMs : null,
      usage: result.ok ? result.usage : null,
    }),
  );
}

const ENRICH_CALL_OPTIONS: DeepSeekCallOptions = {
  operation: "enrich",
  promptVersion: ENRICHMENT_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.enrich,
};

export const ITEM_CALL_OPTIONS: DeepSeekCallOptions = {
  operation: "item",
  promptVersion: ITEM_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.item,
};

export const VERIFY_CALL_OPTIONS: DeepSeekCallOptions = {
  operation: "verify",
  promptVersion: VERIFY_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.verify,
};

export async function requestEnrichment(
  env: WorkerEnv,
  input: { form: string; language: string; context?: string },
) {
  const userPrompt = `Palabra: «${input.form}» (idioma: ${input.language})` +
    (input.context ? `\nAparece en esta oración: «${input.context}»` : "");

  const result = await callDeepSeek(
    env,
    { system: SYSTEM_PROMPT, user: userPrompt },
    ENRICH_CALL_OPTIONS,
  );
  if (!result.ok) {
    logAiCall(ENRICH_CALL_OPTIONS, result, result.reason);
    return { ok: false as const, reason: result.reason };
  }
  if (result.finishReason === "length") {
    logAiCall(ENRICH_CALL_OPTIONS, result, "truncated");
    return { ok: false as const, reason: "invalid" as const };
  }

  try {
    const parsed = validateEnrichment(JSON.parse(result.content));
    logAiCall(ENRICH_CALL_OPTIONS, result, parsed ? "ok" : "invalid");
    return parsed
      ? { ok: true as const, enrichment: parsed }
      : { ok: false as const, reason: "invalid" as const };
  } catch {
    logAiCall(ENRICH_CALL_OPTIONS, result, "invalid");
    return { ok: false as const, reason: "invalid" as const };
  }
}

// ---------- Ítems de ejercicio (Nivel B) ----------

export const ITEM_SYSTEM_PROMPT = `Eres un lexicógrafo de español que redacta ejercicios de vocabulario. Para una palabra y una acepción concretas, devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"sentence":"<oración>","distractors":["<definición breve incorrecta>","<definición breve incorrecta>","<definición breve incorrecta>"]}
Reglas: "sentence" es una oración en español neutro de 6 a 18 palabras que usa la palabra en ESE sentido, sin definirla y sin contener la definición (la oración no puede hacer spoiler del sentido). "distractors" son exactamente 3 definiciones breves, incorrectas pero plausibles, de la misma categoría gramatical que la palabra, distintas entre sí y de la acepción dada.`;

export function buildItemPrompt(lemma: string, pos: string | null, definition: string) {
  return (
    `Palabra: «${lemma}»${pos ? ` (${pos})` : ""}\n` +
    `Sentido correcto: «${definition}»`
  );
}

export type ValidatedItem = { sentence: string; distractors: string[] };

// Valida el JSON del ítem: oración ≤200 caracteres y ≥4 palabras, y
// exactamente 3 distractores no vacíos, ≤200 y distintos entre sí
// (comparados en minúsculas). Devuelve null si algo no cuadra.
export function parseItem(raw: string): ValidatedItem | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const sentence = typeof obj.sentence === "string" ? obj.sentence.trim() : "";
  if (!sentence || sentence.length > 200) return null;
  if (sentence.split(/\s+/).filter(Boolean).length < 4) return null;
  if (!Array.isArray(obj.distractors) || obj.distractors.length !== 3) return null;
  const distractors = obj.distractors.map((d) =>
    typeof d === "string" ? d.trim() : "",
  );
  const seen = new Set<string>();
  for (const distractor of distractors) {
    if (!distractor || distractor.length > 200) return null;
    const key = distractor.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return { sentence, distractors };
}

// ---------- Corrección de oraciones escritas por el usuario ----------

export const VERIFY_SYSTEM_PROMPT = `Eres un corrector de español. Evalúas si una oración escrita por un estudiante usa bien una palabra con un sentido dado. Devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"correct":true|false,"feedback":"<una línea>"}
Reglas: "correct" es true solo si la palabra aparece en la oración usada con ese sentido y la gramática es aceptable. "feedback" es una sola línea en español neutro, amable y concreta (qué falla o por qué está bien).`;

export function buildVerifyPrompt(form: string, meaning: string, sentence: string) {
  return (
    `Palabra: «${form}»\n` +
    `Sentido esperado: «${meaning}»\n` +
    `Oración del estudiante: «${sentence}»`
  );
}

export type VerifiedSentence = { correct: boolean; feedback: string };

// Valida el veredicto de la IA: "correct" debe ser boolean; "feedback"
// es una línea ≤200 (si falta queda vacía). Devuelve null si no cuadra.
export function parseVerify(raw: string): VerifiedSentence | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.correct !== "boolean") return null;
  const feedback =
    typeof obj.feedback === "string" ? obj.feedback.trim().slice(0, 200) : "";
  return { correct: obj.correct, feedback };
}
