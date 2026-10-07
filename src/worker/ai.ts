import type { ValidatedEnrichment } from "./lexicon";
import type { WorkerEnv } from "./db";
import { TIP_ACTIONS, type TipAction, type TipContext } from "../shared/tip";

// Modelo y versión del prompt se guardan en cada entrada creada para
// poder auditar o regenerar contenido por versión.
export const ENRICHMENT_MODEL = "deepseek-flash";
export const ENRICHMENT_PROMPT_VERSION = "enrich-1";
export const ITEM_PROMPT_VERSION = "item-v1";
export const VERIFY_PROMPT_VERSION = "verify-v1";
export const EXPLAIN_PROMPT_VERSION = "explain-v1";
export const TIP_PROMPT_VERSION = "tip-v1";

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

export type DeepSeekOperation =
  | "enrich"
  | "item"
  | "verify"
  | "explain"
  | "tip";

// Techo de tokens de salida por operación. En la muestra A/B de
// enriquecimiento el máximo observado fue 343; 768 deja margen sin
// devolver el default ilimitado. Ítem, verificación y explicación en
// contexto siguen acotados a sus respuestas breves; revisar con los
// eventos lecta.ai_call.
export const AI_CALL_LIMITS = {
  enrich: 768,
  item: 256,
  verify: 128,
  explain: 192,
  tip: 160,
} as const satisfies Record<DeepSeekOperation, number>;

export type DeepSeekCallOptions = {
  operation: DeepSeekOperation;
  promptVersion: string;
  maxTokens: number;
  // Reintentos: las pruebas inyectan sleep para no esperar de verdad;
  // en producción se usa el temporizador real.
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
};

// Timeout por intento: todas las operaciones piden respuestas breves;
// pasado este plazo el intento se corta y se reintenta.
export const AI_CALL_TIMEOUT_MS = 8_000;
// Reintentos ante fallos transitorios: saturación del gateway (429),
// 5xx y cortes de red/timeout. Espera exponencial 400 ms → 800 ms,
// más lo que pida un Retry-After (acotado). Un 4xx no transitorio
// (petición mal formada, credencial inválida) no se repite.
export const AI_MAX_ATTEMPTS = 3;
export const AI_RETRY_BASE_MS = 400;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_AFTER_CAP_MS = 10_000;

const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const retryAfterMs = (response: Response | null) => {
  const raw = response?.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
    : 0;
};

// Caché TTL en memoria del aislante para respuestas IA efímeras (por
// ejemplo explicaciones en contexto, que no se guardan en el
// catálogo): sin binding KV, la memoria del worker es el nivel
// correcto para un dato regenerable. El tope desaloja la entrada más
// vieja (el Map conserva el orden de inserción).
export function createTtlCache<V>(options: {
  maxEntries?: number;
  ttlMs?: number;
} = {}) {
  const maxEntries = options.maxEntries ?? 200;
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const entries = new Map<string, { value: V; expires: number }>();
  return {
    get(key: string): V | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    set(key: string, value: V): void {
      entries.delete(key);
      entries.set(key, { value, expires: Date.now() + ttlMs });
      while (entries.size > maxEntries)
        entries.delete(entries.keys().next().value!);
    },
    get size() {
      return entries.size;
    },
  };
}

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
      attempts: number;
    }
  | {
      ok: false;
      // "rate-limited" distingue un 429 persistente (saturación del
      // gateway) del resto de fallos de API para observabilidad.
      reason: "not-configured" | "api-error" | "rate-limited";
      status: number | null;
      attempts: number;
    };

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

// Llamada JSON a DeepSeek: todas las funciones IA (fichas, ítems,
// corrección) pasan por aquí para compartir modelo, gateway, timeout
// y reintentos. Devuelve el content crudo; validar el JSON es cosa
// del llamador (parseItem, parseVerify, validateEnrichment). Las
// métricas (usage, model, finish_reason, duración, intentos) se
// devuelven al llamador para que decida qué registrar: aquí nunca se
// registra el prompt, el contenido ni las credenciales.
export async function callDeepSeek(
  env: WorkerEnv,
  prompt: { system: string; user: string },
  options: DeepSeekCallOptions,
): Promise<DeepSeekResult> {
  if (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)
    throw new Error(
      `callDeepSeek(${options.operation}): maxTokens debe ser un entero positivo`,
    );
  if (!env.DEEPSEEK_API_KEY)
    return { ok: false, reason: "not-configured", status: null, attempts: 0 };

  const gatewayUrl = env.AI_GATEWAY_URL?.trim();
  const apiBase = (gatewayUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  const startedAt = Date.now();
  const maxAttempts = Math.max(
    1,
    Math.min(options.retry?.maxAttempts ?? AI_MAX_ATTEMPTS, 5),
  );
  const baseDelayMs = options.retry?.baseDelayMs ?? AI_RETRY_BASE_MS;
  const sleep = options.retry?.sleep ?? sleepMs;

  const init: RequestInit = {
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
  };

  let lastStatus: number | null;
  let attempt: number;
  for (attempt = 1; ; attempt++) {
    let response: Response | null;
    try {
      response = await fetch(`${apiBase}/chat/completions`, {
        ...init,
        signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
      });
    } catch {
      // Red caída o timeout del AbortSignal: misma categoría que un 5xx.
      response = null;
    }
    lastStatus = response?.status ?? null;

    if (response?.ok) {
      let data: DeepSeekResponse;
      try {
        data = (await response.json()) as DeepSeekResponse;
      } catch {
        // HTTP 200 con cuerpo que no es JSON válido: no se reintenta,
        // un cuerpo malformado no se arregla repitiendo la petición.
        return {
          ok: false,
          reason: "api-error",
          status: response.status,
          attempts: attempt,
        };
      }
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (!content)
        return {
          ok: false,
          reason: "api-error",
          status: response.status,
          attempts: attempt,
        };
      return {
        ok: true,
        content,
        usage: mapUsage(data.usage),
        model: typeof data.model === "string" ? data.model : null,
        finishReason:
          typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
      };
    }

    const retryable = response === null || RETRYABLE_STATUS.has(response.status);
    if (!retryable || attempt >= maxAttempts) break;
    await sleep(
      Math.max(baseDelayMs * 2 ** (attempt - 1), retryAfterMs(response)),
    );
  }

  return {
    ok: false,
    reason: lastStatus === 429 ? "rate-limited" : "api-error",
    status: lastStatus,
    attempts: attempt,
  };
}

export type AiCallOutcome =
  | "ok"
  | "invalid"
  | "truncated"
  | "not-configured"
  | "api-error"
  | "rate-limited";

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
      status: result.ok ? 200 : result.status,
      attempts: result.attempts,
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

export const EXPLAIN_CALL_OPTIONS: DeepSeekCallOptions = {
  operation: "explain",
  promptVersion: EXPLAIN_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.explain,
};

export const TIP_CALL_OPTIONS: DeepSeekCallOptions = {
  operation: "tip",
  promptVersion: TIP_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.tip,
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

// ---------- Explicación en contexto (opcional, a petición) ----------
//
// La acepción del catálogo define la palabra en general; esta
// operación dice qué sentido aplica en la oración concreta que el
// usuario está leyendo. Es efímera: no escribe al catálogo ni se
// guarda — el botón del panel la pide solo cuando hay contexto.

export const EXPLAIN_SYSTEM_PROMPT = `Eres un lexicógrafo de español. Explicas qué significa una palabra en la oración concreta donde aparece — no la definición general de diccionario, sino el sentido que tiene ahí. Devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"explanation":"<una o dos frases breves en español neutro>"}
Reglas: máximo 45 palabras. Si la palabra es una forma flexionada, menciona su lema entre paréntesis. Si la palabra tiene varios sentidos, di cuál aplica en esa oración. No repitas la oración completa ni comiences con "La palabra".`;

export function buildExplainPrompt(form: string, language: string, context: string) {
  return `Palabra: «${form}» (idioma: ${language})\nOración: «${context}»`;
}

export type Explanation = { explanation: string };

// Valida la explicación: "explanation" no vacía, recortada a 400
// caracteres por si el modelo se pasa de la regla de las 45 palabras.
export function parseExplain(raw: string): Explanation | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const explanation =
    typeof obj.explanation === "string" ? obj.explanation.trim().slice(0, 400) : "";
  return explanation ? { explanation } : null;
}

// ---------- Tip de lectura diario (única operación proactiva) ----------
//
// El consejo de la estantería es la única intervención IA sin gesto
// del usuario, así que su prompt es el más restrictivo: debe nombrar
// el dato observable que lo motiva y puede responder con silencio.
// El cliente registra tip_shown/tip_accepted para auditar si estos
// consejos sirven de algo (docs/concentracion-y-lectura.md §4).

export const TIP_SYSTEM_PROMPT = `Eres un coach de lectura en español neutro. Recibes agregados observables del lector (minutos por día, retrocesos, consultas, avisos de fatiga, ritmo estimado) y decides si hoy hay UN consejo útil. Devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto extra:
{"tip":"<consejo>" o null,"action":"none"|"focus_ruler"|"syntactic"}
Reglas:
- "tip": máximo 45 palabras, segunda persona, amable, jamás un regaño. Nombra el dato observable que lo motiva (ej. "ayer retrocediste más que tu media").
- "action": "focus_ruler" solo si el consejo es probar la regla de foco (banda que vela el texto de alrededor); "syntactic" solo si es probar las líneas sintácticas (texto cortado por unidades de sentido); "none" para cualquier otro consejo o cuando tip es null.
- Si las señales no justifican un consejo concreto hoy, devuelve {"tip":null,"action":"none"}: el silencio es un resultado válido y preferible a un consejo genérico.
- Jamás sugieras ni menciones condiciones o diagnósticos (TDAH, dislexia, ansiedad) ni estados emocionales: solo datos observables y conductas.
- Las señales son ambiguas: un retroceso puede ser relectura sana y un día lento puede ser un buen día. Propón con humildad; nunca afirmes en qué estado está el lector.`;

// Serializa el contexto como texto breve para el prompt. Todo llega
// ya saneado por sanitizeTipContext: solo enteros acotados.
export function buildTipPrompt(ctx: TipContext): string {
  const lines = ctx.days.map(
    (d) =>
      `${d.dayKey}: ${d.minutes} min, ${d.regressions} retrocesos, ` +
      `${d.consults} consultas, ${d.fatigue} avisos de fatiga, ` +
      `${d.wpm > 0 ? `${d.wpm} ppm` : "ritmo sin muestra"}`,
  );
  return [
    `Hora local: ${ctx.localHour}`,
    `Días desde la última lectura: ${ctx.daysSinceLastRead}`,
    `Modo de concentración actual: ${ctx.focusMode}`,
    `Meta semanal: ${ctx.weeklyGoalDays ?? "sin meta"} días`,
    "Días recientes (más nuevo primero):",
    ...lines,
  ].join("\n");
}

export type ValidatedTip = { tip: string | null; action: TipAction };

// Valida la respuesta: tip null o cadena ≤240 caracteres; action
// fuera del enum se degrada a "none" (no se tira un tip bueno por un
// campo secundario malo). Otro formato → null.
export function parseTip(raw: string): ValidatedTip | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj.tip !== null && typeof obj.tip !== "string") return null;
  const tip = typeof obj.tip === "string" ? obj.tip.trim() : null;
  if (tip !== null && (tip.length === 0 || tip.length > 240)) return null;
  const action: TipAction = TIP_ACTIONS.includes(obj.action as TipAction)
    ? (obj.action as TipAction)
    : "none";
  return { tip, action };
}

// Sanea el cuerpo de la petición a un TipContext de solo números
// acotados y cadenas cortas: lo que entre va al prompt, así que nada
// puede inyectar texto libre en él.
export function sanitizeTipContext(body: unknown): TipContext | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  const dayKey =
    typeof raw.dayKey === "string" ? raw.dayKey.slice(0, 16) : "";
  if (!dayKey) return null;
  const int = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.round(v)))
      : 0;
  const days = (Array.isArray(raw.days) ? raw.days : [])
    .slice(0, 14)
    .map((d) => {
      const r = (typeof d === "object" && d !== null ? d : {}) as Record<
        string,
        unknown
      >;
      return {
        dayKey: typeof r.dayKey === "string" ? r.dayKey.slice(0, 16) : "",
        minutes: int(r.minutes, 0, 1440),
        regressions: int(r.regressions, 0, 10_000),
        consults: int(r.consults, 0, 10_000),
        fatigue: int(r.fatigue, 0, 10_000),
        wpm: int(r.wpm, 0, 2_000),
      };
    });
  return {
    dayKey,
    localHour: int(raw.localHour, 0, 23),
    daysSinceLastRead: int(raw.daysSinceLastRead, 0, 36_500),
    days,
    focusMode:
      typeof raw.focusMode === "string" ? raw.focusMode.slice(0, 16) : "off",
    weeklyGoalDays:
      typeof raw.weeklyGoalDays === "number" && Number.isFinite(raw.weeklyGoalDays)
        ? Math.max(0, Math.min(7, Math.round(raw.weeklyGoalDays)))
        : null,
  };
}
