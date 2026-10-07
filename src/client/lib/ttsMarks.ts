// Resaltado de la oración hablada: envuelve el tramo en
// <mark data-tts-sentence> por nodos de texto (patrón de marks.ts).
// El rango se resuelve JUSTO antes de marcar — materializarlo al
// construir el mapa se rompería: envolver texto parte los nodos.
//
// La resolución usa los offsets absolutos del mapa: concatenar los
// nodos de texto da el mismo flujo aunque haya marcas previas, porque
// una <mark> no cambia el textContent — solo lo envuelve. Los nodos
// dentro de marcas TTS viejas cuentan igual (se limpian primero).

import { collectTextPieces, sentenceFingerprint } from "./ttsSentences";
import type { SentenceLayoutItem } from "./ttsTypes";

export const TTS_MARK_SELECTOR = "[data-tts-sentence]";

// Desenrolla las marcas TTS del contenedor y normaliza: devuelve el
// DOM a nodos de texto corridos para que el siguiente resolve parta
// del mismo mapa de offsets.
export function clearTtsMarks(root: HTMLElement | DocumentFragment): void {
  root.querySelectorAll(TTS_MARK_SELECTOR).forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  root.normalize();
}

// Envuelve el tramo [start, end) de la oración en marcas. Una oración
// que cruza nodos («dijo <i>ella</i>») queda en varias marcas
// contiguas con el mismo data-tts-sentence. Si el texto resuelto ya
// no coincide con la huella (re-render a medio camino) no se marca
// nada — el audio sigue sin resaltado, nunca rompe la lectura.
export function markSentence(
  root: HTMLElement,
  item: SentenceLayoutItem,
): boolean {
  const { pieces, text } = collectTextPieces(root);
  const slice = text.slice(item.start, item.end).trim();
  if (!slice || sentenceFingerprint(slice) !== item.fingerprint) {
    return false;
  }
  let marked = false;
  for (const piece of pieces) {
    const from = Math.max(piece.start, item.start);
    const to = Math.min(piece.end, item.end);
    if (from >= to) continue;
    const node = piece.node;
    const start = from - piece.start;
    const rest = node.splitText(start);
    const tail = rest.splitText(to - from);
    const mark = document.createElement("mark");
    mark.dataset.ttsSentence = String(item.sentenceIndex);
    mark.textContent = rest.nodeValue;
    rest.parentNode?.replaceChild(mark, rest);
    piece.node = tail;
    marked = true;
  }
  return marked;
}

// El primer envoltorio de la oración activa, para scroll-into-view.
export function ttsMarkElement(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(TTS_MARK_SELECTOR);
}
