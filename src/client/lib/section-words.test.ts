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

  it("asentada declarada desconocida entra: la evidencia manda sobre el nivel", () => {
    expect(preparationLearning("settled", { known: false })).toBe(true);
    expect(preparationLearning("settled", { known: true })).toBe(false);
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

  it("un «no la conozco» explícito manda sobre el filtro de nombres", () => {
    // «billy» pinta a nombre propio, pero si el lector la declaró
    // desconocida la respuesta manda: entra a la selección principal.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["billy"],
      entries: {},
      capitalOnly: new Set(["billy"]),
      knowledge: new Map([["billy", { lemma: "billy", known: false }]]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["billy"]);
    expect(result.rows[0].reason).toBe("explicit_unknown");
    expect(result.uncertain).toHaveLength(0);
  });

  it("el «ya la conozco» también saca del filtro de nombres", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["billy"],
      entries: {},
      capitalOnly: new Set(["billy"]),
      knowledge: new Map([["billy", { lemma: "billy", known: true }]]),
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

  it("una asentada declarada desconocida entra al grupo de aprendiendo", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["asentada"],
      entries: { asentada: [entry(4.5, { lemma: "asentada" })] },
      saved: new Map([["asentada", "settled" as const]]),
      knowledge: new Map([["asentada", { lemma: "asentada", known: false }]]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["asentada"]);
    expect(result.rows[0].learning).toBe(true);
    // Entra por la declaración explícita, no por su nivel de tarjeta.
    expect(result.rows[0].reason).toBe("explicit_unknown");
  });

  it("una asentada sin evidencia o declarada conocida queda fuera", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["asentada", "sabida"],
      entries: {
        asentada: [entry(4.5, { lemma: "asentada" })],
        sabida: [entry(4.5, { lemma: "sabida" })],
      },
      saved: new Map([
        ["asentada", "settled" as const],
        ["sabida", "settled" as const],
      ]),
      knowledge: new Map([["sabida", { lemma: "sabida", known: true }]]),
    });
    expect(result.rows).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("la selección corta a 40 por prioridad y el resto queda diferido", () => {
    // 39 explícitas + 1 aprendiendo + 2 raras = 42 candidatas: las
    // explícitas conservan todas sus plazas; el corte cae en rareza.
    const code = (i: number) =>
      `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
    const explicits = Array.from({ length: 39 }, (_, i) => `exp${code(i)}`);
    const forms = [...explicits, "aprendiendo", "raraa", "rarab"];
    const result = buildSuggestionRows({
      ...baseInput,
      forms,
      entries: {
        ...Object.fromEntries(
          explicits.map((f) => [f, [entry(4.0, { lemma: f })]]),
        ),
        aprendiendo: [entry(2.0, { lemma: "aprendiendo" })],
        raraa: [entry(1.0, { lemma: "raraa" })],
        rarab: [entry(0.5, { lemma: "rarab" })],
      },
      saved: new Map([["aprendiendo", "new" as const]]),
      knowledge: new Map(
        explicits.map((f) => [f, { lemma: f, known: false }]),
      ),
    });
    expect(result.rows).toHaveLength(40);
    // Las 39 explícitas primero (todas entran aunque el zipf las
    // pondría después de las raras), luego la aprendiendo: el corte
    // cae íntegro en rareza.
    expect(
      result.rows.slice(0, 39).every(
        (row) => row.reason === "explicit_unknown",
      ),
    ).toBe(true);
    expect(result.rows.slice(0, 39).map((row) => row.form).sort()).toEqual(
      [...explicits].sort(),
    );
    expect(result.rows[39].form).toBe("aprendiendo");
    expect(result.deferred.map((row) => row.form)).toEqual([
      "rarab",
      "raraa",
    ]);
    expect(result.deferred[0].reason).toBe("rarity");
  });

  it("la evidencia gana sobre la rareza aunque el zipf diga común", () => {
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["rarisima", "comun"],
      entries: {
        rarisima: [entry(0.5, { lemma: "rarisima" })],
        comun: [entry(4.9, { lemma: "comun" })],
      },
      knowledge: new Map([["comun", { lemma: "comun", known: false }]]),
    });
    // «comun» no entra por rareza (zipf 4.9) sino por la declaración:
    // va primero aunque sea la forma más frecuente del tramo.
    expect(result.rows.map((row) => row.form)).toEqual([
      "comun",
      "rarisima",
    ]);
    expect(result.rows[0].reason).toBe("explicit_unknown");
    expect(result.rows[1].reason).toBe("rarity");
  });

  it("una fila diferida conserva sus datos léxicos y su evidencia", () => {
    // 41 explícitas: la última queda diferida con su ficha y razón.
    const code = (i: number) =>
      `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
    const explicits = Array.from({ length: 41 }, (_, i) => `exp${code(i)}`);
    const lex = new Map();
    const result = buildSuggestionRows({
      ...baseInput,
      forms: explicits,
      entries: Object.fromEntries(
        explicits.map((f) => [f, [entry(2.0, { lemma: f, entryId: `id-${f}` })]]),
      ),
      knowledge: new Map(
        explicits.map((f) => [f, { lemma: f, known: false }]),
      ),
      lex,
    });
    expect(result.rows).toHaveLength(40);
    expect(result.deferred).toHaveLength(1);
    const deferred = result.deferred[0];
    expect(deferred.reason).toBe("explicit_unknown");
    expect(deferred.meaning).toBe("def");
    // Sus datos léxicos están en el mapa: al confirmar se arma la
    // evidencia sin volver a buscarlos.
    expect(lex.get(deferred.key)).toMatchObject({
      form: deferred.form,
      lemma: deferred.lemma,
    });
  });

  it("dígitos y tokens con puntuación residual nunca son candidatos", () => {
    // Regresión del prólogo: «1», «10» y «3,5» salían como «palabras
    // sin información» porque isWordLike los acepta. Aunque traigan
    // ficha no pueden ser filas — ni principales ni secundarias.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["1", "10", "3,5", "sí", "perenne"],
      entries: {
        "1": [entry(0.5, { lemma: "uno", pos: "numeral" })],
        "10": [entry(0.5, { lemma: "diez", pos: "numeral" })],
        "3,5": [entry(1.0, { lemma: "tres", pos: "numeral" })],
        perenne: [entry(1.5, { lemma: "perenne" })],
      },
      knowledge: new Map([["uno", { lemma: "uno", known: false }]]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perenne"]);
    expect(result.uncertain).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("stopwords y numerales en texto nunca llegan a la hoja", () => {
    // «diez», «hola» y «abajo» son funcionales: ni con ficha ni con
    // respuesta explícita aparecen como candidatas.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["diez", "cincuenta", "hola", "abajo", "obstante", "perenne"],
      entries: {
        diez: [entry(0.5, { lemma: "diez", pos: "numeral" })],
        hola: [entry(0.5, { lemma: "hola", pos: "interjección" })],
        abajo: [entry(0.5, { lemma: "abajo", pos: "adverbio" })],
        perenne: [entry(1.5, { lemma: "perenne" })],
      },
      knowledge: new Map([
        ["diez", { lemma: "diez", known: false }],
        ["hola", { lemma: "hola", known: false }],
      ]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perenne"]);
    expect(result.uncertain).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("las fichas funcionales (pronombre, numeral…) no son candidatas", () => {
    // «quienquiera» y «suyo» no son stopwords: solo el POS las
    // excluye, aunque el catálogo las tenga medidas como raras.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["quienquiera", "suyo", "doctrina", "perenne"],
      entries: {
        quienquiera: [entry(0.8, { lemma: "quienquiera", pos: "pronombre" })],
        suyo: [entry(1.0, { lemma: "suyo", pos: "pronombre" })],
        doctrina: [entry(0.9, { lemma: "doctrina", pos: "artículo" })],
        perenne: [entry(1.5, { lemma: "perenne" })],
      },
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perenne"]);
    expect(result.uncertain).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("un adverbio en -mente de adjetivo común no se sugiere", () => {
    // Aunque «perfectamente» tenga ficha propia medida como rara, su
    // raíz «perfecta» → «perfecto» es un adjetivo común para el lector:
    // la derivación es transparente.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["perfectamente", "perenne"],
      entries: {
        perfectamente: [
          entry(1.5, { lemma: "perfectamente", pos: "adverbio" }),
        ],
        perfecta: [entry(4.5, { lemma: "perfecto", pos: "adjetivo" })],
        perenne: [entry(1.5, { lemma: "perenne" })],
      },
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perenne"]);
    expect(result.uncertain).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("un -mente de raíz rara se sugiere con el lema real", () => {
    // Sin ficha propia, la frecuencia se evalúa sobre la raíz
    // «vehemente» — rara para este lector.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["vehementemente"],
      entries: {
        vehemente: [entry(1.8, { lemma: "vehemente", pos: "adjetivo" })],
      },
    });
    expect(result.rows.map((row) => row.form)).toEqual(["vehementemente"]);
    expect(result.rows[0].lemma).toBe("vehemente");
  });

  it("un verbo con enclíticos se evalúa por el lema real", () => {
    // «tomándose» → «tomando» → «tomar» (común: fuera); «zurrándose»
    // → «zurrando» → «zurrar» (raro: candidata con el lema base).
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["tomándose", "zurrándose", "haberse"],
      entries: {
        tomando: [entry(5.5, { lemma: "tomar", pos: "verbo" })],
        zurrando: [entry(1.8, { lemma: "zurrar", pos: "verbo" })],
        haber: [entry(6.0, { lemma: "haber", pos: "verbo" })],
      },
    });
    expect(result.rows.map((row) => row.form)).toEqual(["zurrándose"]);
    expect(result.rows[0].lemma).toBe("zurrar");
    expect(result.uncertain).toHaveLength(0);
  });

  it("un «no la conozco» rescata un -mente de raíz común", () => {
    // La evidencia explícita manda también sobre la transparencia del
    // adverbio: si el lector la declaró, entra a la selección.
    const result = buildSuggestionRows({
      ...baseInput,
      forms: ["perfectamente"],
      entries: {
        perfectamente: [
          entry(1.5, { lemma: "perfectamente", pos: "adverbio" }),
        ],
        perfecta: [entry(4.5, { lemma: "perfecto", pos: "adjetivo" })],
      },
      knowledge: new Map([
        ["perfectamente", { lemma: "perfectamente", known: false }],
      ]),
    });
    expect(result.rows.map((row) => row.form)).toEqual(["perfectamente"]);
    expect(result.rows[0].reason).toBe("explicit_unknown");
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
