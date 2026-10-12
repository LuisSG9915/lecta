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

describe("Filtros por idioma y libro", () => {
  it("muestra selector de idioma si hay palabras en más de un idioma y filtra la lista", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "casa", lemma: "casa", language: "es", key: "es:casa", meaning: "hogar" }),
      word({ form: "wander", lemma: "wander", language: "en", key: "en:wander", meaning: "vagar" }),
    ]);
    await render();
    await click("Palabras");
    expect(button("Todos (2)")).toBeTruthy();
    expect(button("Español (1)")).toBeTruthy();
    expect(button("Inglés (1)")).toBeTruthy();
    const wordsList = () => host.querySelector(".nb-words")?.textContent ?? "";
    expect(wordsList()).toContain("casa");
    expect(wordsList()).toContain("wander");

    await click("Inglés (1)");
    expect(wordsList()).toContain("wander");
    expect(wordsList()).not.toContain("casa");

    await click("Español (1)");
    expect(wordsList()).toContain("casa");
    expect(wordsList()).not.toContain("wander");
  });

  it("permite filtrar palabras por libro específico", async () => {
    const books = [
      { hash: "h-es", name: "libro-es.epub", title: "Libro Español", author: "Autor ES", language: "es" },
      { hash: "h-en", name: "book-en.epub", title: "Book English", author: "Author EN", language: "en" },
    ];
    listWordsMock.mockResolvedValue([
      word({ form: "reloj", lemma: "reloj", bookHash: "h-es", language: "es", meaning: "tiempo" }),
      word({ form: "clock", lemma: "clock", bookHash: "h-en", language: "en", meaning: "time" }),
    ]);
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    await click("Palabras");
    const select = host.querySelector("#nb-book-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const wordsList = () => [...host.querySelectorAll(".nb-words")].map((el) => el.textContent).join(" ");
    expect(wordsList()).toContain("reloj");
    expect(wordsList()).toContain("clock");

    await act(async () => {
      select.value = "h-en";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(wordsList()).toContain("clock");
    expect(wordsList()).not.toContain("reloj");
  });

  it("en overlay tiene role='dialog' y botón volver; en page no tiene role='dialog' ni botón volver", async () => {
    // 1. Overlay (default)
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books: [] }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const overlayNotebook = host.querySelector(".notebook");
    expect(overlayNotebook?.getAttribute("role")).toBe("dialog");
    expect(overlayNotebook?.getAttribute("aria-modal")).toBe("true");
    const backBtn = host.querySelector("button[aria-label='Volver']");
    expect(backBtn).not.toBeNull();

    // 2. Page
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books: [], presentation: "page" }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const pageNotebook = host.querySelector(".notebook");
    expect(pageNotebook?.getAttribute("role")).toBeNull();
    expect(pageNotebook?.getAttribute("aria-modal")).toBeNull();
    const pageBackBtn = host.querySelector("button[aria-label='Volver']");
    expect(pageBackBtn).toBeNull();
  });
});

describe("Reestructura del Cuaderno", () => {
  it("Hoy es la pestaña inicial, muestra Aprender/Repasar y no muestra la lista", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "cantar", lemma: "cantar", meaning: "entonar" }),
    ]);
    await render();
    const activeTab = host.querySelector(".nb-tabs button[aria-pressed='true']");
    expect(activeTab?.textContent).toBe("Hoy");
    expect(text()).toContain("Por aprender · 1");
    expect(host.querySelector(".nb-words")).toBeNull();
  });

  it("El vacío «Estás al día.» aparece cuando no hay pendientes", async () => {
    const futureDue = new Date(Date.now() + 86_400_000 * 2).toISOString();
    listWordsMock.mockResolvedValue([
      word({
        form: "cantar",
        lemma: "cantar",
        meaning: "entonar",
        card: { reps: 2, stability: 30, due: futureDue } as never,
      }),
    ]);
    await render();
    expect(text()).toContain("Estás al día.");
    expect(text()).toContain("El próximo repaso: pasado mañana");
  });

  it("El aviso de alcance aparece con un filtro de libro y «Ver todas» lo reinicia", async () => {
    const books = [
      { hash: "h-es", name: "libro-es.epub", title: "Libro Español", author: "Autor ES", language: "es" },
    ];
    listWordsMock.mockResolvedValue([
      word({ form: "reloj", lemma: "reloj", bookHash: "h-es", meaning: "tiempo" }),
    ]);
    await act(async () => {
      root.render(h(Vocabulary, { onClose: vi.fn(), books }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    await click("Palabras");
    const select = host.querySelector("#nb-book-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "h-es";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    await click("Hoy");
    expect(text()).toContain("Solo palabras de «Libro Español»");
    expect(button("Ver todas")).toBeTruthy();

    await click("Ver todas");
    expect(text()).not.toContain("Solo palabras de «Libro Español»");
  });

  it("Los números de la fila de estados coinciden con la lista filtrada", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "nueva", lemma: "nueva", meaning: "m1", card: { reps: 0, stability: 1 } as never }),
      word({ form: "aprendiendo", lemma: "aprendiendo", meaning: "m2", card: { reps: 1, stability: 5 } as never }),
      word({ form: "asentada", lemma: "asentada", meaning: "m3", card: { reps: 3, stability: 40 } as never }),
    ]);
    await render();
    await click("Palabras");

    expect(button("Todas (3)")).toBeTruthy();
    expect(button("Nueva (1)")).toBeTruthy();
    expect(button("Aprendiendo (1)")).toBeTruthy();
    expect(button("Asentada (1)")).toBeTruthy();

    await click("Aprendiendo (1)");
    const wordsList = () => host.querySelector(".nb-words")?.textContent ?? "";
    expect(wordsList()).toContain("aprendiendo");
    expect(wordsList()).not.toContain("nueva");
    expect(wordsList()).not.toContain("asentada");
  });

  it("El menú Exportar tiene 3 opciones y Palabras ya no ofrece «Pasajes CSV»", async () => {
    listWordsMock.mockResolvedValue([word({ meaning: "hogar" })]);
    await render();
    await click("Palabras");

    const exportDetails = host.querySelector("details.nb-export");
    expect(exportDetails).toBeTruthy();
    const exportButtons = exportDetails?.querySelectorAll("button");
    const exportLabels = [...(exportButtons ?? [])].map((b) => b.textContent?.trim());
    expect(exportLabels).toEqual(["CSV", "Para Anki", "Cuaderno (.md)"]);
    expect(exportLabels).not.toContain("Pasajes CSV");
  });

  it("Ordenar por Libro muestra grupos y por Fecha una lista sin grupos, de más reciente a más antigua", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "antigua", savedAt: 100, meaning: "m1", bookHash: "h1" }),
      word({ form: "reciente", savedAt: 500, meaning: "m2", bookHash: "h2" }),
    ]);
    await render();
    await click("Palabras");

    // Por defecto es fecha: no hay nb-group, y la lista está ordenada de más reciente a más antigua
    expect(host.querySelector(".nb-group")).toBeNull();
    const rows = [...host.querySelectorAll(".nb-word .nb-word-form")].map((el) => el.textContent);
    expect(rows).toEqual(["reciente", "antigua"]);

    // Ordenar por Libro: muestra secciones nb-group
    await click("Libro");
    expect(host.querySelectorAll(".nb-group").length).toBeGreaterThan(0);
  });

  it("La fila abre y cierra (aria-expanded) y muestra la oración y Quitar", async () => {
    listWordsMock.mockResolvedValue([
      word({ form: "espejo", meaning: "superficie que refleja", context: "El espejo de la sala", lemma: "espejo" }),
    ]);
    await render();
    await click("Palabras");

    const rowBtn = host.querySelector(".nb-word-row") as HTMLButtonElement;
    expect(rowBtn).toBeTruthy();
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".nb-word-detail")).toBeNull();
    expect(button("Quitar")).toBeUndefined();
    expect(text()).not.toContain("El espejo de la sala");

    // Abre al tocarla
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".nb-word-detail")).toBeTruthy();
    expect(button("Quitar")).toBeTruthy();
    expect(text()).toContain("El espejo de la sala");

    // Cierra al tocarla de nuevo
    await act(async () => {
      rowBtn.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".nb-word-detail")).toBeNull();
    expect(button("Quitar")).toBeUndefined();
  });
});
