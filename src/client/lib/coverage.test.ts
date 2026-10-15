import { describe, expect, it, vi } from "vitest";
import {
  coverageLabel,
  coverageOfBook,
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

  it("libro vacío no divide entre cero", () => {
    expect(coverageOfBook([], {}, inputs()).percent).toBe(0);
  });
});

describe("coverageLabel & affinityBadgeLabel", () => {
  it("anuncia la banda solo con confianza suficiente", () => {
    expect(coverageLabel(92, "high")).toBe("En tu nivel");
    expect(coverageLabel(92, "low")).toBeNull();
    expect(coverageLabel(80, "mid")).toBe("Asequible");
    expect(coverageLabel(65, "mid")).toBe("Un reto");
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
    // Un conocido frecuente + un desconocido raro: el umbral queda
    // entre ambos y la confianza es baja con dos filas de evidencia.
    expect(inputs.threshold).toBeGreaterThan(2.0);
    expect(inputs.confidence).toBe("low");
    expect(inputs.evidenceCount).toBe(2);
  });

  it("sin evidencia el umbral cae al base y la confianza es low", async () => {
    idbState.knowledge = [];
    idbState.words = [];
    lexiconMock.entries = {};

    const inputs = await inputsForCoverage("es");
    expect(inputs.threshold).toBe(3.0);
    expect(inputs.confidence).toBe("low");
    expect(inputs.evidenceCount).toBe(0);
  });
});
