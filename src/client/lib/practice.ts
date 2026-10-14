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

