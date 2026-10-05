import { describe, expect, it } from "vitest";
import {
  insertEnrichment,
  pendingEnrichmentJobs,
  type LexiconEntryView,
} from "./lexicon";

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
        if (sql.includes("FROM lexicon_entries")) return { rows: [] };
        if (sql.includes("INSERT INTO lexicon_entries")) return { rows: [{ id: "42" }] };
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

    const formInserts = calls.filter(({ sql }) => sql.includes("INSERT INTO lexicon_forms"));
    expect(formInserts.map(({ params }) => params[1])).toEqual(
      expect.arrayContaining(["adusta", "adusto", "adustos"]),
    );
  });
});
