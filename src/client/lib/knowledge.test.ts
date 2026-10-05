import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./lexicon";
import {
  PREDICT_CAP,
  estimateProfile,
  isCredibleKnowledge,
  knowledgeEvidence,
  predictSection,
  type KnowledgeEvidence,
} from "./knowledge";

const entry = (zipf: number | null, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  entryId: null,
  lemma: "lema",
  pos: "sustantivo",
  freqRank: null,
  zipf,
  senses: [{ definition: "definición", example: null, senseOrder: 1 }],
  ...over,
});

const known = (zipf: number | null): KnowledgeEvidence => ({ zipf, known: true });
const unknown = (zipf: number | null): KnowledgeEvidence => ({ zipf, known: false });

const forms = (result: ReturnType<typeof predictSection>) =>
  result.predicted.map((item) => item.form);

describe("estimateProfile", () => {
  it("sin evidencia devuelve el umbral por defecto con confianza baja", () => {
    expect(estimateProfile([])).toEqual({ threshold: 3.0, confidence: "low" });
  });

  it("la evidencia sin medición (zipf null) se ignora por completo", () => {
    expect(estimateProfile([known(null), unknown(null)])).toEqual({
      threshold: 3.0,
      confidence: "low",
    });
  });

  it("palabras conocidas raras bajan el umbral: solo predice más raro que lo que ya sabe", () => {
    // Todas las evidencias son «la conozco» sobre lemas raros: los
    // umbrales 1.5 y 2.0 empatan a cero errores y el desempate favorece
    // al más cercano al valor base — 2.0 deja pasar menos que 3.0 pero
    // el empate no basta para llevar el perfil al extremo.
    const profile = estimateProfile([known(2.0), known(2.4), known(2.8)]);
    expect(profile.threshold).toBe(2.0);
  });

  it("desconocidas comunes suben el umbral: hay que anticipar bastante", () => {
    // Lo contrario del caso anterior: el lector no conoce palabras
    // frecuentes (zipf ~4.0) y conviene predecir hasta por encima.
    const profile = estimateProfile([unknown(4.0), unknown(4.2)]);
    expect(profile.threshold).toBe(4.5);
  });

  it("desconocidas por debajo de la banda mínima dejan el umbral en el valor base", () => {
    // Ningún candidato falla con ellas —ya son más raras que cualquier
    // umbral—, así que la evidencia no distingue y gana el valor base:
    // tampoco es señal de un lector que conoce poco (era el umbral
    // mínimo) ni de uno que conoce mucho.
    const profile = estimateProfile([unknown(1.0), unknown(1.2)]);
    expect(profile.threshold).toBe(3.0);
  });

  it("una frontera mixta elige el candidato que separa mejor", () => {
    // Varios candidatos separan sin errores (2.5–4.0); el desempate
    // favorece al más cercano al valor base.
    const profile = estimateProfile([
      known(4.0),
      known(4.5),
      known(5.0),
      unknown(1.5),
      unknown(2.0),
    ]);
    expect(profile.threshold).toBe(3.0);
  });

  it("el empate entre candidatos favorece el más cercano al valor base", () => {
    // Con una sola evidencia conocida en 3.0 los candidatos 1.5–3.0
    // empatan a cero errores; gana el más cercano a 3.0, no el menor —
    // un empate no es evidencia de que el perfil sea extremo.
    const profile = estimateProfile([known(3.0)]);
    expect(profile.threshold).toBe(3.0);
  });

  it("a igual distancia del valor base el empate favorece el menor", () => {
    // Con una conocida en 2.9 y una desconocida en 3.1, 2.5 y 3.5
    // empatan con el mínimo de errores a la misma distancia de 3.0;
    // gana el menor (predecir menos).
    const profile = estimateProfile([known(2.9), unknown(3.1)]);
    expect(profile.threshold).toBe(2.5);
  });

  it("adjust desplaza el umbral y queda acotado a 1.0–5.5", () => {
    const base = [known(4.0), known(4.5), known(5.0), unknown(1.5), unknown(2.0)];
    expect(estimateProfile(base, 0.5).threshold).toBe(3.5);
    expect(estimateProfile(base, -0.5).threshold).toBe(2.5);
    expect(estimateProfile(base, 10).threshold).toBe(5.5);
    expect(estimateProfile(base, -10).threshold).toBe(1.0);
    // Sin evidencia el ajuste también aplica sobre el valor por defecto.
    expect(estimateProfile([], 0.5).threshold).toBe(3.5);
  });

  it("confidence: 14 evidencias → low, 15 → mid, 60 → high", () => {
    const list = (n: number) => Array.from({ length: n }, () => known(3.0));
    expect(estimateProfile(list(14)).confidence).toBe("low");
    expect(estimateProfile(list(15)).confidence).toBe("mid");
    expect(estimateProfile(list(60)).confidence).toBe("high");
  });
});

describe("predictSection", () => {
  const noKnowledge = new Map<string, { lemma: string; known: boolean }>();

  it("a) las guardadas en el cuaderno cuentan aparte y no se predicen", () => {
    const res = predictSection(
      ["rara", "guardada"],
      {
        rara: [entry(2.0, { lemma: "rara" })],
        guardada: [entry(2.0, { lemma: "guardada" })],
      },
      new Set(["guardada"]),
      noKnowledge,
      3.0,
    );
    expect(res.savedCount).toBe(1);
    expect(forms(res)).toEqual(["rara"]);
    expect(res.total).toBe(2);
  });

  it("b) las formas sin ficha van a missing, aunque haya evidencia sobre ellas", () => {
    // Regla (b) manda sobre (c): sin ficha en el catálogo no hay nada
    // que predecir, aunque el lector declarara conocerla.
    const res = predictSection(
      ["fantasma", "guardada", "declarada"],
      { guardada: [entry(4.0, { lemma: "guardada" })] },
      new Set(["guardada"]),
      new Map([["declarada", { lemma: "declarada", known: true }]]),
      3.0,
    );
    expect(res.missing).toEqual(["fantasma", "declarada"]);
    expect(res.savedCount).toBe(1);
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(0);
  });

  it("c) un «no la conozco» por lema de la ficha la predice", () => {
    const res = predictSection(
      ["perenne"],
      { perenne: [entry(4.5, { lemma: "perenne" })] }, // frecuente: sin evidencia no entraría
      new Set(),
      new Map([["perenne", { lemma: "perenne", known: false }]]),
      3.0,
    );
    expect(forms(res)).toEqual(["perenne"]);
    expect(res.knownCount).toBe(0);
  });

  it("c) la evidencia puede llegar por la forma misma cuando el lema no consta", () => {
    const res = predictSection(
      ["bancos"],
      { bancos: [entry(4.5, { lemma: "banco" })] },
      new Set(),
      new Map([["bancos", { lemma: "bancos", known: false }]]),
      3.0,
    );
    expect(forms(res)).toEqual(["bancos"]);
  });

  it("c) un «ya la conozco» la da por conocida aunque sea rara", () => {
    const res = predictSection(
      ["perenne"],
      { perenne: [entry(1.5, { lemma: "perenne" })] }, // rarísima: sin evidencia entraría
      new Set(),
      new Map([["perenne", { lemma: "perenne", known: true }]]),
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(1);
  });

  it("c) entre varias fichas un «no la conozco» gana al «ya la conozco» de otra acepción", () => {
    const res = predictSection(
      ["banco"],
      {
        banco: [
          entry(4.5, { entryId: "1", lemma: "banco" }),
          entry(4.5, { entryId: "2", lemma: "bancar" }),
        ],
      },
      new Set(),
      new Map([
        ["banco", { lemma: "banco", known: true }],
        ["bancar", { lemma: "bancar", known: false }],
      ]),
      3.0,
    );
    expect(forms(res)).toEqual(["banco"]);
    expect(res.predicted[0].entry.entryId).toBe("2");
  });

  it("d) sin evidencia predice lo raro; lo sin medición va a «uncertain»", () => {
    const res = predictSection(
      ["rara", "comun", "sinmedida"],
      {
        rara: [entry(2.9, { lemma: "rara" })],
        comun: [entry(3.0, { lemma: "comun" })],
        sinmedida: [entry(null, { lemma: "sinmedida" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["rara"]);
    expect(res.knownCount).toBe(1);
    expect(res.uncertain.map((item) => item.form)).toEqual(["sinmedida"]);
  });

  it("d) toda ficha sin medición y sin evidencia va a «uncertain»", () => {
    const res = predictSection(
      ["opaca", "opacas"],
      {
        opaca: [entry(null, { entryId: "1", lemma: "opaco" })],
        opacas: [entry(null, { entryId: "2", lemma: "opacar" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(0);
    expect(res.uncertain.map((item) => item.form)).toEqual(["opaca", "opacas"]);
  });

  it("c) un «no la conozco» sobre ficha sin medición sí la predice", () => {
    // La evidencia explícita manda sobre la falta de medición: no hay
    // incertidumbre que resolver, el lector ya dijo que no la sabe.
    const res = predictSection(
      ["opaca"],
      { opaca: [entry(null, { entryId: "1", lemma: "opaco" })] },
      new Set(),
      new Map([["opaco", { lemma: "opaco", known: false }]]),
      3.0,
    );
    expect(forms(res)).toEqual(["opaca"]);
    expect(res.uncertain).toHaveLength(0);
  });

  it("d) el umbral es estricto: zipf igual al límite no entra", () => {
    const res = predictSection(
      ["justa"],
      { justa: [entry(3.0, { lemma: "justa" })] },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(1);
  });

  it("d) una lectura frecuente tapa la homógrafa rara («antigua» → antiguo)", () => {
    const res = predictSection(
      ["antigua"],
      {
        antigua: [
          entry(null, { entryId: "1", lemma: "antiguar" }), // rara/sin medir
          entry(4.77, { entryId: "2", lemma: "antiguo" }), // lectura común
        ],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(1);
  });

  it("d) con todas las fichas raras predice la de mayor zipf", () => {
    const res = predictSection(
      ["rareza"],
      {
        rareza: [
          entry(1.2, { entryId: "1", lemma: "rarísimo" }),
          entry(2.8, { entryId: "2", lemma: "raro" }),
          entry(null, { entryId: "3", lemma: "sinmedida" }),
        ],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(1);
    expect(res.predicted[0].entry.entryId).toBe("2");
  });

  it("deduplica por entryId conservando la primera forma que la trajo", () => {
    const shared = entry(2.0, { entryId: "7", lemma: "perenne" });
    const res = predictSection(
      ["perenne", "perennes"],
      { perenne: [shared], perennes: [shared] },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["perenne"]);
    // La segunda forma ya quedó cubierta por la predicción: cuenta como conocida.
    expect(res.knownCount).toBe(1);
  });

  it("deduplica por lemma::pos cuando no hay entryId, también con evidencia", () => {
    const res = predictSection(
      ["a", "b"],
      {
        a: [entry(4.0, { lemma: "mismo", pos: "adj" })],
        b: [entry(4.0, { lemma: "mismo", pos: "adj" })],
      },
      new Set(),
      new Map([["mismo", { lemma: "mismo", known: false }]]),
      3.0,
    );
    expect(forms(res)).toEqual(["a"]);
    expect(res.knownCount).toBe(1);
  });

  it("una segunda ficha de la misma forma sí entra si la primera ya se predijo", () => {
    const shared = entry(2.0, { entryId: "7", lemma: "compartida" });
    const res = predictSection(
      ["alfa", "beta"],
      {
        alfa: [shared],
        beta: [shared, entry(1.0, { entryId: "9", lemma: "propia" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted[0].entry.entryId).toBe("9");
    expect(forms(res)).toEqual(["beta", "alfa"]);
  });

  it("ordena por rareza: zipf ascendente, alfabético en empate; sin medición va aparte", () => {
    const res = predictSection(
      ["b", "a", "c", "d"],
      {
        b: [entry(2.0, { lemma: "b" })],
        a: [entry(2.0, { lemma: "a" })],
        c: [entry(1.5, { lemma: "c" })],
        d: [entry(null, { lemma: "d" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["c", "a", "b"]);
    expect(res.uncertain.map((item) => item.form)).toEqual(["d"]);
  });

  it(`recorta la lista a ${PREDICT_CAP} y lo demás cuenta como conocido`, () => {
    const list = Array.from({ length: PREDICT_CAP + 10 }, (_, i) => `r${i}`);
    const entries = Object.fromEntries(
      list.map((form, i) => [form, [entry(2.0, { lemma: `lema${i}` })]]),
    );
    const res = predictSection(list, entries, new Set(), noKnowledge, 3.0);
    expect(res.predicted).toHaveLength(PREDICT_CAP);
    expect(res.knownCount).toBe(10);
    expect(res.total).toBe(PREDICT_CAP + 10);
  });

  it("una ficha sin acepciones se predice igual: es candidata al lote automático de IA", () => {
    // A diferencia del viejo clasificador por nivel —que la contaba
    // como conocida—, una ficha sin definiciones puede ir al lote de
    // enriquecimiento automático.
    const res = predictSection(
      ["vacia"],
      { vacia: [entry(1.0, { lemma: "vacia", senses: [] })] },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["vacia"]);
  });
});

describe("isCredibleKnowledge", () => {
  const row = (over = {}) => ({
    lemma: "casa",
    known: false,
    source: "inferred",
    ...over,
  });

  it("descarta «inferida como desconocida» sin palabra guardada que la respalde", () => {
    expect(isCredibleKnowledge(row(), new Set())).toBe(false);
    expect(isCredibleKnowledge(row(), new Set(["otra"]))).toBe(false);
  });

  it("conserva la inferida cuando el Cuaderno sí la respalda", () => {
    expect(isCredibleKnowledge(row(), new Set(["casa"]))).toBe(true);
  });

  it("la inferida como conocida siempre cuenta", () => {
    expect(isCredibleKnowledge(row({ known: true }), new Set())).toBe(true);
  });

  it("las fuentes explícitas cuentan aunque no haya guardada", () => {
    for (const source of ["declared", "preparation", "saved", "calibration"])
      expect(isCredibleKnowledge(row({ source }), new Set())).toBe(true);
  });
});

describe("knowledgeEvidence", () => {
  it("conserva ambas respuestas con su zipf medido", () => {
    const out = knowledgeEvidence(
      [
        { lemma: "casa", known: true },
        { lemma: "perenne", known: false },
      ],
      {
        casa: [entry(5.1)],
        perenne: [entry(1.8)],
      },
    );
    expect(out.get("casa")).toEqual({ zipf: 5.1, known: true });
    expect(out.get("perenne")).toEqual({ zipf: 1.8, known: false });
  });

  it("lema sin ficha queda sin medición, no se inventa", () => {
    const out = knowledgeEvidence([{ lemma: "xyz", known: false }], {});
    expect(out.get("xyz")).toEqual({ zipf: null, known: false });
  });

  it("usa la primera acepción del lema, el criterio de Cuenta", () => {
    const out = knowledgeEvidence(
      [{ lemma: "carta", known: true }],
      { carta: [entry(4.2), entry(1.1)] },
    );
    expect(out.get("carta")).toEqual({ zipf: 4.2, known: true });
  });

  it("una respuesta nueva reemplaza la anterior del mismo lema", () => {
    const first = knowledgeEvidence(
      [{ lemma: "mesa", known: false }],
      { mesa: [entry(4.0)] },
    );
    const again = knowledgeEvidence(
      [{ lemma: "mesa", known: true }],
      { mesa: [entry(4.0)] },
    );
    expect(first.get("mesa")).toEqual({ zipf: 4.0, known: false });
    expect(again.get("mesa")).toEqual({ zipf: 4.0, known: true });
  });
});
