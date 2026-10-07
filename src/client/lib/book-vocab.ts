import { getBookLanguage, openEpub } from "./epub";
import {
  getStoredBook,
  loadSessionValue,
  saveSessionValue,
  StaleScopeError,
  type DbScope,
} from "./idb";
import { cliticBaseForms, dedupeKey } from "./knowledge";
import { batchLookup, type LexiconEntry } from "./lexicon";
import { extractUniqueWords } from "./segmenter";
import { normalizeBlockText } from "./reading-location";
import { sanitizeSectionDocument } from "./sanitize";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, menteBaseForms } from "../../shared/word-form";
import type { BookVocabManifest } from "./catalog";

// Análisis de vocabulario de un libro propio: produce el mismo
// manifiesto que el seed publica para el catálogo (catalog.ts), así
// la insignia de cobertura lee una sola forma de dato — mismo
// clasificador, misma lectura. El resultado queda en session con
// `bookVocab:v1:{hash}`: es una clave por libro registrada en
// isBookScopedSessionKey (muere con el libro) y BACKUP_SESSION_PREFIXES
// (viaja en el respaldo).
//
// Requiere red para el batchLookup del catálogo: si el análisis no se
// completa no se guarda nada y el próximo intento rehace todo — un
// manifiesto a medias pintaría una cobertura falsa.

export const bookVocabKey = (hash: string) => `bookVocab:v1:${hash}`;

// Deduplica las fichas del catálogo por la misma llave que usa
// predictSection (entryId, o lema+pos sin id) y arma byForm con los
// índices — el formato slim del manifiesto del catálogo.
export function buildBookVocabManifest(
  forms: string[],
  entriesByForm: Record<string, LexiconEntry[]>,
  wordCount: number,
): BookVocabManifest {
  const entries: BookVocabManifest["entries"] = [];
  const indexOf = new Map<string, number>();
  const byForm: Record<string, number[]> = {};
  const missing: string[] = [];

  const idxOf = (entry: LexiconEntry) => {
    const key = dedupeKey(entry);
    const known = indexOf.get(key);
    if (known != null) return known;
    indexOf.set(key, entries.length);
    entries.push({
      id: entry.entryId ?? null,
      lemma: entry.lemma,
      pos: entry.pos ?? null,
      zipf: entry.zipf ?? null,
    });
    return entries.length - 1;
  };

  for (const form of forms) {
    const idxs = (entriesByForm[form] ?? []).map(idxOf);
    if (idxs.length) {
      byForm[form] = idxs;
      continue;
    }
    // Sin ficha propia: la forma solo cuenta como «cubierta» si una
    // base clítica verificada la rescata (predictSection hace lo mismo).
    const base = cliticBaseForms(form).find(
      (candidate) => (entriesByForm[candidate] ?? []).length > 0,
    );
    if (!base) missing.push(form);
  }
  // Las bases consultadas también van como llaves: predictSection las
  // resuelve en caliente y sin ellas no puede evaluar la raíz.
  for (const [form, list] of Object.entries(entriesByForm)) {
    if (byForm[form] || !list.length) continue;
    byForm[form] = list.map(idxOf);
  }

  return {
    v: 1,
    wordCount,
    uniqueForms: forms.length,
    forms,
    entries,
    byForm,
    missing,
  };
}

// Manifiesto ya guardado para el libro, o null si aún no se analizó.
export async function loadBookVocab(
  hash: string,
  scope?: DbScope,
): Promise<BookVocabManifest | null> {
  const cached = await loadSessionValue(bookVocabKey(hash), scope).catch(
    () => null,
  );
  if (cached == null) return null;
  try {
    const parsed = JSON.parse(cached) as BookVocabManifest;
    return parsed?.v === 1 && Array.isArray(parsed.forms) ? parsed : null;
  } catch {
    return null;
  }
}

// Analiza el EPUB guardado de punta a punta: texto por sección con el
// mismo saneamiento del lector, formas únicas con las mismas barreras
// (token de palabra, no stopword, minúsculas) y las bases derivadas en
// el mismo lote de consulta. Null si el libro no está, no parsea o la
// red no responde — el llamador reintenta más tarde.
export async function analyzeStoredBook(
  hash: string,
  scope?: DbScope,
  deps: {
    open?: typeof openEpub;
    lookup?: typeof batchLookup;
    extractWords?: typeof extractUniqueWords;
  } = {},
): Promise<BookVocabManifest | null> {
  const {
    open = openEpub,
    lookup = batchLookup,
    extractWords = extractUniqueWords,
  } = deps;

  const stored = await getStoredBook(hash, scope).catch(() => undefined);
  if (!stored) return null;

  let epub;
  try {
    epub = await open(stored.data);
  } catch {
    return null;
  }
  const { book, close } = epub;
  const language = getBookLanguage(book) || stored.language || "es";

  const parts: string[] = [];
  let wordCount = 0;
  try {
    for (const section of book.sections) {
      try {
        const clean = sanitizeSectionDocument(await section.createDocument());
        const text = normalizeBlockText(
          [...clean.childNodes].map((node) => node.textContent ?? "").join(" "),
        );
        if (!text) continue;
        parts.push(text);
        wordCount += text.split(/\s+/).length;
      } catch {
        continue; // una sección ilegible no frena el análisis
      }
      // Ceder el hilo entre secciones: el análisis nunca compite con la lectura.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    // El loader del zip queda abierto: se cierra analice o no.
    await Promise.resolve(close()).catch(() => undefined);
  }
  if (!parts.length) return null;

  const words = await extractWords(parts.join("\n"), language);
  const forms = [...new Set(words.map((word) => word.toLowerCase()))].filter(
    (form) => isWordToken(form) && !isStopword(form, language),
  );
  const lookupForms = new Set(forms);
  for (const form of forms) {
    for (const base of menteBaseForms(form)) lookupForms.add(base);
    for (const base of cliticBaseForms(form)) lookupForms.add(base);
  }
  const result = lookupForms.size
    ? await lookup([...lookupForms], language, scope)
    : ({ ok: true as const, entries: {} });
  if (!result.ok) return null;

  const manifest = buildBookVocabManifest(forms, result.entries, wordCount);
  void saveSessionValue(
    bookVocabKey(hash),
    JSON.stringify(manifest),
    scope,
  ).catch((error) => {
    if (error instanceof StaleScopeError) return;
  });
  return manifest;
}
