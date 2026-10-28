import { describe, it, expect, beforeEach } from "vitest";
import {
  filterAttentionBudgetWords,
  isBookMicroHighlightsEnabled,
  saveBookMicroHighlightsEnabled,
  MAX_ATTENTION_BUDGET,
} from "./attention-budget";
import {
  getLexiconMemoryCacheSize,
  clearLexiconMemoryCache,
  lookupWordInMemory,
  primeLexiconMemoryCache,
} from "./lexicon";

describe("Attention Budget & Micro-Highlights (Fase 2)", () => {
  beforeEach(() => {
    clearLexiconMemoryCache();
  });

  it("regla anti-saturación: limita a un máximo de 3 palabras por página/viewport", () => {
    const candidates = ["efimero", "inmarcesible", "vislumbrar", "melifluo", "perenne"];
    const occurrences = {
      efimero: 5,
      inmarcesible: 8,
      vislumbrar: 1,
      melifluo: 4,
      perenne: 3,
    };
    const consulted = new Set<string>();

    const result = filterAttentionBudgetWords(candidates, occurrences, consulted, MAX_ATTENTION_BUDGET);

    expect(result.activeHighlights.size).toBe(3);
    // Deben ser las 3 con mayor frecuencia: inmarcesible (8), efimero (5), melifluo (4)
    expect(result.activeHighlights.has("inmarcesible")).toBe(true);
    expect(result.activeHighlights.has("efimero")).toBe(true);
    expect(result.activeHighlights.has("melifluo")).toBe(true);
    expect(result.activeHighlights.has("perenne")).toBe(false);
    expect(result.activeHighlights.has("vislumbrar")).toBe(false);
  });

  it("las palabras previamente consultadas pasan al estilo resuelto y no saturan el presupuesto", () => {
    const candidates = ["inmarcesible", "efimero", "melifluo", "perenne"];
    const occurrences = {
      inmarcesible: 10,
      efimero: 7,
      melifluo: 5,
      perenne: 2,
    };
    // inmarcesible ya fue consultada previamente en el glosario
    const consulted = new Set(["inmarcesible"]);

    const result = filterAttentionBudgetWords(candidates, occurrences, consulted, MAX_ATTENTION_BUDGET);

    // inmarcesible está en resolvedWords
    expect(result.resolvedWords.has("inmarcesible")).toBe(true);
    expect(result.activeHighlights.has("inmarcesible")).toBe(false);

    // El presupuesto de 3 palabras se llena con las no consultadas restantes
    expect(result.activeHighlights.has("efimero")).toBe(true);
    expect(result.activeHighlights.has("melifluo")).toBe(true);
    expect(result.activeHighlights.has("perenne")).toBe(true);
    expect(result.activeHighlights.size).toBe(3);
  });

  it("pre-carga definiciones en memoria para asegurar un tap de 0 ms", async () => {
    expect(getLexiconMemoryCacheSize()).toBe(0);

    primeLexiconMemoryCache({
      efimero: [
        {
          entryId: "1",
          lemma: "efímero",
          pos: "adj",
          freqRank: null,
          zipf: 3.5,
          senses: [{ definition: "Pasajero, de corta duración", example: null, senseOrder: 1 }],
        },
      ],
    });

    const cached = lookupWordInMemory("efimero", "es");
    expect(cached).not.toBeNull();
    expect(cached?.ok).toBe(true);
    if (cached && cached.ok) {
      expect(cached.found).toBe(true);
      expect(cached.lemma).toBe("efímero");
    }
  });

  it("permite activar o desactivar micro-destacados por libro", () => {
    const book = "book-test-123";
    expect(isBookMicroHighlightsEnabled(book)).toBe(true);

    saveBookMicroHighlightsEnabled(book, false);
    expect(isBookMicroHighlightsEnabled(book)).toBe(false);

    saveBookMicroHighlightsEnabled(book, true);
    expect(isBookMicroHighlightsEnabled(book)).toBe(true);
  });
});
