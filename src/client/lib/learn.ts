import { knowledgeKey, type KnownWord, type SavedWord } from "./idb";

// Primera exposición guiada («Aprender»): qué palabras ya pasaron por
// la ficha y con qué veredicto. Vive en el store de session como
// `learnExposure:v1`; migra anónimo→cuenta y entra al respaldo por la
// lista de export.ts. El sello arbitra en la migración como el resto.
export const LEARN_EXPOSURE_KEY = "learnExposure:v1";

export type LearnVerdict = "known" | "learn";

export type LearnExposure = {
  version: 1;
  // Clave de palabra (`language:form`) → cuándo se expuso y con qué
  // decisión. La palabra expuesta no se vuelve a ofrecer.
  seen: Record<string, { at: number; verdict: LearnVerdict }>;
  updatedAt: number;
};

export function emptyLearnExposure(): LearnExposure {
  return { version: 1, seen: {}, updatedAt: 0 };
}

const isVerdict = (value: unknown): value is LearnVerdict =>
  value === "known" || value === "learn";

// Tolera basura y formatos ajenos: una versión desconocida NO se
// reinterpreta como v1 (igual que el borrador de calibración).
export function parseLearnExposure(raw: string | null | undefined): LearnExposure {
  if (!raw) return emptyLearnExposure();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyLearnExposure();
  }
  if (typeof data !== "object" || data === null) return emptyLearnExposure();
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return emptyLearnExposure();
  const seenRaw = typeof obj.seen === "object" && obj.seen !== null ? obj.seen : {};
  const seen: LearnExposure["seen"] = {};
  for (const [key, value] of Object.entries(seenRaw)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.at === "number" && isVerdict(entry.verdict))
      seen[key] = { at: entry.at, verdict: entry.verdict };
  }
  return {
    version: 1,
    seen,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : 0,
  };
}

export function withExposure(
  prev: LearnExposure,
  wordKey: string,
  verdict: LearnVerdict,
  at: number,
): LearnExposure {
  return {
    version: 1,
    seen: { ...prev.seen, [wordKey]: { at, verdict } },
    updatedAt: at,
  };
}

// Lemas con evidencia vigente de «conocida»: una fila tombada o
// conocida:false no excluye nada (mejor enseñar de más que ocultar).
export function knownKeysFor(knowledge: KnownWord[]): Set<string> {
  const keys = new Set<string>();
  for (const word of knowledge) {
    if (!word.deleted && word.known)
      keys.add(knowledgeKey(word.language, word.lemma));
  }
  return keys;
}

// La palabra entra a la cola de Aprender si está viva, nunca se expuso
// en la ficha, no tiene evidencia de «conocida» (por lema y por forma,
// porque una guardada sin lematizar quedó claveada por forma) y no se
// repasó de verdad — una card con reps>0 ya tuvo su primera exposición
// en el repaso mismo.
export function isLearnPending(
  word: SavedWord,
  knownKeys: Set<string>,
  exposure: LearnExposure,
): boolean {
  if (word.deleted) return false;
  if (exposure.seen[word.key]) return false;
  if ((word.card?.reps ?? 0) > 0) return false;
  const language = word.language || "es";
  if (knownKeys.has(knowledgeKey(language, word.lemma ?? word.form))) return false;
  if (word.lemma && knownKeys.has(knowledgeKey(language, word.form))) return false;
  return true;
}

export function learnQueue(
  words: SavedWord[],
  knowledge: KnownWord[],
  exposure: LearnExposure,
): SavedWord[] {
  const knownKeys = knownKeysFor(knowledge);
  return words.filter((word) => isLearnPending(word, knownKeys, exposure));
}
