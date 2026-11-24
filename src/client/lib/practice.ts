import { Rating, type Grade } from "./fsrs-light";
import type { SavedWord } from "./idb";
import { markLevel } from "./word-level";
import { normalizeSearchText } from "./search-text";
import { normalizeWordForm } from "../../shared/word-form";

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
// rellena con cualquier pos. Determinista por palabra: el orden del pool
// depende de un hash de (palabra objetivo, candidata), así la misma palabra
// siempre ofrece las mismas opciones y el orden no depende del pool, pero
// distintas palabras reciben distractores distintos. Antes se ordenaba por
// key y todas las tarjetas repetían los mismos primeros candidatos, de modo
// que se acertaba por descarte.
const distractorRank = (target: SavedWord, candidate: SavedWord): number => {
  // FNV-1a de 32 bits sobre «objetivo|candidata».
  let hash = 0x811c9dc5;
  const text = `${target.key}|${candidate.key}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export function pickDistractors(
  target: SavedWord,
  pool: SavedWord[],
  count = 3,
): SavedWord[] {
  const ordered = [...pool].sort(
    (a, b) =>
      distractorRank(target, a) - distractorRank(target, b) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
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

// Semilla estable por palabra o tanda: las opciones no cambian de
// orden entre renders ni si se interrumpe y retoma el repaso.
export const seedFor = (text: string) => {
  let seed = 7;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  return seed;
};

// Claves de «misma palabra»: lema, lema normalizado y forma normalizada,
// sin acentos ni mayúsculas. Los ítems episódicos suelen traer la forma
// superficial como lema, así que se comparan las tres.
export function lemmaKeys(lemma: string | undefined, form: string, lang = "es"): Set<string> {
  const keys = new Set<string>();
  const add = (value: string | undefined) => {
    const key = value ? normalizeSearchText(value) : "";
    if (key) keys.add(key);
  };
  add(lemma);
  if (lemma) add(normalizeWordForm(lemma, lang));
  add(normalizeWordForm(form, lang));
  return keys;
}

// Dos palabras son la misma si comparten clave o un prefijo de ≥5 letras:
// atrapa flexiones del español sin lema de catálogo («susurró»/«susurraba»).
// Perder a veces un distractor legítimo («presentar»/«presencia») es aceptado.
const SAME_WORD_PREFIX = 5;
export function sameWordKeys(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      if (x.length >= SAME_WORD_PREFIX && y.length >= SAME_WORD_PREFIX && x.slice(0, SAME_WORD_PREFIX) === y.slice(0, SAME_WORD_PREFIX)) return true;
    }
  }
  return false;
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
  source: "pre-chapter-primed" | "in-chapter-lookup" | "notebook-reencounter";
  partOfSpeech?: string;
  /** Opciones del hueco ya resueltas (episodic-cloze.ts): objetivo + palabras reales del cuaderno. */
  options?: string[];
}

export interface ConsolidationAttemptMetrics {
  lemma: string;
  modality: ConsolidationModality;
  responseTimeMs: number;
  errorCount: number;
  usedHint: boolean;
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

  const SOURCE_PRIORITY: Record<EpisodicWordItem["source"], number> = {
    "in-chapter-lookup": 0,
    "notebook-reencounter": 1,
    "pre-chapter-primed": 2,
  };

  // Una sola entrada por lema, con la fuente de mayor prioridad: la
  // misma palabra puede llegar consultada y también como reencuentro.
  const byLemma = new Map<string, EpisodicWordItem>();
  for (const item of candidates) {
    const key = (item.lemma || item.surfaceForm).trim().toLowerCase();
    if (!key) continue;
    const prev = byLemma.get(key);
    if (!prev || SOURCE_PRIORITY[item.source] < SOURCE_PRIORITY[prev.source]) {
      byLemma.set(key, item);
    }
  }

  // Priorizar las palabras que el usuario tocó en el capítulo, luego
  // los reencuentros de su Cuaderno y por último las pre-vistas.
  const sorted = [...byLemma.values()].sort((a, b) => {
    const diff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (diff !== 0) return diff;
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

export function matchCase(source: string, target: string): string {
  if (!source || !target) return target;
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target.charAt(0).toLowerCase() + target.slice(1);
}

/**
 * Distractores para un hueco: solo palabras reales de `candidates` (≠ objetivo,
 * longitud ±4). Antes inventaba variantes por sufijo de la misma palabra
 * («inteligibless», «inteligibleses»): el ejercicio se resolvía sin leer. Sin
 * candidatos devuelve `[]`.
 */
export function generateMorphologicalDistractors(
  targetWord: string,
  options?: MorphologicalDistractorOptions,
): string[] {
  const clean = targetWord.trim();
  if (!clean) return [];

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


