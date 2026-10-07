// Mapa de oraciones de la sección visible para «Leer en voz alta».
// Recorre los nodos de texto del contenedor, concatena su contenido
// con offsets absolutos y segmenta por oración con Intl.Segmenter —
// la misma unidad que usa la ficha de palabra (words.ts).
//
// Cada ítem guarda la ruta de su primer nodo de texto, sus offsets
// absolutos y una huella corta. El resaltado resuelve el rango justo
// antes de marcar (ttsMarks.ts): envolver texto en <mark> parte los
// nodos, así que ningún Range se materializa antes de tiempo.

import type { NodePath, SentenceLayoutItem } from "./ttsTypes";

// Fuera del texto hablable: scripts, estilos, lo oculto, los huecos
// de la tarjeta «Antes de leer» (portal dentro del contenedor) y las
// marcas TTS previas — un mapa reconstruido tras render_change debe
// encontrar el texto original, no los envoltorios.
const SKIP_SELECTOR =
  "script, style, [hidden], [aria-hidden='true'], .section-preview-slot";

// Ruta de índices de childNodes desde `root` hasta `node` — la forma
// de volver a encontrarlo tras un re-render del contenedor.
export function nodePathOf(root: Node, node: Node): NodePath {
  const path: NodePath = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return path;
}

export function nodeAtPath(root: Node, path: NodePath): Node | null {
  let current: Node | null = root;
  for (const index of path) {
    if (!current || index >= current.childNodes.length) return null;
    current = current.childNodes[index];
  }
  return current;
}

// Huella de identidad para re-anclar tras re-render: primeras letras
// normalizadas + cubeta de longitud. Solo compara — no describe el
// contenido ni viaja a eventos.
export const sentenceFingerprint = (text: string): string => {
  const head = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 12);
  return `${head}:${Math.floor(text.length / 16)}`;
};

type TextPiece = { node: Text; path: NodePath; start: number; end: number };

// Bloques que cierran oración: dos nodos de texto en bloques
// distintos llevan un «\n» en el flujo concatenado — sin él,
// «mundo.Segunda» quedaría pegada y el segmentador no cortaría.
// El separador no pertenece a ningún nodo: los tramos de `pieces`
// nunca lo cubren y las marcas no lo envuelven.
const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption, pre, div, section, article";

// Nodos de texto en orden de documento con su tramo absoluto dentro
// del texto concatenado de la sección (incluye los «\n» insertados
// entre bloques — los tramos de `pieces` solo cubren texto real).
export function collectTextPieces(root: HTMLElement): {
  pieces: TextPiece[];
  text: string;
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const pieces: TextPiece[] = [];
  const parts: string[] = [];
  let at = 0;
  let lastBlock: Element | null = null;
  let cursor = walker.nextNode();
  while (cursor) {
    const node = cursor as Text;
    const value = node.nodeValue ?? "";
    if (value.length) {
      const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
      if (pieces.length && block !== lastBlock) {
        parts.push("\n");
        at += 1;
      }
      pieces.push({
        node,
        path: nodePathOf(root, node),
        start: at,
        end: at + value.length,
      });
      parts.push(value);
      at += value.length;
      lastBlock = block;
    }
    cursor = walker.nextNode();
  }
  return { pieces, text: parts.join("") };
}

// ¿La oración trae algo que decir? Separadores sueltos («—», «…»)
// producen utterances vacías que terminan al instante y avanzarían
// el puntero sin sonar; se quedan fuera del mapa.
const hasSpeakable = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

// Construye el mapa de oraciones de la sección. Devuelve también el
// texto concatenado — el controlador lo usa para verificar huellas y
// para medir el arranque por posición.
const normalizeForMatch = (text: string) => text.replace(/\s+/g, " ").trim();

// Primera oración cuyo arranque aparece en `anchor` (texto del bloque
// visible más alto, estilo anchorAtViewTop). Sirve para arrancar la
// sesión donde el lector tiene la vista. Sin coincidencia → 0.
export function sentenceIndexForAnchor(
  items: SentenceLayoutItem[],
  anchor: string | null,
): number {
  if (!anchor) return 0;
  const target = normalizeForMatch(anchor);
  if (!target) return 0;
  const at = items.findIndex((item) => {
    const head = normalizeForMatch(item.text).slice(0, 24);
    return head.length >= 8 && target.includes(head);
  });
  return at >= 0 ? at : 0;
}

// Construye el mapa de oraciones de la sección. Devuelve también el
// texto concatenado — el controlador lo usa para verificar huellas y
// para medir el arranque por posición.
export function buildSentenceMap(
  root: HTMLElement,
  sectionIndex: number,
  language = "es",
): { items: SentenceLayoutItem[]; text: string } {
  const { pieces, text } = collectTextPieces(root);
  if (!pieces.length || !text.trim()) return { items: [], text };
  const segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
  const items: SentenceLayoutItem[] = [];
  let sentenceIndex = 0;
  for (const part of segmenter.segment(text)) {
    const trimmed = part.segment.trim();
    if (!trimmed || !hasSpeakable(trimmed)) continue;
    const firstPiece = pieces.find(
      (piece) => piece.start <= part.index && part.index < piece.end,
    );
    items.push({
      sectionIndex,
      sentenceIndex: sentenceIndex++,
      nodePath: firstPiece?.path ?? [],
      start: part.index,
      end: part.index + part.segment.length,
      fingerprint: sentenceFingerprint(trimmed),
      text: trimmed,
    });
  }
  return { items, text };
}
