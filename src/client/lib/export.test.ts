import { describe, expect, it } from "vitest";
import { activityToCsv, passagesToCsv, wordsToCsv, wordsToAnkiTsv } from "./export";
import type { SavedAnnotation, SavedInterval, SavedWord } from "./idb";

const bookName = (hash: string | undefined) =>
  hash === "b1" ? "Cien años de soledad" : undefined;

const base: SavedWord = {
  key: "es:casa",
  form: "casa",
  language: "es",
  savedAt: 1_700_000_000_000,
};

describe("wordsToCsv", () => {
  it("cabecera y fila básica con BOM", () => {
    const csv = wordsToCsv([{ ...base, meaning: "hogar", bookHash: "b1" }], bookName);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Palabra"');
    expect(lines[1]).toBe(
      '"casa","","","hogar","","Cien años de soledad","es","2023-11-14"',
    );
  });

  it("escapa comillas y aplana saltos", () => {
    const csv = wordsToCsv(
      [{ ...base, meaning: 'dijo "sí"\ny se fue', context: "línea1\nlínea2" }],
      bookName,
    );
    const row = csv.split("\r\n")[1];
    expect(row).toContain('"dijo ""sí"" y se fue"');
    expect(row).toContain('"línea1 línea2"');
  });

  it("neutraliza fórmulas", () => {
    const csv = wordsToCsv([{ ...base, form: "=SUMA(1;2)" }], bookName);
    expect(csv).toContain(`"'=SUMA(1;2)"`);
  });
});

describe("wordsToAnkiTsv", () => {
  it("frente, reverso con oración y etiquetas", () => {
    const tsv = wordsToAnkiTsv(
      [{ ...base, meaning: "hogar", context: "La <casa> grande", bookHash: "b1" }],
      bookName,
    );
    expect(tsv).toBe(
      "casa\thogar<br><i>«La &lt;casa&gt; grande»</i><br><small>Cien años de soledad</small>\tes Cien_años_de_soledad",
    );
  });

  it("sin libro ni contexto quedan vacíos", () => {
    const tsv = wordsToAnkiTsv([{ ...base, meaning: "hogar" }], bookName);
    expect(tsv).toBe("casa\thogar\tes");
  });
});

describe("passagesToCsv", () => {
  const passage: SavedAnnotation = {
    key: "b1:p1",
    id: "p1",
    bookHash: "b1",
    kind: "passage",
    sectionIndex: 3,
    text: "El mundo era tan reciente",
    note: "inicio memorable",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  it("exporta pasajes con capítulo y nota, sin libro completo", () => {
    const csv = passagesToCsv([passage], bookName);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Pasaje"');
    expect(lines[1]).toBe(
      '"Cien años de soledad","Capítulo 4","El mundo era tan reciente","inicio memorable","2023-11-14"',
    );
  });

  it("omite marcadores y respeta solo pasajes", () => {
    const csv = passagesToCsv(
      [passage, { ...passage, id: "m1", kind: "bookmark", text: undefined }],
      bookName,
    );
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("activityToCsv", () => {
  const MIN = 60_000;
  const interval = (
    id: string,
    bookHash: string,
    start: number,
    end: number,
  ): SavedInterval => ({ id, bookHash, startedAt: start, endedAt: end });

  it("reparte minutos por fecha y libro, ordenado", () => {
    const start = Date.UTC(2025, 5, 21, 23, 30); // UTC: cruza medianoche
    const csv = activityToCsv(
      [interval("a", "b1", start, start + 60 * MIN)],
      bookName,
      "UTC",
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Minutos"');
    expect(lines[1]).toBe('"2025-06-21","Cien años de soledad","30"');
    expect(lines[2]).toBe('"2025-06-22","Cien años de soledad","30"');
  });

  it("omite filas de menos de un minuto", () => {
    const csv = activityToCsv(
      [interval("a", "b1", Date.UTC(2025, 5, 21, 9), Date.UTC(2025, 5, 21, 9) + 30_000)],
      bookName,
      "UTC",
    );
    expect(csv.split("\r\n")).toHaveLength(1);
  });
});
