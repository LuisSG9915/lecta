import type { MarkLevel } from "./word-level";

const SAVED_CLASS = "saved-word";
const PREDICTED_CLASS = "predicted-word";
// La tarjeta «Antes de leer» vive dentro del contenedor del texto
// (un portal): su contenido no es parte del libro y nunca se marca.
const SKIP_SELECTOR = `.${SAVED_CLASS}, .${PREDICTED_CLASS}, .section-preview-slot`;

// Marca las formas en el texto del libro: las guardadas llevan
// «saved-word» (con data-level para el desvanecimiento progresivo
// cuando `saved` es un Map) y las predichas como desconocidas llevan
// «predicted-word» (subrayado punteado tenue). Una forma presente en
// ambos conjuntos queda solo como guardada. Primero desenrolla las
// marcas anteriores de ambos tipos para reflejar cambios de nivel,
// guardados nuevos o predicciones que ya no aplican.
export function markWords(
  root: HTMLElement | DocumentFragment,
  saved: Set<string> | Map<string, MarkLevel>,
  predicted: Set<string>,
  language = "es",
) {
  // Desenrolla marcas previas (p. ej. una palabra que pasó a dominada
  // o una predicha que el lector reconoció o guardó).
  root.querySelectorAll(`.${SAVED_CLASS}, .${PREDICTED_CLASS}`).forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  root.normalize();
  if (!saved.size && !predicted.size) return;

  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    if (!text.trim()) continue;
    const matches = [...segmenter.segment(text)].filter((part) => {
      if (!part.isWordLike) return false;
      const form = part.segment.toLowerCase();
      return saved.has(form) || predicted.has(form);
    });
    if (!matches.length) continue;

    let current: Text = node;
    let consumed = 0;
    for (const match of matches) {
      const offset = match.index - consumed;
      const marked = current.splitText(offset);
      current = marked.splitText(match.segment.length);
      const form = match.segment.toLowerCase();
      const mark = document.createElement("mark");
      if (saved.has(form)) {
        mark.className = SAVED_CLASS;
        const level = saved instanceof Map ? saved.get(form) : undefined;
        if (level && level !== "new") mark.dataset.level = level;
      } else {
        mark.className = PREDICTED_CLASS;
      }
      mark.textContent = marked.nodeValue;
      marked.parentNode?.replaceChild(mark, marked);
      consumed = match.index + match.segment.length;
    }
  }
}
