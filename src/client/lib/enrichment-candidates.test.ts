import { describe, expect, it } from "vitest";
import { selectEnrichmentCandidates } from "./enrichment-candidates";
import type { LexiconEntry } from "./lexicon";
import type { SectionPrediction } from "./knowledge";

const entry = (over: Partial<LexiconEntry>): LexiconEntry => ({
  entryId: null,
  lemma: "lema",
  pos: null,
  freqRank: null,
  zipf: null,
  senses: [],
  ...over,
});

const prediction = (over: Partial<SectionPrediction>): SectionPrediction => ({
  predicted: [],
  savedCount: 0,
  knownCount: 0,
  missing: [],
  uncertain: [],
  deferred: [],
  total: 0,
  ...over,
});

describe("selectEnrichmentCandidates", () => {
  it("prioriza fichas sin acepciones antes que formas ausentes", () => {
    const result = selectEnrichmentCandidates(
      prediction({
        predicted: [
          { form: "vacia", entry: entry({ entryId: "1", lemma: "vacia" }) },
          { form: "llena", entry: entry({ entryId: "2", lemma: "llena", senses: [{ definition: "sí", example: null, senseOrder: 1 }] }) },
        ],
        missing: ["fantasma"],
      }),
      new Set(),
      new Map(),
      10,
    );
    expect(result).toEqual(["vacia", "fantasma"]);
  });

  it("excluye capital-only y conocimiento explícito conocido", () => {
    const result = selectEnrichmentCandidates(
      prediction({
        predicted: [
          { form: "abajo", entry: entry({ entryId: "3", lemma: "abajar" }) },
          { form: "conocida", entry: entry({ entryId: "4", lemma: "conocida" }) },
        ],
        missing: ["bran", "también"],
      }),
      new Set(["bran"]),
      new Map([
        ["conocida", { lemma: "conocida", known: true }],
        ["también", { lemma: "también", known: true }],
      ]),
      10,
    );
    expect(result).toEqual(["abajo"]);
  });

  it("deduplica por entryId y por forma, conservando el primer orden", () => {
    const shared = entry({ entryId: "7", lemma: "perenne" });
    const result = selectEnrichmentCandidates(
      prediction({
        predicted: [
          { form: "perenne", entry: shared },
          { form: "perenne", entry: shared },
          { form: "perennes", entry: shared },
        ],
        missing: ["perenne"],
      }),
      new Set(),
      new Map(),
      10,
    );
    expect(result).toEqual(["perenne"]);
  });

  it("aplica el tope sin cambiar el orden", () => {
    const result = selectEnrichmentCandidates(
      prediction({
        predicted: [
          { form: "a", entry: entry({ entryId: "1" }) },
          { form: "b", entry: entry({ entryId: "2" }) },
          { form: "c", entry: entry({ entryId: "3" }) },
        ],
      }),
      new Set(),
      new Map(),
      2,
    );
    expect(result).toEqual(["a", "b"]);
  });
});
