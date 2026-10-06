// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Vocabulary from "./Vocabulary";
import {
  fillSavedWordMeaning,
  listSavedWords,
  saveKnowledge,
  updateSavedWord,
  type SavedWord,
} from "../lib/idb";
import { enrichWord } from "../lib/lexicon";
import { backfillWordMeanings } from "../lib/word-meanings";
import { loadUseAi } from "../lib/ai-pref";
import { saveSessionValue } from "../lib/idb";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { pushWordsToServer } from "../lib/vocab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    listSavedWords: vi.fn(async () => []),
    listKnowledge: vi.fn(async () => []),
    listAnnotations: vi.fn(async () => []),
    loadSessionValue: vi.fn(async () => null),
    saveSessionValue: vi.fn(async () => undefined),
    saveKnowledge: vi.fn(async (row: Record<string, unknown>) => ({
      key: `${row.language}:${row.lemma}`,
      updatedAt: 1,
      ...row,
    })),
    getActiveUserId: vi.fn(() => "u-test"),
    updateSavedWord: vi.fn(async (word: SavedWord) => word),
    fillSavedWordMeaning: vi.fn(async () => null),
    removeSavedWord: vi.fn(async () => undefined),
    putSavedWord: vi.fn(async (word: SavedWord) => word),
  };
});
vi.mock("../lib/lexicon", () => ({
  batchLookup: vi.fn(async () => ({ ok: true, entries: {} })),
  enrichWord: vi.fn(async () => ({ ok: true, found: true, entries: [] })),
  fetchItems: vi.fn(async () => ({ ok: true, items: [] })),
  answerItem: vi.fn(async () => true),
  verifySentence: vi.fn(async () => ({ ok: true, correct: true, feedback: "" })),
}));
vi.mock("../lib/word-meanings", () => ({
  backfillWordMeanings: vi.fn(async (words: SavedWord[]) => words),
  planMeaningBackfill: vi.fn(() => null),
}));
vi.mock("../lib/ai-pref", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ai-pref")>()),
  loadUseAi: vi.fn(async () => true),
}));
vi.mock("../lib/reading-sync", () => ({
  pushKnowledgeToServer: vi.fn(async () => true),
}));
vi.mock("../lib/vocab", () => ({
  pushWordsToServer: vi.fn(async () => true),
  removeWord: vi.fn(async () => true),
}));
vi.mock("./GamePanel", () => ({ GamePanel: () => null }));
vi.mock("./ReadingActivity", () => ({ default: () => null }));

const listWordsMock = vi.mocked(listSavedWords);
const saveKnowledgeMock = vi.mocked(saveKnowledge);
const updateWordMock = vi.mocked(updateSavedWord);
const fillMock = vi.mocked(fillSavedWordMeaning);
const enrichMock = vi.mocked(enrichWord);
const useAiMock = vi.mocked(loadUseAi);
const saveSessionMock = vi.mocked(saveSessionValue);
const backfillMock = vi.mocked(backfillWordMeanings);

const word = (over: Partial<SavedWord> = {}): SavedWord => ({
  key: `es:${over.form ?? "casa"}`,
  language: "es",
  form: "casa",
  lemma: "casa",
  savedAt: 1,
  updatedAt: 1,
  ...over,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  listWordsMock.mockResolvedValue([]);
  backfillMock.mockImplementation(async (words: SavedWord[]) => words);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = () =>
  act(async () => {
    root.render(h(Vocabulary, { onClose: vi.fn(), books: [] }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (label: string) =>
  act(async () => {
    button(label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

describe("Aprender", () => {
  it("ofrece la sección solo con pendientes y abre la ficha guiada", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    expect(text()).toContain("Por aprender · 1");
    await click("Aprender");
    expect(text()).toContain("Primera exposición");
    expect(text()).toContain("casa");
    expect(button("Mostrar significado")).toBeTruthy();
    expect(text()).not.toContain("hogar");
  });

  it("no muestra la sección sin palabras pendientes", async () => {
    listWordsMock.mockResolvedValue([]);
    await render();
    expect(text()).not.toContain("Por aprender");
  });

  it("«Ya la conozco» escribe evidencia declarada y la saca de la cola", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(saveKnowledgeMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ known: true, source: "declared", lemma: "casa" }),
    );
    expect(pushKnowledgeToServer).toHaveBeenCalled();
    expect(saveSessionMock).toHaveBeenCalled();
    expect(text()).toContain("Aprender terminado");
    // La palabra conocida ya no sale como «para hoy» en el contador.
    await click("Ver el cuaderno");
    expect(text()).toContain("1 guardadas · 0 para hoy");
  });

  it("«Quiero aprenderla» crea la card que la trae al repaso hoy", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Aprender");
    await click("Mostrar significado");
    await click("Quiero aprenderla");
    expect(updateWordMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ key: "es:casa", card: expect.anything() }),
    );
    expect(pushWordsToServer).toHaveBeenCalled();
    expect(text()).toContain("Aprender terminado");
  });

  it("sin significado ofrece «Definir con IA» y rellena por sello", async () => {
    listWordsMock.mockResolvedValue([word()]);
    enrichMock.mockResolvedValue({
      ok: true,
      found: true,
      entries: [
        {
          lemma: "casa",
          pos: "sustantivo",
          entryId: "7",
          freqRank: null,
          senses: [{ senseOrder: 1, definition: "hogar", example: null }],
          zipf: null,
        },
      ],
    });
    fillMock.mockResolvedValue(word({ meaning: "hogar" }));
    await render();
    await click("Aprender");
    await click("Mostrar significado");
    expect(text()).toContain("Sin significado guardado");
    // Sin significado no puede entrar al repaso.
    expect(button("Quiero aprenderla")?.disabled).toBe(true);
    await click("Definir con IA");
    expect(enrichMock).toHaveBeenCalled();
    expect(fillMock.mock.calls[0].slice(0, 3)).toEqual([
      "es:casa",
      1,
      expect.objectContaining({ meaning: "hogar" }),
    ]);
  });

  it("con la IA apagada no ofrece el botón y avisa", async () => {
    useAiMock.mockResolvedValue(false);
    listWordsMock.mockResolvedValue([word()]);
    await render();
    await click("Aprender");
    await click("Mostrar significado");
    expect(button("Definir con IA")).toBeUndefined();
    expect(text()).toContain("definiciones con IA están apagadas");
    // «Ya la conozco» sigue disponible sin definición.
    expect(button("Ya la conozco")?.disabled).toBe(false);
  });

  it("un fallo al guardar muestra error y no avanza", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    saveKnowledgeMock.mockRejectedValueOnce(new Error("boom"));
    await render();
    await click("Aprender");
    await click("Mostrar significado");
    await click("Ya la conozco");
    expect(text()).toContain("No se pudo guardar");
    expect(text()).toContain("Primera exposición");
  });

  it("una palabra ya repasada no entra a la cola", async () => {
    listWordsMock.mockResolvedValue([
      word({ meaning: "hogar", card: { reps: 2, stability: 3 } as never }),
    ]);
    await render();
    expect(text()).not.toContain("Por aprender");
  });
});
