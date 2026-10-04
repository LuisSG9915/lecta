export type WordHit = {
  word: string;
  context?: string;
};

const findSentence = (text: string, word: string, language: string) => {
  const sentences = new Intl.Segmenter(language, { granularity: "sentence" });
  for (const sentence of sentences.segment(text)) {
    if (sentence.segment.includes(word)) return sentence.segment.trim();
  }
  return undefined;
};

// caretRangeFromPoint es de WebKit/Chromium; Firefox expone la API
// estándar caretPositionFromPoint y hay que convertirla a Range.
function caretAtPoint(clientX: number, clientY: number): Range | null {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(clientX, clientY);
  const position = document.caretPositionFromPoint?.(clientX, clientY);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

export function extractWordAtPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement,
  language = "es",
): WordHit | null {
  const caret = caretAtPoint(clientX, clientY);
  const node = caret?.startContainer;
  if (!caret || !node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;

  const text = node.textContent ?? "";
  const offset = caret.startOffset;
  const segments = [...new Intl.Segmenter(language, { granularity: "word" }).segment(text)];
  const part =
    segments.find((s) => s.index <= offset && offset < s.index + s.segment.length && s.isWordLike) ??
    (segments.find((s) => s.index === offset) === undefined
      ? segments.filter((s) => s.isWordLike && s.index + s.segment.length === offset).at(-1)
      : undefined);
  if (!part) return null;

  const word = part.segment;
  const block = node.parentElement?.closest(
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th",
  );
  const context = block?.textContent
    ? findSentence(block.textContent, word, language)
    : undefined;

  return { word, context };
}
