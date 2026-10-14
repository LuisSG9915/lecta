import { accountFetch } from "./account-fetch";
import { loadUseAi } from "./ai-pref";
import { knowledgeKey, type DbScope, type KnownWord, type SavedWord } from "./idb";

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
  return words
    .filter((word) => isLearnPending(word, knownKeys, exposure))
    .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
}

// ---------- El Reto del Escritor (Evaluación de oraciones) ----------

export interface EvaluateSentenceInput {
  word: string;
  targetSense: string;
  userSentence: string;
  bookTitle?: string;
  lemma?: string;
}

export interface EvaluateSentenceResult {
  ok: boolean;
  isCorrect: boolean;
  score: number;
  catReaction: "purring" | "curious" | "thinking";
  feedback: string;
  improvedVersion: string | null;
  offlineFallback?: boolean;
  error?: string;
}

// Fallback determinista local para cuando no hay conexión o la IA está desactivada
export function evaluateSentenceLocally(
  input: EvaluateSentenceInput,
): EvaluateSentenceResult {
  const sentence = input.userSentence.trim();
  const lowerSentence = sentence.toLowerCase();
  const word = input.word.trim().toLowerCase();
  const lemma = input.lemma?.trim().toLowerCase();

  const wordsInSentence = sentence.split(/\s+/).filter(Boolean);
  const containsWord =
    (Boolean(word) && lowerSentence.includes(word)) ||
    (Boolean(lemma) && lowerSentence.includes(lemma!));

  if (wordsInSentence.length >= 5 && containsWord) {
    return {
      ok: true,
      isCorrect: true,
      score: 95,
      catReaction: "purring",
      feedback: `¡Miau! Has usado «${input.word}» con soltura y armonía en tu frase.`,
      improvedVersion: null,
      offlineFallback: true,
    };
  }

  if (!containsWord) {
    return {
      ok: true,
      isCorrect: false,
      score: 40,
      catReaction: "curious",
      feedback: `Miau... no veo la palabra «${input.word}» en tu texto. Intenta incluirla explícitamente.`,
      improvedVersion: input.targetSense
        ? `Recuerda que «${input.word}» significa: ${input.targetSense}.`
        : null,
      offlineFallback: true,
    };
  }

  return {
    ok: true,
    isCorrect: false,
    score: 50,
    catReaction: "curious",
    feedback: `Miau... tu frase es un poco breve. Intenta escribir al menos 5 palabras para desplegar el sentido de «${input.word}».`,
    improvedVersion: null,
    offlineFallback: true,
  };
}

export async function evaluateSentenceWithAi(
  input: EvaluateSentenceInput,
  scope?: DbScope,
): Promise<EvaluateSentenceResult> {
  const useAi = await loadUseAi(scope);
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;

  if (!useAi || !isOnline) {
    return evaluateSentenceLocally(input);
  }

  try {
    const response = await accountFetch(
      "/api/ai/evaluate-sentence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: input.word,
          targetSense: input.targetSense,
          userSentence: input.userSentence,
          bookTitle: input.bookTitle,
        }),
      },
      scope,
    );

    if (!response.ok) {
      return evaluateSentenceLocally(input);
    }

    const data = (await response.json()) as {
      isCorrect?: boolean;
      score?: number;
      catReaction?: "purring" | "curious" | "thinking";
      feedback?: string;
      improvedVersion?: string | null;
      error?: string;
    };

    if (typeof data.isCorrect !== "boolean" || !data.feedback) {
      return evaluateSentenceLocally(input);
    }

    return {
      ok: true,
      isCorrect: data.isCorrect,
      score: typeof data.score === "number" ? data.score : data.isCorrect ? 100 : 40,
      catReaction: data.catReaction ?? (data.isCorrect ? "purring" : "curious"),
      feedback: data.feedback,
      improvedVersion: data.improvedVersion ?? null,
    };
  } catch {
    return evaluateSentenceLocally(input);
  }
}

// ---------- Cuento de Tinta del Día (Micro-relato) ----------

export interface MicroStoryInput {
  words: Array<{ word: string; meaning?: string }>;
  styleHint?: string;
}

export interface MicroStoryResult {
  ok: boolean;
  title: string;
  story: string;
  wordsUsed: string[];
  offlineFallback?: boolean;
  error?: string;
}

// Fallback poético determinista con palabras envueltas en [[palabra]]
export function generateMicroStoryLocally(
  input: MicroStoryInput,
): MicroStoryResult {
  const cleanWords = input.words
    .filter((w) => Boolean(w.word?.trim()))
    .slice(0, 4);

  if (cleanWords.length === 0) {
    return {
      ok: true,
      title: "Página en Blanco",
      story: "El gato de la biblioteca contemplaba el estante silencioso, esperando palabras para tejer una historia.",
      wordsUsed: [],
      offlineFallback: true,
    };
  }

  const tags = cleanWords.map((w) => `[[${w.word.trim()}]]`);
  const wordsUsed = cleanWords.map((w) => w.word.trim());

  let story: string;
  if (tags.length === 1) {
    story = `En el silencio de la vieja biblioteca, un destello ${tags[0]} brotaba entre las páginas abiertas. El gato guardián alzó la vista y supo que aquel instante quedaría grabado en la memoria del papel.`;
  } else if (tags.length === 2) {
    story = `La tarde caía con ritmo ${tags[0]} sobre las encuadernaciones. Una brisa ${tags[1]} desordenó las notas del escritorio, revelando el enigma que aguardaba pacientemente al lector.`;
  } else if (tags.length === 3) {
    story = `El rumor ${tags[0]} del anochecer envolvía la sala. Con paso ${tags[1]}, el gato rozó el libro ${tags[2]}, tejiendo un puente entre la tinta y la penumbra.`;
  } else {
    story = `Bajo la lámpara de lectura, el eco ${tags[0]} despertaba memorias. Con gesto ${tags[1]} y mirada ${tags[2]}, desciframos el destino ${tags[3]} que aguardaba en la última página.`;
  }

  return {
    ok: true,
    title: "Cuento de Tinta y Sombras",
    story,
    wordsUsed,
    offlineFallback: true,
  };
}

export async function generateMicroStoryWithAi(
  input: MicroStoryInput,
  scope?: DbScope,
): Promise<MicroStoryResult> {
  const useAi = await loadUseAi(scope);
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;

  if (!useAi || !isOnline) {
    return generateMicroStoryLocally(input);
  }

  try {
    const response = await accountFetch(
      "/api/ai/micro-story",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          words: input.words,
          styleHint: input.styleHint,
        }),
      },
      scope,
    );

    if (!response.ok) {
      return generateMicroStoryLocally(input);
    }

    const data = (await response.json()) as {
      title?: string;
      story?: string;
      wordsUsed?: string[];
      error?: string;
    };

    if (!data.title || !data.story) {
      return generateMicroStoryLocally(input);
    }

    return {
      ok: true,
      title: data.title,
      story: data.story,
      wordsUsed: data.wordsUsed ?? [],
    };
  } catch {
    return generateMicroStoryLocally(input);
  }
}

