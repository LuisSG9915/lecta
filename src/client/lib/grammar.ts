import type { SavedWord } from "./idb";
import { shuffleStable } from "./practice";

export type GrammarCategory = "sustantivo" | "verbo" | "adjetivo" | "adverbio";

export interface GrammarCategoryInfo {
  readonly id: GrammarCategory;
  readonly label: string;
  readonly icon: string;
  readonly shortcut: string;
  readonly question: string;
  readonly hint: string;
}

export const GRAMMAR_CATEGORIES: readonly GrammarCategoryInfo[] = [
  {
    id: "sustantivo",
    label: "Sustantivo",
    icon: "🏛️",
    shortcut: "1",
    question: "Nombra un elemento, ser o idea",
    hint: "Nombra una entidad, objeto o concepto central.",
  },
  {
    id: "verbo",
    label: "Verbo",
    icon: "⚡",
    shortcut: "2",
    question: "Es la acción o estado principal",
    hint: "Expresa el movimiento, proceso o estado de la escena.",
  },
  {
    id: "adjetivo",
    label: "Adjetivo",
    icon: "✨",
    shortcut: "3",
    question: "Describe cómo es algo o lo matiza",
    hint: "Califica o describe los rasgos y la atmósfera.",
  },
  {
    id: "adverbio",
    label: "Adverbio",
    icon: "🧭",
    shortcut: "4",
    question: "Indica cómo, cuándo o cuánto ocurre",
    hint: "Modula el modo, tiempo o grado de la acción.",
  },
] as const;

/**
 * Breve nota editorial de 1 línea explicando cómo la forma gramatical
 * influye en el tono del pasaje literario.
 */
export function grammarToneNote(category: GrammarCategory, word?: string): string {
  const target = word ? ` («${word}»)` : "";
  switch (category) {
    case "adjetivo":
      return `Pinta la atmósfera y matiza la cualidad exacta de la escena${target}.`;
    case "verbo":
      return `Impulsa el ritmo y marca el pulso dinámico de la acción${target}.`;
    case "sustantivo":
      return `Ancla la atención en una presencia o concepto tangible${target}.`;
    case "adverbio":
      return `Modula la intensidad o el compás temporal con que ocurre el momento${target}.`;
  }
}

/**
 * Normaliza y mapea el campo `pos` de una palabra a una de las 4 categorías
 * gramaticales principales del juego, o null si no se puede clasificar con certeza.
 */
export function canonicalGrammarCategory(pos: string | null | undefined): GrammarCategory | null {
  if (!pos) return null;
  const clean = pos.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

  if (
    clean === "sustantivo" ||
    clean === "sust" ||
    clean === "nombre" ||
    clean === "nombre propio" ||
    clean === "noun" ||
    clean === "n"
  ) {
    return "sustantivo";
  }

  if (
    clean === "verbo" ||
    clean === "verb" ||
    clean === "participio" ||
    clean === "v"
  ) {
    return "verbo";
  }

  if (
    clean === "adjetivo" ||
    clean === "adj" ||
    clean === "a"
  ) {
    return "adjetivo";
  }

  if (
    clean === "adverbio" ||
    clean === "adv"
  ) {
    return "adverbio";
  }

  return null;
}

/**
 * Determina si una palabra califica para el minijuego de categorías gramaticales.
 */
export function isGrammarEligible(word: SavedWord): boolean {
  if (word.deleted) return false;
  return canonicalGrammarCategory(word.pos) !== null;
}

/**
 * Prepara una oración corta y ágil para el minijuego de ordenar frases (sintaxis).
 * Si la oración del libro es extensa, extrae la cláusula/oración relevante o una
 * ventana de 4 a 8 palabras alrededor de la palabra objetivo para que nunca sea
 * una pared de texto agobiante.
 */
export function prepareSentenceBuilder(
  rawSentence: string,
  targetWord: string,
  maxWords = 7,
): { originalTokens: string[]; targetWordIndex: number } | null {
  if (!rawSentence || !targetWord) return null;

  const targetClean = targetWord.trim();
  if (!targetClean) return null;

  // Si el texto trae saltos de línea o comillas pesadas, limpiarlas primero
  const clean = rawSentence
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'«“\s]+|["'»”\s]+$/g, "")
    .trim();

  if (!clean) return null;

  // Si hay varias oraciones separadas por puntuación (. ! ?), tomar la que contiene el targetWord
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const targetNorm = targetClean.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

  const containingSentence =
    sentences.find((s) => {
      const sNorm = s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      return sNorm.includes(targetNorm);
    }) ?? clean;

  // Dividir por espacios respetando los tokens
  const tokens = containingSentence.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 3) return null;

  // Buscar el índice del targetWord en los tokens
  let foundIdx = tokens.findIndex((t) => {
    const tNorm = t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    return tNorm.replace(/[^\p{L}\p{N}]/gu, "") === targetNorm.replace(/[^\p{L}\p{N}]/gu, "");
  });

  if (foundIdx === -1) {
    foundIdx = tokens.findIndex((t) => {
      const tNorm = t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      return tNorm.includes(targetNorm);
    });
  }

  if (foundIdx === -1) return null;

  // Si la oración ya tiene un tamaño cómodo (<= maxWords), usarla completa
  if (tokens.length <= maxWords) {
    return {
      originalTokens: tokens,
      targetWordIndex: foundIdx,
    };
  }

  // Si es más larga, extraer una ventana equilibrada alrededor de targetWord
  let start = Math.max(0, foundIdx - Math.floor(maxWords / 2));
  let end = start + maxWords;
  if (end > tokens.length) {
    end = tokens.length;
    start = Math.max(0, end - maxWords);
  }

  const windowTokens = tokens.slice(start, end);
  const adjustedTargetIdx = foundIdx - start;

  return {
    originalTokens: windowTokens,
    targetWordIndex: adjustedTargetIdx,
  };
}

export interface SentenceToken {
  id: string;
  text: string;
}

/**
 * Mezcla los tokens de la oración para el banco de fichas, asegurando
 * que el orden mezclado no sea idéntico al orden original.
 */
export function scrambleSentenceTokens(
  tokens: string[],
  seed?: number,
): SentenceToken[] {
  const tokenObjects: SentenceToken[] = tokens.map((text, idx) => ({
    id: `tok-${idx}-${text}`,
    text,
  }));

  if (tokens.length <= 1) return tokenObjects;

  const scrambled = seed !== undefined
    ? shuffleStable(tokenObjects, seed)
    : [...tokenObjects];

  if (seed === undefined) {
    for (let i = scrambled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]];
    }
  }

  // Verificar si quedó igual que el original y permutar si es necesario
  const isSame = scrambled.every((item, idx) => item.text === tokens[idx]);
  if (isSame && scrambled.length >= 2) {
    // Intercambiar los dos primeros elementos
    const temp = scrambled[0];
    scrambled[0] = scrambled[1];
    scrambled[1] = temp;
  }

  return scrambled;
}

/**
 * Verifica si una palabra califica para el modo sintaxis / ordenar oración.
 */
export function isSentenceEligible(word: SavedWord): boolean {
  if (word.deleted || !word.context) return false;
  return prepareSentenceBuilder(word.context, word.form) !== null;
}
