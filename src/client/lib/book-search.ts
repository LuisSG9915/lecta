import { sanitizeSectionDocument } from "./sanitize";
import { normalizeBlockText } from "./reading-location";

// Búsqueda dentro del libro. Compara con acentos y mayúsculas
// plegados («Era» encuentra «era», «corazon» encuentra «corazón»)
// pero conserva un mapa al texto original para mostrar el contexto
// tal como aparece impreso.

export type SearchSection = { createDocument: () => Promise<Document> };
export type SearchTocRow = { index: number; label: string };

export type SearchHit = {
  sectionIndex: number;
  label: string;
  before: string;
  match: string;
  after: string;
  // Fragmento del texto original en el punto del hallazgo: sirve para
  // reubicarlo en la sección renderizada (scrollToSnippet).
  anchor: string;
};

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, pre, td";
const CONTEXT_LEN = 60;
const ANCHOR_LEN = 80;

// Plegado: cada carácter se descompone (NFD), se le quitan marcas
// diacríticas y pasa a minúscula. map[i] es el índice del carácter
// original que produjo folded[i], para rebanar el texto impreso.
export function foldWithMap(text: string): { folded: string; map: number[] } {
  const folded: string[] = [];
  const map: number[] = [];
  let i = 0;
  for (const char of text) {
    const decomposed = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const out of decomposed) {
      folded.push(out);
      map.push(i);
    }
    i += char.length;
  }
  return { folded: folded.join(""), map };
}

const foldQuery = (query: string) => foldWithMap(normalizeBlockText(query)).folded;

const excerpt = (text: string, start: number, end: number) => {
  const cutBefore = start - CONTEXT_LEN > 0;
  const cutAfter = end + CONTEXT_LEN < text.length;
  const before = text.slice(Math.max(0, start - CONTEXT_LEN), start);
  const match = text.slice(start, end);
  const after = text.slice(end, Math.min(text.length, end + CONTEXT_LEN));
  return {
    before: (cutBefore ? "…" : "") + before.trimStart(),
    match,
    after: after.trimEnd() + (cutAfter ? "…" : ""),
  };
};

// Recorre las secciones una a una y va entregando hallazgos. Se puede
// cancelar con la señal o simplemente dejando de iterar; entre sección
// y sección cede el hilo para no congelar la lectura.
export async function* searchBookSections(
  sections: SearchSection[],
  toc: SearchTocRow[],
  query: string,
  options: { signal?: AbortSignal; limit?: number } = {},
): AsyncGenerator<SearchHit> {
  const needle = foldQuery(query);
  if (needle.length < 2) return;
  const limit = options.limit ?? 100;
  let found = 0;

  for (let index = 0; index < sections.length; index += 1) {
    if (options.signal?.aborted || found >= limit) return;
    let sanitized;
    try {
      sanitized = sanitizeSectionDocument(await sections[index].createDocument());
    } catch {
      continue; // una sección ilegible no frena la búsqueda
    }
    const label =
      toc.find((row) => row.index === index)?.label ?? `Sección ${index + 1}`;

    for (const block of sanitized.querySelectorAll(BLOCK_SELECTOR)) {
      if (options.signal?.aborted || found >= limit) return;
      const printed = normalizeBlockText(block.textContent ?? "");
      if (!printed) continue;
      const { folded, map } = foldWithMap(printed);

      let at = folded.indexOf(needle);
      while (at !== -1) {
        const start = map[at];
        const lastFolded = at + needle.length - 1;
        const end = map[lastFolded] + 1;
        const { before, match, after } = excerpt(printed, start, end);
        found += 1;
        yield {
          sectionIndex: index,
          label,
          before,
          match,
          after,
          anchor: printed.slice(start, start + ANCHOR_LEN),
        };
        if (found >= limit) return;
        at = folded.indexOf(needle, at + 1);
      }
    }
    // Ceder el hilo entre secciones: el análisis nunca compite con la lectura.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
