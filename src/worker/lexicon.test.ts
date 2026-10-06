import { describe, expect, it } from "vitest";
import {
  insertEnrichment,
  pendingEnrichmentJobs,
  sampleForCalibration,
  type LexiconEntryView,
} from "./lexicon";
import {
  CALIBRATION_BANK,
  CALIBRATION_PER_BAND,
} from "../shared/calibration-bank";

const entry = (over: Partial<LexiconEntryView>): LexiconEntryView => ({
  entryId: null,
  lemma: "lema",
  pos: null,
  freqRank: null,
  zipf: null,
  senses: [],
  ...over,
});

const sense = { definition: "Definición útil.", example: null, senseOrder: 1 };

describe("pendingEnrichmentJobs", () => {
  it("omite formas cubiertas por una acepción no vacía", () => {
    const jobs = pendingEnrichmentJobs(
      ["casa", "fantasma"],
      {
        casa: [entry({ entryId: "1", lemma: "casa", senses: [sense] })],
      },
    );
    expect(jobs).toEqual([{ form: "fantasma", entryId: null }]);
  });

  it("una entrada sin acepciones sigue pendiente", () => {
    const jobs = pendingEnrichmentJobs(
      ["abajo"],
      { abajo: [entry({ entryId: "3", lemma: "abajar" })] },
    );
    expect(jobs).toEqual([{ form: "abajo", entryId: "3" }]);
  });

  it("deduplica varias formas que apuntan a la misma entrada", () => {
    const shared = entry({ entryId: "7", lemma: "perenne" });
    const jobs = pendingEnrichmentJobs(
      ["perenne", "perennes", "fantasma", "PERENNE"],
      {
        perenne: [shared],
        perennes: [shared],
      },
    );
    expect(jobs).toEqual([
      { form: "perenne", entryId: "7" },
      { form: "fantasma", entryId: null },
    ]);
  });

  it("no confunde una definición vacía con cobertura", () => {
    const jobs = pendingEnrichmentJobs(
      ["vacia"],
      { vacia: [entry({ senses: [{ definition: "  ", example: null, senseOrder: 1 }] })] },
    );
    expect(jobs).toEqual([{ form: "vacia", entryId: null }]);
  });
});

describe("insertEnrichment", () => {
  it("vincula la forma consultada aunque el modelo devuelva otro lema", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes("FROM") && sql.includes("lexicon_entries"))
          return { rows: [] };
        if (sql.includes("INSERT INTO") && sql.includes("lexicon_entries"))
          return { rows: [{ id: "42" }] };
        return { rows: [] };
      },
    };

    await insertEnrichment(
      client as never,
      "es",
      {
        lemma: "adusto",
        pos: "adjetivo",
        freqRank: null,
        forms: ["adusto", "adustos"],
        senses: [{ definition: "Severo o seco.", example: "Un semblante adusto." }],
      },
      "adusta",
    );

    const formInserts = calls.filter(
      ({ sql }) => sql.includes("INSERT INTO") && sql.includes("lexicon_forms"),
    );
    expect(formInserts.map(({ params }) => params[1])).toEqual(
      expect.arrayContaining(["adusta", "adusto", "adustos"]),
    );
  });
});

describe("sampleForCalibration", () => {
  // zipf dentro de la banda declarada de cada lema del banco.
  const zipfInBand = (lemma: string) => {
    const band = CALIBRATION_BANK.findIndex((list) => list.includes(lemma));
    if (band < 0) throw new Error(`${lemma} no está en el banco`);
    return 2.0 + band * 0.5 + 0.2;
  };
  const row = (lemma: string, over: Record<string, unknown> = {}) => ({
    id: "1",
    lemma,
    pos: null,
    zipf: zipfInBand(lemma),
    definition: `definición de ${lemma}`,
    def_count: 1,
    ...over,
  });
  const clientWith = (rows: Record<string, unknown>[]) =>
    ({ query: async () => ({ rows }) }) as never;

  it("sin definición, sin medición o fuera de banda no entra", async () => {
    const words = await sampleForCalibration(
      clientWith([
        row("subyugar"),
        row("zancada", { zipf: 3.9 }), // medido fuera de su banda
        row("hibernar", { zipf: null }),
        row("injertar", { definition: null }),
      ]),
      "es",
    );
    expect(words.map((w) => w.lemma)).toEqual(["subyugar"]);
    expect(words[0].definition).toBe("definición de subyugar");
  });

  it("una banda corta da menos sin rellenar de otras", async () => {
    // Toda la muestra disponible es un solo lema elegible.
    const words = await sampleForCalibration(clientWith([row("purpúreo")]), "es");
    expect(words).toHaveLength(1);
  });

  it("con el banco completo la muestra queda en 18 (3 por banda)", async () => {
    const rows = CALIBRATION_BANK.flatMap((lemmas) =>
      lemmas.map((lemma) => row(lemma)),
    );
    const words = await sampleForCalibration(clientWith(rows), "es");
    expect(words).toHaveLength(CALIBRATION_BANK.length * CALIBRATION_PER_BAND);
    // Reparte parejo: no hay banda con más de lo suyo.
    const inBand = (lemma: string) =>
      CALIBRATION_BANK.findIndex((list) => list.includes(lemma));
    for (let band = 0; band < CALIBRATION_BANK.length; band++) {
      expect(
        words.filter((w) => inBand(w.lemma) === band).length,
      ).toBeLessThanOrEqual(CALIBRATION_PER_BAND);
    }
  });

  it("a empate de acepciones el homónimo decide por id, no por orden de SQL", async () => {
    // Dos fichas de «cuarto» con el mismo def_count: gana la de menor
    // id, lleguen en el orden que lleguen.
    const a = row("cuarto", { id: "900", def_count: 3, definition: "habitación" });
    const b = row("cuarto", { id: "12", def_count: 3, definition: "cuarta parte" });
    for (const rows of [
      [a, b],
      [b, a],
    ]) {
      const words = await sampleForCalibration(clientWith(rows), "es");
      expect(words).toHaveLength(1);
      expect(words[0].definition).toBe("cuarta parte");
    }
    // Y con más acepciones sí gana la ficha dominante.
    const words = await sampleForCalibration(
      clientWith([row("cuarto", { id: "900", def_count: 5, definition: "habitación" }), b]),
      "es",
    );
    expect(words[0].definition).toBe("habitación");
  });
});
