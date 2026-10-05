import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./lexicon";
import {
  buildSuggestionRows,
  capitalOnlyForms,
  firstSentenceWith,
  preparationLearning,
  toKnowledgeMap,
} from "./section-words";

describe("capitalOnlyForms", () => {
  it("queda una forma siempre capitalizada y nunca en minúscula", () => {
    const set = capitalOnlyForms(["Atilano", "perenne", "Perenne", "casa"]);
    expect(set.has("atilano")).toBe(true);
    // Apareció también en minúscula: palabra normal, no nombre propio.
    expect(set.has("perenne")).toBe(false);
    expect(set.has("casa")).toBe(false);
  });

  it("devuelve las formas en minúsculas y las siglas cuentan", () => {
    const set = capitalOnlyForms(["EEUU", "México"]);
    expect(set.has("eeuu")).toBe(true);
    expect(set.has("méxico")).toBe(true);
  });

  it("los caracteres sin caja (dígitos) no cuentan como capitalizados", () => {
    expect(capitalOnlyForms(["1848"]).size).toBe(0);
  });
});

describe("toKnowledgeMap", () => {
  it("indexa por lema en minúsculas conservando la evidencia", () => {
    const map = toKnowledgeMap([
      { lemma: "Perenne", known: false },
      { lemma: "casa", known: true },
    ]);
    expect(map.get("perenne")).toEqual({ lemma: "perenne", known: false });
    expect(map.get("casa")).toEqual({ lemma: "casa", known: true });
  });
});

describe("preparationLearning", () => {
  it("nueva y aprendiendo entran al grupo", () => {
    expect(preparationLearning("new", undefined)).toBe(true);
    expect(preparationLearning("learning", undefined)).toBe(true);
  });

  it("asentada queda fuera: la tarjeta ya casi está", () => {
    expect(preparationLearning("settled", undefined)).toBe(false);
  });

  it("sin nivel (dominada o no guardada) no aplica al grupo", () => {
    expect(preparationLearning(null, undefined)).toBe(false);
    expect(preparationLearning(undefined, undefined)).toBe(false);
  });

  it("un «ya la conozco» explícito excluye aunque el nivel diga aprender", () => {
    expect(preparationLearning("new", { known: true })).toBe(false);
    expect(preparationLearning("learning", { known: true })).toBe(false);
  });

  it("un «no la conozco» explícito conserva a la aprendiendo", () => {
    expect(preparationLearning("learning", { known: false })).toBe(true);
  });
});

describe("buildSuggestionRows", () => {
  const entry = (
    zipf: number | null,
    over: Partial<LexiconEntry> = {},
  ): LexiconEntry => ({
    entryId: null,
    lemma: "lema",
    pos: "sustantivo",
    freqRank: null,
    zipf,
    senses: [{ definition: "def", example: null, senseOrder: 1 }],
    ...over,
  });

  const baseInput = {
    language: "es",
    text: "La palabra aparece aquí.",
    capitalOnly: new Set<string>(),
    saved: new Map<string, "new">(),
    knowledge: new Map<string, { lemma: string; known: boolean }>(),
    threshold: 3.0,
  };

  it("un «no la conozco» explícito manda sobre la frecuencia (meollo)", () => {
    // Regresión del prólogo: meollo (zipf 3.03) queda por encima del
    // umbral 3.0 y no habría entrado por rareza, pero la respuesta
    // explícita del lector la trae a la selección principal.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["meollo"],
      entries: { meollo: [entry(3.03, { lemma: "meollo" })] },
      knowledge: new Map([["meollo", { lemma: "meollo", known: false }]]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["meollo"]);
    expect(result.rows[0].reason).toBe("explicit_unknown");
    expect(result.uncertain).toHaveLength(0);
  });

  it("las seis guardadas del prólogo se sugieren por evidencia o rareza", () => {
    // turrón, meollo, alevosía, okupa, desternillantes y cogollo: la
    // sesión real las marcó desconocidas; todas deben entrar a la
    // selección principal aunque el perfil sea conservador.
    const words = [
      ["turrón", "turrón", 2.82],
      ["meollo", "meollo", 3.03],
      ["alevosía", "alevosía", 2.85],
      ["okupa", "okupa", 2.5],
      ["desternillantes", "desternillante", 1.86],
      ["cogollo", "cogollo", 2.51],
    ] as const;
    const result = buildSuggestionRows({
      ...baseInput,
      forms: words.map(([form]) => form),
      entries: Object.fromEntries(
        words.map(([form, lemma, zipf]) => [form, [entry(zipf, { lemma })]]),
      ),
      knowledge: new Map(
        words.map(([, lemma]) => [lemma, { lemma, known: false }]),
      ),
    });
    // Todas entran, ordenadas por rareza (las más raras primero).
    expect(result.rows.map((row) => row.form)).toEqual([
      "desternillantes",
      "okupa",
      "cogollo",
      "turrón",
      "alevosía",
      "meollo",
    ]);
    expect(result.rows.every((row) => row.reason === "explicit_unknown")).toBe(
      true,
    );
  });

  it("los nombres solo capitalizados sin ficha no llegan a la hoja", () => {
    // «Billy»: sin ficha y siempre con mayúscula → ni selección
    // principal ni consulta secundaria. Sigue consultable en el texto.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["billy", "perenne"],
      entries: { perenne: [entry(1.5, { lemma: "perenne" })] },
      capitalOnly: new Set(["billy"]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perenne"]);
    expect(result.uncertain).toHaveLength(0);
  });

  it("lo que el catálogo no sabe medir va a la consulta secundaria", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["fantasma", "opaca", "comun"],
      entries: {
        opaca: [entry(null, { lemma: "opaca" })],
        comun: [entry(5.0, { lemma: "común" })],
      },
    });
    expect(result.rows).toHaveLength(0);
    expect(result.uncertain.map((row) => row.form)).toEqual([
      "opaca",
      "fantasma",
    ]);
    expect(result.uncertain.every((row) => row.reason === "catalog_uncertain"))
      .toBe(true);
  });

  it("un «no la conozco» sobre forma sin ficha entra a la selección principal", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["alien"],
      entries: {},
      knowledge: new Map([["alien", { lemma: "alien", known: false }]]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["alien"]);
    expect(result.rows[0].reason).toBe("explicit_unknown");
  });

  it("un «ya la conozco» sin ficha no aparece ni en la secundaria", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["casita"],
      entries: {},
      knowledge: new Map([["casita", { lemma: "casita", known: true }]]),
    });
    expect(result.rows).toHaveLength(0);
    expect(result.uncertain).toHaveLength(0);
  });

  it("los datos léxicos completos quedan en el mapa por clave", () => {
    const lex = new Map();
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["perenne"],
      entries: {
        perenne: [entry(1.5, { entryId: "7", lemma: "perenne" })],
      },
      lex,
    });
    const row = result.rows[0];
    expect(lex.get(row.key)).toMatchObject({ form: "perenne", lemma: "perenne" });
  });
});

describe("firstSentenceWith", () => {
  it("devuelve la primera oración que contiene la forma completa", () => {
    const text = "La casa era antigua. La perenne discusión seguía. Otra cosa.";
    expect(firstSentenceWith(text, "perenne")).toBe(
      "La perenne discusión seguía.",
    );
  });

  it("no confunde subcadenas con la forma", () => {
    const text = "Encasaron la vivienda. La casa quedó lista.";
    expect(firstSentenceWith(text, "casa")).toBe("La casa quedó lista.");
  });

  it("no distingue mayúsculas y devuelve undefined si no aparece", () => {
    expect(firstSentenceWith("La Casa era antigua.", "casa")).toBe(
      "La Casa era antigua.",
    );
    expect(
      firstSentenceWith("Texto sin la palabra buscada.", "perenne"),
    ).toBeUndefined();
  });
});
