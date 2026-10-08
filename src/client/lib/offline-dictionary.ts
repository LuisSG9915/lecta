import { openEpub, getBookLanguage } from "./epub";
import {
  getStoredBook,
  countCachedLexicon,
  clearCachedLexicon,
  getCachedLexiconBatch,
  loadSessionValue,
  type DbScope,
} from "./idb";
import { batchLookup, BATCH_LOOKUP_LIMIT } from "./lexicon";
import { extractUniqueWords } from "./segmenter";
import { normalizeBlockText } from "./reading-location";
import { sanitizeSectionDocument } from "./sanitize";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, menteBaseForms } from "../../shared/word-form";
import { cliticBaseForms } from "./knowledge";
import { bookVocabKey } from "./book-vocab";
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
