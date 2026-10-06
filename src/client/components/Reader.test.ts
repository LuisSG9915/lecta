// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { listAllKnowledge, saveKnowledge, type SavedWord } from "../lib/idb";
import { recordDominated } from "./Reader";

// Solo las llamadas que toca recordDominated; el resto del árbol de
// módulos carga real (epub/zip se importan perezosos al abrir libro).
vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    listAllKnowledge: vi.fn(async () => []),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      ...row,
      key: `es:${String(row.lemma)}`,
      updatedAt: 1,
    })),
  };
});

const listMock = vi.mocked(listAllKnowledge);
const saveMock = vi.mocked(saveKnowledge);

// Tarjeta dominada: repasada y con estabilidad ≥90 días → markLevel null.
const dominatedCard: Card = {
  ...createEmptyCard(new Date("2025-01-01")),
  reps: 3,
  stability: 120,
};

const word = (lemma: string, card?: Card): SavedWord => ({
  key: `es:${lemma}`,
  form: lemma,
  lemma,
  language: "es",
  savedAt: 1,
  card,
});

const known = (lemma: string, extra: Record<string, unknown> = {}) => ({
  key: `es:${lemma}`,
  language: "es",
  lemma,
  known: true,
  source: "declared",
  updatedAt: 1,
  ...extra,
});

describe("recordDominated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([]);
  });

  it("registra una dominada sin fila previa como inferida", async () => {
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).toHaveBeenCalledWith(
      {
        language: "es",
        lemma: "perenne",
        known: true,
        source: "inferred",
      },
      expect.anything(),
    );
  });

  it("no sobrescribe una respuesta explícita «desconocida»", async () => {
    listMock.mockResolvedValue([known("perenne", { known: false })]);
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("no revive una lápida", async () => {
    listMock.mockResolvedValue([known("perenne", { deleted: true })]);
    await recordDominated([word("perenne", dominatedCard)], "es");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("sin tarjeta dominada no escribe nada", async () => {
    await recordDominated(
      [word("casa"), word("mesa", { ...dominatedCard, stability: 10 })],
      "es",
    );
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("un fallo del almacén no rompe la carga", async () => {
    listMock.mockRejectedValue(new Error("idb caído"));
    await expect(
      recordDominated([word("perenne", dominatedCard)], "es"),
    ).resolves.toBeUndefined();
    expect(saveMock).not.toHaveBeenCalled();
  });
});
