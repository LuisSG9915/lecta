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

const setSearchValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

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
    // Curado: a, b, c. Cobertura: a ~100% (casa zipf 6 ≥ 3), c con la
    // mitad de sus formas sin ficha → «aún sin medir» en vez del ~0%
    // engañoso, b sin medir → b queda al final en su lugar curado.
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
    expect(badges()).toEqual(["~100%", "Vocabulario aún sin medir"]);
  });

  it("entre libros en tu nivel, el que repite palabras de tu cuaderno va primero", async () => {
    const books = [book("sin-reencuentros"), book("con-reencuentros")];
    const vocabs: Record<string, ReturnType<typeof vocab>> = {
      "sin-reencuentros": vocab([["casa", 6]]),
      "con-reencuentros": vocab([
        ["casa", 6],
        ["perenne", 2.1],
      ]),
    };
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async (id: string) => vocabs[id] ?? null,
          loadInputs: async () => ({ ...INPUTS, saved: new Set(["perenne"]) }),
        }),
      );
    });

    expect(titles()).toEqual(["Libro con-reencuentros", "Libro sin-reencuentros"]);
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
    expect(
      host.querySelector<HTMLButtonElement>(".discover-action")?.textContent,
    ).toBe("Obtener");
  });

  it("filtra por etiquetas de estado de ánimo / tiempo (A.4)", async () => {
    const books = [
      book("quijote", { title: "Don Quijote" }),
      book("lazarillo", { title: "El Lazarillo" }),
      book("poemas-dario", { title: "Poemas de Darío" }),
    ];

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    expect(titles()).toEqual(["Don Quijote", "El Lazarillo", "Poemas de Darío"]);

    // Clic en el filtro "Poesía y Modernismo"
    const pills = host.querySelectorAll<HTMLButtonElement>(".discover-filter-pill");
    const poesiaPill = [...pills].find((p) => p.textContent === "Poesía y Modernismo");
    expect(poesiaPill).toBeTruthy();

    await act(async () => {
      poesiaPill!.click();
    });

    expect(titles()).toEqual(["Poemas de Darío"]);
  });

  it("muestra el contador de palabras nuevas útiles cuando se mide la cobertura (A.4)", async () => {
    const books = [book("a")];
    const vocabs = {
      a: vocab([["perenne", 2.1]], ["rara"]),
    };

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async (id: string) => vocabs[id as keyof typeof vocabs] ?? null,
          loadInputs: async () => INPUTS,
        }),
      );
    });

    const newWords = host.querySelector(".discover-new-words");
    expect(newWords).toBeTruthy();
    expect(newWords?.textContent).toContain("palabras útiles");
  });

  it("mide cada libro con el perfil de su idioma", async () => {
    const books = [
      book("es-1", { title: "Libro en español", language: "es" }),
      book("en-1", { title: "Book in English", language: "en" }),
    ];
    const languages: string[] = [];
    const loadInputs = vi.fn(async (language: string) => {
      languages.push(language);
      return INPUTS;
    });

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs,
        }),
      );
    });

    expect(languages.filter((lang) => lang === "es")).toHaveLength(1);
    expect(languages.filter((lang) => lang === "en")).toHaveLength(1);
  });

  it("muestra los reencuentros con el Cuaderno al medir la cobertura", async () => {
    const books = [book("a")];
    const vocabs = {
      a: vocab([
        ["casa", 6],
        ["perenne", 2.1],
      ]),
    };

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async (id: string) => vocabs[id as keyof typeof vocabs] ?? null,
          loadInputs: async () => ({ ...INPUTS, saved: new Set(["perenne"]) }),
        }),
      );
    });

    const reencuentros = host.querySelector(".discover-reencuentros");
    expect(reencuentros).toBeTruthy();
    expect(reencuentros?.textContent).toContain("Repite 1 palabra de tu cuaderno");
  });

  it("muestra la píldora de afinidad .book-affinity-pill con data-tone y label cálido (Fase 1)", async () => {
    const books = [
      book("quijote", { title: "Don Quijote", language: "es", difficulty: "ideal" }),
      book("simple", { title: "Cuentos Fáciles", language: "es", difficulty: "relaxed" }),
      book("english", { title: "Great Expectations", language: "en", difficulty: "supported" }),
    ];

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    const affinityPills = host.querySelectorAll<HTMLSpanElement>(".book-affinity-pill");
    expect(affinityPills.length).toBe(3);

    expect(affinityPills[0].getAttribute("data-tone")).toBe("ideal");
    expect(affinityPills[0].textContent).toBe("Ideal para tu ritmo");

    expect(affinityPills[1].getAttribute("data-tone")).toBe("relaxed");
    expect(affinityPills[1].textContent).toBe("Lectura relajada");

    expect(affinityPills[2].getAttribute("data-tone")).toBe("supported");
    expect(affinityPills[2].textContent).toBe("Con apoyo bilingüe");
  });

  it("no pinta píldoras de mood: una sola etiqueta por libro (la afinidad)", async () => {
    // La categoría/mood sigue en los filtros de arriba; en la tarjeta
    // solo va la afinidad para que títulos y «Obtener» alineen (G3).
    const books = [book("quijote", { title: "Don Quijote", language: "es" })];

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    const card = host.querySelector(".discover-book");
    expect(card).toBeTruthy();
    expect(card?.querySelectorAll(".discover-tag-pill").length).toBe(0);
    expect(card?.querySelectorAll(".book-affinity-pill").length).toBe(1);
  });

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
      book("corazon", { title: "El corazón", author: "Anónimo" }),
    ];

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Buscar en libros gratuitos"]',
    )!;

    await act(async () => setSearchValue(input, "becquer"));
    expect(titles()).toEqual(["Obras escogidas"]);

    await act(async () => setSearchValue(input, "galdos"));
    expect(titles()).toEqual(["Fortunata y Jacinta"]);

    await act(async () => setSearchValue(input, "corazon"));
    expect(titles()).toEqual(["El corazón"]);
  });

  it("«Ver todos» despliega la cuadrícula completa y vuelve al riel", async () => {
    const books = Array.from({ length: 15 }, (_, i) =>
      book(`b${String(i + 1).padStart(2, "0")}`),
    );

    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    expect(titles()).toHaveLength(12);
    const toggle = host.querySelector<HTMLButtonElement>(
      ".discover-view-toggle",
    )!;
    expect(toggle.textContent).toBe("Ver todos (15)");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector(".discover-rail--grid")).toBeNull();

    await act(async () => toggle.click());
    expect(titles()).toHaveLength(15);
    expect(host.querySelector(".discover-rail--grid")).not.toBeNull();
    expect(toggle.textContent).toBe("Ver en riel");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    await act(async () => toggle.click());
    expect(titles()).toHaveLength(12);
    expect(host.querySelector(".discover-rail--grid")).toBeNull();
  });

  it("recalcula coberturas al subir vocabVersion sin re-bajar manifiestos", async () => {
    const books = [book("a")];
    const fetchVocab = vi.fn(async () => vocab([["casa", 6]]));
    const loadInputs = vi.fn(async () => INPUTS);
    const props = {
      library: [],
      onOpen: vi.fn(),
      onGet: vi.fn(),
      fetchIndex: async () => index(books),
      fetchVocab,
      loadInputs,
    };

    await act(async () => {
      root.render(h(DiscoverRail, { ...props, vocabVersion: 0 }));
    });
    expect(badges()).toContain("~100%");
    expect(fetchVocab).toHaveBeenCalledTimes(1);
    expect(loadInputs).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(h(DiscoverRail, { ...props, vocabVersion: 1 }));
    });
    expect(loadInputs).toHaveBeenCalledTimes(2);
    expect(fetchVocab).toHaveBeenCalledTimes(1);
    expect(badges()).toContain("~100%");
  });

  it("filtra por idioma y por ritmo de afinidad", async () => {
    const books = [
      book("es-1", { title: "Libro en español", language: "es" }),
      book("en-1", { title: "Book in English", language: "en" }),
    ];
    await act(async () => {
      root.render(
        h(DiscoverRail, {
          library: [],
          onOpen: vi.fn(),
          onGet: vi.fn(),
          fetchIndex: async () => index(books),
          fetchVocab: async () => null,
          loadInputs: async () => null,
        }),
      );
    });

    const langGroup = host.querySelector<HTMLElement>(
      '[aria-label="Filtrar por idioma"]',
    )!;
    const enPill = [...langGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "EN",
    )!;
    await act(async () => enPill.click());
    expect(titles()).toEqual(["Book in English"]);

    const allLang = [...langGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Todos",
    )!;
    await act(async () => allLang.click());

    const paceGroup = host.querySelector<HTMLElement>(
      '[aria-label="Filtrar por ritmo"]',
    )!;
    const supported = [...paceGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Con apoyo",
    )!;
    await act(async () => supported.click());
    expect(titles()).toEqual(["Book in English"]);

    const ideal = [...paceGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Ideal para tu ritmo",
    )!;
    await act(async () => ideal.click());
    expect(titles()).toEqual(["Libro en español"]);
  });

  it("abre la hoja de vista previa y obtiene el libro desde ella", async () => {
    const onGet = vi.fn(async () => undefined);
    const books = [
      book("a", {
        title: "Vista Previa",
        author: "Autor X",
        language: "es",
        synopsis: "Sinopsis de prueba.",
        wordCount: 36_000,
      }),
    ];
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

    const coverButton = host.querySelector<HTMLButtonElement>(
      ".discover-cover--action",
    )!;
    await act(async () => coverButton.click());

    const sheet = host.querySelector(".sheet");
    expect(sheet).toBeTruthy();
    expect(sheet?.textContent).toContain("Vista Previa");
    expect(sheet?.textContent).toContain("Autor X");
    expect(sheet?.textContent).toContain("Sinopsis de prueba.");
    expect(sheet?.textContent).toContain("~3 h");

    const obtain = [...sheet!.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener libro",
    )!;
    await act(async () => obtain.click());
    expect(onGet).toHaveBeenCalledWith(books[0]);
    expect(host.querySelector(".sheet")).toBeNull();
  });

  it("desde la vista previa ofrece «Abrir» cuando el libro ya está en la estantería", async () => {
    const owned = shelfItem("abc123");
    const onOpen = vi.fn();
    const books = [book("a", { title: "Ya lo tengo", epubSha256: "abc123" })];
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

    const titleButton = host.querySelector<HTMLButtonElement>(
      ".discover-title--action",
    )!;
    await act(async () => titleButton.click());

    const sheet = host.querySelector(".sheet")!;
    const open = [...sheet.querySelectorAll("button")].find(
      (b) => b.textContent === "Abrir",
    )!;
    await act(async () => open.click());
    expect(onOpen).toHaveBeenCalledWith(owned);
    expect(host.querySelector(".sheet")).toBeNull();
  });
});

