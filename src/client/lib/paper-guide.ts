// Generación y consumo de la «guía de papel» comunitaria (modelo A1).
//
// Este módulo se importa de forma DINÁMICA desde App.tsx: arrastra
// epub.ts (foliate) y no puede entrar al bundle inicial. Lo que corre
// en el camino caliente (books.ts) solo valida con sanitizePaperBookGuide.
//
// `buildPaperBookGuide` recorre el EPUB del donante UNA vez (su propio
// dispositivo, con su red) y produce el índice léxico que se comparte.
// `createGuideChapterAnalyzer` reimplementa ChapterAnalyzer sin EPUB:
// las formas ya vienen extraídas y solo falta la consulta léxica por
// lote, así la hoja de capítulo muestra las mismas filas de
// buildChapterSuggestionRows con text: "" — sin contexto que citar.

import {
  buildChapterCatalog,
  type ChapterCatalog,
  type ChapterRange,
  type ChapterTarget,
} from "./chapters";
import {
  type ChapterAnalysis,
  type ChapterAnalyzer,
} from "./chapter-analysis";
import {
  detectBookLanguage,
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
  openEpub,
} from "./epub";
import { extractUniqueWords } from "./segmenter";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, menteBaseForms } from "../../shared/word-form";
import { cliticBaseForms } from "./knowledge";
import { capitalOnlyForms } from "./section-words";
import { sanitizeSectionDocument } from "./sanitize";
import { batchLookup } from "./lexicon";
import {
  PAPER_GUIDE_LABEL_MAX,
  PAPER_GUIDE_VERSION,
  type PaperBookGuide,
  type PaperGuideChapter,
} from "../../shared/paper-guide";
import type { StoredBookBinary } from "./idb";

export type { PaperBookGuide, PaperGuideChapter } from "../../shared/paper-guide";
export { sanitizePaperBookGuide } from "../../shared/paper-guide";

// Texto limpio del tramo físico [startSection, endSection), igual que
// rangeText del analizador de capítulos del lector.
const rangeTextFromBook = async (
  book: Awaited<ReturnType<typeof openEpub>>["book"],
  range: ChapterRange,
): Promise<string> => {
  const parts: string[] = [];
  for (let index = range.startSection; index < range.endSection; index += 1) {
    const section = book.sections[index];
    if (!section) continue;
    const clean = sanitizeSectionDocument(await section.createDocument());
    parts.push(
      [...clean.childNodes].map((node) => node.textContent ?? "").join("\n"),
    );
  }
  return parts.join("\n");
};

// Genera la guía desde el EPUB del donante: índice real del libro y,
// por destino, las formas únicas y las solo-capitalizadas en orden
// alfabético — sin una sola oración del texto.
export async function buildPaperBookGuide(
  bookHash: string,
  data: StoredBookBinary,
  meta?: { title?: string; author?: string; language?: string },
  // Segmentador inyectable: la app usa el Web Worker; las pruebas
  // pasan un extractor síncrono (jsdom no tiene Worker).
  extractWords: (text: string, language: string) => Promise<string[]> =
    extractUniqueWords,
): Promise<PaperBookGuide | null> {
  // openEpub trabaja sobre Blob (zip.js BlobReader): normalizamos la
  // entrada igual que saveBook — ArrayBuffer/Uint8Array → Blob epub.
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data as unknown as BlobPart], {
          type: "application/epub+zip",
        });
  const { book, close } = await openEpub(blob);
  try {
    const language =
      meta?.language ||
      (await detectBookLanguage(book).catch(() => getBookLanguage(book))) ||
      "es";
    const title = (meta?.title || getBookTitle(book)).slice(0, 200);
    const author = (meta?.author || getBookAuthor(book) || "").slice(0, 200);
    const catalog = buildChapterCatalog(book);

    const chapters: PaperGuideChapter[] = [];
    for (const range of catalog.ranges) {
      const target = range.target;
      let forms: string[] = [];
      let capitalOnly: string[] = [];
      try {
        const text = await rangeTextFromBook(book, range);
        const words = await extractWords(text, language);
        forms = [
          ...new Set(words.map((word) => word.toLowerCase())),
        ]
          .filter((form) => isWordToken(form) && !isStopword(form, language))
          .sort((a, b) => a.localeCompare(b));
        capitalOnly = [...capitalOnlyForms(words)].sort((a, b) =>
          a.localeCompare(b),
        );
      } catch {
        // Un destino ilegible no frena la guía: queda con listas vacías
        // y la hoja solo dirá que no trae palabras nuevas.
      }
      chapters.push({
        id: target.id,
        label: target.label.slice(0, PAPER_GUIDE_LABEL_MAX),
        depth: target.depth,
        kind: target.kind,
        forms,
        capitalOnly,
      });
      // Ceder el hilo entre capítulos: generar la guía jamás compite
      // con la lectura en curso en este dispositivo.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return {
      version: PAPER_GUIDE_VERSION,
      bookHash,
      title,
      author,
      language,
      updatedAt: Date.now(),
      chapters,
    };
  } finally {
    await Promise.resolve(close()).catch(() => undefined);
  }
}

// Reconstruye el catálogo del modo papel desde la guía: cada capítulo
// es un destino y su propio rango — no hay secciones físicas que unir.
export function catalogFromPaperGuide(guide: PaperBookGuide): ChapterCatalog {
  const targets: ChapterTarget[] = guide.chapters.map((ch) => ({
    id: ch.id,
    label: ch.label,
    href: ch.id,
    sectionIndex: guide.chapters.indexOf(ch),
    depth: ch.depth,
    kind: ch.kind,
  }));
  const ranges: ChapterRange[] = targets.map((target, index) => ({
    target,
    startSection: index,
    endSection: index + 1,
  }));
  return { targets, ranges };
}

export type GuideAnalyzerDeps = {
  language: string;
  lookup?: typeof batchLookup;
  loadCached?: (targetId: string) => Promise<ChapterAnalysis | null>;
  saveCached?: (targetId: string, analysis: ChapterAnalysis) => Promise<void>;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
};

// Analizador de capítulos sobre la guía: las formas ya vienen en la
// guía, así que el análisis es solo el lookup por lote (con las mismas
// bases derivadas -mente/enclíticos del pipeline real) y el resultado
// es idéntico a lo que produce createChapterAnalyzer salvo text: "".
export function createGuideChapterAnalyzer(
  guide: PaperBookGuide,
  deps: GuideAnalyzerDeps,
): ChapterAnalyzer {
  const {
    language,
    lookup = batchLookup,
    loadCached,
    saveCached,
    isCurrent = () => true,
    signal,
  } = deps;

  const cache = new Map<string, ChapterAnalysis>();
  const inflight = new Map<string, Promise<ChapterAnalysis>>();
  const byTarget = new Map(guide.chapters.map((ch) => [ch.id, ch]));

  const run = async (range: ChapterRange): Promise<ChapterAnalysis> => {
    if (signal?.aborted) return { state: "cancelled" };
    try {
      const ch = byTarget.get(range.target.id);
      if (!ch) return { state: "error", error: "Capítulo fuera de la guía." };
      const forms = ch.forms.filter(
        (form) => isWordToken(form) && !isStopword(form, language),
      );
      const lookupForms = new Set(forms);
      for (const form of forms) {
        for (const base of menteBaseForms(form)) lookupForms.add(base);
        for (const base of cliticBaseForms(form)) lookupForms.add(base);
      }
      const result = lookupForms.size
        ? await lookup([...lookupForms], language)
        : ({ ok: true, entries: {} } as const);
      if (!isCurrent() || signal?.aborted)
        return { state: signal?.aborted ? "cancelled" : "stale" };
      if (!result.ok) return { state: "error", error: result.error };
      return {
        state: "ready",
        forms,
        entries: result.entries,
        capitalOnly: new Set(ch.capitalOnly),
        text: "",
        coveragePct: 100,
        unknownKeyWords: [],
      };
    } catch (error) {
      return {
        state: "error",
        error:
          error instanceof Error
            ? error.message
            : "No se pudo analizar el capítulo.",
      };
    }
  };

  const analyze = async (range: ChapterRange): Promise<ChapterAnalysis> => {
    const key = range.target.id;
    const cached = cache.get(key);
    if (cached?.state === "ready") return cached;
    if (loadCached) {
      try {
        const persisted = await loadCached(key);
        if (persisted?.state === "ready") {
          cache.set(key, persisted);
          return persisted;
        }
      } catch {
        // error de lectura de caché → análisis normal
      }
    }
    let pending = inflight.get(key);
    if (!pending) {
      pending = run(range).then((result) => {
        inflight.delete(key);
        if (result.state === "ready") {
          cache.set(key, result);
          if (saveCached) void saveCached(key, result).catch(() => undefined);
        }
        return result;
      });
      inflight.set(key, pending);
    }
    return pending;
  };

  return {
    analyze,
    nextRangeAfter: (sectionIndex: number) => {
      const catalog = catalogFromPaperGuide(guide);
      const current = catalog.ranges.find(
        (range) =>
          range.startSection <= sectionIndex &&
          sectionIndex < range.endSection,
      );
      if (!current) return null;
      const at = catalog.ranges.indexOf(current);
      return catalog.ranges[at + 1] ?? null;
    },
    preloadNext: async (sectionIndex: number) => {
      const catalog = catalogFromPaperGuide(guide);
      const current = catalog.ranges.find(
        (range) =>
          range.startSection <= sectionIndex &&
          sectionIndex < range.endSection,
      );
      if (!current) return null;
      const at = catalog.ranges.indexOf(current);
      const next = catalog.ranges[at + 1];
      return next ? analyze(next) : null;
    },
    cached: (targetId: string) => cache.get(targetId),
    clear: () => cache.clear(),
  };
}
