import type { PhraseHit } from "./phrases";

export type WordHit = {
  word: string;
  context?: string;
  // Locución detectada en la oración del toque (fase B): la rellena
  // quien abre la ficha — la extracción en sí no la conoce.
  phrase?: PhraseHit;
  // Tramo exacto de la palabra tocada: lo usa la ficha para resaltarla
  // con la Custom Highlight API mientras está abierta. Transitorio — no
  // se serializa ni sobrevive a un cambio de sección.
  range?: Range;
};

// Bloques de texto del lector: la oración, el offset y la tinta se miden
// dentro de uno de estos.
export const TEXT_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th";

export function textBlockOf(node: Node | null | undefined): Element | null {
  const el = !node ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(TEXT_BLOCK_SELECTOR) ?? null;
}

// Offset en caracteres de textContent desde el inicio del bloque hasta
// (node, offset), aunque el nodo esté anidado en <em>, marcas o spans.
export function offsetInBlock(block: Element, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(node, offset);
  return range.toString().length;
}

// Elige la oración que cubre la posición del toque (offset dentro de
// text): una palabra repetida en el bloque debe traer la oración que
// la rodea a ella, no la primera que la contiene. Si ninguna cubre el
// offset, se conserva el criterio anterior como respaldo.
export const findSentence = (
  text: string,
  word: string,
  language: string,
  offset: number,
) => {
  const sentences = [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)];
  const covering = sentences.find(
    (sentence) => sentence.index <= offset && offset < sentence.index + sentence.segment.length,
  );
  if (covering) return covering.segment.trim();
  for (const sentence of sentences) {
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
  const covering = segments.find(
    (s) => s.index <= offset && offset < s.index + s.segment.length && s.isWordLike,
  );
  // Tocar la mitad derecha de la última letra deja el caret justo DESPUÉS
  // de la palabra: al final del nodo, o al inicio de la puntuación o el
  // espacio que la sigue («perenne|.»). La palabra que termina ahí vale,
  // pero ante un segmento siguiente solo si el toque cae dentro de su
  // caja (más abajo): el hueco entre palabras sigue siendo zona neutral.
  const next = covering ? undefined : segments.find((s) => s.index === offset);
  const part =
    covering ??
    (next === undefined || !next.isWordLike
      ? segments.filter((s) => s.isWordLike && s.index + s.segment.length === offset).at(-1)
      : undefined);
  if (!part) return null;
  const strictHit = !covering && next !== undefined;

  const word = part.segment;

  // Validación de proximidad geométrica: en navegadores reales, caretAtPoint
  // al pulsar en el margen derecho o fuera del texto cae al final del nodo
  // de texto y seleccionaba erróneamente la última palabra de la línea.
  // Si el navegador provee rectángulos de trazado para la palabra, verificamos
  // que el toque (clientX, clientY) esté dentro de la caja de la palabra
  // ampliada un 25 % (zona neutral: el hueco entre palabras o el margen no
  // abre la ficha de la vecina ni hace nada — cierra la abierta).
  const wordRange = document.createRange();
  wordRange.setStart(node, part.index);
  wordRange.setEnd(node, part.index + part.segment.length);
  try {
    const rects = wordRange.getClientRects();
    if (rects && rects.length > 0) {
      const hasLayout = Array.from(rects).some((r) => r.width > 0 || r.height > 0);
      if (hasLayout) {
        const slack = strictHit ? 0 : 0.25;
        const hitInside = Array.from(rects).some(
          (r) =>
            clientX >= r.left - r.width * slack &&
            clientX <= r.right + r.width * slack &&
            clientY >= r.top - r.height * slack &&
            clientY <= r.bottom + r.height * slack,
        );
        if (!hitInside) return null;
      }
    }
  } catch {
    // Si la medición falla por el entorno, se conserva el resultado textual.
  }
  const block = textBlockOf(node);
  let context: string | undefined;
  if (block?.textContent) {
    context = findSentence(block.textContent, word, language, offsetInBlock(block, node, part.index));
  }

  return { word, context, range: wordRange };
}

/**
 * Extrae un WordHit a partir de un Range del DOM si y solo si la selección
 * contiene exactamente una sola palabra (para mostrar «Definir» en el menú).
 * Si contiene múltiples palabras o ninguna, devuelve null.
 */
export function wordHitFromRange(
  range: Range,
  root: HTMLElement,
  language = "es",
): WordHit | null {
  if (range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;

  const text = range.toString().trim();
  if (!text) return null;

  // Segmentar el texto seleccionado en palabras
  const segments = [...new Intl.Segmenter(language, { granularity: "word" }).segment(text)];
  const wordLikes = segments.filter((s) => s.isWordLike);

  // Exactamente una sola palabra seleccionada
  if (wordLikes.length !== 1) return null;

  const word = wordLikes[0].segment;
  const block = textBlockOf(range.startContainer);

  let context: string | undefined;
  if (block?.textContent) {
    try {
      const offset = offsetInBlock(block, range.startContainer, range.startOffset);
      context = findSentence(block.textContent, word, language, offset);
    } catch {
      context = findSentence(block.textContent, word, language, 0);
    }
  }

  return { word, context, range: range.cloneRange() };
}

// Dónde empieza la palabra de la ficha: bloque + offset de su primera
// letra. Independiente del origen del rango (toque sostenido o
// selección nativa, que puede incluir puntuación o partir en spans).
export function hitAnchor(hit: WordHit): { block: Element; offset: number } | null {
  const range = hit.range;
  if (!range) return null;
  const block = textBlockOf(range.startContainer);
  if (!block) return null;
  try {
    const text = block.textContent ?? "";
    let offset = offsetInBlock(block, range.startContainer, range.startOffset);
    while (offset < text.length && !/[\p{L}\p{N}]/u.test(text[offset])) offset += 1;
    return { block, offset };
  } catch {
    return null;
  }
}

const sameText = (a: string, b: string) =>
  a.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() === b.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// ¿Es la misma palabra en el mismo sitio? Misma palabra normalizada y, si
// ambas traen rango, mismo bloque y mismo offset de la primera letra.
export function sameWordHit(a: WordHit, b: WordHit): boolean {
  if (!sameText(a.word.trim(), b.word.trim())) return false;
  const anchorA = hitAnchor(a);
  const anchorB = hitAnchor(b);
  if (!anchorA || !anchorB) return !a.range && !b.range;
  return anchorA.block === anchorB.block && anchorA.offset === anchorB.offset;
}

// Rango de la oración que contiene la palabra de la ficha: lo que guarda
// «Tinta» desde la ficha. Mide sobre textContent del bloque con el mismo
// Segmenter que findSentence y convierte los offsets a nodos de texto.
// null sin rango (fichas abiertas sin toque).
export function sentenceRangeForHit(hit: WordHit, language = "es"): Range | null {
  const anchor = hitAnchor(hit);
  if (!anchor) return null;
  const text = anchor.block.textContent ?? "";
  const sentence = [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)].find(
    (s) => s.index <= anchor.offset && anchor.offset < s.index + s.segment.length,
  );
  if (!sentence) return null;
  let start = sentence.index;
  let end = sentence.index + sentence.segment.length;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (end <= start) return null;

  const walker = document.createTreeWalker(anchor.block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let startSet = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.data.length;
    if (!startSet && start < seen + length) {
      range.setStart(node, start - seen);
      startSet = true;
    }
    if (startSet && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}
