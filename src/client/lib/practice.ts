import { Rating, type Grade } from "./fsrs";
import type { SavedWord } from "./idb";
import { markLevel } from "./word-level";

const BLANK = "_____";

export function blankWordInContext(
  context: string,
  form: string,
  language = "es",
): string | null {
  const target = form.trim().toLowerCase();
  if (!context || !target) return null;
  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  let replaced = false;
  const result = [...segmenter.segment(context)]
    .map((part) => {
      if (!part.isWordLike || part.segment.toLowerCase() !== target) return part.segment;
      replaced = true;
      return BLANK;
    })
    .join("");
  return replaced ? result : null;
}

export interface ContextSnippetResult {
  snippet: string;
  isTrimmed: boolean;
}

// Ventana de micro-contexto para ejercicios: si la cita del libro
// es un párrafo largo (muchas palabras), aísla solo unas pocas
// palabras antes y después de la palabra clave (o del hueco «_____»).
// Así el repaso es ágil e instantáneo sin abrumar con paredes de texto.
export function smartContextSnippet(
  text: string | null | undefined,
  target?: string,
  options: {
    maxWordsBefore?: number;
    maxWordsAfter?: number;
    maxTotalWords?: number;
    language?: string;
  } = {},
): ContextSnippetResult {
  if (!text || !text.trim()) {
    return { snippet: "", isTrimmed: false };
  }
  const {
    maxWordsBefore = 5,
    maxWordsAfter = 5,
    maxTotalWords = 14,
    language = "es",
  } = options;

  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  const segments = [...segmenter.segment(text)];
  const wordSegments = segments.filter((s) => s.isWordLike);

  // Si la cita completa ya es breve, se conserva íntegra.
  if (wordSegments.length <= maxTotalWords) {
    return { snippet: text.trim(), isTrimmed: false };
  }

  const targetLower = target?.trim().toLowerCase() ?? "";
  let targetIdx = -1;
  if (targetLower) {
    targetIdx = wordSegments.findIndex(
      (s) =>
        s.segment.toLowerCase() === targetLower ||
        s.segment.toLowerCase().includes(targetLower),
    );
  }

  let startWord = 0;
  let endWord = Math.min(wordSegments.length - 1, maxTotalWords - 1);
  if (targetIdx !== -1) {
    startWord = Math.max(0, targetIdx - maxWordsBefore);
    endWord = Math.min(wordSegments.length - 1, targetIdx + maxWordsAfter);
  }

  const startSegment = wordSegments[startWord];
  const endSegment = wordSegments[endWord];
  const rawStart = startSegment.index;
  let rawEnd = endSegment.index + endSegment.segment.length;

  const nextSeg = segments.find((s) => s.index === rawEnd);
  if (nextSeg && !nextSeg.isWordLike && /^[,.;:!?»”]/.test(nextSeg.segment)) {
    rawEnd += nextSeg.segment.length;
  }

  let slice = text.slice(rawStart, rawEnd).trim();
  const trimmedBefore = startWord > 0;
  const trimmedAfter = endWord < wordSegments.length - 1;

  if (trimmedBefore) {
    slice = slice.replace(/^[\u201C\u201D"'\s]+/, "");
    slice = `… ${slice}`;
  }
  if (trimmedAfter) {
    slice = slice.replace(/[\u201C\u201D"'\s]+$/, "");
    slice = `${slice} …`;
  }

  return { snippet: slice, isTrimmed: true };
}

// ---------- Ejercicios con opciones ----------

// Acertar eligiendo entre opciones vale menos que recordar la
// respuesta sin ayuda: por eso un acierto programa «Difícil» (Hard)
// y no «Bien». El fallo siempre vuelve a empezar (Again).
export const EXERCISE_RATING: Record<"correct" | "wrong", Grade> = {
  correct: Rating.Hard,
  wrong: Rating.Again,
};

// La estadística editorial de un ítem del catálogo solo anota
// acierto/fallo: en la escala de autovaloración, «Otra vez» (Again)
// es el único fallo y cualquier recuerdo —difícil, bien o fácil—
// cuenta como acierto.
export function ratingToCorrect(rating: Grade): boolean {
  return rating !== Rating.Again;
}

// Distractores para «elegir palabra»: otras formas del cuaderno,
// preferentemente de la misma categoría (pos); si no alcanzan se
// rellena con cualquier pos. Determinista: se recorre el pool en
// orden estable por key, así la misma palabra siempre ofrece las
// mismas opciones.
export function pickDistractors(
  target: SavedWord,
  pool: SavedWord[],
  count = 3,
): SavedWord[] {
  const ordered = [...pool].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const seen = new Set([target.form.toLowerCase()]);
  const samePos: SavedWord[] = [];
  const others: SavedWord[] = [];
  for (const word of ordered) {
    const form = word.form.toLowerCase();
    if (word.key === target.key || word.deleted || seen.has(form)) continue;
    seen.add(form);
    if (target.pos != null && word.pos === target.pos) samePos.push(word);
    else others.push(word);
  }
  return [...samePos, ...others].slice(0, count);
}

// Fisher-Yates con semilla (mulberry32): la misma semilla produce la
// misma mezcla, así las opciones de una tarjeta no «bailan» entre
// renders ni entre sesiones del mismo repaso.
export function shuffleStable<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Modo de cada palabra en la mezcla «Repasar hoy»: con oración
// guardada alterna cloze y elegir; sin oración, significado y
// palabra. «sense» y los modos B («contexto», «oración nueva»,
// «escribir») nunca salen de aquí: armar su cola pide fichas o ítems
// del catálogo que se generan con IA (preparación lenta), así que se
// eligen a mano desde la lista de modos.
export function modeForWord(
  word: SavedWord,
  index: number,
): "meaning" | "word" | "cloze" | "choose" | "sense" {
  const even = index % 2 === 0;
  if (word.context) return even ? "cloze" : "choose";
  return even ? "meaning" : "word";
}

// Recorta definiciones largas para tarjetas y chips de minijuegos
// (como «Parejas»), eliminando prefijos pesados y cortando limpiamente
// en la frontera de palabra.
export function conciseMeaning(meaning: string, maxChars = 75): string {
  if (!meaning) return "";
  let text = meaning.trim();
  text = text.replace(/^(?:\([^)]+\)\s*)+/, "");
  text = text.replace(/^Dicho de [^:]+:\s*/i, "");
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim() + "…";
}

// Mezcla las letras de una palabra para el minijuego de descifrar,
// garantizando que el resultado no sea idéntico a la palabra original
// (a menos que tenga una sola letra o todas iguales).
export function scrambleWord(
  word: string,
  seed?: number,
): { original: string; letters: string[] } {
  const clean = word.trim();
  if (!clean) return { original: "", letters: [] };
  const chars = [...clean].map((c) => c.toUpperCase());
  if (chars.length <= 1) {
    return { original: clean, letters: chars };
  }

  const allSame = chars.every((c) => c === chars[0]);
  if (allSame) {
    return { original: clean, letters: chars };
  }

  const scrambled = seed !== undefined ? shuffleStable(chars, seed) : [...chars];
  if (seed === undefined) {
    for (let i = scrambled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]];
    }
  }

  if (scrambled.join("") === chars.join("")) {
    for (let i = 0; i < scrambled.length - 1; i++) {
      if (scrambled[i] !== scrambled[i + 1]) {
        [scrambled[i], scrambled[i + 1]] = [scrambled[i + 1], scrambled[i]];
        break;
      }
    }
    if (scrambled.join("") === chars.join("")) {
      for (let i = 0; i < scrambled.length; i++) {
        for (let j = i + 1; j < scrambled.length; j++) {
          if (scrambled[i] !== scrambled[j]) {
            [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]];
            break;
          }
        }
        if (scrambled.join("") !== chars.join("")) break;
      }
    }
  }

  return { original: clean, letters: scrambled };
}

// ---------- Sesión Fluida y Enrutamiento Cognitivo Adaptativo ----------

export type AdaptiveMechanic =
  | "contextual_cloze"
  | "syllable_scramble"
  | "phrase_weaver"
  | "grammar_nuance"
  | "ai_sentence_craft";

export type PracticeItem =
  | SavedWord
  | {
      word: SavedWord;
      pool?: SavedWord[];
      useAi?: boolean;
      hasConnection?: boolean;
    };

export interface AdaptiveChallenge {
  id: string;
  word: SavedWord;
  level: 1 | 2 | 3;
  mechanic: AdaptiveMechanic;
  distractors: string[];
  clozeSentence: string | null;
  targetWord: string;
  rescued?: boolean;
  originalMechanic?: AdaptiveMechanic;
  hint?: string;
}

/**
 * Selecciona 3 distractores semánticamente plausibles del mismo nivel
 * léxico/estabilidad (word-level.ts) y categoría gramatical.
 */
export function pickLevelDistractors(
  target: SavedWord,
  pool: SavedWord[],
  count = 3,
): string[] {
  const targetLevel = markLevel(target.card);
  const seen = new Set([target.form.toLowerCase()]);
  const sameLevelSamePos: string[] = [];
  const sameLevel: string[] = [];
  const samePos: string[] = [];
  const others: string[] = [];

  const ordered = [...pool].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  for (const w of ordered) {
    if (w.key === target.key || w.deleted) continue;
    const formLower = w.form.toLowerCase();
    if (seen.has(formLower)) continue;
    seen.add(formLower);

    const wLevel = markLevel(w.card);
    const isSameLevel = wLevel === targetLevel;
    const isSamePos = target.pos != null && w.pos === target.pos;

    if (isSameLevel && isSamePos) {
      sameLevelSamePos.push(w.form);
    } else if (isSameLevel) {
      sameLevel.push(w.form);
    } else if (isSamePos) {
      samePos.push(w.form);
    } else {
      others.push(w.form);
    }
  }

  return [...sameLevelSamePos, ...sameLevel, ...samePos, ...others].slice(0, count);
}

/**
 * Algoritmo de Enrutamiento Cognitivo:
 * Asigna automáticamente la mecánica óptima según la estabilidad S y dificultad D en FSRS:
 * - Nivel 1 — Reconocimiento (S < 2.5 días o tarjeta nueva): mechanic: 'contextual_cloze'
 * - Nivel 2 — Reconstrucción Morfológica y Sintáctica (2.5 <= S < 10 días):
 *             Alterna entre 'syllable_scramble' y 'phrase_weaver'
 * - Nivel 3 — Dominio Profundo y Producción (S >= 10 días):
 *             'grammar_nuance' o 'ai_sentence_craft' (si IA está activa y hay conexión)
 */
export function buildAdaptivePracticeQueue(
  items: PracticeItem[],
  options?: {
    pool?: SavedWord[];
    useAi?: boolean;
    hasConnection?: boolean;
  },
): AdaptiveChallenge[] {
  const allWords: SavedWord[] = items.map((it) => ("word" in it ? it.word : it));
  const defaultPool = options?.pool ?? allWords;

  let level2Counter = 0;

  return items.map((item, index) => {
    const word = "word" in item ? item.word : item;
    const itemPool = ("pool" in item && item.pool) ? item.pool : defaultPool;
    const useAi =
      ("useAi" in item ? item.useAi : undefined) ?? options?.useAi ?? false;
    const hasConnection =
      ("hasConnection" in item ? item.hasConnection : undefined) ??
      options?.hasConnection ??
      true;

    const card = word.card;
    const stability = card?.stability ?? 0;
    const reps = card?.reps ?? 0;
    const isNew = !card || reps === 0;

    let level: 1 | 2 | 3;
    let mechanic: AdaptiveMechanic;

    if (isNew || stability < 2.5) {
      level = 1;
      mechanic = "contextual_cloze";
    } else if (stability < 10) {
      level = 2;
      const wantsWeaver = level2Counter % 2 === 1;
      level2Counter++;
      if (wantsWeaver && word.context && word.context.trim().length > 0) {
        mechanic = "phrase_weaver";
      } else {
        mechanic = "syllable_scramble";
      }
    } else {
      level = 3;
      if (useAi && hasConnection) {
        mechanic = "ai_sentence_craft";
      } else {
        mechanic = "grammar_nuance";
      }
    }

    const distractors = pickLevelDistractors(word, itemPool, 3);
    const clozeSentence = word.context
      ? blankWordInContext(word.context, word.form, word.language)
      : null;

    return {
      id: `challenge-${word.key}-${index}`,
      word,
      level,
      mechanic,
      distractors,
      clozeSentence,
      targetWord: word.form,
    };
  });
}

/**
 * Regla de Rescate Pedagógico (Anti-Frustración):
 * Si un usuario falla un reto de Nivel 2 o Nivel 3, degrada inmediatamente el reto
 * en la misma pantalla al Nivel 1 (mostrar la oración con pistas visuales / distractores)
 * para que el usuario termine siempre el turno con una respuesta exitosa.
 */
export function rescueChallenge(
  challenge: AdaptiveChallenge,
  pool: SavedWord[] = [],
): AdaptiveChallenge {
  const distractors =
    challenge.distractors && challenge.distractors.length > 0
      ? challenge.distractors
      : pickLevelDistractors(challenge.word, pool, 3);

  const clozeSentence =
    challenge.clozeSentence ??
    (challenge.word.context
      ? blankWordInContext(
          challenge.word.context,
          challenge.word.form,
          challenge.word.language,
        )
      : null);

  const prefix = challenge.word.form.slice(
    0,
    Math.min(2, challenge.word.form.length),
  );

  return {
    ...challenge,
    level: 1,
    originalMechanic: challenge.originalMechanic ?? challenge.mechanic,
    mechanic: "contextual_cloze",
    rescued: true,
    distractors,
    clozeSentence,
    hint: `Pista de rescate: la palabra empieza por «${prefix.toUpperCase()}»`,
  };
}

/* ==========================================================================
   Track 4: Repaso Rápido de 1 Minuto (FSRS + Selección Automática de Dinámica)
   ========================================================================== */

export type AutoGameType = "flash-choice" | "word-scramble" | "sentence-builder";

export interface SavedWordItem {
  id: string;
  word: string;
  shortDefinition: string;
  inPassageMeaning?: string;
  sentenceContext?: string;
  bookTitle?: string;
  // Metadatos de FSRS (src/client/lib/fsrs.ts)
  dueTimestamp: number;
  stability: number; // < 2: nueva/frágil, 2-7: intermedia, > 7: consolidada
}

export interface OneMinuteReviewRound {
  item: SavedWordItem;
  assignedGame: AutoGameType;
}

/**
 * Selecciona automáticamente hasta 5 palabras prioritarias según FSRS
 * y les asigna la dinámica más amena según su nivel de dominio.
 */
export function buildOneMinuteReviewSession(
  items: SavedWordItem[],
  now = Date.now(),
): OneMinuteReviewRound[] {
  const sorted = [...items].sort((a, b) => {
    const aOverdue = a.dueTimestamp <= now ? 0 : 1;
    const bOverdue = b.dueTimestamp <= now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    return a.dueTimestamp - b.dueTimestamp;
  });

  return sorted.slice(0, 5).map((item) => {
    let assignedGame: AutoGameType = "flash-choice";
    if (item.stability >= 2 && item.stability < 6) {
      assignedGame = "word-scramble"; // WordScrambleGame.tsx
    } else if (item.stability >= 6 && item.sentenceContext) {
      assignedGame = "sentence-builder"; // SentenceBuilderGame.tsx
    }
    return { item, assignedGame };
  });
}

/**
 * Convierte un SavedWord de IndexedDB a SavedWordItem para la sesión de 1 minuto.
 */
export function savedWordToItem(w: SavedWord): SavedWordItem {
  const rawDue = w.card?.due;
  let dueTimestamp = 0;
  if (typeof rawDue === "number") {
    dueTimestamp = rawDue;
  } else if (typeof rawDue === "string") {
    dueTimestamp = new Date(rawDue).getTime();
  }
  return {
    id: w.key,
    word: w.form,
    shortDefinition: w.meaning ?? "",
    inPassageMeaning: w.meaning,
    sentenceContext: w.context,
    bookTitle: w.bookTitle,
    dueTimestamp,
    stability: w.card?.stability ?? 0,
  };
}

/* ==========================================================================
   Track 10: Consolidación Episódica Post-Capítulo (FSRS Implícito + Adaptación)
   ========================================================================== */

export type ConsolidationModality =
  | "sentence-cloze"
  | "word-scramble"
  | "grammar-nuance";

export interface EpisodicWordItem {
  lemma: string;
  surfaceForm: string;
  lang: string;
  shortGloss: string;
  chapterSentence: string; // La oración exacta del capítulo que acaba de leer
  chapterTitle: string;
  source: "pre-chapter-primed" | "in-chapter-lookup";
  partOfSpeech?: string;
}

export interface ConsolidationAttemptMetrics {
  lemma: string;
  modality: ConsolidationModality;
  responseTimeMs: number;
  errorCount: number;
  usedHint: boolean;
}

export interface ImplicitFsrsGradeResult {
  grade: 1 | 2 | 3 | 4; // 1=Again, 2=Hard, 3=Good, 4=Easy
  episodicStabilityMultiplier: number;
  masteryDeltaTheta: number;
}

export interface PostChapterConsolidationPrefs {
  enabled: boolean;
  mutedBookIds: string[];
  maxExercisesPerChapter: 2 | 3;
  modalityWeightsByLang: Record<string, Record<ConsolidationModality, number>>;
}

export const DEFAULT_CONSOLIDATION_PREFS: PostChapterConsolidationPrefs = {
  enabled: true,
  mutedBookIds: [],
  maxExercisesPerChapter: 3,
  modalityWeightsByLang: {},
};

/**
 * Infiere automáticamente la calificación FSRS (1..4) y el bono de estabilidad episódica
 * a partir de la telemetría de respuesta del usuario, sin pedirle autoevaluación manual.
 */
export function computeImplicitFsrsGrade(
  wordLength: number,
  metrics: ConsolidationAttemptMetrics,
): ImplicitFsrsGradeResult {
  const effectiveLen = Math.max(4, wordLength);
  const msPerChar = metrics.responseTimeMs / effectiveLen;

  if (metrics.errorCount >= 2) {
    return {
      grade: 1,
      episodicStabilityMultiplier: 1.0,
      masteryDeltaTheta: -0.08,
    };
  }

  if (metrics.errorCount === 1 || metrics.usedHint) {
    return {
      grade: 2,
      episodicStabilityMultiplier: 1.0,
      masteryDeltaTheta: 0.02,
    };
  }

  if (msPerChar <= 650) {
    return {
      grade: 4,
      episodicStabilityMultiplier: 1.35,
      masteryDeltaTheta: 0.14,
    };
  }

  return {
    grade: 3,
    episodicStabilityMultiplier: 1.2,
    masteryDeltaTheta: 0.09,
  };
}

export const calculateImplicitFsrsGrade = computeImplicitFsrsGrade;

/**
 * Selecciona los 2 o 3 mejores ejercicios al terminar el capítulo priorizando
 * palabras consultadas durante la lectura y palabras vistas en la pre-lectura.
 */
export function buildPostChapterConsolidationQueue(
  candidates: EpisodicWordItem[],
  prefs: PostChapterConsolidationPrefs,
  isForeignLanguage: boolean,
  options?: { bookId?: string },
): Array<{ item: EpisodicWordItem; modality: ConsolidationModality }> {
  if (!prefs.enabled || candidates.length === 0) return [];
  if (options?.bookId && prefs.mutedBookIds?.includes(options.bookId)) return [];

  // Priorizar las palabras que el usuario necesitó tocar dentro del capítulo, luego las pre-vistas
  const sorted = [...candidates].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === "in-chapter-lookup" ? -1 : 1;
    }
    return b.chapterSentence.length - a.chapterSentence.length;
  });

  const selected = sorted.slice(0, prefs.maxExercisesPerChapter);

  return selected.map((item, idx) => {
    const langKey = item.lang.slice(0, 2).toLowerCase() || "es";
    const customWeights = prefs.modalityWeightsByLang[langKey];

    let modality: ConsolidationModality = "sentence-cloze";
    if (customWeights && Object.keys(customWeights).length > 0) {
      const sortedWeights = (
        Object.entries(customWeights) as Array<[ConsolidationModality, number]>
      ).sort((a, b) => b[1] - a[1]);
      if (sortedWeights.length > 0) {
        modality = sortedWeights[0][0];
      }
    } else if (isForeignLanguage && idx === 1 && item.surfaceForm.length <= 10) {
      // En L2, alternar el segundo ejercicio con reconstrucción ortográfica (WordScramble)
      modality = "word-scramble";
    }

    return { item, modality };
  });
}

/**
 * Adapta los pesos de efectividad de cada modalidad en función de los resultados del usuario:
 * - Si en L2 comete errores ortográficos (error en word-scramble), incrementa la probabilidad de word-scramble.
 * - Si consolida adecuadamente la ortografía o comete errores sintácticos, incrementa sentence-cloze.
 */
export function recordModalityAttempt(
  prefs: PostChapterConsolidationPrefs,
  lang: string,
  metrics: ConsolidationAttemptMetrics,
  isForeignLanguage = false,
): PostChapterConsolidationPrefs {
  const langKey = lang.slice(0, 2).toLowerCase() || "es";
  const currentLangWeights = prefs.modalityWeightsByLang[langKey] ?? {
    "sentence-cloze": 1.0,
    "word-scramble": isForeignLanguage ? 0.9 : 0.6,
    "grammar-nuance": 0.5,
  };

  const nextWeights: Record<ConsolidationModality, number> = {
    ...currentLangWeights,
  };

  if (metrics.modality === "word-scramble") {
    if (metrics.errorCount > 0 || metrics.usedHint) {
      nextWeights["word-scramble"] = Number(
        (nextWeights["word-scramble"] + 0.25).toFixed(2),
      );
    } else if (metrics.responseTimeMs / Math.max(4, metrics.lemma.length) <= 650) {
      nextWeights["sentence-cloze"] = Number(
        (nextWeights["sentence-cloze"] + 0.15).toFixed(2),
      );
    }
  } else if (metrics.modality === "sentence-cloze") {
    if (metrics.errorCount > 0 || metrics.usedHint) {
      nextWeights["sentence-cloze"] = Number(
        (nextWeights["sentence-cloze"] + 0.25).toFixed(2),
      );
    } else if (isForeignLanguage) {
      nextWeights["word-scramble"] = Number(
        (nextWeights["word-scramble"] + 0.1).toFixed(2),
      );
    }
  }

  return {
    ...prefs,
    modalityWeightsByLang: {
      ...prefs.modalityWeightsByLang,
      [langKey]: nextWeights,
    },
  };
}

export const POST_CHAPTER_CONSOLIDATION_PREFS_KEY =
  "lecta:post_chapter_consolidation_prefs:v1";

const memoryStorage: Record<string, string> = {};

const getLocalStorage = (): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} | null => {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as { localStorage: Storage }).localStorage;
  }
  return {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage[k] = v;
    },
    removeItem: (k: string) => {
      delete memoryStorage[k];
    },
  };
};

export function loadPostChapterConsolidationPrefs(): PostChapterConsolidationPrefs {
  const storage = getLocalStorage();
  if (!storage) {
    return { ...DEFAULT_CONSOLIDATION_PREFS };
  }
  try {
    const raw = storage.getItem(POST_CHAPTER_CONSOLIDATION_PREFS_KEY);
    if (!raw) return { ...DEFAULT_CONSOLIDATION_PREFS };
    const parsed = JSON.parse(raw) as Partial<PostChapterConsolidationPrefs>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      mutedBookIds: Array.isArray(parsed.mutedBookIds) ? parsed.mutedBookIds : [],
      maxExercisesPerChapter:
        parsed.maxExercisesPerChapter === 2 || parsed.maxExercisesPerChapter === 3
          ? parsed.maxExercisesPerChapter
          : 3,
      modalityWeightsByLang:
        typeof parsed.modalityWeightsByLang === "object" &&
        parsed.modalityWeightsByLang !== null
          ? parsed.modalityWeightsByLang
          : {},
    };
  } catch {
    return { ...DEFAULT_CONSOLIDATION_PREFS };
  }
}

export function savePostChapterConsolidationPrefs(
  prefs: PostChapterConsolidationPrefs,
): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(
      POST_CHAPTER_CONSOLIDATION_PREFS_KEY,
      JSON.stringify(prefs),
    );
  } catch {
    // Ignorar fallo de almacenamiento
  }
}

/**
 * Silencia la consolidación post-capítulo específicamente para un libro.
 */
export function muteConsolidationForBook(bookId: string): void {
  if (!bookId) return;
  const prefs = loadPostChapterConsolidationPrefs();
  if (!prefs.mutedBookIds.includes(bookId)) {
    savePostChapterConsolidationPrefs({
      ...prefs,
      mutedBookIds: [...prefs.mutedBookIds, bookId],
    });
  }
}

/**
 * Vuelve a habilitar la consolidación para un libro silenciado previamente.
 */
export function unmuteConsolidationForBook(bookId: string): void {
  if (!bookId) return;
  const prefs = loadPostChapterConsolidationPrefs();
  savePostChapterConsolidationPrefs({
    ...prefs,
    mutedBookIds: prefs.mutedBookIds.filter((id) => id !== bookId),
  });
}

/**
 * Desactiva la consolidación post-capítulo para todos los libros de forma global.
 */
export function disableConsolidationGlobally(): void {
  const prefs = loadPostChapterConsolidationPrefs();
  savePostChapterConsolidationPrefs({
    ...prefs,
    enabled: false,
  });
}

/**
 * Activa la consolidación post-capítulo de forma global.
 */
export function enableConsolidationGlobally(): void {
  const prefs = loadPostChapterConsolidationPrefs();
  savePostChapterConsolidationPrefs({
    ...prefs,
    enabled: true,
  });
}

/**
 * Verifica si la consolidación post-capítulo está activa (globalmente y no silenciada para el libro).
 */
export function isConsolidationActive(bookId?: string): boolean {
  const prefs = loadPostChapterConsolidationPrefs();
  if (!prefs.enabled) return false;
  if (bookId && prefs.mutedBookIds.includes(bookId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Generador de Distractores Morfológicos y Opciones Cloze (Fase 2)
// ---------------------------------------------------------------------------

export interface MorphologicalDistractorOptions {
  lang?: string;
  pos?: string;
  count?: number;
  candidates?: string[];
}

export interface ClozeOptionsResult {
  options: string[];
  correctIndex: number;
}

function matchCase(source: string, target: string): string {
  if (!source || !target) return target;
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target.charAt(0).toLowerCase() + target.slice(1);
}

/**
 * Genera distractores morfológicamente coherentes para una palabra clave,
 * alternando desinencias verbales, flexiones o sufijos según el idioma (L1/L2).
 */
export function generateMorphologicalDistractors(
  targetWord: string,
  options?: MorphologicalDistractorOptions,
): string[] {
  const clean = targetWord.trim();
  if (!clean) return [];

  const lang = (options?.lang ?? "es").toLowerCase();
  const isEn = lang.startsWith("en");
  const count = Math.max(1, options?.count ?? 2);
  const targetLower = clean.toLowerCase();

  const results: string[] = [];
  const seen = new Set<string>([targetLower]);

  const addVariant = (variant: string | undefined | null) => {
    if (!variant) return;
    const trimmed = variant.trim();
    const lower = trimmed.toLowerCase();
    if (!lower || seen.has(lower)) return;
    seen.add(lower);
    results.push(matchCase(clean, trimmed));
  };

  // 1. Si se aportaron palabras candidatas (por ejemplo del mismo capítulo), priorizar las de longitud similar
  if (options?.candidates && options.candidates.length > 0) {
    const candidateMatches = options.candidates
      .map((c) => c.trim())
      .filter((c) => {
        const cl = c.toLowerCase();
        if (!cl || seen.has(cl)) return false;
        return Math.abs(cl.length - targetLower.length) <= 4;
      });
    for (const cand of candidateMatches) {
      addVariant(cand);
      if (results.length >= count) return results.slice(0, count);
    }
  }

  // 2. Reglas morfológicas para inglés (L2)
  if (isEn) {
    if (targetLower.endsWith("ing") && targetLower.length > 4) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "ed");
      addVariant(base + "s");
      addVariant(base);
      addVariant(base + "er");
    } else if (targetLower.endsWith("ed") && targetLower.length > 4) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "ing");
      addVariant(base + "s");
      addVariant(base);
      addVariant(base + "er");
    } else if (targetLower.endsWith("ly") && targetLower.length > 4) {
      const base = targetLower.slice(0, -2);
      addVariant(base);
      addVariant(base + "ness");
      addVariant(base + "ful");
    } else if (targetLower.endsWith("tion") && targetLower.length > 5) {
      const base = targetLower.slice(0, -4);
      addVariant(base + "tive");
      addVariant(base + "ting");
      addVariant(base + "ted");
    } else if (targetLower.endsWith("ful") && targetLower.length > 4) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "less");
      addVariant(base + "fully");
      addVariant(base + "ness");
    } else if (targetLower.endsWith("able") && targetLower.length > 5) {
      const base = targetLower.slice(0, -4);
      addVariant(base + "ably");
      addVariant(base + "ed");
      addVariant(base + "ing");
    } else if (targetLower.endsWith("s") && targetLower.length > 3) {
      const base = targetLower.endsWith("es") ? targetLower.slice(0, -2) : targetLower.slice(0, -1);
      addVariant(base + "ed");
      addVariant(base + "ing");
      addVariant(base);
    } else {
      addVariant(targetLower + "ing");
      addVariant(targetLower + "ed");
      addVariant(targetLower + "s");
      addVariant(targetLower + "er");
    }
  } else {
    // 3. Reglas morfológicas para español (L1)
    if (targetLower.endsWith("mente") && targetLower.length > 6) {
      const base = targetLower.slice(0, -5);
      addVariant(base);
      addVariant(base + "s");
      addVariant(base.slice(0, -1) + "ez");
    } else if (targetLower.endsWith("ando") && targetLower.length > 5) {
      const base = targetLower.slice(0, -4);
      addVariant(base + "ar");
      addVariant(base + "aba");
      addVariant(base + "ado");
      addVariant(base + "ó");
    } else if (targetLower.endsWith("iendo") && targetLower.length > 6) {
      const base = targetLower.slice(0, -5);
      addVariant(base + "er");
      addVariant(base + "ir");
      addVariant(base + "ía");
      addVariant(base + "ido");
      addVariant(base + "ió");
    } else if (targetLower.endsWith("ado") && targetLower.length > 4) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "ar");
      addVariant(base + "ando");
      addVariant(base + "aba");
      addVariant(base + "ó");
    } else if (targetLower.endsWith("ido") && targetLower.length > 4) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "er");
      addVariant(base + "ir");
      addVariant(base + "iendo");
      addVariant(base + "ió");
    } else if (targetLower.endsWith("aba") && targetLower.length > 4) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "ar");
      addVariant(base + "ando");
      addVariant(base + "ó");
    } else if (targetLower.endsWith("ía") && targetLower.length > 3) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "er");
      addVariant(base + "ir");
      addVariant(base + "ió");
    } else if (targetLower.endsWith("ó") && targetLower.length > 2) {
      const base = targetLower.slice(0, -1);
      addVariant(base + "aba");
      addVariant(base + "ar");
      addVariant(base + "ando");
    } else if (targetLower.endsWith("ió") && targetLower.length > 3) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "ía");
      addVariant(base + "er");
      addVariant(base + "iendo");
    } else if (targetLower.endsWith("ar") && targetLower.length > 3) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "aba");
      addVariant(base + "ando");
      addVariant(base + "ó");
      addVariant(base + "ado");
    } else if (targetLower.endsWith("er") && targetLower.length > 3) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "ía");
      addVariant(base + "iendo");
      addVariant(base + "ió");
      addVariant(base + "ido");
    } else if (targetLower.endsWith("ir") && targetLower.length > 3) {
      const base = targetLower.slice(0, -2);
      addVariant(base + "ía");
      addVariant(base + "iendo");
      addVariant(base + "ió");
      addVariant(base + "ido");
    } else if (targetLower.endsWith("ción") && targetLower.length > 5) {
      const base = targetLower.slice(0, -4);
      addVariant(base + "dor");
      addVariant(base + "miento");
      addVariant(base + "ivo");
    } else if (targetLower.endsWith("oso") || targetLower.endsWith("osa")) {
      const base = targetLower.slice(0, -3);
      addVariant(base + "idad");
      addVariant(base + "al");
      addVariant(base + (targetLower.endsWith("oso") ? "osa" : "oso"));
    } else if (targetLower.endsWith("able") || targetLower.endsWith("ible")) {
      const base = targetLower.slice(0, -4);
      addVariant(base + "idad");
      addVariant(base + "ado");
      addVariant(base + "ante");
    } else if (targetLower.endsWith("o") || targetLower.endsWith("a")) {
      const base = targetLower.slice(0, -1);
      addVariant(base + (targetLower.endsWith("o") ? "a" : "o"));
      addVariant(base + "os");
      addVariant(base + "as");
      addVariant(base + "ito");
    }
  }

  // 4. Mecanismo de contingencia si no se alcanzó el conteo requerido
  const fallbackAffixes = isEn
    ? ["s", "ed", "ing", "er", "ly", "ish"]
    : ["s", "es", "ito", "ón", "ero", "ado"];

  for (const affix of fallbackAffixes) {
    if (results.length >= count) break;
    addVariant(targetLower + affix);
  }

  if (results.length < count) {
    const lastChar = targetLower.slice(-1);
    const altChar = lastChar === "a" ? "o" : lastChar === "o" ? "e" : "a";
    addVariant(targetLower.slice(0, -1) + altChar);
    addVariant(targetLower + (isEn ? "y" : "al"));
  }

  return results.slice(0, count);
}

/**
 * Genera el paquete de opciones de hueco contextual (cloze), devolviendo
 * las opciones barajadas y el índice de la respuesta correcta.
 */
export function generateClozeOptions(
  targetWord: string,
  options?: MorphologicalDistractorOptions & { seed?: number },
): ClozeOptionsResult {
  const count = options?.count ?? 3;
  const distractorCount = Math.max(1, count - 1);
  const distractors = generateMorphologicalDistractors(targetWord, {
    ...options,
    count: distractorCount,
  });

  const all = [targetWord.trim(), ...distractors.slice(0, distractorCount)];
  const shuffled =
    options?.seed !== undefined
      ? shuffleStable(all, options.seed)
      : [...all].sort(() => Math.random() - 0.5);

  const targetLower = targetWord.trim().toLowerCase();
  let correctIndex = shuffled.findIndex(
    (opt) => opt.trim().toLowerCase() === targetLower,
  );
  if (correctIndex === -1) {
    correctIndex = 0;
    shuffled[0] = targetWord.trim();
  }

  return {
    options: shuffled,
    correctIndex,
  };
}


