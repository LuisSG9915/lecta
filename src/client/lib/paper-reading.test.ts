// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contextIfPresent,
  firstAppearance,
  groupPaperChapters,
  loadPaperReading,
  PAPER_MAIN_ROWS,
  paperChapterStatus,
  paperReadingKey,
  parsePaperReadingRecord,
  savePaperReading,
  splitPaperRows,
  suggestManualForms,
  type PaperReadingRecord,
} from "./paper-reading";
import type { ChapterCatalog, ChapterTarget } from "./chapters";
import type { PreparationRecord } from "./preparation";
import type { SuggestionRow, SuggestionRows } from "./section-words";

const store = vi.hoisted(() => new Map<string, string>());

vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    loadSessionValue: vi.fn(async (key: string) => store.get(key) ?? null),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

const record = (extra: Partial<PaperReadingRecord> = {}): PaperReadingRecord => ({
  version: 1,
  bookHash: "h1",
  readTargetIds: [],
  lastTargetId: null,
  updatedAt: 1000,
  ...extra,
});

describe("parsePaperReadingRecord", () => {
  it("acepta un registro válido y copia el arreglo", () => {
    const parsed = parsePaperReadingRecord(
      JSON.stringify(record({ readTargetIds: ["a"], lastTargetId: "a" })),
      "h1",
    );
    expect(parsed?.readTargetIds).toEqual(["a"]);
    expect(parsed?.lastTargetId).toBe("a");
    expect(parsed).not.toBeNull();
  });

  it("rechaza vacío, JSON roto y cualquier campo inválido", () => {
    const bad = [
      null,
      undefined,
      "{roto",
      JSON.stringify({ ...record(), version: 2 }),
      JSON.stringify(record({ bookHash: "otro" })),
      JSON.stringify(record({ readTargetIds: "a" as never })),
      JSON.stringify(record({ readTargetIds: ["a", 3] as never })),
      JSON.stringify(record({ readTargetIds: ["a", ""] })),
      JSON.stringify(record({ lastTargetId: 4 as never })),
      JSON.stringify(record({ updatedAt: "hoy" as never })),
    ];
    for (const raw of bad) expect(parsePaperReadingRecord(raw, "h1")).toBeNull();
  });
});

describe("loadPaperReading / savePaperReading", () => {
  beforeEach(() => store.clear());

  it("guarda y recupera el registro por su clave versionada", async () => {
    await savePaperReading(record({ lastTargetId: "cap2" }));
    expect(store.has(paperReadingKey("h1"))).toBe(true);
    const loaded = await loadPaperReading("h1");
    expect(loaded?.lastTargetId).toBe("cap2");
  });

  it("sin registro o con JSON roto devuelve null", async () => {
    expect(await loadPaperReading("h1")).toBeNull();
    store.set(paperReadingKey("h1"), "{roto");
    expect(await loadPaperReading("h1")).toBeNull();
  });
});

const target = (id: string, kind: ChapterTarget["kind"]): ChapterTarget => ({
  id,
  label: id,
  href: `${id}.xhtml`,
  sectionIndex: 0,
  depth: 0,
  kind,
});

const catalog = (kinds: ChapterTarget["kind"][]): ChapterCatalog => ({
  targets: kinds.map((kind, i) => target(`t${i}`, kind)),
  ranges: [],
});

describe("groupPaperChapters", () => {
  it("chapter y uncertain van a la lista; preliminares y anexos se apartan", () => {
    const groups = groupPaperChapters(
      catalog(["frontmatter", "preliminary", "chapter", "chapter", "uncertain", "other"]),
    );
    expect(groups.reading.map((t) => t.id)).toEqual(["t2", "t3", "t4"]);
    expect(groups.extras.map((t) => t.id)).toEqual(["t0", "t1", "t5"]);
  });

  it("si no hay destinos de lectura todos van a la lista principal", () => {
    const groups = groupPaperChapters(catalog(["frontmatter", "other"]));
    expect(groups.reading).toHaveLength(2);
    expect(groups.extras).toHaveLength(0);
  });
});

const prep = (
  disposition: PreparationRecord["disposition"],
  answers: PreparationRecord["answers"] = {},
): PreparationRecord => ({
  version: 1,
  bookHash: "h1",
  targetId: "cap1",
  disposition,
  answers,
  entryAcknowledged: false,
  updatedAt: 1,
});

describe("paperChapterStatus", () => {
  it("«leído» gana sobre «preparado»", () => {
    const status = paperChapterStatus(
      "cap1",
      prep("reviewed", { k1: "unknown" }),
      record({ readTargetIds: ["cap1"] }),
    );
    expect(status).toEqual({ status: "read", unknownCount: 1 });
  });

  it("reviewed cuenta solo las respuestas «No la conozco»", () => {
    const status = paperChapterStatus(
      "cap1",
      prep("reviewed", { k1: "unknown", k2: "known", k3: "unknown" }),
      null,
    );
    expect(status).toEqual({ status: "prepared", unknownCount: 2 });
  });

  it("borradores y skipped cuentan como sin revisar", () => {
    expect(paperChapterStatus("cap1", prep("pending"), null).status).toBe("new");
    expect(paperChapterStatus("cap1", prep("skipped"), null).status).toBe("new");
    expect(paperChapterStatus("cap1", null, null).status).toBe("new");
  });
});

describe("firstAppearance", () => {
  const text = "La heladera enfriaba la casa. Luego, la casa ardió.";

  it("devuelve el índice de la primera aparición sin distinguir mayúsculas", () => {
    expect(firstAppearance(text, "la")).toBe(0);
    expect(firstAppearance(text, "CASA")).toBe(24);
  });

  it("no cuenta la forma dentro de otra palabra", () => {
    expect(firstAppearance("la heladera", "heladera")).toBe(3);
    expect(firstAppearance("la heladera", "era")).toBe(-1);
  });

  it("entradas vacías devuelven -1", () => {
    expect(firstAppearance("", "casa")).toBe(-1);
    expect(firstAppearance(text, "")).toBe(-1);
  });
});

describe("contextIfPresent", () => {
  it("palabra presente devuelve la frase donde aparece", () => {
    const snippet = contextIfPresent("Vio la casa. Siguió.", "casa");
    expect(snippet).toContain("casa");
  });

  it("palabra ausente devuelve undefined — nunca el inicio del capítulo", () => {
    const text = "Inicio del capítulo con otras palabras completamente distintas.";
    expect(contextIfPresent(text, "esternocleidomastoideo")).toBeUndefined();
  });
});

const row = (form: string): SuggestionRow => ({
  key: `es:${form}`,
  form,
  lemma: form,
  meaning: undefined,
  context: undefined,
  reason: "rarity",
});

const suggestion = (forms: string[], deferred: string[] = [], uncertain: string[] = []): SuggestionRows => ({
  rows: forms.map(row),
  deferred: deferred.map(row),
  uncertain: uncertain.map(row),
});

describe("splitPaperRows", () => {
  it(`las ${PAPER_MAIN_ROWS} principales van en orden de aparición en el capítulo`, () => {
    const forms = Array.from({ length: PAPER_MAIN_ROWS + 4 }, (_, i) => `w${i}`);
    const text = forms
      .slice()
      .reverse()
      .join(" ");
    const split = splitPaperRows(suggestion(forms), text);
    // Las 12 primeras de la selección, en el orden en que aparecen en el
    // texto invertido: w11 primero … w0 al final.
    expect(split.main.map((r) => r.form)).toEqual(forms.slice(0, PAPER_MAIN_ROWS).reverse());
    // «más» conserva el orden de la selección (w12…w15), sin reordenar.
    expect(split.more.map((r) => r.form)).toEqual(forms.slice(PAPER_MAIN_ROWS));
  });

  it("las que no aparecen en el texto van al final sin romper su orden", () => {
    const forms = ["ausente1", "presente", "ausente2"];
    const split = splitPaperRows(suggestion(forms), "solo presente está");
    expect(split.main.map((r) => r.form)).toEqual([
      "presente",
      "ausente1",
      "ausente2",
    ]);
  });

  it("el resto de la selección y las diferidas van a «más»; inciertas aparte", () => {
    const forms = Array.from({ length: PAPER_MAIN_ROWS + 2 }, (_, i) => `w${i}`);
    const split = splitPaperRows(suggestion(forms, ["d1"], ["u1"]), "w0");
    expect(split.more.map((r) => r.form)).toEqual(["w12", "w13", "d1"]);
    expect(split.uncertain.map((r) => r.form)).toEqual(["u1"]);
  });
});

describe("suggestManualForms", () => {
  it("menos de 2 letras no sugiere nada", () => {
    expect(suggestManualForms("c", ["casa"], ["casco"], new Set())).toEqual([]);
  });

  it("el capítulo va primero, luego el libro, sin distinguir acentos", () => {
    const out = suggestManualForms(
      "canc",
      ["canción"],
      ["canciller", "canica"],
      new Set(),
    );
    expect(out[0]).toMatchObject({ form: "canción", inChapter: true });
    expect(out.slice(1).every((s) => !s.inChapter)).toBe(true);
  });

  it("deduplica por minúsculas conservando la marca del capítulo", () => {
    const out = suggestManualForms("cas", ["Casa"], ["casa", "casco"], new Set());
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ form: "Casa", inChapter: true });
  });

  it("marca las ya guardadas y respeta el tope", () => {
    const out = suggestManualForms("ca", ["casa"], ["cama", "camino"], new Set(["casa"]), 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ form: "casa", saved: true });
    expect(out[1]).toMatchObject({ form: "cama", saved: false });
  });
});
