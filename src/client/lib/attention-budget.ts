import type { DbScope } from "./idb";
import { lookupWord, primeLexiconMemoryCache, type LexiconEntry } from "./lexicon";
import { normalizeGlossaryWord, isWordConsultedInBook } from "./book-glossary";
import { markWords } from "./marks";
import type { MarkLevel } from "./word-level";

export const MAX_ATTENTION_BUDGET = 3;

export interface AttentionBudgetResult {
  /** Palabras activas con subrayado sutil punteado (máximo 3 por página/viewport) */
  activeHighlights: Set<string>;
  /** Palabras previamente consultadas en la obra (estilo resuelto sutil, sin saturación) */
  resolvedWords: Set<string>;
}

/**
 * Aplica la regla anti-saturación de atención:
 * 1. Separa las palabras que ya fueron consultadas (resueltas).
 * 2. Ordena las candidatas restantes por frecuencia en el capítulo (priorizando mayor frecuencia).
 * 3. Selecciona un máximo estricto de 3 palabras para destacar con punteado sutil en el viewport actual.
 */
export function filterAttentionBudgetWords(
  candidates: string[],
  chapterOccurrences: Record<string, number> = {},
  consultedForms = new Set<string>(),
  maxBudget = MAX_ATTENTION_BUDGET,
): AttentionBudgetResult {
  const activeHighlights = new Set<string>();
  const resolvedWords = new Set<string>();

  const uniqueCandidates = [...new Set(candidates.map((w) => normalizeGlossaryWord(w)).filter(Boolean))];

  const pending: string[] = [];

  for (const form of uniqueCandidates) {
    if (consultedForms.has(form)) {
      resolvedWords.add(form);
    } else {
      pending.push(form);
    }
  }

  // Ordenar por frecuencia descendente en el capítulo actual
  pending.sort((a, b) => {
    const freqA = chapterOccurrences[a] ?? chapterOccurrences[a.toLowerCase()] ?? 1;
    const freqB = chapterOccurrences[b] ?? chapterOccurrences[b.toLowerCase()] ?? 1;
    if (freqB !== freqA) return freqB - freqA;
    return a.localeCompare(b);
  });

  for (let i = 0; i < Math.min(pending.length, maxBudget); i++) {
    activeHighlights.add(pending[i]);
  }

  return {
    activeHighlights,
    resolvedWords,
  };
}

/**
 * Pre-carga en caché de memoria las definiciones de las palabras del presupuesto de atención.
 * Garantiza un tap de 0 ms en el lector sin requerir llamadas de red al tocarlas.
 */
export async function preloadAttentionBudgetWords(
  words: string[] | Set<string>,
  language = "es",
  scope?: DbScope,
): Promise<void> {
  const list = [...words].map((w) => normalizeGlossaryWord(w)).filter(Boolean);
  if (!list.length) return;

  const entriesMap = new Map<string, LexiconEntry[]>();
  await Promise.all(
    list.map(async (word) => {
      try {
        const res = await lookupWord(word, language, scope);
        if (res.ok && res.found && res.entries && res.entries.length > 0) {
          entriesMap.set(word, res.entries);
        }
      } catch {
        // Ignorar fallos de pre-carga individual
      }
    }),
  );

  if (entriesMap.size > 0) {
    primeLexiconMemoryCache(entriesMap);
  }
}

// Configuración de micro-destacados activados por libro
const bookMicroHighlightsMemory = new Map<string, boolean>();

export function isBookMicroHighlightsEnabled(bookHash: string): boolean {
  if (!bookHash) return true; // Por defecto activo para enriquecer lectura
  return bookMicroHighlightsMemory.get(bookHash) ?? true;
}

export function saveBookMicroHighlightsEnabled(bookHash: string, enabled: boolean): void {
  if (!bookHash) return;
  bookMicroHighlightsMemory.set(bookHash, enabled);
  try {
    sessionStorage.setItem(`lecta:micro_highlights:${bookHash}`, enabled ? "1" : "0");
  } catch {
    // ignore storage error
  }
}

/**
 * Calcula el presupuesto de atención a partir de las formas predichas y el texto del capítulo.
 */
export function computeAttentionBudget(
  candidateForms: string[],
  textContext: string,
  bookHash: string,
): AttentionBudgetResult {
  if (!isBookMicroHighlightsEnabled(bookHash)) {
    return { activeHighlights: new Set(), resolvedWords: new Set() };
  }

  const occurrences: Record<string, number> = {};
  const lowerText = textContext.toLowerCase();
  for (const form of candidateForms) {
    const f = form.toLowerCase();
    if (!occurrences[f]) {
      let count = 0;
      let pos = 0;
      while ((pos = lowerText.indexOf(f, pos)) !== -1) {
        const before = pos === 0 || !/[a-záéíóúüñ]/i.test(lowerText[pos - 1]);
        const after = pos + f.length >= lowerText.length || !/[a-záéíóúüñ]/i.test(lowerText[pos + f.length]);
        if (before && after) count++;
        pos += f.length;
      }
      occurrences[f] = Math.max(1, count);
    }
  }

  const consulted = new Set<string>();
  for (const form of candidateForms) {
    if (isWordConsultedInBook(bookHash, form)) {
      consulted.add(normalizeGlossaryWord(form));
    }
  }

  return filterAttentionBudgetWords(candidateForms, occurrences, consulted, MAX_ATTENTION_BUDGET);
}

/**
 * Aplica el presupuesto de atención al contenedor y pre-carga definiciones en memoria.
 */
export function applyAttentionBudget(
  root: HTMLElement | DocumentFragment,
  saved: Set<string> | Map<string, MarkLevel>,
  candidateForms: string[],
  textContext: string,
  bookHash: string,
  language = "es",
  scope?: DbScope,
): AttentionBudgetResult {
  const budget = computeAttentionBudget(candidateForms, textContext, bookHash);
  markWords(root, saved, budget.activeHighlights, language, budget.resolvedWords);
  if (budget.activeHighlights.size > 0) {
    void preloadAttentionBudgetWords(budget.activeHighlights, language, scope);
  }
  return budget;
}
