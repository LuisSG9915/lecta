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
      if (replaced || !part.isWordLike) return part.segment;
      if (part.segment.toLowerCase() !== target) return part.segment;
      replaced = true;
      return BLANK;
    })
    .join("");
  return replaced ? result : null;
}
