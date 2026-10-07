// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverRail from "./DiscoverRail";
import type { CatalogBook, CatalogIndex } from "../lib/catalog";
import type { CoverageInputs } from "../lib/coverage";
import type { ShelfItem } from "./Shelf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// El riel captura el scope por dispositivo; en prueba no hay cuenta
// activa y el scope anónimo basta — no se mockea idb porque las deps
// de datos van inyectadas por props.
vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return { ...mod, captureDbScope: vi.fn(() => undefined) };
});

const book = (id: string, over: Partial<CatalogBook> = {}): CatalogBook => ({
  id,
  gutenbergId: 1,
  title: `Libro ${id}`,
  author: `Autor ${id}`,
  cover: false,
  ...over,
});

const index = (books: CatalogBook[]): CatalogIndex => ({
  bookCount: books.length,
  books,
});

// Manifiesto mínimo: una sola forma con su frecuencia → el porcentaje
// sale determinista del threshold dado.
const vocab = (forms: [string, number][], missing: string[] = []) => ({
  v: 1 as const,
  wordCount: 100,
  uniqueForms: forms.length + missing.length,
  forms: [...forms.map(([form]) => form), ...missing],
  entries: forms.map(([form, zipf]) => ({
    id: `id-${form}`,
    lemma: form,
    pos: "sustantivo",
    zipf,
  })),
  byForm: Object.fromEntries(forms.map(([form], i) => [form, [i]])),
  missing,
});

const INPUTS: CoverageInputs = {
  saved: new Set(),
  knowledge: new Map(),
  threshold: 3.0,
  confidence: "mid",
  evidenceCount: 40,
};

const shelfItem = (hash: string): ShelfItem =>
  ({ hash, name: `${hash}.epub`, addedAt: 1 }) as ShelfItem;

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

const titles = () =>
  [...host.querySelectorAll(".discover-title")].map((el) => el.textContent);
const badges = () =>
  [...host.querySelectorAll(".discover-badge")].map((el) => el.textContent);

describe("DiscoverRail", () => {
  it("sin índice no pinta nada", async () => {
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => null,
          fetchVocab: async () => null,
          loadInputs: async () => INPUTS,
        }),
      );
    });
    expect(host.querySelector(".discover")).toBeNull();
  });

  it("ordena por cobertura los medidos y conserva el orden curado al final", async () => {
    // Curado: a, b, c. Cobertura: a ~100% (casa zipf 6 ≥ 3), c ~0%
    // (rara predicha + una sin ficha), b sin medir → b queda al final
    // en su lugar curado, no entre medidos.
    const books = [book("a"), book("b"), book("c")];
    const vocabs: Record<string, ReturnType<typeof vocab>> = {
      a: vocab([["casa", 6]]),
      c: vocab([["perenne", 2.1]], ["xing"]),
    };
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async (id: string) => vocabs[id] ?? null,
          loadInputs: async () => INPUTS,
        }),
      );
    });
    // El prefetch es secuencial: a y c medidos, b sin ficha (null →
    // el lazo se detiene ahí y no mide más).
    expect(titles()).toEqual(["Libro a", "Libro c", "Libro b"]);
    expect(badges()).toEqual(["~100%", "~0%"]);
  });

  it("el libro ya en la estantería muestra «Abrir» y abre ese ítem", async () => {
    const owned = shelfItem("abc123");
    const onOpen = vi.fn();
    const books = [book("a", { epubSha256: "abc123" })];
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [owned],
          onOpen,
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });
    const button = host.querySelector<HTMLButtonElement>(".discover-action");
    expect(button?.textContent).toBe("Abrir");
    await act(async () => button!.click());
    expect(onOpen).toHaveBeenCalledWith(owned);
  });

  it("«Obtener» llama onGet con el libro del catálogo", async () => {
    const onGet = vi.fn(async () => undefined);
    const books = [book("a")];
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet,
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });
    const button = host.querySelector<HTMLButtonElement>(".discover-action");
    expect(button?.textContent).toBe("Obtener");
    await act(async () => button!.click());
    expect(onGet).toHaveBeenCalledWith(books[0]);
  });

  it("si la descarga falla muestra el error en la tarjeta", async () => {
    const onGet = vi.fn(async () => {
      throw new Error("sin red");
    });
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet,
          fetchIndex: async () => index([book("a")]),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".discover-action")!.click(),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudo descargar",
    );
    // La tarjeta recupera su acción: el error no bloquea el reintento.
    expect(
      host.querySelector<HTMLButtonElement>(".discover-action")?.textContent,
    ).toBe("Obtener");
  });
});
