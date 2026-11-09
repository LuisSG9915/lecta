// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunityShelf from "./CommunityShelf";
import { attachCommunityBook } from "../lib/books";
import type { CommunityBook, CommunityBooksResult } from "../lib/books";
import type { ShelfItem } from "./Shelf";
import type { CoverageInputs } from "../lib/coverage";
import type { LexiconEntry } from "../lib/lexicon";

vi.mock("../lib/books", () => ({
  listCommunityBooksResult: vi.fn(async () => ({ ok: true, books: [] })),
  fetchBookGuide: vi.fn(async () => null),
  attachCommunityBook: vi.fn(async () => ({ ok: true })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const book = (hash: string, over: Partial<CommunityBook> = {}): CommunityBook => ({
  hash,
  title: `Guía ${hash}`,
  author: `Autor ${hash}`,
  language: "es",
  sizeBytes: 1000,
  hasCover: false,
  sharers: 1,
  genre: "",
  ...over,
});

const okBooks = (books: CommunityBook[]): CommunityBooksResult => ({
  ok: true,
  books,
});

const entry = (form: string): LexiconEntry => ({
  entryId: `e-${form}`,
  lemma: form,
  pos: "sustantivo",
  freqRank: 10,
  zipf: 5,
  senses: [{ definition: "definición", example: null, senseOrder: 1 }],
});

// Guía cruda (la misma forma que devuelve /api/books/:hash/guide): pasa
// la sanitización del cliente porque trae versión, hash y capítulos.
const guideFor = (hash: string) => ({
  version: 1,
  bookHash: hash,
  title: "Cien años de soledad",
  author: "García Márquez",
  language: "es",
  updatedAt: 1,
  chapters: [
    {
      id: "c1",
      label: "Capítulo 1",
      depth: 0,
      kind: "chapter",
      forms: ["casa", "perro"],
      capitalOnly: [],
    },
    {
      id: "c2",
      label: "Capítulo 2",
      depth: 0,
      kind: "chapter",
      forms: ["gato", "ventana"],
      capitalOnly: [],
    },
  ],
});

const coverageInputs = (): CoverageInputs => ({
  saved: new Set(["casa", "perro", "gato", "ventana"]),
  knowledge: new Map(),
  threshold: 3,
  confidence: "high",
  evidenceCount: 10,
});

const shelfItem = (
  hash: string,
  over: Partial<ShelfItem> = {},
): ShelfItem => ({
  hash,
  name: `${hash}.epub`,
  addedAt: 1,
  title: `Libro ${hash}`,
  author: "Autora",
  language: "es",
  ...over,
});

const flush = async (ticks = 5) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};

const titles = () =>
  [...host.querySelectorAll(".discover-title")].map((el) => el.textContent);

const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const setSearchValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("CommunityShelf", () => {
  it("busca por título y autor sin acentos", async () => {
    const books = [
      book("becquer", {
        title: "Obras escogidas",
        author: "Gustavo Adolfo Bécquer",
      }),
      book("galdo", {
        title: "Fortunata y Jacinta",
        author: "Benito Pérez Galdós",
      }),
    ];

    await act(async () => {
      root.render(
        h(CommunityShelf, { fetchBooks: async () => okBooks(books) }),
      );
      await flush();
    });

    expect(titles()).toEqual(["Obras escogidas", "Fortunata y Jacinta"]);

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Buscar en la comunidad"]',
    )!;
    await act(async () => setSearchValue(input, "galdos"));
    expect(titles()).toEqual(["Fortunata y Jacinta"]);

    await act(async () => setSearchValue(input, "becquer"));
    expect(titles()).toEqual(["Obras escogidas"]);
  });

  it("distingue error de lista vacía y permite reintentar", async () => {
    const fetchBooks = vi
      .fn<() => Promise<CommunityBooksResult>>()
      .mockResolvedValueOnce({ ok: false, books: [] })
      .mockResolvedValueOnce(okBooks([book("h1", { title: "Guía recuperada" })]));

    await act(async () => {
      root.render(h(CommunityShelf, { fetchBooks }));
      await flush();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudo cargar la comunidad",
    );
    expect(titles()).toEqual([]);

    const retry = buttonByText(host, "Reintentar")!;
    await act(async () => {
      retry.click();
      await flush();
    });

    expect(fetchBooks).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["Guía recuperada"]);
  });

  it("marca como «En tu estantería» las guías ya agregadas", async () => {
    await act(async () => {
      root.render(
        h(CommunityShelf, {
          fetchBooks: async () => okBooks([book("h1", { title: "Guía propia" })]),
          ownedHashes: new Set(["h1"]),
        }),
      );
      await flush();
    });

    const action = host.querySelector<HTMLButtonElement>(".discover-action")!;
    expect(action.textContent).toBe("En tu estantería");
    expect(action.disabled).toBe(true);
  });

  it("muestra capítulos y cobertura, y la vista previa permite usar la guía", async () => {
    const onAttached = vi.fn();
    await act(async () => {
      root.render(
        h(CommunityShelf, {
          fetchBooks: async () =>
            okBooks([
              book("g1", {
                title: "Cien años",
                author: "García Márquez",
                genre: "Clásicos",
              }),
            ]),
          fetchGuide: async () => guideFor("g1"),
          loadInputs: async () => coverageInputs(),
          lookupForms: async (forms: string[]) =>
            Object.fromEntries(forms.map((form) => [form, [entry(form)]])),
          onAttached,
        }),
      );
      await flush(40);
    });
    await act(async () => {
      await flush(40);
    });

    const pills = [...host.querySelectorAll(".discover-tag-pill")].map(
      (el) => el.textContent,
    );
    expect(pills).toContain("2 cap.");
    expect(host.querySelector(".discover-badge")?.textContent).toContain(
      "~100%",
    );
    expect(host.querySelector(".discover-reencuentros")?.textContent).toContain(
      "Repite 4 palabras",
    );

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".discover-cover--action")!
        .click();
      await flush(10);
    });

    const sheet = host.querySelector(".sheet-scrim");
    expect(sheet).toBeTruthy();
    expect(sheet?.textContent).toContain("Índice de capítulos");
    const items =
      sheet?.querySelectorAll(".discover-preview-chapters li") ?? [];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Capítulo 1");
    expect(items[0].textContent).toContain("2 palabras");

    const useButton = [...(sheet?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Usar en papel",
    )!;
    await act(async () => {
      useButton.click();
      await flush(40);
    });

    expect(attachCommunityBook).toHaveBeenCalledWith("g1");
    expect(onAttached).toHaveBeenCalled();
    expect(onAttached.mock.calls[0][0]).toBe("g1");
    expect(host.querySelector(".sheet-scrim")).toBeNull();
  });

  it("«Ver todos» abre la cuadrícula y vuelve al riel", async () => {
    const books = Array.from({ length: 13 }, (_, i) =>
      book(`b${i}`, { title: `Guía ${i}` }),
    );

    await act(async () => {
      root.render(
        h(CommunityShelf, {
          fetchBooks: async () => okBooks(books),
          fetchGuide: async () => null,
        }),
      );
      await flush(20);
    });

    expect(titles()).toHaveLength(12);
    const toggle = buttonByText(host, "Ver todos (13)")!;
    await act(async () => {
      toggle.click();
      await flush(10);
    });

    expect(host.querySelector("ul.discover-rail")?.className).toContain(
      "discover-rail--grid",
    );
    expect(titles()).toHaveLength(13);

    const back = buttonByText(host, "Ver en riel")!;
    await act(async () => {
      back.click();
      await flush(10);
    });
    expect(titles()).toHaveLength(12);
  });

  it("comparte la guía de un libro propio desde la hoja de Comunidad", async () => {
    const onShareBook = vi.fn();
    const own = shelfItem("b1", { title: "Mi novela", genre: "Clásicos" });

    await act(async () => {
      root.render(
        h(CommunityShelf, {
          fetchBooks: async () => okBooks([book("g1", { title: "Guía ajena" })]),
          fetchGuide: async () => null,
          shareableBooks: [own],
          onShareBook,
        }),
      );
      await flush(20);
    });

    const openButton = buttonByText(host, "Compartir un libro tuyo")!;
    await act(async () => {
      openButton.click();
      await flush(10);
    });

    const sheet = host.querySelector(".sheet-scrim")!;
    const bookButton = [...sheet.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Mi novela"),
    )!;
    await act(async () => {
      bookButton.click();
      await flush(10);
    });

    const confirm = buttonByText(sheet, "Compartir guía")!;
    await act(async () => {
      confirm.click();
      await flush(10);
    });

    expect(onShareBook).toHaveBeenCalledWith(own, "Clásicos");
  });
});
