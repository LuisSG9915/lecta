// Análisis de vocabulario por destino (T13): un `ChapterRange` cubre
// el tramo físico de un capítulo — una sección o varias — así que el
// análisis trabaja sobre el texto del rango completo, no sobre una
// sección suelta. Cada destino se analiza una vez (caché) y las
// solicitudes concurrentes comparten la misma promesa.
//
// Estados discriminados: quien llama distingue «listo» de «falló» y
// de «el libro/cuenta ya no es el mismo» — el análisis nunca falla
// en silencio ni bloquea la lectura.
//
// El enriquecimiento con IA queda fuera a propósito: es opcional, va
// a su propio ritmo y no debe frenar la preparación ni el análisis.

import type { EpubBook } from "./epub";
import type { ChapterCatalog, ChapterRange } from "./chapters";
import { extractUniqueWords } from "./segmenter";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, menteBaseForms } from "../../shared/word-form";
import { cliticBaseForms } from "./knowledge";
import { capitalOnlyForms } from "./section-words";
import { sanitizeSectionDocument } from "./sanitize";
import { batchLookup, type BatchLookupResult, type LexiconEntry } from "./lexicon";

export type ChapterAnalysis =
  | {
      state: "ready";
      forms: string[];
      entries: Record<string, LexiconEntry[]>;
      capitalOnly: Set<string>;
      text: string;
    }
  | { state: "error"; error: string }
  // El libro cambió o se canceló mientras corría: el resultado no es
  // confiable y no queda en caché — el próximo intento rehace todo.
  | { state: "stale" }
  | { state: "cancelled" };

export type SerializedChapterAnalysis = {
  version: 1;
  forms: string[];
  entries: Record<string, LexiconEntry[]>;
  capitalOnly: string[];
  text: string;
};

export function serializeChapterAnalysis(analysis: ChapterAnalysis): string | null {
  if (analysis.state !== "ready") return null;
  const payload: SerializedChapterAnalysis = {
    version: 1,
    forms: analysis.forms,
    entries: analysis.entries,
    capitalOnly: Array.from(analysis.capitalOnly),
    text: analysis.text,
  };
  return JSON.stringify(payload);
}

export function deserializeChapterAnalysis(raw: string): ChapterAnalysis | null {
  try {
    const data = JSON.parse(raw) as SerializedChapterAnalysis;
    if (data.version !== 1 || !Array.isArray(data.forms)) return null;
    return {
      state: "ready",
      forms: data.forms,
      entries: data.entries ?? {},
      capitalOnly: new Set(data.capitalOnly ?? []),
      text: data.text ?? "",
    };
  } catch {
    return null;
  }
}

export type AnalyzerDeps = {
  book: EpubBook;
  language: string;
  loadCached?: (targetId: string) => Promise<ChapterAnalysis | null>;
  saveCached?: (targetId: string, analysis: ChapterAnalysis) => Promise<void>;
  // Inyectables para pruebas; en producción usan el pipeline real.
  extractWords?: (text: string, lang: string) => Promise<string[]>;
  lookup?: (forms: string[], lang: string) => Promise<BatchLookupResult>;
  sanitize?: (doc: Document) => HTMLElement;
  // False cuando el libro/cuenta ya no es el mismo: el resultado se
  // descarta como «stale» sin tocar la caché.
  isCurrent?: () => boolean;
  signal?: AbortSignal;
};

export type ChapterAnalyzer = {
  // Analiza el rango completo. `knownSection` evita reextraer el
  // texto cuando el rango es exactamente la sección ya renderizada.
  analyze: (
    range: ChapterRange,
    opts?: { knownSection?: { index: number; text: string } },
  ) => Promise<ChapterAnalysis>;
  // El rango que sigue al que contiene la sección — la «siguiente
  // parte real», no simplemente la sección física siguiente.
  nextRangeAfter: (sectionIndex: number) => ChapterRange | null;
  // Precarga solo el siguiente destino real; jamás mezcla capítulos.
  preloadNext: (sectionIndex: number) => Promise<ChapterAnalysis | null>;
  cached: (targetId: string) => ChapterAnalysis | undefined;
  clear: () => void;
};

export function createChapterAnalyzer(
  catalog: ChapterCatalog,
  deps: AnalyzerDeps,
): ChapterAnalyzer {
  const {
    book,
    language,
    extractWords = extractUniqueWords,
    lookup = batchLookup,
    sanitize = sanitizeSectionDocument,
    isCurrent = () => true,
    signal,
  } = deps;

  const cache = new Map<string, ChapterAnalysis>();
  const inflight = new Map<string, Promise<ChapterAnalysis>>();

  // Texto del rango: solo las secciones que le pertenecen — un
  // capítulo repartido se lee entero y un capítulo dentro de una
  // sección compartida no arrastra el texto de los vecinos.
  const rangeText = async (
    range: ChapterRange,
    knownSection?: { index: number; text: string },
  ): Promise<string> => {
    if (
      knownSection &&
      range.startSection === knownSection.index &&
      range.endSection === knownSection.index + 1
    )
      return knownSection.text;
    const parts: string[] = [];
    for (let index = range.startSection; index < range.endSection; index += 1) {
      const section = book.sections[index];
      if (!section) continue;
      const clean = sanitize(await section.createDocument());
      parts.push(
        [...clean.childNodes].map((node) => node.textContent ?? "").join("\n"),
      );
    }
    return parts.join("\n");
  };

  const run = async (
    range: ChapterRange,
    knownSection?: { index: number; text: string },
  ): Promise<ChapterAnalysis> => {
    if (signal?.aborted) return { state: "cancelled" };
    try {
      const text = await rangeText(range, knownSection);
      if (!isCurrent() || signal?.aborted)
        return { state: signal?.aborted ? "cancelled" : "stale" };
      const words = await extractWords(text, language);
      if (!isCurrent() || signal?.aborted)
        return { state: signal?.aborted ? "cancelled" : "stale" };
      const forms = [...new Set(words.map((word) => word.toLowerCase()))].filter(
        (form) => isWordToken(form) && !isStopword(form, language),
      );
      // Las bases derivadas (raíz «-mente», verbo sin enclíticos) se
      // consultan en el mismo lote: predictSection evalúa la frecuencia
      // del lema real sin una segunda ronda de red. No son formas del
      // análisis — solo claves de consulta del catálogo.
      const lookupForms = new Set(forms);
      for (const form of forms) {
        for (const base of menteBaseForms(form)) lookupForms.add(base);
        for (const base of cliticBaseForms(form)) lookupForms.add(base);
      }
      // Sin formas el análisis está listo sin tocar la red.
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
        capitalOnly: capitalOnlyForms(words),
        text,
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

  const analyze = async (
    range: ChapterRange,
    opts?: { knownSection?: { index: number; text: string } },
  ): Promise<ChapterAnalysis> => {
    const key = range.target.id;
    const cached = cache.get(key);
    if (cached?.state === "ready") return cached;

    // Si hay cargador persistente, consultar antes de computar
    if (deps.loadCached) {
      try {
        const persisted = await deps.loadCached(key);
        if (persisted?.state === "ready") {
          cache.set(key, persisted);
          return persisted;
        }
      } catch {
        // En caso de error de lectura, continúa con la ejecución normal
      }
    }

    let pending = inflight.get(key);
    if (!pending) {
      pending = run(range, opts?.knownSection).then((result) => {
        inflight.delete(key);
        // Solo «ready» se cachea: un error o un resultado obsoleto se
        // reintenta en la próxima solicitud, nunca queda congelado.
        if (result.state === "ready") {
          cache.set(key, result);
          if (deps.saveCached) {
            void deps.saveCached(key, result).catch(() => undefined);
          }
        }
        return result;
      });
      inflight.set(key, pending);
    }
    return pending;
  };

  const rangeContaining = (sectionIndex: number) =>
    catalog.ranges.find(
      (range) =>
        range.startSection <= sectionIndex && sectionIndex < range.endSection,
    ) ?? null;

  const nextRangeAfter = (sectionIndex: number): ChapterRange | null => {
    const current = rangeContaining(sectionIndex);
    if (!current) return null;
    const at = catalog.ranges.indexOf(current);
    return catalog.ranges[at + 1] ?? null;
  };

  const preloadNext = async (
    sectionIndex: number,
  ): Promise<ChapterAnalysis | null> => {
    const next = nextRangeAfter(sectionIndex);
    return next ? analyze(next) : null;
  };

  return {
    analyze,
    nextRangeAfter,
    preloadNext,
    cached: (targetId) => cache.get(targetId),
    clear: () => cache.clear(),
  };
}
