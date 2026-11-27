// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenShelf from "./ScreenShelf";
import { ScreenApiError } from "../lib/screen";
import { screenWorkHash } from "../../shared/screen-guide";
import type { ScreenGuideObject } from "../../shared/screen-guide";
import type { ShelfItem } from "./Shelf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// La hoja calcula screenWorkHash con crypto.subtle: la promesa puede
// resolver en un macrotask que los microtasks de flush() no alcanzan
// con fake timers — un avance de 0 ms lo vacía de forma fiable.
const flushDeep = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await flush();
  });

const movieResult = {
  imdbId: "tt0133093",
  type: "movie" as const,
  title: "Matrix",
  year: "1999",
  hasPoster: false,
};

const seriesResult = {
  imdbId: "tt0944947",
  type: "tv" as const,
  title: "Game of Thrones",
  year: "2011",
  hasPoster: false,
};

const guideObject = (
  over: Partial<ScreenGuideObject> = {},
): ScreenGuideObject => ({
  v: 1,
  type: "movie",
  imdbId: "tt0133093",
  language: "en",
  forms: ["matrix", "neo"],
  capitalOnly: [],
  phrases: [],
  createdAt: 1,
  ...over,
});

const work = (over: Partial<ShelfItem> = {}): ShelfItem => ({
  hash: "h1",
  name: "work",
  addedAt: 1,
  title: "Matrix",
  author: undefined,
  cover: undefined,
  language: "en",
  mediaKind: "movie",
  paperOnly: true,
  ...over,
});

type Props = Parameters<typeof ScreenShelf>[0];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (props: Partial<Props> = {}) =>
  act(async () => {
    root.render(
      h(ScreenShelf, {
        works: [],
        onOpenWork: vi.fn(),
        onRemoveWork: vi.fn(),
        onPrepareWork: vi.fn(async () => true),
        fetchSearch: vi.fn(async () => [movieResult]),
        fetchSeasons: vi.fn(async () => ({ title: "GoT", seasons: 2 })),
        fetchEpisodes: vi.fn(async () => [1, 2, 3]),
        requestGuide: vi.fn(async () => ({ guide: guideObject(), cached: false })),
        ...props,
      }),
    );
    await flush();
  });

const typeSearch = async (value: string) => {
  const input = host.querySelector<HTMLInputElement>("#screen-search")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(400);
    await flush();
  });
};

const clickButton = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );
  expect(button, `botón «${label}»`).toBeTruthy();
  await act(async () => {
    button!.click();
    await flush();
  });
};

const sheet = () => host.querySelector(".sheet");

const pill = (group: string, label: string) =>
  [
    ...host.querySelectorAll<HTMLButtonElement>(
      `[aria-label="${group}"] button`,
    ),
  ].find((b) => b.textContent?.trim() === label);

describe("ScreenShelf", () => {
  it("lista «Tus títulos» y «Quitar» exige confirmación en dos pasos", async () => {
    const onRemoveWork = vi.fn();
    await render({
      works: [
        work(),
        work({
          hash: "h2",
          title: "Game of Thrones",
          mediaKind: "tv",
          language: "es",
        }),
      ],
      onRemoveWork,
    });
    expect(host.textContent).toContain("Tus títulos");
    expect(host.textContent).toContain("Película");
    expect(host.textContent).toContain("Serie");

    // Primer toque: solo pide confirmación, no borra.
    await clickButton("Quitar");
    expect(onRemoveWork).not.toHaveBeenCalled();
    expect(host.textContent).toContain("¿Quitar de este dispositivo?");

    // «Cancelar» desarma sin borrar y devuelve el botón simple.
    await clickButton("Cancelar");
    expect(onRemoveWork).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("¿Quitar de este dispositivo?");

    // Segundo intento confirmado: sí borra.
    await clickButton("Quitar");
    await clickButton("Sí, quitar");
    expect(onRemoveWork).toHaveBeenCalledWith("h1");
  });

  it("sin obras muestra la invitación a preparar", async () => {
    await render();
    expect(host.textContent).toContain("Prepara el vocabulario");
    expect(host.textContent).toContain(
      "Solo guardamos una lista de palabras; nunca el diálogo.",
    );
  });

  it("la tarjeta abre la hoja y una película se prepara con su idioma", async () => {
    const requestGuide = vi.fn(async () => ({
      guide: guideObject({ language: "es" }),
      cached: false,
    }));
    const onPrepareWork = vi.fn(async () => true);
    await render({ requestGuide, onPrepareWork });

    await typeSearch("matrix");
    expect(host.textContent).toContain("Matrix");
    expect(host.textContent).toContain("Película · 1999");

    await clickButton("Matrix");
    expect(sheet()?.textContent).toContain("Matrix");
    expect(sheet()?.textContent).toContain("Película · 1999");
    // Película: sin temporadas ni episodios, solo el idioma.
    expect(sheet()?.querySelector('[aria-label="Temporada"]')).toBeNull();

    const espanol = pill("Idioma del audio", "Español")!;
    await act(async () => {
      espanol.click();
      await flush();
    });
    expect(espanol.getAttribute("aria-pressed")).toBe("true");

    await clickButton("Preparar vocabulario");
    expect(requestGuide).toHaveBeenCalledWith({
      type: "movie",
      imdbId: "tt0133093",
      language: "es",
    });
    expect(onPrepareWork).toHaveBeenCalledWith({
      ref: { type: "movie", imdbId: "tt0133093", language: "es" },
      guide: expect.objectContaining({ imdbId: "tt0133093" }),
      title: "Matrix",
    });
    // Al preparar bien la hoja se cierra (el padre abrió la obra).
    expect(sheet()).toBeNull();
  });

  it("la tarjeta con póster pinta la imagen y cae al bloque si falla", async () => {
    await render({
      fetchSearch: vi.fn(async () => [{ ...movieResult, hasPoster: true }]),
    });
    await typeSearch("matrix");
    const img = host.querySelector<HTMLImageElement>(
      ".discover-cover img.cover",
    );
    expect(img?.getAttribute("src")).toBe(
      "/api/screen/poster?imdbId=tt0133093",
    );
    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector(".discover-cover img.cover")).toBeNull();
    expect(host.querySelector(".screen-poster-fallback")).not.toBeNull();
  });

  it("en una serie la hoja pide temporadas y episodios antes de preparar", async () => {
    const fetchEpisodes = vi.fn(async (_id: string, season: number) =>
      season === 1 ? [1, 2, 3] : [1],
    );
    const requestGuide = vi.fn(async () => ({
      guide: guideObject({
        type: "tv",
        imdbId: "tt0944947",
        season: 2,
        episode: 1,
      }),
      cached: true,
    }));
    const onPrepareWork = vi.fn(async () => true);
    await render({
      fetchSearch: vi.fn(async () => [seriesResult]),
      fetchEpisodes,
      requestGuide,
      onPrepareWork,
    });

    await typeSearch("thrones");
    await clickButton("Game of Thrones");
    expect(sheet()).toBeTruthy();

    // Sin temporada/episodio el botón sigue deshabilitado.
    const prepareButton = () =>
      [...sheet()!.querySelectorAll("button")].find(
        (b) => b.textContent === "Preparar vocabulario",
      ) as HTMLButtonElement;
    expect(prepareButton().disabled).toBe(true);

    const season2 = pill("Temporada", "2")!;
    await act(async () => {
      season2.click();
      await flush();
    });
    expect(fetchEpisodes).toHaveBeenCalledWith("tt0944947", 2);
    expect(prepareButton().disabled).toBe(true);

    const episode1 = [
      ...sheet()!.querySelectorAll<HTMLButtonElement>(".screen-ep"),
    ].find((b) => b.textContent?.includes("1"))!;
    await act(async () => {
      episode1.click();
      await flush();
    });
    expect(episode1.getAttribute("aria-pressed")).toBe("true");
    expect(prepareButton().disabled).toBe(false);

    await clickButton("Preparar vocabulario");
    expect(requestGuide).toHaveBeenCalledWith({
      type: "tv",
      imdbId: "tt0944947",
      language: "en",
      season: 2,
      episode: 1,
    });
    expect(onPrepareWork).toHaveBeenCalled();
  });

  it("«Otro episodio» fija el idioma y preselecciona el siguiente con ✓", async () => {
    const hash = await screenWorkHash("tv", "tt0944947", "en");
    expect(hash).toBeTruthy();
    const loadPreparedChapters = vi.fn(async () => ["s01e01"]);
    const fetchEpisodes = vi.fn(async () => [1, 2, 3]);
    const requestGuide = vi.fn(async () => ({
      guide: guideObject({
        type: "tv",
        imdbId: "tt0944947",
        language: "en",
        season: 1,
        episode: 2,
      }),
      cached: true,
    }));
    await render({
      works: [
        work({
          hash: hash!,
          title: "Game of Thrones",
          mediaKind: "tv",
          imdbId: "tt0944947",
          language: "en",
        }),
      ],
      loadPreparedChapters,
      fetchEpisodes,
      requestGuide,
    });

    await clickButton("Otro episodio");
    await flushDeep();
    expect(sheet()?.textContent).toContain("Audio: Inglés");
    // Sin píldoras de idioma: el audio quedó fijo.
    expect(sheet()?.querySelector('[aria-label="Idioma del audio"]')).toBeNull();
    // La temporada del siguiente episodio (s01e01 → T1 E2) viene elegida.
    const season1 = pill("Temporada", "1")!;
    expect(season1.getAttribute("aria-pressed")).toBe("true");
    expect(loadPreparedChapters).toHaveBeenCalledWith(hash);

    // Episodio 1 marcado como preparado (✓ + etiqueta accesible) y el
    // 2 preseleccionado por la sugerencia.
    const eps = [...sheet()!.querySelectorAll<HTMLButtonElement>(".screen-ep")];
    const ep1 = eps.find((b) => b.getAttribute("aria-label")?.includes("Episodio 1"))!;
    expect(ep1.querySelector(".icon--check")).toBeTruthy();
    expect(ep1.getAttribute("aria-label")).toBe("Episodio 1, ya preparado");
    const ep2 = eps.find((b) => b.getAttribute("aria-label") === "Episodio 2")!;
    expect(ep2.getAttribute("aria-pressed")).toBe("true");

    await clickButton("Preparar vocabulario");
    expect(requestGuide).toHaveBeenCalledWith({
      type: "tv",
      imdbId: "tt0944947",
      language: "en",
      season: 1,
      episode: 2,
    });
  });

  it("un episodio ya preparado ofrece «Ver palabras» por el mismo flujo", async () => {
    const hash = await screenWorkHash("movie", "tt0133093", "en");
    await render({
      works: [
        work({ hash: hash!, title: "Matrix", mediaKind: "movie", imdbId: "tt0133093" }),
      ],
      loadPreparedChapters: vi.fn(async () => ["movie"]),
    });

    await typeSearch("matrix");
    await clickButton("Matrix");
    await flushDeep();
    // Película = capítulo «movie»: ya está en la lista → «Ver palabras».
    const verPalabras = [...sheet()!.querySelectorAll("button")].find(
      (b) => b.textContent === "Ver palabras",
    )!;
    expect(verPalabras).toBeTruthy();
    await act(async () => {
      verPalabras.click();
      await flush();
    });
    expect(sheet()).toBeNull();
  });

  it("muestra el error del servidor al preparar (404 sin vocabulario)", async () => {
    const requestGuide = vi.fn(async () => {
      throw new ScreenApiError(404, "No hay subtítulos para este episodio.");
    });
    await render({ requestGuide });
    await typeSearch("matrix");
    await clickButton("Matrix");
    await clickButton("Preparar vocabulario");
    expect(sheet()?.textContent).toContain(
      "No hay subtítulos para este episodio.",
    );
    // La hoja sigue abierta para reintentar.
    expect(sheet()).toBeTruthy();
  });

  it("la búsqueda fallida muestra error y sin resultados el vacío", async () => {
    await render({ fetchSearch: vi.fn(async () => null) });
    await typeSearch("zzz");
    expect(host.textContent).toContain("No pudimos buscar. Reintenta.");

    await render({
      fetchSearch: vi.fn(async () => []),
    });
    const input = host.querySelector<HTMLInputElement>("#screen-search")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "otra");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(400);
      await flush();
    });
    expect(host.textContent).toContain("Sin resultados.");
  });

  const railItem = (imdbId: string, title: string) => ({
    imdbId,
    type: "movie" as const,
    title,
    year: "2020",
    hasPoster: false,
  });

  it("pinta los rieles y oculta vacíos e instalados", async () => {
    await render({
      works: [work({ imdbId: "tt9999999", title: "Ya instalada" })],
      fetchDiscover: vi.fn(async () => ({
        source: "curated" as const,
        rails: [
          {
            id: "trending" as const,
            items: [
              railItem("tt1111111", "Tendencia uno"),
              railItem("tt9999999", "Instalada de nuevo"),
            ],
          },
          { id: "recent" as const, items: [] },
          { id: "popular" as const, items: [railItem("tt2222222", "Popular uno")] },
        ],
      })),
      // La semilla (la obra instalada) pide related y recibe justo el
      // imdbId ya instalado: el riel queda vacío y no se pinta.
      fetchRelated: vi.fn(async () => [
        railItem("tt9999999", "Repetida"),
      ]),
    });
    await flushDeep();

    expect(host.textContent).toContain("En tendencia");
    expect(host.textContent).toContain("Tendencia uno");
    expect(host.textContent).not.toContain("Instalada de nuevo");
    expect(host.textContent).toContain("Populares");
    expect(host.textContent).toContain("Popular uno");
    // Riel vacío → su título no aparece.
    expect(host.textContent).not.toContain("Estrenos recientes");
    // Related solo trajo lo ya instalado → «Porque preparaste» oculto.
    expect(host.textContent).not.toContain("Porque preparaste");
    expect(host.textContent).not.toContain("Repetida");
  });

  it("«Porque preparaste» usa la obra más reciente como semilla", async () => {
    const fetchRelated = vi.fn(async (imdbId: string) =>
      imdbId === "tt0000002"
        ? [railItem("tt5555555", "Similar nueva")]
        : [],
    );
    await render({
      works: [
        work({
          hash: "h-old",
          title: "Obra vieja",
          imdbId: "tt0000001",
          mediaKind: "movie",
          addedAt: 100,
        }),
        work({
          hash: "h-new",
          title: "Obra nueva",
          imdbId: "tt0000002",
          mediaKind: "tv",
          addedAt: 200,
        }),
      ],
      fetchDiscover: vi.fn(async () => ({
        source: "curated" as const,
        rails: [],
      })),
      fetchRelated,
    });
    await flushDeep();

    // Las dos semillas recientes piden related; solo la nueva trajo.
    expect(fetchRelated).toHaveBeenCalledWith("tt0000002", "tv");
    expect(fetchRelated).toHaveBeenCalledWith("tt0000001", "movie");
    expect(host.textContent).toContain("Porque preparaste «Obra nueva»");
    expect(host.textContent).toContain("Similar nueva");
    expect(host.textContent).not.toContain("Porque preparaste «Obra vieja»");
  });

  it("con texto en el buscador los rieles desaparecen", async () => {
    await render({
      fetchDiscover: vi.fn(async () => ({
        source: "trakt" as const,
        rails: [
          { id: "popular" as const, items: [railItem("tt2222222", "Popular uno")] },
        ],
      })),
      fetchRelated: vi.fn(async () => []),
    });
    await flushDeep();
    expect(host.querySelector(".screen-discover")).not.toBeNull();
    expect(host.textContent).toContain("Populares");

    await typeSearch("matrix");
    expect(host.querySelector(".screen-discover")).toBeNull();
    expect(host.textContent).not.toContain("Populares");
    // Los resultados de búsqueda sí aparecen.
    expect(host.textContent).toContain("Matrix");
  });

  it("si discover falla no se pintan rieles y la búsqueda sigue", async () => {
    await render({
      fetchDiscover: vi.fn(async () => null),
      fetchRelated: vi.fn(async () => []),
    });
    await flushDeep();
    expect(host.querySelector(".screen-discover-rail")).toBeNull();

    await typeSearch("matrix");
    expect(host.textContent).toContain("Matrix");
  });
});
