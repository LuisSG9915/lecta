import {
  loadSessionValue,
  saveSessionValue,
  StaleScopeError,
  type DbScope,
} from "./idb";

// Clave de sesión para almacenar el historial de palabras consultadas por obra
export const bookConsultedWordsKey = (bookHash: string) => `bookGlossary:consulted:v1:${bookHash}`;

// Caché en memoria para comprobaciones síncronas instantáneas (0 ms)
const consultedMemoryCache = new Map<string, Set<string>>();

/**
 * Normaliza una palabra para el glosario del libro (minúsculas y sin espacios).
 */
export function normalizeGlossaryWord(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * Consulta en memoria si una palabra ya fue consultada en este libro.
 */
export function isWordConsultedInBook(bookHash: string, word: string): boolean {
  if (!bookHash || !word) return false;
  const set = consultedMemoryCache.get(bookHash);
  return Boolean(set?.has(normalizeGlossaryWord(word)));
}

/**
 * Pre-carga en memoria las palabras consultadas de un libro.
 */
export function primeBookConsultedWords(
  bookHash: string,
  words: string[] | Set<string>,
): void {
  if (!bookHash) return;
  const set = consultedMemoryCache.get(bookHash) ?? new Set<string>();
  for (const w of words) {
    set.add(normalizeGlossaryWord(w));
  }
  consultedMemoryCache.set(bookHash, set);
}

/**
 * Obtiene el conjunto de palabras consultadas para un libro desde IndexedDB.
 */
export async function getBookConsultedWords(
  bookHash: string,
  scope?: DbScope,
): Promise<Set<string>> {
  if (!bookHash) return new Set();
  const cached = consultedMemoryCache.get(bookHash);
  if (cached && cached.size > 0) {
    return new Set(cached);
  }

  const raw = await loadSessionValue(bookConsultedWordsKey(bookHash), scope).catch(() => null);
  const result = new Set<string>();
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const w of arr) {
          if (typeof w === "string" && w) result.add(normalizeGlossaryWord(w));
        }
      }
    } catch {
      // Ignorar json corrupto
    }
  }

  consultedMemoryCache.set(bookHash, result);
  return result;
}

/**
 * Registra una palabra como consultada para un libro en memoria y persistencia IndexedDB.
 */
export async function recordBookConsultedWord(
  bookHash: string,
  word: string,
  scope?: DbScope,
): Promise<void> {
  if (!bookHash || !word) return;
  const norm = normalizeGlossaryWord(word);
  if (!norm) return;

  let set = consultedMemoryCache.get(bookHash);
  if (!set) {
    set = await getBookConsultedWords(bookHash, scope);
  }
  if (set.has(norm)) return;

  set.add(norm);
  consultedMemoryCache.set(bookHash, set);

  const payload = JSON.stringify([...set]);
  void saveSessionValue(bookConsultedWordsKey(bookHash), payload, scope).catch((err) => {
    if (err instanceof StaleScopeError) return;
  });
}
