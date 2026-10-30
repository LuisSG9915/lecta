import { isReviewDueWord } from "./fsrs";
import type { SavedWord } from "./idb";
import { blankWordInContext, type EpisodicWordItem } from "./practice";
import { firstSentenceWith } from "./section-words";

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
    return {
      lemma: word.lemma || form,
      surfaceForm: form,
      lang: language,
      shortGloss: word.meaning ?? "",
      chapterSentence: sentence,
      chapterTitle: "",
      source: "notebook-reencounter",
      partOfSpeech: word.pos ?? undefined,
    };
  }
  return null;
}
