// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GutenbergSearch from "./GutenbergSearch";
import { CatalogAuthError, type CatalogBook } from "../lib/catalog";
import type { ShelfItem } from "./Shelf";
import type {
  GutenbergSearchPage,
  GutenbergSearchParams,
} from "../lib/gutenberg";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const book = (id: string, over: Partial<CatalogBook> = {}): CatalogBook => ({
  id,
  gutenbergId: Number(id.replace(/\D/g, "")) || 1,
  title: `Libro ${id}`,
  author: `Autor ${id}`,
  language: "es",
  cover: false,
  ...over,
});

const page = (
  books: CatalogBook[],
  over: Partial<GutenbergSearchPage> = {},
): GutenbergSearchPage => ({
  page: 0,
  hasMore: false,
  books,
  ...over,
});

type FetchCall = [GutenbergSearchParams, AbortSignal | undefined];

// Los mocks de fetchSearch se tipan por prueba; la lectura de calls
// pasa por unknown para no acoplar cada firma al helper.
const callArgs = (mock: { mock: { calls: unknown[][] } }, index = -1) =>
  mock.mock.calls.at(index) as unknown as FetchCall;

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

const pills = (group: string) =>
  [
    ...host.querySelectorAll<HTMLButtonElement>(
      `[aria-label="${group}"] button`,
    ),
  ];

const setSearchValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const render = (
  props: Partial<Parameters<typeof GutenbergSearch>[0]> = {},
) =>
  act(async () => {
    root.render(
      h(GutenbergSearch, {
        onGet: vi.fn(async () => undefined),
        fetchSearch: vi.fn(async () => page([])),
        ...props,
      }),
    );
  });

describe("GutenbergSearch", () => {
  it("al montar pide la página 0 sin filtros (los más descargados)", async () => {
    const fetchSearch = vi.fn(async () =>
      page([book("pg-1342", { title: "Don Quijote" })]),
    );
    await render({ fetchSearch });
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    const [params] = callArgs(fetchSearch, 0);
    expect(params).toMatchObject({ page: 0 });
    expect(params.q ?? "").toBe("");
    expect(titles()).toEqual(["Don Quijote"]);
    expect(
      host.querySelector('section[aria-label="Más clásicos de dominio público"]'),
    ).not.toBeNull();
  });

  it("mientras carga muestra role=status; la etiqueta del campo es visible", async () => {
    const fetchSearch = vi.fn(() => new Promise<GutenbergSearchPage | null>(() => {}));
    await render({ fetchSearch });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Buscando");
    const label = host.querySelector<HTMLLabelElement>(".gutenberg-search-label");
    const input = host.querySelector<HTMLInputElement>("#gutenberg-search-field");
    expect(label?.textContent).toBe("Busca por título o autor");
    expect(label?.htmlFor).toBe(input?.id);
  });

  it("espera 350 ms tras escribir y cancela la petición anterior", async () => {
    vi.useFakeTimers();
    try {
      const pending: Promise<GutenbergSearchPage | null>[] = [];
      const signals: (AbortSignal | undefined)[] = [];
      const fetchSearch = vi.fn(
        (_params: GutenbergSearchParams, signal?: AbortSignal) => {
          signals.push(signal);
          return new Promise<GutenbergSearchPage | null>(() => {});
        },
      );
      void pending;
      await render({ fetchSearch });
      // Montaje: primera llamada ya salió (sin espera, es la carga inicial).
      expect(fetchSearch).toHaveBeenCalledTimes(1);

      const input = host.querySelector<HTMLInputElement>(
        "#gutenberg-search-field",
      )!;
      await act(async () => {
        setSearchValue(input, "dickens");
        vi.advanceTimersByTime(200);
      });
      expect(fetchSearch).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(fetchSearch).toHaveBeenCalledTimes(2);
      const [params] = callArgs(fetchSearch, 1);
      expect(params.q).toBe("dickens");
      // La segunda búsqueda abortó la señal de la primera.
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("los filtros de idioma y tema viajan como parámetros", async () => {
    const fetchSearch = vi.fn(async () => page([]));
    await render({ fetchSearch });
    const lastParams = () => callArgs(fetchSearch)[0];

    const ingles = pills("Filtrar por idioma").find(
      (b) => b.textContent === "Inglés",
    )!;
    await act(async () => ingles.click());
    expect(lastParams().lang).toBe("en");

    const poesia = pills("Filtrar por tema").find(
      (b) => b.textContent === "Poesía",
    )!;
    await act(async () => poesia.click());
    expect(lastParams().topic).toBe("poetry");
    expect(poesia.getAttribute("aria-pressed")).toBe("true");

    // Tocar el tema activo lo quita.
    await act(async () => poesia.click());
    expect(lastParams().topic).toBeUndefined();
    expect(poesia.getAttribute("aria-pressed")).toBe("false");
  });

  it("«Ver más» pide la página siguiente y agrega resultados", async () => {
    const fetchSearch = vi.fn(async (params: GutenbergSearchParams) =>
      params.page === 1
        ? page([book("pg-84", { title: "Frankenstein" })])
        : page([book("pg-1342", { title: "Don Quijote" })], {
            hasMore: true,
          }),
    );
    await render({ fetchSearch });
    expect(titles()).toEqual(["Don Quijote"]);

    const more = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Ver más",
    )!;
    await act(async () => more.click());
    expect(titles()).toEqual(["Don Quijote", "Frankenstein"]);
    const [params] = callArgs(fetchSearch);
    expect(params.page).toBe(1);
    // hasMore agotado: el botón desaparece.
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Ver más",
      ),
    ).toBe(false);
  });

  it("sin resultados muestra el vacío", async () => {
    await render({ fetchSearch: vi.fn(async () => page([])) });
    expect(host.textContent).toContain(
      "No encontramos libros con esa búsqueda.",
    );
  });

  it("error de búsqueda muestra Reintentar y recupera", async () => {
    const fetchSearch = vi
      .fn<() => Promise<GutenbergSearchPage | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(page([book("pg-1", { title: "Recuperado" })]));
    await render({ fetchSearch });
    expect(host.textContent).toContain("No pudimos buscar ahora.");

    const retry = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Reintentar",
    )!;
    await act(async () => retry.click());
    expect(titles()).toEqual(["Recuperado"]);
    expect(fetchSearch).toHaveBeenCalledTimes(2);
  });

  it("«Obtener» llama onGet y muestra Obteniendo… mientras baja", async () => {
    let release: (() => void) | null = null;
    const onGet = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const target = book("pg-1342", { title: "Don Quijote" });
    await render({
      onGet,
      fetchSearch: vi.fn(async () => page([target])),
    });
    const getButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener",
    )!;
    await act(async () => getButton.click());
    expect(onGet).toHaveBeenCalledWith(target);
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Obteniendo…",
      ),
    ).toBe(true);
    await act(async () => release!());
  });

  it("401 al obtener muestra la invitación a iniciar sesión", async () => {
    const onOpenAccount = vi.fn();
    const onGet = vi.fn(async () => {
      throw new CatalogAuthError();
    });
    await render({
      onGet,
      onOpenAccount,
      fetchSearch: vi.fn(async () =>
        page([book("pg-1342", { title: "Don Quijote" })]),
      ),
    });
    const getButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener",
    )!;
    await act(async () => getButton.click());
    expect(host.textContent).toContain(
      "Inicia sesión para obtener este libro.",
    );
    const login = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Iniciar sesión",
    )!;
    await act(async () => login.click());
    expect(onOpenAccount).toHaveBeenCalled();
  });

  it("un fallo genérico al obtener muestra error sin invitación", async () => {
    const onGet = vi.fn(async () => {
      throw new Error("network");
    });
    await render({
      onGet,
      onOpenAccount: vi.fn(),
      fetchSearch: vi.fn(async () =>
        page([book("pg-1342", { title: "Don Quijote" })]),
      ),
    });
    const getButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener",
    )!;
    await act(async () => getButton.click());
    expect(host.textContent).toContain("No se pudo descargar");
    expect(host.textContent).not.toContain("Inicia sesión para obtener");
  });

  it("con cover:true pinta la imagen del worker y cae a la tipográfica si falla", async () => {
    const target = book("pg-1342", {
      title: "Don Quijote",
      cover: true,
    });
    await render({ fetchSearch: vi.fn(async () => page([target])) });
    const img = host.querySelector<HTMLImageElement>(
      ".discover-cover img.cover",
    );
    expect(img?.getAttribute("src")).toBe("/api/catalog/pg-1342/cover");
    expect(img?.getAttribute("loading")).toBe("lazy");

    // El error de carga cambia a la portada tipográfica del mismo libro.
    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector(".discover-cover img.cover")).toBeNull();
    expect(
      host.querySelector('.cover--generated[aria-label="Portada de Don Quijote"]'),
    ).not.toBeNull();
  });

  it("con query controlada no pinta el input propio y busca con ese texto", async () => {
    vi.useFakeTimers();
    try {
      const fetchSearch = vi.fn(async () => page([]));
      await render({ fetchSearch, query: "dickens" });
      // El campo único vive en la pestaña: aquí no hay etiqueta ni input.
      expect(host.querySelector("#gutenberg-search-field")).toBeNull();
      expect(host.querySelector(".gutenberg-search-label")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      const [params] = callArgs(fetchSearch);
      expect(params.q).toBe("dickens");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin búsqueda lista en riel; con texto pasa a cuadrícula", async () => {
    const fetchSearch = vi.fn(async () =>
      page([book("pg-1342", { title: "Don Quijote" })]),
    );
    await render({ fetchSearch });
    expect(host.querySelector("ul.discover-rail")).not.toBeNull();
    expect(host.querySelector("ul.discover-rail--grid")).toBeNull();

    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(
          h(GutenbergSearch, {
            onGet: vi.fn(async () => undefined),
            fetchSearch,
            query: "quijote",
          }),
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(host.querySelector("ul.discover-rail--grid")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("la portada abre la vista previa y «Obtener libro» la cierra al lograrlo", async () => {
    const target = book("pg-1342", {
      title: "Don Quijote",
      author: "Miguel de Cervantes",
      language: "es",
      synopsis: "Un hidalgo manchego…",
      subjects: ["Novela", "Caballería"],
    });
    const onGet = vi.fn(async () => "hash-quijote");
    await render({
      onGet,
      fetchSearch: vi.fn(async () => page([target])),
    });
    const coverButton = host.querySelector<HTMLButtonElement>(
      ".discover-cover--action",
    )!;
    await act(async () => coverButton.click());

    const sheet = host.querySelector(".sheet")!;
    expect(sheet.textContent).toContain("Don Quijote");
    expect(sheet.textContent).toContain("Miguel de Cervantes");
    expect(sheet.textContent).toContain("Español");
    expect(sheet.textContent).toContain("Novela · Caballería");

    const obtain = [...sheet.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener libro",
    )!;
    await act(async () => obtain.click());
    expect(onGet).toHaveBeenCalledWith(target);
    expect(host.querySelector(".sheet")).toBeNull();
  });

  it("tras obtener, la tarjeta ofrece «Abrir» con el libro de la estantería", async () => {
    const target = book("pg-1342", { title: "Don Quijote" });
    const owned = {
      hash: "hash-quijote",
      name: "don-quijote.epub",
      addedAt: 1,
    } as ShelfItem;
    const onOpen = vi.fn();
    const onGet = vi.fn(async () => "hash-quijote");
    await render({
      onGet,
      onOpen,
      library: [owned],
      fetchSearch: vi.fn(async () => page([target])),
    });

    const getButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Obtener",
    )!;
    await act(async () => getButton.click());

    const openButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Abrir",
    )!;
    await act(async () => openButton.click());
    expect(onOpen).toHaveBeenCalledWith(owned);
  });
});
