// Opciones del hueco episódico (repaso de fin y de mitad de capítulo): el
// objetivo y otras palabras reales del cuaderno, nunca variantes inventadas
// de la misma palabra. Sigue el patrón de «Elegir palabra» del Cuaderno
// (pool del mismo idioma + pickDistractors + shuffleStable).
import type { SavedWord } from "./idb";
import {
  blankWordInContext,
  lemmaKeys,
  matchCase,
  pickDistractors,
  sameWordKeys,
  seedFor,
  shuffleStable,
  type ConsolidationModality,
  type EpisodicWordItem,
} from "./practice";

const MIN_CONTEXT_WORDS = 2;

type QueueEntry = { item: EpisodicWordItem; modality: ConsolidationModality };

const langOf = (value: string | undefined) => (value || "es").slice(0, 2).toLowerCase();
const startsUpper = (value: string) => {
  const first = value.charAt(0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
};

/** Forma que el hueco tapa en la frase del capítulo. */
export const episodicForm = (item: EpisodicWordItem) => (item.surfaceForm || item.lemma || "").trim();

/**
 * 3 o 4 opciones (objetivo + 2–3 palabras del cuaderno) barajadas de forma
 * estable, o `null` si no hay ≥2 distractores o la frase no tiene hueco.
 */
export function episodicClozeOptions(item: EpisodicWordItem, pool: SavedWord[]): string[] | null {
  const form = episodicForm(item);
  if (!form) return null;
  // Sin hueco en la frase, o con la palabra sola de frase (algunos
  // productores caen a `hit.word`), el cloze se adivina sin leer: no se ofrece.
  const blanked = item.chapterSentence ? blankWordInContext(item.chapterSentence, form, item.lang) : null;
  if (!blanked || (blanked.match(/\p{L}+/gu)?.length ?? 0) < MIN_CONTEXT_WORDS) return null;

  const lang = langOf(item.lang);
  const targetKeys = lemmaKeys(item.lemma, form, item.lang);
  const targetUpper = startsUpper(form);
  const candidates = pool.filter((word) => {
    if (word.deleted || langOf(word.language) !== lang) return false;
    const wordForm = word.form.trim();
    if (!wordForm) return false;
    // Nombres propios solo si el objetivo también va en mayúscula:
    // matchCase convertiría «Madrid» en «madrid».
    if (startsUpper(wordForm) && !targetUpper) return false;
    return !sameWordKeys(targetKeys, lemmaKeys(word.lemma, wordForm, word.language || item.lang));
  });

  const target: SavedWord = {
    key: `${lang}:${form.toLowerCase()}`,
    form,
    language: item.lang,
    pos: item.partOfSpeech,
    savedAt: 0,
  } as SavedWord;
  const distractors = pickDistractors(target, candidates, 3).map((word) => matchCase(form, word.form.trim()));
  if (distractors.length < 2) return null;
  return shuffleStable([form, ...distractors], seedFor(item.lemma || form));
}

const SCRAMBLE_MAX_LETTERS = 10;

/**
 * Pone `options` a cada entrada del repaso de fin de capítulo, sobre copias
 * (los ítems originales se comparten con los registros del capítulo). Sin
 * opciones válidas, un cloze pasa a «word-scramble» si la palabra mide ≤10
 * letras (el juego corre con 10 s) o sale de la cola.
 */
export function attachClozeOptions(queue: QueueEntry[], pool: SavedWord[]): QueueEntry[] {
  const result: QueueEntry[] = [];
  for (const entry of queue) {
    if (entry.modality === "word-scramble") {
      result.push({ item: { ...entry.item }, modality: entry.modality });
      continue;
    }
    const options = episodicClozeOptions(entry.item, pool);
    if (options) {
      result.push({ item: { ...entry.item, options }, modality: entry.modality });
    } else if (episodicForm(entry.item).length > 0 && episodicForm(entry.item).length <= SCRAMBLE_MAX_LETTERS) {
      result.push({ item: { ...entry.item }, modality: "word-scramble" });
    }
  }
  return result;
}

/** Inserta o reemplaza por `key` (mismo orden; nuevas al final). */
export function upsertSavedWord(words: SavedWord[], word: SavedWord): SavedWord[] {
  const index = words.findIndex((w) => w.key === word.key);
  if (index === -1) return [...words, word];
  const next = [...words];
  next[index] = word;
  return next;
}

/** Quita por `key`. */
export function removeSavedWord(words: SavedWord[], key: string): SavedWord[] {
  return words.filter((w) => w.key !== key);
}
