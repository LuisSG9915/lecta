// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenShelf from "./ScreenShelf";
import { ScreenApiError } from "../lib/screen";
import type { ScreenGuideObject } from "../../shared/screen-guide";
import type { ShelfItem } from "./Shelf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

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
        fetchEpisodes: vi.fn(async () => [1, 2]),
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

const selectValue = async (id: string, value: string) => {
  const select = host.querySelector<HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
  });
};

describe("ScreenShelf", () => {
  it("lista «Tus títulos» con la etiqueta Serie/Película y permite quitar", async () => {
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
    expect(host.textContent).toContain("Matrix");
    expect(host.textContent).toContain("Serie");
    expect(host.textContent).toContain("Película");
    const remove = host.querySelector<HTMLButtonElement>(
      '[aria-label="Quitar Matrix"]',
    )!;
    await act(async () => {
      remove.click();
    });
    expect(onRemoveWork).toHaveBeenCalledWith("h1");
  });

  it("sin obras muestra la invitación a preparar", async () => {
    await render();
    expect(host.textContent).toContain("Prepara el vocabulario");
    expect(host.textContent).toContain(
      "Solo guardamos una lista de palabras; nunca el diálogo.",
    );
  });

  it("busca, elige una película y prepara con el idioma del audio", async () => {
    const fetchSearch = vi.fn(async () => [movieResult]);
    const requestGuide = vi.fn(async () => ({
      guide: guideObject({ language: "es" }),
      cached: false,
    }));
    const onPrepareWork = vi.fn(async () => true);
    await render({ fetchSearch, requestGuide, onPrepareWork });

    await typeSearch("matrix");
    expect(fetchSearch).toHaveBeenCalledWith("matrix");
    expect(host.textContent).toContain("Matrix");

    await clickButton("Matrix");
    // Película: no hay selects de temporada/episodio.
    expect(host.querySelector("#screen-season")).toBeNull();

    await selectValue("screen-lang", "es");
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
  });

  it("en una serie pide temporadas y episodios antes de preparar", async () => {
    const fetchSeasons = vi.fn(async () => ({ title: "GoT", seasons: 2 }));
    const fetchEpisodes = vi.fn(async (_id: string, season: number) =>
      season === 1 ? [1, 2] : [1],
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
      fetchSeasons,
      fetchEpisodes,
      requestGuide,
      onPrepareWork,
    });

    await typeSearch("thrones");
    await clickButton("Game of Thrones");
    expect(fetchSeasons).toHaveBeenCalledWith("tt0944947");

    // Sin temporada/episodio el botón sigue deshabilitado.
    const prepare = () =>
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Preparar vocabulario",
      ) as HTMLButtonElement;
    expect(prepare().disabled).toBe(true);

    await selectValue("screen-season", "2");
    expect(fetchEpisodes).toHaveBeenCalledWith("tt0944947", 2);
    await selectValue("screen-episode", "1");
    expect(prepare().disabled).toBe(false);

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

  it("muestra el error del servidor al preparar (404 sin vocabulario)", async () => {
    const requestGuide = vi.fn(async () => {
      throw new ScreenApiError(404, "No hay subtítulos para este episodio.");
    });
    await render({ requestGuide });
    await typeSearch("matrix");
    await clickButton("Matrix");
    await clickButton("Preparar vocabulario");
    expect(host.textContent).toContain(
      "No hay subtítulos para este episodio.",
    );
  });

  it("la búsqueda fallida muestra error y sin resultados el vacío", async () => {
    await render({ fetchSearch: vi.fn(async () => null) });
    await typeSearch("zzz");
    expect(host.textContent).toContain("No pudimos buscar. Reintenta.");

    await render({
      fetchSearch: vi.fn(async () => []),
    });
    // El segundo render reutiliza el mismo root: limpiamos la query.
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
});
