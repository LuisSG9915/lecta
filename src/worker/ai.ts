import type { ValidatedEnrichment } from "./lexicon";
import type { WorkerEnv } from "./db";

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

type DeepSeekResponse = {
  choices?: { message?: { content?: string } }[];
};

export async function requestEnrichment(
  env: WorkerEnv,
  input: { form: string; language: string; context?: string },
) {
  if (!env.DEEPSEEK_API_KEY) return { ok: false as const, reason: "not-configured" as const };

  const userPrompt = `Palabra: «${input.form}» (idioma: ${input.language})` +
    (input.context ? `\nAparece en esta oración: «${input.context}»` : "");

  const response = await fetch(`${env.AI_GATEWAY_URL ?? "https://api.deepseek.com"}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) return { ok: false as const, reason: "api-error" as const };
  const data = (await response.json()) as DeepSeekResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) return { ok: false as const, reason: "api-error" as const };

  try {
    const parsed = validateEnrichment(JSON.parse(content));
    return parsed
      ? { ok: true as const, enrichment: parsed }
      : { ok: false as const, reason: "invalid" as const };
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }
}
