// Genera una guía de papel (modelo A1) desde un EPUB local, usando el
// MISMO pipeline del cliente (`buildPaperBookGuide`). Uso:
//
//   pnpm exec tsx scripts/generate-paper-guide.mts <epub> <hash> <salida.json> [titulo] [autor] [idioma]
//
// Pensado para el backfill de guías comunitarias: el EPUB se baja de
// R2 con wrangler, la guía sale aquí y se sube a `guides/{hash}.json`.
// El JSON solo contiene índice + formas — nunca texto del libro.

import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";

// Foliate y sanitize esperan un DOM de navegador. jsdom lo da; se
// copian solo los globals que el pipeline toca (document, DOMParser,
// NodeFilter, customElements, clases de nodos…).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const w = dom.window as unknown as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "DOMParser",
  "XMLSerializer",
  "NodeFilter",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Document",
  "DocumentFragment",
  "customElements",
  "MutationObserver",
  "FileReader",
  "getComputedStyle",
]) {
  if (w[key] !== undefined) (globalThis as Record<string, unknown>)[key] = w[key];
}
try {
  void (globalThis as Record<string, unknown>).navigator;
} catch {
  Object.defineProperty(globalThis, "navigator", {
    value: w.navigator,
    configurable: true,
  });
}

const [epubPath, hash, outPath, title, author, language] =
  process.argv.slice(2);
if (!epubPath || !hash || !outPath) {
  console.error(
    "uso: generate-paper-guide.mts <epub> <hash> <salida.json> [titulo] [autor] [idioma]",
  );
  process.exit(2);
}
if (!/^[a-f0-9]{64}$/.test(hash)) {
  console.error("hash inválido: se esperan 64 hex");
  process.exit(2);
}

const { buildPaperBookGuide } = await import(
  "../src/client/lib/paper-guide"
);
const { sanitizePaperBookGuide } = await import(
  "../src/shared/paper-guide"
);

// Segmentador sin Web Worker: Intl.Segmenter nativo de Node.
const segmenters = new Map<string, Intl.Segmenter>();
const extractWords = async (text: string, language: string) => {
  let segmenter = segmenters.get(language);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(language || "es", {
      granularity: "word",
    });
    segmenters.set(language, segmenter);
  }
  return [...segmenter.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);
};

const bytes = readFileSync(epubPath);
const guide = await buildPaperBookGuide(
  hash,
  new Uint8Array(bytes),
  {
    title: title || undefined,
    author: author || undefined,
    language: language || undefined,
  },
  extractWords,
);

if (!guide) {
  console.error("no se pudo generar la guía");
  process.exit(1);
}
// La validación es la misma que aplica el servidor al recibirla.
const clean = sanitizePaperBookGuide(guide, hash);
if (!clean) {
  console.error("la guía generada no pasó la validación del contrato");
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(clean));
const forms = clean.chapters.reduce((n, ch) => n + ch.forms.length, 0);
console.log(
  `guía ok: ${clean.chapters.length} capítulos, ${forms} formas, ` +
    `${(JSON.stringify(clean).length / 1024).toFixed(1)} kB → ${outPath}`,
);
