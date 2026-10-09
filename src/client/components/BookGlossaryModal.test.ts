// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookGlossaryModal, { type BookGlossaryModalProps } from "./BookGlossaryModal";
import type { BookVocabManifest } from "../lib/catalog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const testManifest: BookVocabManifest = {
  v: 1,
  wordCount: 12500,
  uniqueForms: 6,
  forms: ["abismo", "bálsamo", "cúpula", "diáfano", "efímero", "fatuo"],
  entries: [
    { id: "1", lemma: "abismo", pos: "sust.", zipf: 3.2 },
    { id: "2", lemma: "bálsamo", pos: "sust.", zipf: 3.5 },
    { id: "3", lemma: "cúpula", pos: "sust.", zipf: 3.1 },
    { id: "4", lemma: "diáfano", pos: "adj.", zipf: 2.9 },
    { id: "5", lemma: "efímero", pos: "adj.", zipf: 2.8 },
    { id: "6", lemma: "fatuo", pos: "adj.", zipf: 2.5 },
  ],
  byForm: {
    abismo: [0],
    bálsamo: [1],
    cúpula: [2],
    diáfano: [3],
    efímero: [4],
    fatuo: [5],
  },
  missing: [],
};

vi.mock("../lib/book-vocab", () => ({
  loadBookVocab: vi.fn(async () => testManifest),
  analyzeStoredBook: vi.fn(async () => testManifest),
}));

vi.mock("../lib/idb", () => ({
  captureDbScope: vi.fn(() => ({})),
  listSavedWords: vi.fn(async () => []),
  listAllKnowledge: vi.fn(async () => []),
  saveWordWithKnowledge: vi.fn(async ({ word }: { word: { form: string; lemma: string } }) => ({
    word: { key: word.form, form: word.form, lemma: word.lemma, savedAt: Date.now() },
  })),
}));

vi.mock("../lib/lexicon", () => ({
  lookupWord: vi.fn(async (form: string) => ({
    ok: true,
    found: true,
    entries: [
      {
        entryId: "e1",
        lemma: form,
        pos: "sust.",
        senses: [{ senseOrder: 1, definition: `Significado de ${form}`, example: "Ejemplo literario" }],
      },
    ],
  })),
}));

vi.mock("../lib/game", () => ({
  award: vi.fn(),
  localDayKey: vi.fn(() => "2026-10-09"),
}));

vi.mock("../lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = (props: Partial<BookGlossaryModalProps> = {}) =>
  act(async () => {
    root.render(
      h(BookGlossaryModal, {
        bookHash: "book-hash-123",
        bookTitle: "Cien años de soledad",
        onClose: vi.fn(),
        ...props,
      }),
    );
  });

const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("BookGlossaryModal", () => {
  it("renderiza el glosario con título del libro y estadísticas de la obra", async () => {
    await render();

    expect(host.querySelector(".glossary-title")?.textContent).toBe("Glosario de la obra");
    expect(host.querySelector(".glossary-book-subtitle")?.textContent).toContain("Cien años de soledad");

    // Estadísticas
    const statsBar = host.querySelector(".glossary-stats-bar");
    expect(statsBar).toBeTruthy();
    expect(statsBar?.textContent).toContain("6");
    expect(statsBar?.textContent).toContain("formas");
    expect(statsBar?.textContent).toContain("12.500");
    expect(statsBar?.textContent).toContain("palabras");
  });

  it("permite filtrar por letra en la barra A–Z", async () => {
    await render();

    // Comprobar que los términos iniciales incluyen abismo, diáfano, etc.
    expect(host.textContent).toContain("abismo");
    expect(host.textContent).toContain("diáfano");

    // Click en la letra 'D'
    const btnD = Array.from(host.querySelectorAll(".glossary-az-btn")).find(
      (btn) => btn.textContent?.trim() === "D",
    ) as HTMLButtonElement | undefined;
    expect(btnD).toBeDefined();

    await act(async () => {
      btnD?.click();
    });

    // Ahora solo debe estar diáfano
    expect(host.textContent).toContain("diáfano");
    expect(host.textContent).not.toContain("abismo");

    // Click en 'Todas'
    const btnTodas = host.querySelector(".glossary-az-btn--all") as HTMLButtonElement;
    await act(async () => {
      btnTodas?.click();
    });

    expect(host.textContent).toContain("abismo");
    expect(host.textContent).toContain("diáfano");
  });

  it("permite buscar y limpiar la búsqueda", async () => {
    await render();

    const searchInput = host.querySelector(".glossary-search-input") as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    await typeInto(searchInput, "efímero");

    expect(host.textContent).toContain("efímero");
    expect(host.textContent).not.toContain("abismo");

    // Limpiar búsqueda
    const clearBtn = host.querySelector(".glossary-search-clear") as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    await act(async () => {
      clearBtn.click();
    });

    expect(host.textContent).toContain("abismo");
  });

  it("expande un término al hacer clic para ver su definición", async () => {
    await render();

    const cardSummary = host.querySelector(".glossary-card-summary") as HTMLButtonElement;
    expect(cardSummary).toBeTruthy();

    await act(async () => {
      cardSummary.click();
    });

    // Debe mostrar la definición
    expect(host.querySelector(".glossary-card-body")).toBeTruthy();
    expect(host.textContent).toContain("Significado de");
    expect(host.textContent).toContain("Ejemplo literario");
  });

  it("gestiona la paginación correctamente en colecciones grandes", async () => {
    const manyForms = Array.from({ length: 120 }, (_, i) => `palabra_${String(i).padStart(3, "0")}`);
    const largeManifest: BookVocabManifest = {
      v: 1,
      wordCount: 80000,
      uniqueForms: 120,
      forms: manyForms,
      entries: manyForms.map((f, i) => ({ id: String(i), lemma: f, pos: "sust.", zipf: 2.0 })),
      byForm: Object.fromEntries(manyForms.map((f, i) => [f, [i]])),
      missing: [],
    };

    const { loadBookVocab } = await import("../lib/book-vocab");
    vi.mocked(loadBookVocab).mockResolvedValueOnce(largeManifest);

    await render();

    // Debe mostrar información de página
    expect(host.textContent).toContain("Pág. 1 de 3");
    expect(host.textContent).toContain("palabra_000");

    // Click en la página 2
    const btnPage2 = Array.from(host.querySelectorAll(".glossary-page-num")).find(
      (btn) => btn.textContent?.trim() === "2",
    ) as HTMLButtonElement | undefined;
    expect(btnPage2).toBeDefined();

    await act(async () => {
      btnPage2?.click();
    });

    expect(host.textContent).toContain("Pág. 2 de 3");
    expect(host.textContent).toContain("palabra_050");
    expect(host.textContent).not.toContain("palabra_000");
  });
});
