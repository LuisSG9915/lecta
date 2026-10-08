import { Rating, type Grade } from "./fsrs";
import type { SavedWord } from "./idb";

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
