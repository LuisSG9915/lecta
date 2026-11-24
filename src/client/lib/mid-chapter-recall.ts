import { isReviewDueWord } from "./fsrs-light";
import type { SavedWord } from "./idb";
import { blankWordInContext, type EpisodicWordItem } from "./practice";
import { firstSentenceWith } from "./section-words";
import { episodicClozeOptions } from "./episodic-cloze";

export function isForwardStepIntoSection(previous: number, current: number): boolean {
  return previous >= 0 && current === previous + 1;
}

export const midChapterRecallKey = (bookHash: string, chapterId: string) =>
  `midChapterRecall:v1:${encodeURIComponent(bookHash)}:${encodeURIComponent(chapterId)}`;

export function pickMidChapterRecall(
  words: SavedWord[],
  sectionText: string,
  language: string,
  now = new Date(),
): EpisodicWordItem | null {
  const lang = language.slice(0, 2).toLowerCase();
  const due = words
    .filter(
      (word) =>
        !word.deleted &&
        Boolean(word.meaning) &&
        (word.card?.reps ?? 0) > 0 &&
        isReviewDueWord(word, now) &&
        (word.language || "es").slice(0, 2).toLowerCase() === lang,
    )
    .sort((a, b) => new Date(a.card!.due).getTime() - new Date(b.card!.due).getTime());
  for (const word of due) {
    const form = word.form.trim();
    const sentence = firstSentenceWith(sectionText, form, language);
    if (!sentence || !blankWordInContext(sentence, form, language)) continue;
    const item: EpisodicWordItem = {
      lemma: word.lemma || form,
      surfaceForm: form,
      lang: language,
      shortGloss: word.meaning ?? "",
      chapterSentence: sentence,
      chapterTitle: "",
      source: "notebook-reencounter",
      partOfSpeech: word.pos ?? undefined,
    };
    // Sin ≥2 palabras reales del cuaderno para distraer, el hueco se
    // resolvería sin leer: se prueba el siguiente vencido.
    const options = episodicClozeOptions(item, words);
    if (!options) continue;
    return { ...item, options };
  }
  return null;
}
