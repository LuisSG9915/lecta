import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./lexicon";
import {
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD_NATIVE,
  PREDICT_CAP,
  cliticBaseForms,
  cliticBasesFor,
  estimateProfile,
  isCredibleKnowledge,
  knowledgeEvidence,
  predictSection,
  resolveEvidence,
  vocabLevelLabel,
  applyPreviewKnownSignal,
  applyWordPanelLookupSignal,
  updatePreviewFrictionPreference,
  recordSilentCalibration,
  type KnowledgeEvidence,
} from "./knowledge";
import type { UserLanguageProfile } from "./profile-models";

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

  it("dos desconocidas comunes no bastan para subir el umbral al extremo", () => {
    // Solo dos evidencias: la regularización no paga alejarse del
    // valor base — mover el perfil exige más señal que un par de
    // respuestas.
    const profile = estimateProfile([unknown(4.0), unknown(4.2)]);
    expect(profile.threshold).toBe(3.0);
  });

  it("muchas desconocidas comunes sí suben el umbral", () => {
    // Con suficiente evidencia la regularización se diluye: diez
    // respuestas sostienen el salto por encima de las frecuentes.
    const profile = estimateProfile(
      Array.from({ length: 10 }, (_, i) => unknown(4.0 + i * 0.01)),
    );
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

  it("a igual puntaje el empate favorece al más cercano al valor base", () => {
    // Con una conocida en 2.9 y una desconocida en 3.1, los
    // candidatos 2.5, 3.0 y 3.5 empatan en puntaje (errores +
    // regularización); gana el más cercano a 3.0.
    const profile = estimateProfile([known(2.9), unknown(3.1)]);
    expect(profile.threshold).toBe(3.0);
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

  it("a2) una forma flexionada cuenta como guardada si su lema está en el cuaderno", () => {
    const res = predictSection(
      ["corrieron", "rara"],
      {
        corrieron: [entry(2.0, { lemma: "correr" })],
        rara: [entry(2.0, { lemma: "rara" })],
      },
      new Set(["correr"]),
      noKnowledge,
      3.0,
    );
    expect(res.savedCount).toBe(1);
    expect(forms(res)).toEqual(["rara"]);
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

  it(`recorta la lista a ${PREDICT_CAP} y lo demás queda diferido, no conocido`, () => {
    const list = Array.from({ length: PREDICT_CAP + 10 }, (_, i) => `r${i}`);
    const entries = Object.fromEntries(
      list.map((form, i) => [form, [entry(2.0, { lemma: `lema${i}` })]]),
    );
    const res = predictSection(list, entries, new Set(), noKnowledge, 3.0);
    expect(res.predicted).toHaveLength(PREDICT_CAP);
    // Las que no cupieron son candidatas reales: la hoja las ofrece
    // aparte; no inflan el conteo de conocidas. Quedan en el orden
    // de rareza del corte (zipf igualado → alfabético).
    const rarityOrder = [...list].sort((a, b) => a.localeCompare(b));
    expect(res.deferred.map((item) => item.form)).toEqual(
      rarityOrder.slice(PREDICT_CAP),
    );
    expect(res.knownCount).toBe(0);
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

  it("c) las fichas funcionales no son vocabulario: cuentan como conocidas", () => {
    const res = predictSection(
      ["diez", "quienquiera", "perenne"],
      {
        diez: [entry(0.5, { lemma: "diez", pos: "numeral" })],
        quienquiera: [entry(0.8, { lemma: "quienquiera", pos: "pronombre" })],
        perenne: [entry(1.5, { lemma: "perenne" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["perenne"]);
    expect(res.knownCount).toBe(2);
    expect(res.missing).toHaveLength(0);
    expect(res.uncertain).toHaveLength(0);
  });

  it("las fichas funcionales no tapan una lectura aprendible de la misma forma", () => {
    // La interjección rara no compite: solo la lectura de vocabulario
    // decide si la forma se predice.
    const res = predictSection(
      ["mixta"],
      {
        mixta: [
          entry(0.5, { entryId: "1", lemma: "mixta", pos: "interjección" }),
          entry(1.8, { entryId: "2", lemma: "mixto", pos: "adjetivo" }),
        ],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["mixta"]);
    expect(res.predicted[0].entry.entryId).toBe("2");
  });

  it("b) un -mente de adjetivo común se da por conocido aunque tenga ficha rara", () => {
    const res = predictSection(
      ["perfectamente"],
      {
        perfectamente: [
          entry(1.5, { lemma: "perfectamente", pos: "adverbio" }),
        ],
        perfecta: [entry(4.5, { lemma: "perfecto", pos: "adjetivo" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(1);
  });

  it("b) el -mente también resuelve por el lema masculino de la raíz", () => {
    // Si la tabla de formas no enlaza «perfecta», la candidata
    // «perfecto» sigue verificando la raíz común.
    const res = predictSection(
      ["perfectamente"],
      { perfecto: [entry(4.5, { lemma: "perfecto", pos: "adjetivo" })] },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.predicted).toHaveLength(0);
    expect(res.knownCount).toBe(1);
    expect(res.missing).toHaveLength(0);
  });

  it("b) un -mente de raíz rara se evalúa por la raíz", () => {
    const res = predictSection(
      ["vehementemente"],
      {
        vehemente: [entry(1.8, { lemma: "vehemente", pos: "adjetivo" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(forms(res)).toEqual(["vehementemente"]);
    expect(res.predicted[0].entry.lemma).toBe("vehemente");
  });

  it("b) un «no la conozco» explícito rescata el -mente de raíz común", () => {
    const res = predictSection(
      ["perfectamente"],
      {
        perfectamente: [
          entry(1.5, { lemma: "perfectamente", pos: "adverbio" }),
        ],
        perfecta: [entry(4.5, { lemma: "perfecto", pos: "adjetivo" })],
      },
      new Set(),
      new Map([["perfectamente", { lemma: "perfectamente", known: false }]]),
      3.0,
    );
    expect(forms(res)).toEqual(["perfectamente"]);
  });

  it("d) un verbo con enclíticos se evalúa por la frecuencia del lema real", () => {
    const res = predictSection(
      ["tomándose", "zurrándose"],
      {
        tomando: [entry(5.5, { lemma: "tomar", pos: "verbo" })],
        zurrando: [entry(1.8, { lemma: "zurrar", pos: "verbo" })],
      },
      new Set(),
      noKnowledge,
      3.0,
    );
    // La común queda fuera; la rara se predice con la ficha del lema base.
    expect(forms(res)).toEqual(["zurrándose"]);
    expect(res.predicted[0].entry.lemma).toBe("zurrar");
    expect(res.knownCount).toBe(1);
    expect(res.missing).toHaveLength(0);
  });

  it("d) sin base clítica verificable la forma sigue a missing", () => {
    const res = predictSection(
      ["zarandéandose"],
      {},
      new Set(),
      noKnowledge,
      3.0,
    );
    expect(res.missing).toEqual(["zarandéandose"]);
    expect(res.predicted).toHaveLength(0);
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

  it("una ficha sin medición no oculta la ficha medida del mismo lema", () => {
    // Regresión de «abrir»: la ficha de IA sin zipf aparecía primero y
    // la evidencia quedaba sin medición aunque existía la medida.
    const out = knowledgeEvidence([{ lemma: "abrir", known: true }], {
      abrir: [entry(null, { lemma: "abrir" }), entry(4.77, { lemma: "abrir" })],
    });
    expect(out.get("abrir")).toEqual({ zipf: 4.77, known: true });
  });

  it("prefiere la ficha medida del propio lema antes que la de otro", () => {
    // «indigno» trae fichas de «indignar» (medida) y de «indigno»
    // (medida): la evidencia declarada sobre «indigno» usa la suya.
    const out = knowledgeEvidence([{ lemma: "indigno", known: true }], {
      indigno: [
        entry(2.26, { lemma: "indignar" }),
        entry(3.28, { lemma: "indigno" }),
        entry(null, { lemma: "indignarse" }),
      ],
    });
    expect(out.get("indigno")).toEqual({ zipf: 3.28, known: true });
  });

  it("sin ficha medida del lema cae a la primera lectura medida", () => {
    // «decirle»: su ficha propia del Wikcionario no trae zipf; la
    // medición útil es la del lema base «decir».
    const out = knowledgeEvidence([{ lemma: "decirle", known: false }], {
      decirle: [entry(null, { lemma: "decirle" }), entry(5.78, { lemma: "decir" })],
    });
    expect(out.get("decirle")).toEqual({ zipf: 5.78, known: false });
  });
});

describe("cliticBaseForms", () => {
  it("quita un pronombre enclítico conservando el verbo base", () => {
    expect(cliticBaseForms("abrirlo")).toEqual(["abrir"]);
    expect(cliticBaseForms("leerlo")).toEqual(["leer"]);
    expect(cliticBaseForms("elegirlo")).toEqual(["elegir"]);
    expect(cliticBaseForms("decirle")).toEqual(["decir"]);
    expect(cliticBaseForms("reírme")).toEqual(["reir"]);
  });

  it("quita dos pronombres y normaliza la tilde desplazada", () => {
    expect(cliticBaseForms("tomármelo")).toEqual(["tomarme", "tomar"]);
    // «díselo» = «dí» + «se» + «lo»: el residuo queda en dos letras
    // y se descarta — un imperativo tan corto no es verificable.
    expect(cliticBaseForms("díselo")).toEqual(["dise"]);
  });

  it("forma con gerundio acentuado resuelve al gerundio", () => {
    // El residuo «escribiendol» también sale como candidata ruidosa;
    // el catálogo la descarta al no existir.
    expect(cliticBaseForms("escribiéndolos")).toEqual([
      "escribiendo",
      "escribiendol",
    ]);
  });

  it("palabras sin clítico no producen candidatas", () => {
    expect(cliticBaseForms("pedacito")).toEqual([]);
    expect(cliticBaseForms("oenegés")).toEqual([]);
    expect(cliticBaseForms("guiris")).toEqual([]);
    expect(cliticBaseForms("cocina")).toEqual([]);
    // «meollo» produce una candidata falsa («meol») que el catálogo
    // rechaza al no existir — el ruido es inofensivo.
    expect(cliticBaseForms("meollo")).toEqual(["meol"]);
  });

  it("residuos de menos de tres letras se descartan", () => {
    // «ello» terminaría en «el» si se quitara «lo»: no es verbo y el
    // residuo es demasiado corto para confiar.
    expect(cliticBaseForms("ello")).toEqual([]);
  });
});

describe("cliticBasesFor", () => {
  it("solo consulta bases de formas sin ficha, sin repetir", () => {
    const bases = cliticBasesFor(
      [{ lemma: "abrirlo" }, { lemma: "casa" }, { lemma: "abrirlo" }],
      { casa: [entry(4.5, { lemma: "casa" })] },
    );
    expect(bases).toEqual(["abrir"]);
  });
});

describe("resolveEvidence", () => {
  it("forma clítica sin ficha se proyecta al lema base verificado", () => {
    // «abrirlo» no tiene ficha; «abrir» sí. La evidencia queda sobre
    // «abrir» con su medición — la fila original no se toca.
    const out = resolveEvidence(
      [{ lemma: "abrirlo", known: true, source: "declared" }],
      {},
      { abrir: [entry(4.77, { lemma: "abrir" })] },
    );
    expect([...out.keys()]).toEqual(["abrir"]);
    expect(out.get("abrir")).toEqual({ lemma: "abrir", known: true, zipf: 4.77 });
  });

  it("sin base verificable la forma conserva su clave sin medición", () => {
    const out = resolveEvidence(
      [{ lemma: "oenegés", known: false }],
      {},
      {},
    );
    expect(out.get("oenegés")).toEqual({
      lemma: "oenegés",
      known: false,
      zipf: null,
    });
  });

  it("la proyección no pisa una declaración directa más fuerte", () => {
    // «abrir» declarado desconocido (fuente explícita) gana a un
    // «abrirlo» guardado como conocida (fuente más débil).
    const out = resolveEvidence(
      [
        { lemma: "abrirlo", known: true, source: "saved", updatedAt: 1 },
        { lemma: "abrir", known: false, source: "declared", updatedAt: 2 },
      ],
      { abrir: [entry(4.77, { lemma: "abrir" })] },
      { abrir: [entry(4.77, { lemma: "abrir" })] },
    );
    expect(out.get("abrir")).toEqual({
      lemma: "abrir",
      known: false,
      zipf: 4.77,
    });
  });

  it("a igual fuente gana la evidencia más reciente", () => {
    const out = resolveEvidence(
      [
        { lemma: "abrirlo", known: true, source: "declared", updatedAt: 5 },
        { lemma: "abrir", known: false, source: "declared", updatedAt: 9 },
      ],
      { abrir: [entry(4.77, { lemma: "abrir" })] },
      { abrir: [entry(4.77, { lemma: "abrir" })] },
    );
    expect(out.get("abrir")?.known).toBe(false);
  });

  it("palabra del banco de calibración en inglés resuelve su zipf de banda cuando no hay catálogo", () => {
    const out = resolveEvidence(
      [
        { lemma: "clandestine", known: false },
        { lemma: "awkward", known: true },
      ],
      {},
      {},
      "en",
    );
    expect(out.get("clandestine")).toEqual({
      lemma: "clandestine",
      known: false,
      zipf: 2.25,
    });
    expect(out.get("awkward")).toEqual({
      lemma: "awkward",
      known: true,
      zipf: 2.75,
    });
  });
});

describe("estimateProfile baseThreshold", () => {
  it("usa DEFAULT_THRESHOLD_NATIVE por defecto para lectores nativos", () => {
    const profile = estimateProfile([], 0, DEFAULT_THRESHOLD_NATIVE);
    expect(profile.threshold).toBe(2.0);
  });

  it("usa DEFAULT_THRESHOLD_LEARNER para estudiantes", () => {
    const profile = estimateProfile([], 0, DEFAULT_THRESHOLD_LEARNER);
    expect(profile.threshold).toBe(3.0);
  });

  it("aplica el ajuste de sensibilidad sobre el umbral base", () => {
    const profile = estimateProfile([], 0.3, DEFAULT_THRESHOLD_NATIVE);
    expect(profile.threshold).toBe(2.3);
  });
});

describe("vocabLevelLabel", () => {
  it("etiqueta perfiles nativos según umbrales de vocabulario literario", () => {
    expect(vocabLevelLabel(1.6, "native")).toBe("amplio");
    expect(vocabLevelLabel(2.0, "native")).toBe("medio");
    expect(vocabLevelLabel(2.6, "native")).toBe("en desarrollo");
  });

  it("etiqueta perfiles aprendices con escalas tradicionales", () => {
    expect(vocabLevelLabel(2.2, "learner")).toBe("amplio");
    expect(vocabLevelLabel(3.0, "learner")).toBe("medio");
    expect(vocabLevelLabel(3.8, "learner")).toBe("en desarrollo");
  });
});

describe("Canales de Retroalimentación Adaptativa (Paso 3)", () => {
  const baseProfile: UserLanguageProfile = {
    theta: 0.0,
    thetaByLang: { es: 0.0, en: 0.0 },
    uncertaintyByLang: { es: 1.0, en: 1.0 },
    chaptersCompletedByLang: { es: 0, en: 0 },
    preferredPreviewCount: 5,
    consecutivePreviewSkips: 0,
  };

  it("applyPreviewKnownSignal incrementa thetaByLang[lang] y theta para 'es' al tocar '✓ Ya la sé'", () => {
    const updated = applyPreviewKnownSignal(baseProfile, "es", 1.2);
    expect(updated.thetaByLang.es).toBeGreaterThan(baseProfile.thetaByLang.es);
    expect(updated.theta).toBe(updated.thetaByLang.es);
    // No debe alterar inglés
    expect(updated.thetaByLang.en).toBe(0.0);
  });

  it("applyPreviewKnownSignal en inglés actualiza thetaByLang['en'] sin alterar theta de español", () => {
    const updated = applyPreviewKnownSignal(baseProfile, "en", 1.0);
    expect(updated.thetaByLang.en).toBeGreaterThan(baseProfile.thetaByLang.en);
    expect(updated.thetaByLang.es).toBe(0.0);
    expect(updated.theta).toBe(0.0);
  });

  it("applyWordPanelLookupSignal baja theta por sorpresa al consultar una palabra asumida como conocida", () => {
    // Usuario con nivel alto (theta = 2.0). Consulta palabra fácil (beta = -0.5, pKnow alto)
    const highProfile: UserLanguageProfile = {
      ...baseProfile,
      theta: 2.0,
      thetaByLang: { es: 2.0, en: 0.0 },
    };
    const updated = applyWordPanelLookupSignal(highProfile, "es", -0.5);
    expect(updated.thetaByLang.es).toBeLessThan(highProfile.thetaByLang.es);
    expect(updated.theta).toBe(updated.thetaByLang.es);
  });

  it("updatePreviewFrictionPreference reduce preferredPreviewCount de 5 a 3 con 3 omisiones consecutivas", () => {
    // Estado inicial: 5 palabras preferidas
    let profile: UserLanguageProfile = {
      ...baseProfile,
      preferredPreviewCount: 5,
      consecutivePreviewSkips: 0,
    };

    // Omisión 1
    profile = updatePreviewFrictionPreference(profile, false);
    expect(profile.consecutivePreviewSkips).toBe(1);
    expect(profile.preferredPreviewCount).toBe(5);

    // Omisión 2
    profile = updatePreviewFrictionPreference(profile, false);
    expect(profile.consecutivePreviewSkips).toBe(2);
    expect(profile.preferredPreviewCount).toBe(5);

    // Omisión 3: Se alcanza el umbral de fricción -> reduce a 3 palabras
    profile = updatePreviewFrictionPreference(profile, false);
    expect(profile.consecutivePreviewSkips).toBe(3);
    expect(profile.preferredPreviewCount).toBe(3);

    // Interacción del usuario: reinicia el contador de omisiones a 0
    profile = updatePreviewFrictionPreference(profile, true);
    expect(profile.consecutivePreviewSkips).toBe(0);
    expect(profile.preferredPreviewCount).toBe(3);
  });

  it("recordSilentCalibration ejecuta de forma segura los eventos 'lookup' y 'save'", () => {
    expect(() => recordSilentCalibration("casa", "lookup", "es")).not.toThrow();
    expect(() => recordSilentCalibration("perenne", "save", "es")).not.toThrow();
  });
});


