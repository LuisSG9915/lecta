import type { MarkLevel } from "./word-level";

const MARK_CLASS = "saved-word";

// Marca las formas guardadas en el texto del libro. Recibe un Set
// (todas al nivel «nueva») o un Map forma → nivel, que pinta
// data-level para el desvanecimiento progresivo. Primero quita las
// marcas anteriores para reflejar cambios de nivel o dominio.
export function markSavedWords(
  root: HTMLElement | DocumentFragment,
  forms: Set<string> | Map<string, MarkLevel>,
  language = "es",
) {
  // Desenrolla marcas previas (p. ej. una palabra que pasó a dominada).
  root.querySelectorAll(`.${MARK_CLASS}`).forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  root.normalize();
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
      const level = forms instanceof Map ? forms.get(match.segment.toLowerCase()) : undefined;
      if (level && level !== "new") mark.dataset.level = level;
      mark.textContent = marked.nodeValue;
      marked.parentNode?.replaceChild(mark, marked);
      consumed = match.index + match.segment.length;
    }
  }
}
