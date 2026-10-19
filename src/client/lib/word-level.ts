import type { Card } from "./fsrs";
import type { SavedWord } from "./idb";

export type MarkLevel = "new" | "learning" | "settled";

// Rango para decidir qué nivel gana cuando dos fichas cubren la misma
// forma: se queda el menos aprendido (la marca más visible).
const RANK: Record<MarkLevel, number> = { new: 0, learning: 1, settled: 2 };

// Nivel de marca según la estabilidad FSRS de la tarjeta, en días:
// nunca repasada (reps 0) es «nueva»; <21 días, «aprendiendo»;
// <90, «asentada». Por encima se considera dominada y ya no se marca.
export function markLevel(card: Card | undefined): MarkLevel | null {
  const s = card?.stability ?? 0;
  if (s < 2) return (card?.reps ?? 0) === 0 ? "new" : "learning";
  if (s < 21) return "learning";
  if (s < 90) return "settled";
  return null;
}

// Mapa forma (form y lemma, en minúsculas) → nivel de marca,
// para pasarlo a markWords.
export function savedFormLevels(words: SavedWord[]): Map<string, MarkLevel> {
  const levels = new Map<string, MarkLevel>();
  for (const word of words) {
    const level = markLevel(word.card);
    if (!level) continue;
    for (const form of [word.form, word.lemma]) {
      if (!form) continue;
      const key = form.toLowerCase();
      const current = levels.get(key);
      if (!current || RANK[level] < RANK[current]) levels.set(key, level);
    }
  }
  return levels;
}

// Lemas de las palabras dominadas: repasadas al menos una vez y con
// estabilidad ≥90 días (markLevel null). Sirven como evidencia
// auxiliar «conocida» del modelo de conocimiento, registrada al
// cargar el libro. Sin lemma propio se usa la forma; todo en
// minúsculas y sin repetidos.
export function dominatedLemmas(words: SavedWord[]): string[] {
  const lemmas = new Set<string>();
  for (const word of words) {
    if ((word.card?.reps ?? 0) === 0 || markLevel(word.card) !== null) continue;
    const lemma = (word.lemma ?? word.form).toLowerCase();
    if (lemma) lemmas.add(lemma);
  }
  return [...lemmas];
}

export type WordLevel = "a1" | "a2" | "b1" | "b2" | "c1" | "c2";

export function classifyWordLevel(wordOrLemma: string): WordLevel {
  const len = wordOrLemma.length;
  if (len <= 4) return "a1";
  if (len <= 6) return "a2";
  if (len <= 8) return "b1";
  if (len <= 10) return "b2";
  if (len <= 12) return "c1";
  return "c2";
}
