// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildChapterSuggestionRows } from "./preparation-rows";
import { buildSuggestionRows } from "./section-words";
import { loadUserTheta } from "./profile-models";
import { loadNativeLanguage } from "./settings";
import type { LexiconEntry } from "./lexicon";

const entry = (lemma: string, zipf: number | null, pos = "sustantivo"): LexiconEntry => ({
  entryId: `id-${lemma}`,
  lemma,
  pos,
  freqRank: null,
  zipf,
  senses: [],
});

// Análisis mínimo con la forma «ready» que produce createChapterAnalyzer.
const analysis = {
  state: "ready" as const,
  forms: ["abstruso", "casa", "efímero", "gato"],
  entries: {
    abstruso: [entry("abstruso", 2.4)],
    casa: [entry("casa", 6.9)],
    efímero: [entry("efímero", 3.1, "adjetivo")],
  },
  capitalOnly: new Set<string>(),
  text: "Un abstruso gato efímero entró en la casa.",
};

describe("buildChapterSuggestionRows", () => {
  it("produce las mismas filas que la llamada del lector con los mismos datos", () => {
    const ctx = {
      saved: new Map<string, never>(),
      knowledge: new Map<string, { lemma: string; known: boolean }>([
        ["casa", { lemma: "casa", known: true }],
      ]),
      threshold: 2.5,
    };
    const expected = buildSuggestionRows({
      language: "es",
      forms: analysis.forms,
      entries: analysis.entries,
      capitalOnly: analysis.capitalOnly,
      text: analysis.text,
      saved: ctx.saved,
      knowledge: ctx.knowledge,
      threshold: ctx.threshold,
      userTheta: loadUserTheta("es"),
      isSecondLanguage: "es" !== loadNativeLanguage(),
      lex: undefined,
    });
    const actual = buildChapterSuggestionRows(analysis, "es", ctx);
    expect(actual.rows).toEqual(expected.rows);
    expect(actual.uncertain).toEqual(expected.uncertain);
    expect(actual.deferred).toEqual(expected.deferred);
  });

  it("las apariciones en el libro entero suben una palabra en la hoja", () => {
    // Misma rareza y una sola aparición en el capítulo: sin conteo del libro
    // decide el orden alfabético («lóbrego» primero).
    const twin = {
      state: "ready" as const,
      forms: ["lóbrego", "umbrío"],
      entries: { lóbrego: [entry("lóbrego", 2.5, "adjetivo")], umbrío: [entry("umbrío", 2.5, "adjetivo")] },
      capitalOnly: new Set<string>(),
      text: "Un pasillo lóbrego y un patio umbrío.",
    };
    const ctx = { saved: new Map<string, never>(), knowledge: new Map(), threshold: 3.0 };
    expect(buildChapterSuggestionRows(twin, "es", ctx).rows.map((r) => r.form)).toEqual(["lóbrego", "umbrío"]);
    const withBook = { ...ctx, bookFrequencies: new Map([["umbrío", 30], ["lóbrego", 1]]) };
    expect(buildChapterSuggestionRows(twin, "es", withBook).rows.map((r) => r.form)).toEqual(["umbrío", "lóbrego"]);
  });

  it("un umbral distinto cambia la selección (la puerta es el umbral)", () => {
    const ctx = (threshold: number) => ({
      saved: new Map<string, never>(),
      knowledge: new Map<string, { lemma: string; known: boolean }>(),
      threshold,
    });
    const low = buildChapterSuggestionRows(analysis, "es", ctx(2.0));
    const high = buildChapterSuggestionRows(analysis, "es", ctx(4.0));
    const allKeys = (r: { rows: { key: string }[]; deferred: { key: string }[] }) =>
      [...r.rows, ...r.deferred].map((x) => x.key);
    expect(allKeys(low)).not.toEqual(allKeys(high));
  });
});
