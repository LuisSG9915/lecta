import {
  captureDbScope,
  isDbScopeActive,
  listKnowledge,
  saveCalibrationBatch,
  type DbScope,
  type KnownWord,
} from "./idb";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";
import {
  calibrationFallbackDefinition,
  calibrationSampleContext,
  type CalibrationProfile,
} from "../../shared/calibration-bank";

// Calibración inicial del vocabulario: una muestra del catálogo
// (lemas repartidos en bandas de frecuencia, servida por
// GET /api/lexicon/sample) que el lector marca explícitamente como
// «la conozco / me suena dudosa / no la conozco». Solo lo respondido queda como
// evidencia `calibration` del modelo de conocimiento (knowledge.ts);
// lo no tocado no es conocido ni desconocido: es pendiente.

// Marca «la prueba ya se ofreció» en el almacén de sesión por cuenta;
// sin ella se vuelve a ofrecer antes de entrar al primer libro.
export const CALIBRATION_DONE_KEY = "calibrationDone";
// Borrador de respuestas mientras la prueba está abierta: un cierre
// accidental no las pierde — se restauran en la próxima oferta.
export const CALIBRATION_DRAFT_KEY = "calibrationDraft";

export function calibrationDoneKey(language = "es"): string {
  return language === "es" ? CALIBRATION_DONE_KEY : `${CALIBRATION_DONE_KEY}:${language}`;
}

export function calibrationDraftKey(language = "es"): string {
  return language === "es" ? CALIBRATION_DRAFT_KEY : `${CALIBRATION_DRAFT_KEY}:${language}`;
}

export type CalibrationAnswerValue = "known" | "unknown" | "unsure";
export type CalibrationAnswers = Record<string, CalibrationAnswerValue>;

export function calibrationAnswerScore(answer: CalibrationAnswerValue): number {
  switch (answer) {
    case "known":
      return 1.0;
    case "unsure":
      return 0.35;
    case "unknown":
      return 0.0;
  }
}

// `definition` puede ser null: el catálogo ofrece lemas aunque no
// tengan acepción cargada; al marcarlos no hay revelado.
export type CalibrationWord = {
  lemma: string;
  definition: string | null;
  sampleContext?: string | null;
  pos?: string;
  zipf?: number | null;
};

export type CalibrationSample =
  | { ok: true; words: CalibrationWord[]; version?: string }
  | { ok: false };

export const CALIBRATION_ADAPTIVE_COUNT = 10;

// Pide la muestra al catálogo con tope de espera: sin conexión, con
// respuesta rara o demasiado lenta devuelve { ok: false } y quien
// llama abre el libro igual — la calibración nunca bloquea la lectura.
export async function fetchCalibrationSample(
  language = "es",
  profile: CalibrationProfile = "native",
): Promise<CalibrationSample> {
  try {
    const response = await fetch(
      `/api/lexicon/sample?language=${encodeURIComponent(language)}&profile=${encodeURIComponent(profile)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await response.json()) as {
      words?: unknown;
      version?: unknown;
    };
    if (!response.ok || !Array.isArray(data.words)) return { ok: false };
    const words = data.words
      .filter(
        (item): item is CalibrationWord =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as CalibrationWord).lemma === "string" &&
          ((item as CalibrationWord).definition === null ||
            typeof (item as CalibrationWord).definition === "string"),
      )
      .map((item) => ({
        ...item,
        definition:
          item.definition ?? calibrationFallbackDefinition(item.lemma, language),
        sampleContext:
          item.sampleContext ?? calibrationSampleContext(item.lemma, language),
      }));
    const version =
      typeof data.version === "string" ? data.version : undefined;
    return { ok: true, words, version };
  } catch {
    return { ok: false };
  }
}

// ¿Ya existe evidencia de calibración (local o bajada por sync de
// otro dispositivo)? Evita volver a ofrecer la prueba aunque la marca
// local falte — sin esperar a la red: es una lectura del almacén.
export async function hasCalibrationEvidence(language?: string, scope?: DbScope) {
  try {
    const rows = await listKnowledge(language, scope);
    return rows.some((row) => row.source === "calibration");
  } catch {
    return false;
  }
}

// Versión del borrador en sesión. v2 lleva la muestra completa y el
// paso donde quedó el lector: reabrir la hoja muestra las mismas
// palabras en el mismo lugar — la nueva consulta al catálogo podría
// traer una selección distinta. Un borrador v1 (solo `answers`,
// formato anterior) restaura las respuestas cuyo lema siga en la
// muestra actual.
export const CALIBRATION_DRAFT_VERSION = 2;

export type CalibrationDraft = {
  answers: CalibrationAnswers;
  step: number;
  stage?: number;
  // La muestra guardada con el borrador; si existe, sustituye a la
  // recién descargada para conservar la misma selección.
  words?: CalibrationWord[];
};

// Serializa el borrador v2: respuestas, paso y muestra completa.
export function serializeCalibrationDraft(draft: {
  answers: CalibrationAnswers;
  step: number;
  stage?: number;
  words: CalibrationWord[];
}): string {
  return JSON.stringify({
    v: CALIBRATION_DRAFT_VERSION,
    answers: draft.answers,
    step: draft.step,
    ...(draft.stage !== undefined ? { stage: draft.stage } : {}),
    words: draft.words,
  });
}

const cleanAnswers = (
  source: unknown,
  words: CalibrationWord[],
): CalibrationAnswers => {
  if (typeof source !== "object" || source === null || Array.isArray(source))
    return {};
  const valid = new Set(words.map((word) => word.lemma));
  const answers: CalibrationAnswers = {};
  for (const [lemma, value] of Object.entries(source))
    if (
      valid.has(lemma) &&
      (value === "known" || value === "unknown" || value === "unsure")
    )
      answers[lemma] = value;
  return answers;
};

const cleanDraftWords = (source: unknown): CalibrationWord[] | undefined => {
  if (!Array.isArray(source) || !source.length) return undefined;
  const words = source.filter(
    (item): item is CalibrationWord =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as CalibrationWord).lemma === "string" &&
      ((item as CalibrationWord).definition === null ||
        typeof (item as CalibrationWord).definition === "string"),
  );
  return words.length === source.length ? words : undefined;
};

// Palabras por paso de la hoja (18 lemas en tres pasos de seis).
export const STEP_SIZE = 6;

// Restaura el borrador: respuestas válidas para la muestra, paso
// acotado y la muestra misma si el borrador la guardó. `fallback`
// es la muestra recién descargada — acota las respuestas a lemas que
// el borrador o la muestra reconozcan.
export function parseCalibrationDraft(
  raw: string | null | undefined,
  fallback: CalibrationWord[],
): CalibrationDraft {
  const empty: CalibrationDraft = { answers: {}, step: 0 };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      answers?: unknown;
      step?: unknown;
      stage?: unknown;
      words?: unknown;
    };
    // Una versión distinta a las conocidas no se interpreta: un v3
    // futuro no es un v1 sin campo — mejor no restaurar que leer mal.
    if (parsed?.v != null && parsed.v !== CALIBRATION_DRAFT_VERSION)
      return empty;
    if (parsed?.v !== CALIBRATION_DRAFT_VERSION) {
      // v1: solo respuestas, sin paso ni muestra guardada.
      const answers = cleanAnswers(parsed?.answers, fallback);
      return { answers, step: 0 };
    }
    const words = cleanDraftWords(parsed.words) ?? fallback;
    const lastStep = Math.max(0, Math.ceil(words.length / STEP_SIZE) - 1);
    const step =
      typeof parsed.step === "number" && Number.isInteger(parsed.step)
        ? Math.min(Math.max(parsed.step, 0), lastStep)
        : 0;
    const stage =
      typeof parsed.stage === "number" && [1, 2, 3].includes(parsed.stage)
        ? parsed.stage
        : undefined;
    return {
      answers: cleanAnswers(parsed.answers, words),
      step,
      ...(stage ? { stage } : {}),
      words,
    };
  } catch {
    return empty;
  }
}

// Traduce la prueba a filas del modelo: solo los lemas con respuesta
// explícita generan evidencia — el resto no se toca. Pura y separada
// del guardado para poder probarla sin IndexedDB.
export function calibrationRows(
  words: CalibrationWord[],
  answers: CalibrationAnswers,
  language = "es",
): Omit<KnownWord, "key" | "updatedAt">[] {
  return words.flatMap(({ lemma }) => {
    const answer = answers[lemma];
    if (!answer) return [];
    return [
      {
        language,
        lemma: lemma.toLowerCase(),
        known: answer === "known",
        source: "calibration",
      },
    ];
  });
}

// Guarda las respuestas explícitas en el dispositivo y empuja al
// servidor si hay sesión — mismo criterio «local primero» que
// recordReview: un envío fallido no deshace nada. Las desconocidas
// además entran al Cuaderno con la regla segura de la preparación
// (palabra activa intacta, lápida restaurada conservando lo útil).
// Evidencia y palabras escriben en UNA transacción: un fallo a mitad
// no deja media ronda (ni filas huérfanas por sincronizar).
export async function recordCalibration(
  words: CalibrationWord[],
  answers: CalibrationAnswers,
  language = "es",
  scope?: DbScope,
) {
  const bound = scope ?? captureDbScope();
  const { knowledge, words: saved } = await saveCalibrationBatch(
    {
      knowledge: calibrationRows(words, answers, language),
      words: words
        .filter((word) => answers[word.lemma] === "unknown")
        .map((word) => ({
          form: word.lemma,
          lemma: word.lemma,
          language,
          meaning: word.definition ?? undefined,
        })),
    },
    bound,
  );

  // La cuenta cambió mientras se guardaba: no empujar con la sesión
  // nueva respuestas escritas bajo la anterior.
  if (isDbScopeActive(bound)) {
    void pushKnowledgeToServer(knowledge, bound);
    void pushWordsToServer(saved, bound);
  }
  return { knowledge, words: saved };
}
