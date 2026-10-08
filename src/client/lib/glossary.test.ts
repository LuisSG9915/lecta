import { describe, expect, it } from "vitest";
import {
  extractGlossaryTerms,
  filterAndSortGlossary,
  formatZipfLabel,
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

  it("formatZipfLabel asigna etiquetas humanas precisas", () => {
    expect(formatZipfLabel(null)).toBe("Voz particular de la obra");
    expect(formatZipfLabel(2.1)).toBe("Cultismo muy raro");
    expect(formatZipfLabel(3.2)).toBe("Término literario");
    expect(formatZipfLabel(4.2)).toBe("Poco frecuente");
    expect(formatZipfLabel(5.3)).toBe("Frecuente");
  });
});
