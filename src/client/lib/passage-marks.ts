import type { SavedAnnotation } from "./idb";
import { foldWithMap } from "./book-search";

// Marca los pasajes guardados dentro del texto del libro. Preferida:
// CSS Custom Highlight API (no toca el DOM, así no rompe las marcas
// de vocabulario). Alternativa controlada: envolver nodos de texto
// con <mark class="saved-passage">, sin tocar el interior de las
// marcas de palabras (guardadas o predichas) ni la tarjeta
// «Antes de leer».

const PASSAGE_CLASS = "saved-passage";
const HIGHLIGHT_NAME = "lecta-passage";

type NodeMap = { node: Text; offset: number }[];

// Texto plegado de todo el contenedor con mapa a (nodo, offset).
// Los nodos se concatenan sin separador — como hace textContent — así
// un pasaje que cruza <em>/<strong> o hasta dos párrafos se encuentra.
function foldContainer(root: HTMLElement): { folded: string; map: NodeMap } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const folded: string[] = [];
  const map: NodeMap = [];
  let lastWasSpace = false;
  for (const node of nodes) {
    const data = node.nodeValue ?? "";
    for (let i = 0; i < data.length; i += 1) {
      const decomposed = data[i].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      for (const char of decomposed) {
        const isSpace = /\s/.test(char);
        if (isSpace && lastWasSpace) continue;
        folded.push(isSpace ? " " : char);
        map.push({ node, offset: i });
        lastWasSpace = isSpace;
      }
    }
    // Entre bloques no hay espacio implícito en textContent, pero un
    // salto de párrafo sí separa palabras al seleccionar: lo agregamos.
    if (node.nextSibling === null && !lastWasSpace) {
      folded.push(" ");
      map.push({ node, offset: data.length });
      lastWasSpace = true;
    }
  }
  return { folded: folded.join(""), map };
}

const foldNeedle = (text: string) => {
  const { folded } = foldWithMap(text.replace(/\s+/g, " ").trim());
  return folded;
};

// Construye el rango del pasaje dentro del contenedor. Primero busca
// el texto completo; si no aparece, intenta con el inicio y el final
// del fragmento por separado (el usuario pudo seleccionar a mitad de
// palabra o el EPUB variantes de espaciado).
export function findPassageRange(
  container: HTMLElement,
  passage: Pick<SavedAnnotation, "text">,
): Range | null {
  const text = passage.text?.trim();
  if (!text) return null;
  const { folded, map } = foldContainer(container);
  const needle = foldNeedle(text);

  let at = needle ? folded.indexOf(needle) : -1;
  let end = at === -1 ? -1 : at + needle.length;

  if (at === -1 && text.length > 80) {
    // Plan B: ubicar cabeza y cola del fragmento por separado.
    const head = foldNeedle(text.slice(0, 40));
    const tail = foldNeedle(text.slice(-40));
    const start = head ? folded.indexOf(head) : -1;
    const tailAt = tail ? folded.indexOf(tail, Math.max(0, start)) : -1;
    if (start !== -1 && tailAt !== -1) {
      at = start;
      end = tailAt + tail.length;
    }
  }
  if (at === -1 || end <= at) return null;

  const first = map[at];
  const last = map[end - 1];
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

function unwrapPassageMarks(root: HTMLElement) {
  root.querySelectorAll(`mark.${PASSAGE_CLASS}`).forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  root.normalize();
}

// Aplica las marcas de los pasajes visibles de esta sección. Llamar
// después de markWords: el fallback envuelve nodos vivos y las
// marcas de palabras deben existir ya para no pisarlas.
export function applyPassageMarks(
  container: HTMLElement,
  passages: SavedAnnotation[],
) {
  if (typeof CSS !== "undefined" && CSS.highlights) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  }
  unwrapPassageMarks(container);

  const ranges = passages
    .map((passage) => findPassageRange(container, passage))
    .filter((range): range is Range => range !== null);
  if (!ranges.length) return;

  if (
    typeof CSS !== "undefined" &&
    CSS.highlights &&
    typeof Highlight !== "undefined"
  ) {
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return;
  }

  // Alternativa: envolver nodos de texto completos o parciales que no
  // estén dentro de una marca de vocabulario ni de la tarjeta «Antes
  // de leer». Un pasaje largo queda como varios <mark> contiguos —
  // visualmente continuo.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const range of ranges) {
    for (const node of nodes) {
      if (
        !node.isConnected ||
        node.parentElement?.closest(
          `.saved-word, .predicted-word, .section-preview-slot`,
        )
      )
        continue;
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : (node.nodeValue ?? "").length;
      if (end <= start) continue;
      if (end < (node.nodeValue ?? "").length) node.splitText(end);
      const mid = start > 0 ? node.splitText(start) : node;
      const mark = document.createElement("mark");
      mark.className = PASSAGE_CLASS;
      mid.parentNode?.replaceChild(mark, mid);
      mark.appendChild(mid);
    }
  }
}
