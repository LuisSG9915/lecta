import { describe, expect, it, vi } from "vitest";
import {
  coverageIsReliable,
  coverageLabel,
  coverageLanguageOf,
  compareBookCoverages,
  coverageOfBook,
  createCoverageInputsLoader,
  inputsForCoverage,
  type CoverageInputs,
} from "./coverage";
import { predictSection } from "./knowledge";
import type { LexiconEntry } from "./lexicon";
import type { KnownWord, SavedWord } from "./idb";

const idbState = vi.hoisted(() => ({
  knowledge: [] as KnownWord[],
  words: [] as SavedWord[],
  session: new Map<string, string>(),
}));
const lexiconMock = vi.hoisted(() => ({
  entries: {} as Record<string, LexiconEntry[]>,
}));

vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    listKnowledge: vi.fn(async () => idbState.knowledge),
    listSavedWords: vi.fn(async () => idbState.words),
    loadSessionValue: vi.fn(async (key: string) => idbState.session.get(key) ?? null),
  };
});
vi.mock("./lexicon", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./lexicon")>();
  return {
    ...mod,
    batchLookup: vi.fn(async (forms: string[]) => ({
      ok: true as const,
      entries: Object.fromEntries(
        forms.map((form) => [form, lexiconMock.entries[form] ?? []]),
      ),
    })),
  };
});

const entry = (
  lemma: string,
  zipf: number | null,
  pos = "sustantivo",
): LexiconEntry => ({
  entryId: `id-${lemma}`,
  lemma,
  pos,
  freqRank: null,
  zipf,
  senses: [],
});

const inputs = (over: Partial<CoverageInputs> = {}): CoverageInputs => ({
  saved: new Set(),
  knowledge: new Map(),
  threshold: 3.0,
  confidence: "mid",
  evidenceCount: 40,
  ...over,
});

describe("coverageOfBook", () => {
  it("cuenta lo cubierto como predictSection: saved + conocidas sobre el total", () => {
    const forms = ["casa", "perenne", "corrió", "galaxia"];
    const entriesByForm = {
      casa: [entry("casa", 6.1)],
      perenne: [entry("perenne", 2.1)],
      corrió: [entry("correr", 4.5)],
      galaxia: [entry("galaxia", 3.4)],
    };
    const input = inputs({ saved: new Set(["galaxia"]) });

    const coverage = coverageOfBook(forms, entriesByForm, input);
    const direct = predictSection(
      forms,
      entriesByForm,
      input.saved,
      input.knowledge,
      input.threshold,
    );

    const expected = Math.round(
      ((direct.savedCount + direct.knownCount) / direct.total) * 100,
    );
    expect(coverage.percent).toBe(expected);
    expect(coverage.total).toBe(direct.total);
    // casa y corrió (zipf ≥ 3) conocidas, galaxia guardada, perenne
    // predicha → 3 de 4 cubierto.
    expect(coverage.percent).toBe(75);
    // Galaxia es la única forma del Cuaderno que reaparece en el libro.
    expect(coverage.reencuentrosCount).toBe(1);
  });

  it("las formas sin ficha cuentan en total y se reportan como missing", () => {
    const forms = ["casa", "xing"];
    const coverage = coverageOfBook(
      forms,
      { casa: [entry("casa", 6)] },
      inputs(),
    );
    expect(coverage.total).toBe(2);
    expect(coverage.missing).toBe(1);
    expect(coverage.percent).toBe(50);
  });

  it("respeta las bases derivadas en entriesByForm (-mente, enclíticos)", () => {
    const forms = ["perfectamente", "abrirlo"];
    const entriesByForm = {
      perfectamente: [],
      perfecto: [entry("perfecto", 5.0, "adjetivo")],
      abrirlo: [],
      abrir: [entry("abrir", 6.5, "verbo")],
    };
    const coverage = coverageOfBook(forms, entriesByForm, inputs());
    expect(coverage.missing).toBe(0);
    expect(coverage.percent).toBe(100);
  });

  it("reencuentros cuentan lemas únicos del cuaderno: varias conjugaciones suman una", () => {
    const forms = ["corrió", "corrieron", "correrá", "casa"];
    const entriesByForm = {
      corrió: [entry("correr", 4.5, "verbo")],
      corrieron: [entry("correr", 4.5, "verbo")],
      correrá: [entry("correr", 4.5, "verbo")],
      casa: [entry("casa", 6.1)],
    };
    const coverage = coverageOfBook(
      forms,
      entriesByForm,
      inputs({ saved: new Set(["correr"]) }),
    );
    expect(coverage.percent).toBe(100);
    expect(coverage.reencuentrosCount).toBe(1);
  });

  it("el reencuentro ponderado suma las apariciones de los lemas del cuaderno", () => {
    const entriesByForm = {
      corrió: [entry("correr", 4.5, "verbo")],
      corrieron: [entry("correr", 4.5, "verbo")],
      casa: [entry("casa", 6.1)],
    };
    const coverage = coverageOfBook(
      ["corrió", "corrieron", "casa"],
      entriesByForm,
      inputs({ saved: new Set(["correr"]) }),
      { corrió: 2, corrieron: 1, casa: 4 },
    );
    expect(coverage.reencuentrosCount).toBe(1);
    expect(coverage.reencuentrosPonderados).toBe(3);
  });

  it("sin conteos, cada lema vale una aparición aunque tenga varias formas", () => {
    const entriesByForm = {
      corrió: [entry("correr", 4.5, "verbo")],
      corrieron: [entry("correr", 4.5, "verbo")],
    };
    const coverage = coverageOfBook(
      ["corrió", "corrieron"],
      entriesByForm,
      inputs({ saved: new Set(["correr"]) }),
    );
    expect(coverage.reencuentrosCount).toBe(1);
    expect(coverage.reencuentrosPonderados).toBe(1);
  });

  it("entre libros en tu nivel gana el que más apariciones del cuaderno repite", () => {
    const pocas = { percent: 90, total: 10, missing: 0, uncertain: 0, measuredShare: 1, reencuentrosCount: 3, reencuentrosPonderados: 3 };
    const muchas = { percent: 90, total: 10, missing: 0, uncertain: 0, measuredShare: 1, reencuentrosCount: 2, reencuentrosPonderados: 12 };
    expect([pocas, muchas].sort(compareBookCoverages)[0]).toBe(muchas);
  });

  it("un libro que el catálogo no pudo medir va después de uno medible", () => {
    const medible = { percent: 50, total: 10, missing: 0, uncertain: 0, measuredShare: 0.9 };
    const sinMedir = { percent: 95, total: 10, missing: 9, uncertain: 0, measuredShare: 0.1 };
    expect([sinMedir, medible].sort(compareBookCoverages)[0]).toBe(medible);
  });

  it("libro vacío no divide entre cero", () => {
    const vacio = coverageOfBook([], {}, inputs());
    expect(vacio.percent).toBe(0);
    expect(vacio.measuredShare).toBe(0);
    expect(coverageIsReliable(vacio)).toBe(false);
  });
});

describe("measuredShare — porcentaje honesto", () => {
  it("descuenta del medido las formas sin ficha y las sin medición", () => {
    const forms = ["casa", "perenne", "xing", "zzz"];
    const entriesByForm = {
      casa: [entry("casa", 6.1)],
      perenne: [entry("perenne", 2.1)],
      // xing y zzz sin ficha: missing
    };
    const coverage = coverageOfBook(forms, entriesByForm, inputs());
    // 2 de 4 formas medidas (casa y perenne) → 0.5.
    expect(coverage.measuredShare).toBe(0.5);
    expect(coverage.missing).toBe(2);
    expect(coverageIsReliable(coverage)).toBe(false);
  });

  it("un libro casi entero sin ficha no es «0 % conocido»: no es medible", () => {
    // El caso real del reporte: libro en inglés sin catálogo — las
    // formas caen a missing y el porcentaje crudo diría ~0 %.
    const forms = ["water", "friend", "house", "window", "casa"];
    const entriesByForm = { casa: [entry("casa", 6.1)] };
    const coverage = coverageOfBook(forms, entriesByForm, inputs());
    expect(coverage.percent).toBe(20);
    expect(coverage.measuredShare).toBeCloseTo(0.2, 5);
    expect(coverageIsReliable(coverage)).toBe(false);
  });

  it("con todo medido es confiable y el guardia toma el 0.6 exacto", () => {
    const forms = ["casa", "perenne", "corrió", "galaxia", "sol"];
    const entriesByForm = {
      casa: [entry("casa", 6.1)],
      perenne: [entry("perenne", 2.1)],
      corrió: [entry("correr", 4.5)],
      galaxia: [entry("galaxia", 3.4)],
      sol: [entry("sol", 5.9)],
    };
    const coverage = coverageOfBook(forms, entriesByForm, inputs());
    expect(coverage.measuredShare).toBe(1);
    expect(coverageIsReliable(coverage)).toBe(true);

    expect(coverageIsReliable({ measuredShare: 0.6 })).toBe(true);
    expect(coverageIsReliable({ measuredShare: 0.59 })).toBe(false);
  });
});

describe("coverageLabel & affinityBadgeLabel", () => {
  it("anuncia la banda solo con confianza suficiente", () => {
    expect(coverageLabel(95, "high")).toBe("Lectura relajada");
    expect(coverageLabel(92, "low")).toBeNull();
    expect(coverageLabel(90, "mid")).toBe("Ideal para tu ritmo");
    expect(coverageLabel(75, "mid")).toBe("Un reto");
    expect(coverageLabel(40, "mid")).toBe("Exigente");
  });

  it("calcula los badges de afinidad según porcentaje (A.2)", async () => {
    const { affinityBadgeLabel, affinityTierOf } = await import("./coverage");
    expect(affinityTierOf(96)).toBe("fluida");
    expect(affinityBadgeLabel(96)).toBe("Lectura Fluida");

    expect(affinityTierOf(91)).toBe("reto");
    expect(affinityBadgeLabel(91)).toBe("Reto Ideal (i+1)");

    expect(affinityTierOf(84)).toBe("rico");
    expect(affinityBadgeLabel(84)).toBe("Rico en Vocabulario");
  });
});

describe("inputsForCoverage", () => {
  it("arma el perfil con las mismas fuentes que el lector", async () => {
    idbState.knowledge = [
      { key: "es:casa", language: "es", lemma: "casa", known: true, source: "explicit", updatedAt: 1 },
      { key: "es:perenne", language: "es", lemma: "perenne", known: false, source: "explicit", updatedAt: 1 },
    ];
    idbState.words = [
      { key: "es:galaxia", form: "Galaxia", lemma: "galaxia", language: "es", savedAt: 1 },
    ];
    lexiconMock.entries = {
      casa: [entry("casa", 6.1)],
      perenne: [entry("perenne", 2.1)],
    };

    const inputs = await inputsForCoverage("es");

    expect(inputs.saved.has("galaxia")).toBe(true);
    expect(inputs.knowledge.get("casa")?.known).toBe(true);
    expect(inputs.knowledge.get("perenne")?.known).toBe(false);
    // Un conocido frecuente + un desconocido raro son coherentes con
    // el base nativo (2.0): el umbral no tiene motivo para moverse y
    // la confianza es baja con dos filas de evidencia.
    expect(inputs.threshold).toBe(2.0);
    expect(inputs.confidence).toBe("low");
    expect(inputs.evidenceCount).toBe(2);
  });

  it("sin evidencia el umbral cae al base del perfil y la confianza es low", async () => {
    idbState.knowledge = [];
    idbState.words = [];
    lexiconMock.entries = {};

    // Español para un hispanohablante parte del base nativo (2.0),
    // igual que el lector; antes la insignia usaba siempre 3.0.
    const inputs = await inputsForCoverage("es");
    expect(inputs.threshold).toBe(2.0);
    expect(inputs.confidence).toBe("low");
    expect(inputs.evidenceCount).toBe(0);

    // En inglés (segunda lengua) el base es el de aprendiz (3.0).
    const inputsEn = await inputsForCoverage("en");
    expect(inputsEn.threshold).toBe(3.0);
    expect(inputsEn.evidenceCount).toBe(0);
  });

  it("la evidencia en inglés sin ficha en el catálogo cae al zipf del banco", async () => {
    idbState.knowledge = [
      { key: "en:whisper", language: "en", lemma: "whisper", known: false, source: "calibration", updatedAt: 1 },
      { key: "en:wander", language: "en", lemma: "wander", known: false, source: "calibration", updatedAt: 1 },
      { key: "en:delight", language: "en", lemma: "delight", known: false, source: "calibration", updatedAt: 1 },
      { key: "en:water", language: "en", lemma: "water", known: true, source: "calibration", updatedAt: 1 },
      { key: "en:friend", language: "en", lemma: "friend", known: true, source: "calibration", updatedAt: 1 },
    ];
    idbState.words = [];
    // Sin fichas en el catálogo inglés: solo el banco da el zipf.
    lexiconMock.entries = {};

    const inputs = await inputsForCoverage("en");

    expect(inputs.knowledge.get("whisper")?.known).toBe(false);
    expect(inputs.knowledge.get("water")?.known).toBe(true);
    // Tres desconocidas en 3.25 (banda del banco) mueven el umbral del
    // base de aprendiz (3.0) hacia arriba — antes, sin el idioma, el
    // zipf quedaba null y la evidencia no movía nada.
    expect(inputs.evidenceCount).toBe(5);
    expect(inputs.threshold).toBe(3.5);
    expect(inputs.confidence).toBe("low");
  });
});

describe("coverageLanguageOf", () => {
  it("reduce la etiqueta del libro a dos letras; sin idioma asume es", () => {
    expect(coverageLanguageOf(undefined)).toBe("es");
    expect(coverageLanguageOf("en-US")).toBe("en");
    expect(coverageLanguageOf("ES")).toBe("es");
  });
});

describe("createCoverageInputsLoader", () => {
  it("lee el perfil una sola vez por idioma, aunque se pida repetido", async () => {
    const asked: string[] = [];
    const load = vi.fn(async (language: string) => {
      asked.push(language);
      return inputs({ confidence: "high" });
    });
    const inputsFor = createCoverageInputsLoader(undefined, load);

    const first = await inputsFor("es");
    const second = await inputsFor("es-MX");
    const english = await inputsFor("en");

    expect(first?.confidence).toBe("high");
    expect(second).toBe(first);
    expect(english).not.toBe(first);
    // «es» y «es-MX» caen en la misma llave; «en» es otra lectura.
    expect(asked).toEqual(["es", "en"]);
  });

  it("un fallo deja ese idioma sin perfil y no lanza", async () => {
    const load = vi.fn(async () => {
      throw new Error("sin catálogo");
    });
    const inputsFor = createCoverageInputsLoader(undefined, load);

    await expect(inputsFor("en")).resolves.toBeNull();
  });
});
