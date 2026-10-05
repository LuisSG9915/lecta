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
