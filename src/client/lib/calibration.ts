import {
  getActiveUserId,
  listAllSavedWords,
  listKnowledge,
  mergePreparationWord,
  putSavedWord,
  saveKnowledge,
  wordKey,
  type KnownWord,
  type SavedWord,
} from "./idb";
import { pushKnowledgeToServer } from "./reading-sync";
import { pushWordsToServer } from "./vocab";

// Calibración inicial del vocabulario: una muestra del catálogo
// (lemas repartidos en bandas de frecuencia, servida por
// GET /api/lexicon/sample) que el lector marca explícitamente como
// «la conozco / no la conozco». Solo lo respondido queda como
// evidencia `calibration` del modelo de conocimiento (knowledge.ts);
// lo no tocado no es conocido ni desconocido: es pendiente.

// Marca «la prueba ya se ofreció» en el almacén de sesión por cuenta;
// sin ella se vuelve a ofrecer antes de entrar al primer libro.
export const CALIBRATION_DONE_KEY = "calibrationDone";
// Borrador de respuestas mientras la prueba está abierta: un cierre
// accidental no las pierde — se restauran en la próxima oferta.
export const CALIBRATION_DRAFT_KEY = "calibrationDraft";

export type CalibrationAnswers = Record<string, "known" | "unknown">;

// `definition` puede ser null: el catálogo ofrece lemas aunque no
// tengan acepción cargada; al marcarlos no hay revelado.
export type CalibrationWord = { lemma: string; definition: string | null };

export type CalibrationSample =
  | { ok: true; words: CalibrationWord[] }
  | { ok: false };

// Pide la muestra al catálogo con tope de espera: sin conexión, con
// respuesta rara o demasiado lenta devuelve { ok: false } y quien
// llama abre el libro igual — la calibración nunca bloquea la lectura.
export async function fetchCalibrationSample(
  language = "es",
): Promise<CalibrationSample> {
  try {
    const response = await fetch(
      `/api/lexicon/sample?language=${encodeURIComponent(language)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await response.json()) as { words?: unknown };
    if (!response.ok || !Array.isArray(data.words)) return { ok: false };
    const words = data.words.filter(
      (item): item is CalibrationWord =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CalibrationWord).lemma === "string" &&
        ((item as CalibrationWord).definition === null ||
          typeof (item as CalibrationWord).definition === "string"),
    );
    return { ok: true, words };
  } catch {
    return { ok: false };
  }
}

// ¿Ya existe evidencia de calibración (local o bajada por sync de
// otro dispositivo)? Evita volver a ofrecer la prueba aunque la marca
// local falte — sin esperar a la red: es una lectura del almacén.
export async function hasCalibrationEvidence(language?: string) {
  try {
    const rows = await listKnowledge(language);
    return rows.some((row) => row.source === "calibration");
  } catch {
    return false;
  }
}

// Restaura las respuestas guardadas en el borrador: solo las válidas
// y cuyo lema siga en la muestra actual (otra muestra puede repetir
// lemas). Un borrador corrupto o de otra versión se ignora completo.
export function parseCalibrationDraft(
  raw: string | null | undefined,
  words: CalibrationWord[],
): CalibrationAnswers {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { answers?: unknown };
    const source = parsed?.answers;
    if (typeof source !== "object" || source === null || Array.isArray(source))
      return {};
    const valid = new Set(words.map((word) => word.lemma));
    const answers: CalibrationAnswers = {};
    for (const [lemma, value] of Object.entries(source))
      if (valid.has(lemma) && (value === "known" || value === "unknown"))
        answers[lemma] = value;
    return answers;
  } catch {
    return {};
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
// además entran al Cuaderno con la operación segura de la preparación
// (palabra activa intacta, lápida restaurada conservando lo útil).
export async function recordCalibration(
  words: CalibrationWord[],
  answers: CalibrationAnswers,
  language = "es",
) {
  const userId = getActiveUserId();
  const knowledge = await Promise.all(
    calibrationRows(words, answers, language).map((row) => saveKnowledge(row)),
  );

  const unknowns = words.filter((word) => answers[word.lemma] === "unknown");
  const saved: SavedWord[] = [];
  if (unknowns.length) {
    const existingByKey = new Map(
      (await listAllSavedWords(language)).map((word) => [word.key, word]),
    );
    const now = Date.now();
    for (const word of unknowns) {
      const entry = mergePreparationWord(
        existingByKey.get(wordKey(language, word.lemma)),
        {
          form: word.lemma,
          lemma: word.lemma,
          language,
          meaning: word.definition ?? undefined,
        },
        now,
      );
      if (!entry) continue;
      await putSavedWord(entry);
      saved.push(entry);
    }
  }

  // La cuenta cambió mientras se guardaba: no empujar con la sesión
  // nueva respuestas escritas bajo la anterior.
  if (getActiveUserId() === userId) {
    void pushKnowledgeToServer(knowledge);
    void pushWordsToServer(saved);
  }
  return { knowledge, words: saved };
}
