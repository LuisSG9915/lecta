const MARK_CLASS = "saved-word";

export function markSavedWords(root: HTMLElement, forms: Set<string>, language = "es") {
  if (!forms.size) return;
  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`.${MARK_CLASS}`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    if (!text.trim()) continue;
    const matches = [...segmenter.segment(text)].filter(
      (part) => part.isWordLike && forms.has(part.segment.toLowerCase()),
    );
    if (!matches.length) continue;

    let current: Text = node;
    let consumed = 0;
    for (const match of matches) {
      const offset = match.index - consumed;
      const marked = current.splitText(offset);
      current = marked.splitText(match.segment.length);
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = marked.nodeValue;
      marked.parentNode?.replaceChild(mark, marked);
      consumed = match.index + match.segment.length;
    }
  }
}
