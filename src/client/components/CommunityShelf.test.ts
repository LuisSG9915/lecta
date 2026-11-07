// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunityShelf from "./CommunityShelf";
import type { CommunityBook, CommunityBooksResult } from "../lib/books";

vi.mock("../lib/books", () => ({
  listCommunityBooksResult: vi.fn(async () => ({ ok: true, books: [] })),
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

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const titles = () =>
  [...host.querySelectorAll(".discover-title")].map((el) => el.textContent);

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

    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Reintentar",
    )!;
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
});
