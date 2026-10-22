import { openEpub, getBookLanguage } from "./epub";
import {
  getStoredBook,
  countCachedLexicon,
  clearCachedLexicon,
  getCachedLexiconBatch,
  loadSessionValue,
  saveCachedLexiconBatch,
  type DbScope,
} from "./idb";
import { batchLookup, BATCH_LOOKUP_LIMIT, type LexiconEntry } from "./lexicon";
import { extractUniqueWords } from "./segmenter";
import { normalizeBlockText } from "./reading-location";
import { sanitizeSectionDocument } from "./sanitize";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, menteBaseForms } from "../../shared/word-form";
import { cliticBaseForms } from "./knowledge";
import type { BookVocabManifest } from "./catalog";

export interface PrecacheProgress {
  done: number;
  total: number;
  percent: number;
}

export interface PrecacheResult {
  total: number;
  cached: number;
  error?: string;
}

/**
 * Extrae y descarga todas las definiciones del léxico de un libro almacenado
 * en el dispositivo, guardándolas en la memoria local de IndexedDB para que
 * el lector pueda consultar cualquier palabra sin conexión a internet.
 */
export async function precacheBookDictionary(
  hash: string,
  onProgress?: (progress: PrecacheProgress) => void,
  scope?: DbScope,
): Promise<PrecacheResult> {
  const stored = await getStoredBook(hash, scope).catch(() => undefined);
  if (!stored) {
    return { total: 0, cached: 0, error: "El libro no está guardado en el dispositivo." };
  }

  let epub;
  try {
    epub = await openEpub(stored.data);
  } catch {
    return { total: 0, cached: 0, error: "No se pudo abrir el archivo del libro." };
  }

  const { book, close } = epub;
  const language = getBookLanguage(book) || stored.language || "es";
  const parts: string[] = [];

  try {
    for (const section of book.sections) {
      try {
        const clean = sanitizeSectionDocument(await section.createDocument());
        const text = normalizeBlockText(
          [...clean.childNodes].map((node) => node.textContent ?? "").join(" "),
        );
        if (text) parts.push(text);
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await Promise.resolve(close()).catch(() => undefined);
  }

  if (!parts.length) {
    return { total: 0, cached: 0, error: "El libro no contiene texto legible." };
  }

  const words = await extractUniqueWords(parts.join("\n"), language).catch(() => []);
  const forms = [...new Set(words.map((w) => w.toLowerCase()))].filter(
    (form) => isWordToken(form) && !isStopword(form, language),
  );

  const lookupForms = new Set(forms);
  for (const form of forms) {
    for (const base of menteBaseForms(form)) lookupForms.add(base);
    for (const base of cliticBaseForms(form)) lookupForms.add(base);
  }

  const allForms = [...lookupForms];
  const total = allForms.length;
  if (!total) {
    return { total: 0, cached: 0 };
  }

  let cachedCount = 0;
  for (let i = 0; i < allForms.length; i += BATCH_LOOKUP_LIMIT) {
    const chunk = allForms.slice(i, i + BATCH_LOOKUP_LIMIT);
    const result = await batchLookup(chunk, language, scope);
    if (result.ok) {
      cachedCount += Object.keys(result.entries).length;
    }
    const done = Math.min(i + chunk.length, total);
    const percent = Math.round((done / total) * 100);
    onProgress?.({ done, total, percent });
  }

  return { total, cached: cachedCount };
}

/**
 * Consulta el estado de precacheado del diccionario para un libro:
 * devuelve cuántas palabras únicas tiene y cuántas ya residen en la memoria local.
 */
export async function getBookDictionaryStatus(
  hash: string,
  language = "es",
  scope?: DbScope,
): Promise<{ total: number; cached: number; percent: number }> {
  const { bookVocabKey } = await import("./book-vocab");
  const cachedJson = await loadSessionValue(bookVocabKey(hash), scope).catch(() => null);
  if (!cachedJson) {
    return { total: 0, cached: 0, percent: 0 };
  }
  try {
    const manifest = JSON.parse(cachedJson) as BookVocabManifest;
    const forms = manifest.forms ?? [];
    if (!forms.length) return { total: 0, cached: 0, percent: 0 };

    const cachedMap = await getCachedLexiconBatch(language, forms, scope);
    const cached = Object.keys(cachedMap).length;
    const total = forms.length;
    const percent = Math.min(100, Math.round((cached / total) * 100));
    return { total, cached, percent };
  } catch {
    return { total: 0, cached: 0, percent: 0 };
  }
}

/**
 * Devuelve la cantidad total de palabras cacheadas en la memoria local del dispositivo.
 */
export async function getDictionaryCacheWordCount(scope?: DbScope): Promise<number> {
  return countCachedLexicon(undefined, scope);
}

/**
 * Elimina toda la memoria local del diccionario de la base activa.
 */
export async function emptyDictionaryCache(scope?: DbScope): Promise<void> {
  return clearCachedLexicon(scope);
}

// ---------------------------------------------------------------------------
// Pre-caché predictivo offline de capítulos futuros (Track 11 — Fase 3)
// ---------------------------------------------------------------------------

export const AUTO_PRECACHE_STORAGE_KEY = "lecta:auto_precache_enabled:v1";

let memoryAutoPrecache: boolean | null = null;

export function isAutoPrecacheEnabled(): boolean {
  if (memoryAutoPrecache !== null) return memoryAutoPrecache;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const val = window.localStorage.getItem(AUTO_PRECACHE_STORAGE_KEY);
      return val === null ? true : val === "true";
    } catch {
      return true;
    }
  }
  return true;
}

export function setAutoPrecacheEnabled(enabled: boolean): void {
  memoryAutoPrecache = enabled;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(AUTO_PRECACHE_STORAGE_KEY, String(enabled));
    } catch {
      // Ignorar fallo de almacenamiento
    }
  }
}

/**
 * Planifica los índices de capítulos a pre-cargar según el capítulo actual del lector
 * y la ventana deslizante (lookahead = 2 por defecto).
 */
export function planPredictiveChapterPrecache(
  currentChapterIndex: number,
  totalChapters: number,
  lookahead = 2,
): number[] {
  if (totalChapters <= 0 || lookahead <= 0 || currentChapterIndex < 0) return [];
  const planned: number[] = [];
  const max = Math.min(totalChapters, currentChapterIndex + 1 + lookahead);
  for (let i = currentChapterIndex + 1; i < max; i++) {
    planned.push(i);
  }
  return planned;
}

export interface PredictivePrecacheResult {
  success: boolean;
  upcomingChapters: number[];
  precachedWords: number;
  totalWords: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Inspecciona silenciosamente en segundo plano los próximos capítulos (c+1 y c+2)
 * cuando hay conexión, resolviendo primero contra el diccionario local (english-core-lexicon)
 * y pre-descargando únicamente los términos no cubiertos.
 */
export async function prefetchUpcomingChaptersLexicon(
  bookHash: string,
  currentChapterIndex: number,
  options?: {
    lookahead?: number;
    language?: string;
    scope?: DbScope;
    forceOnlineCheck?: boolean;
  },
): Promise<PredictivePrecacheResult> {
  if (!isAutoPrecacheEnabled()) {
    return {
      success: false,
      skipped: true,
      reason: "disabled_by_user",
      upcomingChapters: [],
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const isOnline =
    options?.forceOnlineCheck === false ||
    typeof navigator === "undefined" ||
    !("onLine" in navigator) ||
    navigator.onLine === true;

  if (!isOnline) {
    return {
      success: false,
      skipped: true,
      reason: "offline",
      upcomingChapters: [],
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const stored = await getStoredBook(bookHash, options?.scope).catch(() => undefined);
  if (!stored) {
    return {
      success: false,
      skipped: true,
      reason: "book_not_found",
      upcomingChapters: [],
      precachedWords: 0,
      totalWords: 0,
    };
  }

  let epub;
  try {
    epub = await openEpub(stored.data);
  } catch {
    return {
      success: false,
      skipped: true,
      reason: "open_failed",
      upcomingChapters: [],
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const { book, close } = epub;
  const language = options?.language || getBookLanguage(book) || stored.language || "es";
  const lookahead = options?.lookahead ?? 2;
  const plannedChapters = planPredictiveChapterPrecache(
    currentChapterIndex,
    book.sections.length,
    lookahead,
  );

  if (plannedChapters.length === 0) {
    await Promise.resolve(close()).catch(() => undefined);
    return {
      success: true,
      skipped: true,
      reason: "no_upcoming_chapters",
      upcomingChapters: [],
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const chapterTexts: string[] = [];
  try {
    for (const chIdx of plannedChapters) {
      const section = book.sections[chIdx];
      if (!section) continue;
      try {
        const clean = sanitizeSectionDocument(await section.createDocument());
        const text = normalizeBlockText(
          [...clean.childNodes].map((node) => node.textContent ?? "").join(" "),
        );
        if (text) chapterTexts.push(text);
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await Promise.resolve(close()).catch(() => undefined);
  }

  if (chapterTexts.length === 0) {
    return {
      success: true,
      upcomingChapters: plannedChapters,
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const words = await extractUniqueWords(chapterTexts.join("\n"), language).catch(() => []);
  const forms = [...new Set(words.map((w) => w.toLowerCase()))].filter(
    (form) => isWordToken(form) && !isStopword(form, language),
  );

  const lookupForms = new Set(forms);
  for (const form of forms) {
    for (const base of menteBaseForms(form)) lookupForms.add(base);
    for (const base of cliticBaseForms(form)) lookupForms.add(base);
  }

  const allForms = [...lookupForms];
  if (!allForms.length) {
    return {
      success: true,
      upcomingChapters: plannedChapters,
      precachedWords: 0,
      totalWords: 0,
    };
  }

  const batchToSave: Record<string, LexiconEntry[]> = {};
  const missingFromLocalCore: string[] = [];

  if (language === "en") {
    const { getEnglishCoreEntry } = await import("../../shared/english-core-lexicon");
    for (const form of allForms) {
      const coreEntry = getEnglishCoreEntry(form);
      if (coreEntry) {
        batchToSave[form] = [coreEntry];
      } else {
        missingFromLocalCore.push(form);
      }
    }
    if (Object.keys(batchToSave).length > 0) {
      await saveCachedLexiconBatch("en", batchToSave, options?.scope).catch(() => undefined);
    }
  } else {
    missingFromLocalCore.push(...allForms);
  }

  const resolvedLocally = Object.keys(batchToSave).length;
  const alreadyCached: Record<string, LexiconEntry[]> = await getCachedLexiconBatch(
    language,
    missingFromLocalCore,
    options?.scope,
  ).catch(() => ({}));
  const wordsToFetch = missingFromLocalCore.filter((f) => !alreadyCached[f]);

  let newlyCached = 0;
  if (wordsToFetch.length > 0) {
    for (let i = 0; i < wordsToFetch.length; i += BATCH_LOOKUP_LIMIT) {
      const chunk = wordsToFetch.slice(i, i + BATCH_LOOKUP_LIMIT);
      const result = await batchLookup(chunk, language, options?.scope);
      if (result.ok) {
        newlyCached += Object.keys(result.entries).length;
      }
    }
  }

  return {
    success: true,
    upcomingChapters: plannedChapters,
    precachedWords: resolvedLocally + newlyCached + Object.keys(alreadyCached).length,
    totalWords: allForms.length,
  };
}
