import { describe, expect, it } from "vitest";
import {
  extractGlossaryTerms,
  filterAndSortGlossary,
  formatZipfLabel,
  getAvailableLetters,
  getInitialLetter,
  normalizePosCategory,
} from "./glossary";
import type { BookVocabManifest } from "./catalog";

describe("glossary", () => {
  const manifest: BookVocabManifest = {
    v: 1,
    wordCount: 1500,
    uniqueForms: 4,
    forms: ["inmarcesible", "casa", "diáfana", "ignoto"],
    entries: [
      { id: "1", lemma: "inmarcesible", pos: "adj.", zipf: 2.1 },
      { id: "2", lemma: "casa", pos: "sust.", zipf: 5.2 },
      { id: "3", lemma: "diáfano", pos: "adj.", zipf: 3.4 },
    ],
    byForm: {
      inmarcesible: [0],
      casa: [1],
      diáfana: [2],
    },
    missing: ["ignoto"],
  };

  it("extractGlossaryTerms extrae términos con cultismos y estados", () => {
    const saved = new Set(["inmarcesible"]);
    const known = new Set(["casa"]);

    const terms = extractGlossaryTerms(manifest, saved, known);
    expect(terms).toHaveLength(4);

    const inmarcesible = terms.find((t) => t.form === "inmarcesible");
    expect(inmarcesible).toBeDefined();
    expect(inmarcesible?.isCultism).toBe(true);
    expect(inmarcesible?.isSaved).toBe(true);
    expect(inmarcesible?.isKnown).toBe(false);

    const casa = terms.find((t) => t.form === "casa");
    expect(casa?.isCultism).toBe(false);
    expect(casa?.isKnown).toBe(true);

    const ignoto = terms.find((t) => t.form === "ignoto");
    expect(ignoto?.zipf).toBeNull();
    expect(ignoto?.isCultism).toBe(true);
  });

  it("filterAndSortGlossary filtra por búsqueda y categoría", () => {
    const terms = extractGlossaryTerms(manifest);

    // Búsqueda
    const search = filterAndSortGlossary(terms, "diáf", "all", "alpha");
    expect(search).toHaveLength(1);
    expect(search[0].form).toBe("diáfana");

    // Filtro de cultismos
    const cultisms = filterAndSortGlossary(terms, "", "cultisms", "alpha");
    const forms = cultisms.map((t) => t.form);
    expect(forms).toContain("inmarcesible");
    expect(forms).toContain("diáfana");
    expect(forms).toContain("ignoto");
    expect(forms).not.toContain("casa");

    // Orden por rareza (menor zipf primero)
    const sortedRarity = filterAndSortGlossary(terms, "", "all", "rarity");
    // ignoto tiene zipf 0 en sort fallback
    expect(sortedRarity[0].form).toBe("ignoto");
    expect(sortedRarity[1].form).toBe("inmarcesible");
    expect(sortedRarity[2].form).toBe("diáfana");
    expect(sortedRarity[3].form).toBe("casa");
  });

  it("filterAndSortGlossary soporta letra inicial y categoría gramatical", () => {
    const terms = extractGlossaryTerms(manifest);

    // Filtro por letra 'I'
    const byLetter = filterAndSortGlossary(terms, "", "all", "alpha", "I");
    expect(byLetter.map((t) => t.form)).toEqual(["ignoto", "inmarcesible"]);

    // Filtro por letra 'D' (diáfana)
    const byD = filterAndSortGlossary(terms, "", "all", "alpha", "D");
    expect(byD.map((t) => t.form)).toEqual(["diáfana"]);

    // Filtro por POS 'sustantivo'
    const sust = filterAndSortGlossary(terms, "", "all", "alpha", null, "sustantivo");
    expect(sust.map((t) => t.form)).toEqual(["casa"]);

    // Filtro por POS 'adjetivo'
    const adj = filterAndSortGlossary(terms, "", "all", "alpha", null, "adjetivo");
    expect(adj.map((t) => t.form)).toEqual(["diáfana", "inmarcesible"]);

    // Orden alpha-desc (Z a A)
    const desc = filterAndSortGlossary(terms, "", "all", "alpha-desc");
    expect(desc[0].form).toBe("inmarcesible");
    expect(desc[desc.length - 1].form).toBe("casa");

    // Orden frequency (mayor zipf primero)
    const freq = filterAndSortGlossary(terms, "", "all", "frequency");
    expect(freq[0].form).toBe("casa");
  });

  it("getInitialLetter normaliza tildes y respeta Ñ", () => {
    expect(getInitialLetter("Árbol")).toBe("A");
    expect(getInitialLetter("éxito")).toBe("E");
    expect(getInitialLetter("Índice")).toBe("I");
    expect(getInitialLetter("Ópera")).toBe("O");
    expect(getInitialLetter("último")).toBe("U");
    expect(getInitialLetter("Ñandú")).toBe("Ñ");
    expect(getInitialLetter("ñame")).toBe("Ñ");
    expect(getInitialLetter("casa")).toBe("C");
    expect(getInitialLetter("123")).toBe("#");
    expect(getInitialLetter("")).toBe("");
  });

  it("normalizePosCategory clasifica categorías", () => {
    expect(normalizePosCategory("sust.")).toBe("sustantivo");
    expect(normalizePosCategory("sustantivo")).toBe("sustantivo");
    expect(normalizePosCategory("nombre propio")).toBe("sustantivo");
    expect(normalizePosCategory("adj.")).toBe("adjetivo");
    expect(normalizePosCategory("verbo")).toBe("verbo");
    expect(normalizePosCategory("v.")).toBe("verbo");
    expect(normalizePosCategory("adv.")).toBe("adverbio");
    expect(normalizePosCategory(null)).toBeNull();
  });

  it("getAvailableLetters extrae letras únicas presentes", () => {
    const terms = extractGlossaryTerms(manifest);
    const letters = getAvailableLetters(terms);
    expect(letters.has("I")).toBe(true);
    expect(letters.has("C")).toBe(true);
    expect(letters.has("D")).toBe(true);
    expect(letters.has("Z")).toBe(false);
  });

  it("formatZipfLabel asigna etiquetas humanas precisas", () => {
    expect(formatZipfLabel(null)).toBe("Voz particular de la obra");
    expect(formatZipfLabel(2.1)).toBe("Cultismo muy raro");
    expect(formatZipfLabel(3.2)).toBe("Término literario");
    expect(formatZipfLabel(4.2)).toBe("Poco frecuente");
    expect(formatZipfLabel(5.3)).toBe("Frecuente");
  });
});
