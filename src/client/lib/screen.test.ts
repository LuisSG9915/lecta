import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSeasonEpisodes,
  fetchTvSeasons,
  mergeScreenChapter,
  mergeScreenChapterPhrases,
  nextEpisodeAfter,
  parseScreenPhrasesRecord,
  requestScreenGuide,
  ScreenApiError,
  screenPhraseItems,
  screenPhrasesKey,
  screenPosterUrl,
  searchScreen,
} from "./screen";
import type { ScreenGuideObject } from "../../shared/screen-guide";
import type { PaperBookGuide } from "../../shared/paper-guide";

const movieObject = (
  over: Partial<ScreenGuideObject> = {},
): ScreenGuideObject => ({
  v: 1,
  type: "movie",
  imdbId: "tt0133093",
  language: "en",
  forms: ["matrix", "neo", "agent"],
  capitalOnly: ["neo"],
  phrases: [],
  createdAt: 1000,
  ...over,
});

const episodeObject = (
  season: number,
  episode: number,
  over: Partial<ScreenGuideObject> = {},
): ScreenGuideObject => ({
  v: 1,
  type: "tv",
  imdbId: "tt0944947",
  language: "en",
  season,
  episode,
  forms: [`word${season}${episode}`, "common"],
  capitalOnly: [],
  phrases: [],
  createdAt: 1000,
  ...over,
});

const META = { bookHash: "abc123", title: "La obra", author: "Autor" };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mergeScreenChapter", () => {
  it("una película produce un solo capítulo «movie» rotulado «Película»", () => {
    const guide = mergeScreenChapter(null, movieObject(), META);
    expect(guide).not.toBeNull();
    expect(guide!.bookHash).toBe("abc123");
    expect(guide!.title).toBe("La obra");
    expect(guide!.language).toBe("en");
    expect(guide!.chapters).toHaveLength(1);
    expect(guide!.chapters[0].id).toBe("movie");
    expect(guide!.chapters[0].label).toBe("Película");
    expect(guide!.chapters[0].forms).toEqual(["agent", "matrix", "neo"]);
  });

  it("una serie acumula episodios ordenados por temporada y número", () => {
    let guide: PaperBookGuide | null = null;
    guide = mergeScreenChapter(guide, episodeObject(1, 10), META);
    guide = mergeScreenChapter(guide, episodeObject(1, 2), META);
    guide = mergeScreenChapter(guide, episodeObject(2, 1), META);
    guide = mergeScreenChapter(guide, episodeObject(1, 10), {
      ...META,
      title: "La obra (actualizada)",
    });
    expect(guide!.chapters.map((c) => c.id)).toEqual([
      "s01e02",
      "s01e10",
      "s02e01",
    ]);
    expect(guide!.chapters.map((c) => c.label)).toEqual([
      "T1 · E2",
      "T1 · E10",
      "T2 · E1",
    ]);
    // El episodio repetido se reemplazó, no se duplicó; el título nuevo
    // de la obra se conserva.
    expect(guide!.title).toBe("La obra (actualizada)");
    expect(guide!.chapters).toHaveLength(3);
  });

  it("ordena por número y no por texto («s01e100» después de «s01e99»)", () => {
    let guide: PaperBookGuide | null = null;
    guide = mergeScreenChapter(guide, episodeObject(1, 100), META);
    guide = mergeScreenChapter(guide, episodeObject(1, 99), META);
    expect(guide!.chapters.map((c) => c.id)).toEqual(["s01e99", "s01e100"]);
  });

  it("ignora una guía previa de otra obra (bookHash distinto)", () => {
    const foreign = mergeScreenChapter(null, movieObject(), {
      bookHash: "otro",
      title: "Otra",
    })!;
    const merged = mergeScreenChapter(foreign, episodeObject(1, 1), META);
    expect(merged!.chapters).toHaveLength(1);
    expect(merged!.chapters[0].id).toBe("s01e01");
  });

  it("devuelve null si la identidad del objeto no cuadra con su tipo", () => {
    // Un objeto tv sin temporada/episodio no puede convertirse en ref.
    const bad = { ...episodeObject(1, 1), season: undefined, episode: undefined };
    expect(
      mergeScreenChapter(null, bad as ScreenGuideObject, META),
    ).toBeNull();
  });
});

describe("requestScreenGuide", () => {
  const ref = {
    type: "movie" as const,
    imdbId: "tt0133093",
    language: "en" as const,
  };

  it("devuelve la guía sanitizada y el flag cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ guide: movieObject(), cached: true }),
      ),
    );
    const { guide, cached } = await requestScreenGuide(ref);
    expect(cached).toBe(true);
    expect(guide.type).toBe("movie");
    expect(guide.forms).toContain("matrix");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/screen/guide");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(ref);
  });

  it("un objeto que no coincide con el ref pedido se rechaza", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ guide: movieObject({ imdbId: "tt9999999" }) }),
      ),
    );
    await expect(requestScreenGuide(ref)).rejects.toMatchObject({
      name: "ScreenApiError",
      status: 0,
    });
  });

  it("propaga el status y mensaje del servidor (404 sin vocabulario)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "No hay vocabulario disponible." }, 404),
      ),
    );
    const error = await requestScreenGuide(ref).catch((e) => e);
    expect(error).toBeInstanceOf(ScreenApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("No hay vocabulario disponible.");
  });

  it("un fallo de red lanza ScreenApiError con status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const error = await requestScreenGuide(ref).catch((e) => e);
    expect(error).toBeInstanceOf(ScreenApiError);
    expect(error.status).toBe(0);
  });
});

describe("búsqueda y metadatos", () => {
  it("searchScreen devuelve solo items bien formados", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          results: [
            { imdbId: "tt1", type: "movie", title: "M", year: "2000", hasPoster: true },
            { imdbId: "tt2", type: "bad", title: "X" },
            "basura",
          ],
        }),
      ),
    );
    const items = await searchScreen("matrix");
    expect(items).toHaveLength(1);
    expect(items![0].imdbId).toBe("tt1");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/screen/search?q=matrix");
  });

  it("searchScreen devuelve null si el servidor falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    expect(await searchScreen("x")).toBeNull();
    expect(await searchScreen("   ")).toEqual([]);
  });

  it("fetchTvSeasons y fetchSeasonEpisodes validan la forma", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/season/"))
          return jsonResponse({ episodes: [1, 2, "x", 3.5] });
        return jsonResponse({ title: "Serie", seasons: 3 });
      }),
    );
    await expect(fetchTvSeasons("tt0944947")).resolves.toEqual({
      title: "Serie",
      seasons: 3,
    });
    // Solo enteros: «x» y 3.5 se filtran.
    await expect(fetchSeasonEpisodes("tt0944947", 1)).resolves.toEqual([1, 2]);
  });

  it("screenPosterUrl apunta al proxy del worker", () => {
    expect(screenPosterUrl("tt0133093")).toBe(
      "/api/screen/poster?imdbId=tt0133093",
    );
  });
});

describe("frases de la obra (screenPhrases)", () => {
  it("mergeScreenChapterPhrases acumula por capítulo y limpia claves ajenas", () => {
    let record = mergeScreenChapterPhrases(null, "s01e01", [
      "at stake",
      "inventada fuera del banco",
      "at stake",
    ]);
    record = mergeScreenChapterPhrases(record, "s01e02", ["bear in mind"]);
    expect(record).toEqual({
      s01e01: ["at stake"],
      s01e02: ["bear in mind"],
    });
    // Repetir el episodio reemplaza su entrada; lista vacía la borra.
    record = mergeScreenChapterPhrases(record, "s01e01", []);
    expect(record).toEqual({ s01e02: ["bear in mind"] });
  });

  it("parseScreenPhrasesRecord tolera JSON roto y filtra claves inválidas", () => {
    expect(parseScreenPhrasesRecord(null)).toEqual({});
    expect(parseScreenPhrasesRecord("{no json")).toEqual({});
    expect(parseScreenPhrasesRecord('["at stake"]')).toEqual({});
    expect(
      parseScreenPhrasesRecord(
        JSON.stringify({
          s01e01: ["at stake", "no-existe", 42],
          s01e02: "basura",
        }),
      ),
    ).toEqual({ s01e01: ["at stake"] });
  });

  it("screenPhrasesKey sigue el patrón de claves por libro", () => {
    expect(screenPhrasesKey("abc")).toBe("screenPhrases:v1:abc");
  });

  it("screenPhraseItems ordena por beta, recorta a 8 y elige glosa por lengua materna", () => {
    const all = [
      "take for granted",
      "make up mind",
      "catch off guard",
      "in the long run",
      "at stake",
      "bear in mind",
      "out of the blue",
      "avoir beau",
      "en vouloir à",
      "a duras penas",
      "dar por sentado",
    ];
    const items = screenPhraseItems(all, "es");
    expect(items).toHaveLength(8);
    // beta descendente: «en vouloir à» (1.0) y «avoir beau» (0.9) primero.
    expect(items[0].text).toBe("en vouloir à");
    expect(items[1].text).toBe("avoir beau");
    expect(items[0].meaning).toBeTruthy();
    // Lengua materna no española → glosa en inglés.
    const en = screenPhraseItems(["at stake"], "en");
    expect(en[0].meaning).toBe("at risk");
    // Patrones desconocidos se ignoran.
    expect(screenPhraseItems(["no-existe"], "es")).toEqual([]);
    expect(screenPhraseItems(undefined, "es")).toEqual([]);
  });
});

describe("antispoiler — la guía fusionada no puede llevar texto del guion", () => {
  it("los capítulos fusionados solo tienen las claves permitidas del contrato", () => {
    const guide = mergeScreenChapter(
      null,
      // Campos extra simulando un JSON manipulado: se descartan en
      // sanitizeScreenGuideObject antes de llegar aquí, y merge
      // tampoco los copiaría.
      episodeObject(1, 2, { forms: ["neo"], capitalOnly: [] }),
      META,
    )!;
    for (const chapter of guide.chapters) {
      expect(Object.keys(chapter).sort()).toEqual([
        "capitalOnly",
        "depth",
        "forms",
        "id",
        "kind",
        "label",
      ]);
      // Ni contexto, ni citas, ni orden narrativo: solo formas.
      expect(chapter).not.toHaveProperty("text");
      expect(chapter).not.toHaveProperty("context");
      expect(chapter).not.toHaveProperty("quote");
    }
    expect(guide.chapters[0].id).toBe("s01e02");
    expect(guide.chapters[0].label).toBe("T1 · E2");
  });
});

describe("nextEpisodeAfter", () => {
  it("devuelve null sin capítulos o sin ids de episodio", () => {
    expect(nextEpisodeAfter([])).toBeNull();
    expect(nextEpisodeAfter(["movie", "notas"])).toBeNull();
    expect(nextEpisodeAfter(["s01e0x", "xe1", "capítulo 3"])).toBeNull();
  });

  it("propone el siguiente episodio del mayor preparado", () => {
    expect(nextEpisodeAfter(["s01e01"])).toEqual({
      season: 1,
      episode: 2,
    });
    // Desordenados: gana la temporada/episodio más alto, no el último.
    expect(
      nextEpisodeAfter(["s02e05", "s01e09", "s02e01", "movie"]),
    ).toEqual({ season: 2, episode: 6 });
  });
});
