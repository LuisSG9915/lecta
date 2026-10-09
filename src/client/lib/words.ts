import type { PhraseHit } from "./phrases";

export type WordHit = {
  word: string;
  context?: string;
  // Locución detectada en la oración del toque (fase B): la rellena
  // quien abre la ficha — la extracción en sí no la conoce.
  phrase?: PhraseHit;
};

// Elige la oración que cubre la posición del toque (offset dentro de
// text): una palabra repetida en el bloque debe traer la oración que
// la rodea a ella, no la primera que la contiene. Si ninguna cubre el
// offset, se conserva el criterio anterior como respaldo.
const findSentence = (text: string, word: string, language: string, offset: number) => {
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
  const part =
    segments.find((s) => s.index <= offset && offset < s.index + s.segment.length && s.isWordLike) ??
    (segments.find((s) => s.index === offset) === undefined
      ? segments.filter((s) => s.isWordLike && s.index + s.segment.length === offset).at(-1)
      : undefined);
  if (!part) return null;

  const word = part.segment;

  // Validación de proximidad geométrica: en navegadores reales, caretAtPoint
  // al pulsar en el margen derecho o fuera del texto cae al final del nodo
  // de texto y seleccionaba erróneamente la última palabra de la línea.
  // Si el navegador provee rectángulos de trazado para la palabra, verificamos
  // que el toque (clientX, clientY) esté dentro o inmediatamente adyacente
  // a la palabra (con margen de tolerancia para dedos en pantallas táctiles).
  try {
    const wordRange = document.createRange();
    wordRange.setStart(node, part.index);
    wordRange.setEnd(node, part.index + part.segment.length);
    const rects = wordRange.getClientRects();
    if (rects && rects.length > 0) {
      const hasLayout = Array.from(rects).some((r) => r.width > 0 || r.height > 0);
      if (hasLayout) {
        const padX = 14;
        const padY = 8;
        const hitInside = Array.from(rects).some(
          (r) =>
            clientX >= r.left - padX &&
            clientX <= r.right + padX &&
            clientY >= r.top - padY &&
            clientY <= r.bottom + padY,
        );
        if (!hitInside) return null;
      }
    }
  } catch {
    // Si la medición falla por el entorno, se conserva el resultado textual.
  }
  const block = node.parentElement?.closest(
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th",
  );
  let context: string | undefined;
  if (block?.textContent) {
    // Posición de la palabra dentro del bloque: un Range desde el
    // inicio del bloque hasta el inicio del segmento tocado da el
    // offset en caracteres de textContent, aunque el nodo esté anidado.
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, part.index);
    context = findSentence(block.textContent, word, language, range.toString().length);
  }

  return { word, context };
}
