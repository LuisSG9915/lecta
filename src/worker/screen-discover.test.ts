import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenDiscover } from "./screen-discover";

// Mismo arnés que screen.test.ts: sesión y base simuladas; las cachés
// del isolate (rieles 10 min) se reinician reimportando el módulo.
async function freshDiscover() {
  vi.resetModules();
  return (await import("./screen-discover")).screenDiscover;
}

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return {
    ...actual,
    getSession: (...args: unknown[]) => getSessionMock(...args),
    getSessionUser: async (...args: unknown[]) => {
      const s = await getSessionMock(...args);
      return s?.user ?? null;
    },
  };
});

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    withClient: async (
      _env: unknown,
      run: (client: { query: typeof queryMock }) => Promise<unknown>,
      _cached?: boolean,
    ) => run({ query: queryMock }),
  };
});

const fetchMock = vi.hoisted(() => vi.fn());

let fetchHandler: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  queryMock.mockReset().mockResolvedValue({ rows: [{ units_used: 1 }] });
  fetchMock.mockReset();
  fetchHandler = async () => {
    throw new Error("fetch inesperado en la prueba");
  };
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
    fetchHandler(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

// Bucket R2 falso: mismo contrato que screen.test.ts (get → text(),
// put captura clave y cuerpo).
function fakeBucket(objects: Record<string, string> = {}) {
  const puts: Array<{ key: string; body: string }> = [];
  const store = { ...objects };
  return {
    puts,
    bucket: {
      async get(key: string) {
        const body = store[key];
        if (body == null) return null;
        return { body, text: async () => body };
      },
      async put(key: string, value: string) {
        puts.push({ key, body: value });
        store[key] = value;
      },
    },
  };
}

const TRAKT_KEY = "trakt-test-key";
const env = (
  objects: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) => {
  const fake = fakeBucket(objects);
  return {
    fake,
    env: { BOOKS: fake.bucket, TRACKT_API_KEY: TRAKT_KEY, ...extra },
  };
};

const req = (path: string) => new Request(`https://t${path}`);
const get = (e: unknown, path: string, app = screenDiscover) =>
  app.fetch(req(path), e as never);

// Filas con la forma real de Trakt (sonda 2026-11-16): trending
// envuelve en movie/show; popular y related devuelven el objeto
// directo. year viaja como número.
const traktMovie = (imdb: string, title: string, year = 2020) => ({
  ids: { imdb, trakt: 1, slug: title.toLowerCase().replace(/\s+/g, "-") },
  title,
  year,
});
const trendingRow = (kind: "movie" | "show", item: unknown) => ({
  watchers: 100,
  [kind]: item,
});

const RAILS_FRESH = JSON.stringify({
  fetchedAt: Date.now(),
  rails: [
    {
      id: "popular",
      items: [
        {
          imdbId: "tt1111111",
          type: "movie",
          title: "Cached Film",
          year: "2021",
          hasPoster: true,
        },
      ],
    },
  ],
});
const RAILS_STALE = JSON.stringify({
  fetchedAt: Date.now() - 13 * 60 * 60_000, // > 12 h
  rails: [
    {
      id: "popular",
      items: [
        {
          imdbId: "tt2222222",
          type: "tv",
          title: "Old Show",
          year: "2019",
          hasPoster: true,
        },
      ],
    },
  ],
});

// Respuestas Trakt para los 6 listados: trending/popular/recent.
const traktListsOk = (url: string) => {
  if (url.includes("/movies/trending"))
    return jsonRes([
      trendingRow("movie", traktMovie("tt0000001", "Trend Movie", 2026)),
      { ids: { trakt: 9 }, title: "Sin imdb", year: 2020 }, // se descarta
      trendingRow("movie", traktMovie("tt0000003", "Trend Movie 2", 2025)),
    ]);
  if (url.includes("/shows/trending"))
    return jsonRes([
      trendingRow("show", traktMovie("tt0000002", "Trend Show", 2026)),
    ]);
  if (url.includes("/movies/popular") && url.includes("years="))
    return jsonRes([traktMovie("tt0000011", "Recent Movie", 2026)]);
  if (url.includes("/shows/popular") && url.includes("years="))
    return jsonRes([traktMovie("tt0000012", "Recent Show", 2025)]);
  if (url.includes("/movies/popular"))
    return jsonRes([traktMovie("tt0000021", "Popular Movie", 2024)]);
  if (url.includes("/shows/popular"))
    return jsonRes([traktMovie("tt0000022", "Popular Show", 2023)]);
  throw new Error(`URL Trakt inesperada: ${url}`);
};

describe("autenticación", () => {
  it("discover y related responden 401 sin sesión", async () => {
    getSessionMock.mockResolvedValue(null);
    const { env: e } = env();
    expect((await get(e, "/api/screen/discover")).status).toBe(401);
    expect(
      (await get(e, "/api/screen/related?imdbId=tt0133093&type=movie")).status,
    ).toBe(401);
  });
});

describe("GET /api/screen/discover", () => {
  it("sin TRACKT_API_KEY sirve el respaldo curado", async () => {
    const app = await freshDiscover();
    const fake = fakeBucket();
    const res = await app.fetch(
      req("/api/screen/discover"),
      { BOOKS: fake.bucket } as never,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      source: string;
      rails: Array<{ id: string; items: unknown[] }>;
    };
    expect(data.source).toBe("curated");
    expect(data.rails).toHaveLength(1);
    expect(data.rails[0].id).toBe("popular");
    expect(data.rails[0].items.length).toBeGreaterThan(20);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con llave arma 3 rieles intercalados, descarta inválidos y guarda en R2", async () => {
    const app = await freshDiscover();
    const { fake, env: e } = env();
    fetchHandler = async (url) => traktListsOk(url);
    const seenHeaders: RequestInit[] = [];
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      seenHeaders.push(init ?? {});
      return fetchHandler(String(input), init);
    });

    const res = await get(e, "/api/screen/discover", app);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      source: string;
      rails: Array<{
        id: string;
        items: Array<Record<string, unknown>>;
      }>;
    };
    expect(data.source).toBe("trakt");
    expect(data.rails.map((r) => r.id)).toEqual([
      "trending",
      "recent",
      "popular",
    ]);
    // Intercalado película/serie en trending: tt0000001 (movie)
    // primero y tt0000002 (show) segundo; la fila sin ids.imdb se
    // descartó.
    const trending = data.rails[0].items;
    expect(trending.map((i) => i.imdbId)).toEqual([
      "tt0000001",
      "tt0000002",
      "tt0000003",
    ]);
    expect(trending.map((i) => i.type)).toEqual(["movie", "tv", "movie"]);
    // Solo los 5 campos permitidos.
    for (const item of trending) {
      expect(Object.keys(item).sort()).toEqual(
        ["hasPoster", "imdbId", "title", "type", "year"].sort(),
      );
    }
    // La llave viaja en la cabecera, nunca en la respuesta.
    expect(
      seenHeaders.every(
        (init) =>
          (init.headers as Record<string, string>)?.["trakt-api-key"] ===
          TRAKT_KEY,
      ),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toContain(TRAKT_KEY);
    // Se guardó en R2 para la próxima copia fresca.
    expect(fake.puts.some((p) => p.key === "screen-discover/v1/rails.json"))
      .toBe(true);
  });

  it("copia fresca en R2 se sirve sin llamar a Trakt", async () => {
    const app = await freshDiscover();
    const { env: e } = env({ "screen-discover/v1/rails.json": RAILS_FRESH });
    const res = await get(e, "/api/screen/discover", app);
    const data = (await res.json()) as { source: string; rails: unknown[] };
    expect(data.source).toBe("trakt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Trakt caído + copia vieja en R2 → sirve la copia vencida", async () => {
    const app = await freshDiscover();
    const { env: e } = env({ "screen-discover/v1/rails.json": RAILS_STALE });
    fetchHandler = async () => new Response("down", { status: 503 });
    const res = await get(e, "/api/screen/discover", app);
    const data = (await res.json()) as {
      source: string;
      rails: Array<{ items: Array<{ title: string }> }>;
    };
    expect(data.source).toBe("trakt");
    expect(data.rails[0].items[0].title).toBe("Old Show");
  });

  it("Trakt caído sin copia → respaldo curado", async () => {
    const app = await freshDiscover();
    const { env: e } = env();
    fetchHandler = async () => {
      throw new Error("red caída");
    };
    const res = await get(e, "/api/screen/discover", app);
    const data = (await res.json()) as { source: string };
    expect(data.source).toBe("curated");
  });
});

describe("GET /api/screen/related", () => {
  it("rechaza imdbId o type inválidos con 400", async () => {
    const app = await freshDiscover();
    const { env: e } = env();
    expect(
      (await get(e, "/api/screen/related?imdbId=xx&type=movie", app)).status,
    ).toBe(400);
    expect(
      (await get(e, "/api/screen/related?imdbId=tt0133093&type=book", app))
        .status,
    ).toBe(400);
  });

  it("acierto fresco en R2: sin fetch ni cuota", async () => {
    const app = await freshDiscover();
    const stored = JSON.stringify({
      fetchedAt: Date.now(),
      items: [
        {
          imdbId: "tt0999999",
          type: "movie",
          title: "Related Film",
          year: "2020",
          hasPoster: true,
          extra: "campo prohibido",
        },
      ],
    });
    const { env: e } = env({
      "screen-discover/v1/related-movie-tt0133093.json": stored,
    });
    const res = await get(
      e,
      "/api/screen/related?imdbId=tt0133093&type=movie",
      app,
    );
    const data = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(data.items).toHaveLength(1);
    // El campo extra no sobrevive la revalidación.
    expect(Object.keys(data.items[0]).sort()).toEqual(
      ["hasPoster", "imdbId", "title", "type", "year"].sort(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("sin llave → items vacíos sin fetch", async () => {
    const app = await freshDiscover();
    const fake = fakeBucket();
    const res = await app.fetch(
      req("/api/screen/related?imdbId=tt0133093&type=movie"),
      { BOOKS: fake.bucket } as never,
    );
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuota agotada → items vacíos sin llamar a Trakt", async () => {
    const app = await freshDiscover();
    queryMock.mockResolvedValue({ rows: [] }); // consumeRateUnits → false
    const { env: e } = env();
    const res = await get(
      e,
      "/api/screen/related?imdbId=tt0133093&type=movie",
      app,
    );
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Trakt responde → guarda en R2 y devuelve items limpios", async () => {
    const app = await freshDiscover();
    const { fake, env: e } = env();
    fetchHandler = async (url) => {
      if (url.includes("/movies/tt0133093/related"))
        return jsonRes([
          traktMovie("tt7777777", "Related A", 2019),
          traktMovie("tt0133093", "Self", 1999), // la misma obra: se deduplica? no — related no deduplica contra la semilla
        ]);
      throw new Error(`URL inesperada: ${url}`);
    };
    const res = await get(
      e,
      "/api/screen/related?imdbId=tt0133093&type=movie",
      app,
    );
    const data = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(data.items.map((i) => i.imdbId)).toEqual(["tt7777777", "tt0133093"]);
    expect(fake.puts.some((p) => p.key.includes("related-movie-tt0133093")))
      .toBe(true);
    expect(JSON.stringify(data)).not.toContain(TRAKT_KEY);
  });

  it("fallo de Trakt → items vacíos", async () => {
    const app = await freshDiscover();
    const { env: e } = env();
    fetchHandler = async () => new Response("down", { status: 500 });
    const res = await get(
      e,
      "/api/screen/related?imdbId=tt0133093&type=tv",
      app,
    );
    expect(await res.json()).toEqual({ items: [] });
  });
});
