import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { Hono } from "hono";
import { screen, screenZoneGate } from "./screen";
import { screenDiscover } from "./screen-discover";
import type { WorkerEnv } from "./db";

// Las cachés del isolate (OMDb 1 h, búsqueda 10 min, negativa SubDL
// 30 min) viven en el módulo: las pruebas que dependen de estado frío
// reimportan limpio, igual que catalog.test.ts.
async function freshScreen() {
  vi.resetModules();
  return (await import("./screen")).screen;
}

// Sesión y base simuladas (mismo patrón que catalog.test.ts):
// consumeRateUnits pasa por withClient → el queryMock decide si hay
// cuota. getSession devuelve lo que cada prueba dicte.
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

// Router de fetch por host: cada prueba instala su handler y las URLs
// inesperadas fallan ruidosamente (nunca deben llevar la llave a un
// mensaje de error: los handlers la reciben pero no la devuelven).
let fetchHandler: (url: string) => Promise<Response>;
beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  queryMock.mockReset().mockResolvedValue({ rows: [{ units_used: 1 }] });
  fetchMock.mockReset();
  fetchHandler = async () => {
    throw new Error("fetch inesperado en la prueba");
  };
  fetchMock.mockImplementation((input: unknown) =>
    fetchHandler(String(input)),
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

// Bucket R2 falso con la forma que screen.ts usa: get → { text() },
// put captura clave y cuerpo para las aserciones de «nada de texto
// de subtítulo en R2».
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

const KEYS = { OMDB_API_KEY: "omdb-test-key", SUBDL_API_KEY: "subdl-test-key" };
const env = (
  objects: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) => {
  const fake = fakeBucket(objects);
  return {
    fake,
    env: { BOOKS: fake.bucket, ...KEYS, ...extra },
  };
};

const req = (path: string, init?: RequestInit) =>
  new Request(`https://t${path}`, init);
const get = (e: unknown, path: string, app = screen) =>
  app.fetch(req(path), e as never);
const post = (e: unknown, body: unknown, app = screen) =>
  app.fetch(
    req("/api/screen/guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    e as never,
  );

// ---------- utilidades de subtítulos de prueba ----------

// 60 palabras inventadas (sin dígitos: el tokenizador no los traga)
// para pasar el mínimo de 50 formas de la guía.
const fakeWord = (i: number) =>
  `zorb${i
    .toString()
    .split("")
    .map((d) => "abcdefghi"[Number(d)])
    .join("")}`;

function makeSrt(): string {
  const words = Array.from({ length: 60 }, (_, i) => fakeWord(i));
  const lines: string[] = [];
  for (let cue = 0; cue < 6; cue++) {
    const slice = words.slice(cue * 10, cue * 10 + 10);
    const text =
      cue === 2
        ? `${slice.slice(0, 8).join(" ")} this is at stake ${slice[8]} ${slice[9]}`
        : slice.join(" ");
    const start = cue * 4;
    lines.push(
      String(cue + 1),
      `00:00:${String(start).padStart(2, "0")},000 --> 00:00:${String(start + 3).padStart(2, "0")},000`,
      text,
      "",
    );
  }
  return lines.join("\n");
}

async function makeZip(entries: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, contents] of Object.entries(entries)) {
    await writer.add(name, new TextReader(contents));
  }
  return writer.close();
}

const zipResponse = async (entries: Record<string, string>) =>
  new Response(new Blob([await makeZip(entries)]));

const MOVIE_REF = { type: "movie", imdbId: "tt01111111", language: "en" };
const TV_REF = {
  type: "tv",
  imdbId: "tt02222222",
  language: "en",
  season: 1,
  episode: 2,
};
const GUIDE_KEY_MOVIE = "screen-guides/v1/movie-tt01111111-en.json";
const GUIDE_KEY_TV = "screen-guides/v1/tv-tt02222222-s01e02-en.json";

const subdlFound = (url = "/subtitle/abc123") =>
  jsonRes({
    status: true,
    subtitles: [
      {
        release_name: "pack completo",
        lang: "en",
        url,
        hi: "false",
        full_season: "true",
      },
      {
        release_name: "suelto",
        lang: "en",
        url,
        hi: "false",
        full_season: "false",
      },
    ],
    results: [],
  });

// fetchHandler estándar para el flujo feliz de guía: OMDb no se usa,
// SubDL lista + descarga zip.
const happyGuideFetch = (srt = makeSrt(), zipEntries?: Record<string, string>) =>
  (async (url: string) => {
    if (url.startsWith("https://api.subdl.com/")) return subdlFound();
    if (url.startsWith("https://dl.subdl.com/")) {
      return zipResponse(zipEntries ?? { "Show.S01E02.1080p.srt": srt });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as (url: string) => Promise<Response>;

// ---------- sesión y llaves ----------

describe("autenticación", () => {
  it("todas las rutas responden 401 sin sesión", async () => {
    getSessionMock.mockResolvedValue(null);
    const { env: e } = env();
    expect((await get(e, "/api/screen/search?q=x")).status).toBe(401);
    expect((await get(e, "/api/screen/tv/tt01111111")).status).toBe(401);
    expect((await get(e, "/api/screen/tv/tt01111111/season/1")).status).toBe(401);
    expect((await get(e, "/api/screen/poster?imdbId=tt01111111")).status).toBe(401);
    expect((await post(e, MOVIE_REF)).status).toBe(401);
  });

  it("las rutas OMDb responden 503 sin OMDB_API_KEY", async () => {
    const app = await freshScreen();
    const { env: e } = env({}, { OMDB_API_KEY: undefined });
    for (const path of [
      "/api/screen/search?q=x",
      "/api/screen/tv/tt01111111",
      "/api/screen/tv/tt01111111/season/1",
      "/api/screen/poster?imdbId=tt01111111",
    ]) {
      expect((await get(e, path, app)).status).toBe(503);
    }
  });

  it("la guía responde 503 sin SUBDL_API_KEY cuando no hay copia en R2", async () => {
    const app = await freshScreen();
    const { env: e } = env({}, { SUBDL_API_KEY: undefined });
    const res = await post(e, MOVIE_REF, app);
    expect(res.status).toBe(503);
  });

  it("una guía ya guardada en R2 se sirve aunque falte SUBDL_API_KEY", async () => {
    const stored = JSON.stringify({
      v: 1,
      type: "movie",
      imdbId: "tt03333333",
      language: "en",
      forms: ["apple"],
      capitalOnly: [],
      phrases: ["at stake"],
      createdAt: 1700000000000,
    });
    const { env: e } = env(
      { "screen-guides/v1/movie-tt03333333-en.json": stored },
      { SUBDL_API_KEY: undefined },
    );
    const res = await post(e, {
      type: "movie",
      imdbId: "tt03333333",
      language: "en",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------- búsqueda OMDb ----------

describe("GET /api/screen/search", () => {
  it("mapea movie/series→tv, filtra episodios y hasPoster", async () => {
    fetchHandler = async (url) => {
      expect(url).toContain("s=severance");
      expect(url).toContain("apikey=omdb-test-key");
      return jsonRes({
        Response: "True",
        Search: [
          {
            Title: "Película Uno",
            Year: "2020",
            imdbID: "tt01111111",
            Type: "movie",
            Poster: "https://m.media-amazon.com/x.jpg",
          },
          {
            Title: "Episodio Suelto",
            Year: "2021",
            imdbID: "tt09999999",
            Type: "episode",
            Poster: "N/A",
          },
          {
            Title: "Serie Dos",
            Year: "2019–2022",
            imdbID: "tt02222222",
            Type: "series",
            Poster: "N/A",
          },
        ],
      });
    };
    const res = await get(env().env, "/api/screen/search?q=severance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
    };
    expect(body.results).toEqual([
      {
        imdbId: "tt01111111",
        type: "movie",
        title: "Película Uno",
        year: "2020",
        hasPoster: true,
      },
      {
        imdbId: "tt02222222",
        type: "tv",
        title: "Serie Dos",
        year: "2019–2022",
        hasPoster: false,
      },
    ]);
  });

  it("Response False y q vacío devuelven lista vacía", async () => {
    fetchHandler = async () => jsonRes({ Response: "False", Error: "x" });
    const { env: e } = env();
    const res = await get(e, "/api/screen/search?q=nada");
    expect(((await res.json()) as { results: unknown[] }).results).toEqual([]);
    const empty = await get(e, "/api/screen/search?q=");
    expect(((await empty.json()) as { results: unknown[] }).results).toEqual(
      [],
    );
  });

  it("rechaza q demasiado larga", async () => {
    const res = await get(env().env, `/api/screen/search?q=${"x".repeat(81)}`);
    expect(res.status).toBe(400);
  });

  it("cachea la búsqueda en el isolate: dos llamadas, un fetch", async () => {
    const app = await freshScreen();
    let calls = 0;
    fetchHandler = async () => {
      calls += 1;
      return jsonRes({ Response: "True", Search: [] });
    };
    const { env: e } = env();
    await get(e, "/api/screen/search?q=dracula", app);
    await get(e, "/api/screen/search?q=dracula", app);
    expect(calls).toBe(1);
  });
});

// ---------- detalle de serie y episodios ----------

describe("GET /api/screen/tv", () => {
  it("devuelve título y número de temporadas", async () => {
    fetchHandler = async (url) => {
      expect(url).toContain("i=tt01111111");
      return jsonRes({
        Response: "True",
        Title: "Severance",
        Type: "series",
        totalSeasons: "3",
      });
    };
    const res = await get(env().env, "/api/screen/tv/tt01111111");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Severance", seasons: 3 });
  });

  it("404 con Response False, con película o imdbId inválido → 400", async () => {
    fetchHandler = async () =>
      jsonRes({ Response: "False", Error: "Not found" });
    const { env: e } = env();
    expect((await get(e, "/api/screen/tv/tt04444444")).status).toBe(404);
    expect((await get(e, "/api/screen/tv/nope")).status).toBe(400);
  });

  it("una película en la ruta de serie también es 404", async () => {
    fetchHandler = async () =>
      jsonRes({ Response: "True", Title: "Film", Type: "movie" });
    expect((await get(env().env, "/api/screen/tv/tt05555555")).status).toBe(404);
  });
});

describe("GET /api/screen/tv/:imdbId/season/:n", () => {
  it("devuelve solo números de episodio, nunca títulos", async () => {
    fetchHandler = async (url) => {
      expect(url).toContain("i=tt01111111");
      expect(url).toContain("Season=1");
      return jsonRes({
        Response: "True",
        Episodes: [
          { Episode: "1", Title: "Secreto Uno" },
          { Episode: "2", Title: "Secreto Dos" },
          { Episode: "3", Title: "Secreto Tres" },
        ],
      });
    };
    const res = await get(env().env, "/api/screen/tv/tt01111111/season/1");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ episodes: [1, 2, 3] });
    expect(body).not.toContain("Secreto");
  });

  it("404 cuando OMDb dice False; 400 con temporada inválida", async () => {
    fetchHandler = async () => jsonRes({ Response: "False" });
    const { env: e } = env();
    expect(
      (await get(e, "/api/screen/tv/tt01111111/season/9")).status,
    ).toBe(404);
    expect(
      (await get(e, "/api/screen/tv/tt01111111/season/100")).status,
    ).toBe(400);
    expect(
      (await get(e, "/api/screen/tv/tt01111111/season/x")).status,
    ).toBe(400);
  });
});

// ---------- póster ----------

describe("GET /api/screen/poster", () => {
  const posterDetail = (poster: string) =>
    jsonRes({ Response: "True", Title: "X", Type: "movie", Poster: poster });

  it("reenvía el póster solo desde hosts permitidos, inmutable", async () => {
    fetchHandler = async (url) => {
      if (url.includes("omdbapi.com")) {
        return posterDetail("https://m.media-amazon.com/images/M/x.jpg");
      }
      if (url.startsWith("https://m.media-amazon.com/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    // tt01234567 es exclusivo de esta prueba: la caché OMDb del
    // isolate es por imdbId y un detalle cacheado sin Poster daría 404.
    const res = await get(
      env().env,
      "/api/screen/poster?imdbId=tt01234567",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("404 con host no permitido, http, N/A o imdbId inválido", async () => {
    const cases: Array<[string, string]> = [
      ["https://evil.example.com/x.jpg", "host ajeno"],
      ["http://m.media-amazon.com/x.jpg", "http plano"],
      ["N/A", "sin póster"],
    ];
    for (const [poster] of cases) {
      const app = await freshScreen();
      fetchHandler = async (url) =>
        url.includes("omdbapi.com")
          ? posterDetail(poster)
          : new Response("no", { status: 500 });
      const res = await get(
        env().env,
        "/api/screen/poster?imdbId=tt06666666",
        app,
      );
      expect(res.status).toBe(404);
    }
    expect(
      (await get(env().env, "/api/screen/poster?imdbId=nope")).status,
    ).toBe(400);
  });

  it("un póster ya en R2 se sirve sin tocar OMDb ni Amazon", async () => {
    const app = await freshScreen();
    const { env: e } = env({
      "screen/posters/tt05555555.jpg": "bytes-del-poster",
    });
    // Cualquier fetch es un fallo: el acierto en R2 no sale del worker.
    fetchHandler = async () => {
      throw new Error("fetch inesperado con póster en R2");
    };
    const res = await get(e, "/api/screen/poster?imdbId=tt05555555", app);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await res.text()).toBe("bytes-del-poster");
  });

  it("la URL del póster vista en la búsqueda ahorra la llamada ?i=", async () => {
    const app = await freshScreen();
    const { env: e } = env();
    const omdbCalls: string[] = [];
    fetchHandler = async (url) => {
      if (url.includes("omdbapi.com")) {
        omdbCalls.push(url);
        if (url.includes("s=")) {
          return jsonRes({
            Response: "True",
            Search: [
              {
                Title: "Matrix",
                Year: "1999",
                imdbID: "tt0133093",
                Type: "movie",
                Poster: "https://m.media-amazon.com/images/M/matrix.jpg",
              },
            ],
          });
        }
        // Un ?i= aquí significaría que el póster no reusó la búsqueda.
        throw new Error(`detalle OMDb inesperado: ${url}`);
      }
      if (url.startsWith("https://m.media-amazon.com/")) {
        return new Response(new Uint8Array([9, 9]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };

    const search = await get(e, "/api/screen/search?q=matrix", app);
    expect(search.status).toBe(200);
    const poster = await get(
      e,
      "/api/screen/poster?imdbId=tt0133093",
      app,
    );
    expect(poster.status).toBe(200);
    // Una sola llamada a OMDb en total: la búsqueda. El póster saltó
    // directo a Amazon con la URL que la búsqueda ya había traído.
    expect(omdbCalls).toHaveLength(1);
    expect(omdbCalls[0]).toContain("s=matrix");
  });

  it("guarda el póster en R2 y la segunda petición no vuelve a salir", async () => {
    const app = await freshScreen();
    const { env: e, fake } = env();
    let amazonCalls = 0;
    fetchHandler = async (url) => {
      if (url.includes("omdbapi.com")) {
        return posterDetail("https://m.media-amazon.com/images/M/r2.jpg");
      }
      if (url.startsWith("https://m.media-amazon.com/")) {
        amazonCalls += 1;
        return new Response(new Uint8Array([7]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };

    const first = await get(e, "/api/screen/poster?imdbId=tt07777777", app);
    expect(first.status).toBe(200);
    expect(fake.puts.map((p) => p.key)).toContain(
      "screen/posters/tt07777777.jpg",
    );

    const second = await get(e, "/api/screen/poster?imdbId=tt07777777", app);
    expect(second.status).toBe(200);
    expect(amazonCalls).toBe(1);
  });
});

// ---------- POST /api/screen/guide ----------

describe("POST /api/screen/guide — validación", () => {
  it("rechaza referencias inválidas con 400", async () => {
    const { env: e } = env();
    const bad = [
      { type: "movie", imdbId: "tt1", language: "en" }, // imdbId corto
      { type: "movie", imdbId: "tt01111111", language: "fr" }, // idioma
      { type: "movie", imdbId: "tt01111111", language: "en", season: 1 }, // movie con season
      { type: "tv", imdbId: "tt01111111", language: "en" }, // tv sin s/e
      { type: "tv", imdbId: "tt01111111", language: "en", season: 1 }, // tv sin episode
      { type: "book", imdbId: "tt01111111", language: "en" }, // type
      "no-es-objeto",
    ];
    for (const body of bad) {
      const res = await post(e, body);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON también es 400", async () => {
    const res = await screen.fetch(
      new Request("https://t/api/screen/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{roto",
      }),
      env().env as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/screen/guide — flujo", () => {
  it("acierto en R2: cached true, sin fetch ni cuota", async () => {
    const stored = JSON.stringify({
      v: 1,
      type: "movie",
      imdbId: "tt07777777",
      language: "en",
      forms: ["apple", "zebra"],
      capitalOnly: [],
      phrases: ["at stake"],
      createdAt: 1700000000000,
      dialogue: "texto que nunca debió guardarse",
    });
    const { env: e } = env({
      "screen-guides/v1/movie-tt07777777-en.json": stored,
    });
    const res = await post(e, {
      type: "movie",
      imdbId: "tt07777777",
      language: "en",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cached: boolean;
      guide: Record<string, unknown>;
    };
    expect(body.cached).toBe(true);
    // sanitizeScreenGuideObject reconstruyó el objeto: el extra
    // «dialogue» no llega al cliente.
    expect(body.guide.dialogue).toBeUndefined();
    expect(body.guide.forms).toEqual(["apple", "zebra"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("éxito movie: guía en R2 sin texto de subtítulo en ningún lado", async () => {
    const app = await freshScreen();
    const srt = makeSrt();
    fetchHandler = happyGuideFetch(srt, { "Film.2020.srt": srt });
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { env: e, fake } = env();
    const res = await post(e, MOVIE_REF, app);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      cached: boolean;
      guide: {
        v: number;
        type: string;
        imdbId: string;
        language: string;
        forms: string[];
        capitalOnly: string[];
        phrases: string[];
      };
    };
    expect(body.cached).toBe(false);
    expect(body.guide.v).toBe(1);
    expect(body.guide.type).toBe("movie");
    expect(body.guide.imdbId).toBe("tt01111111");
    expect(body.guide.forms.length).toBeGreaterThanOrEqual(50);
    expect(body.guide.phrases).toContain("at stake");
    // Solo formas sueltas ordenadas: ni diálogo contiguo, ni tiempos,
    // ni numeración de cue.
    expect(raw).not.toContain("-->");
    expect(raw).not.toContain("00:00:");
    expect(raw).not.toContain(`${fakeWord(0)} ${fakeWord(1)} ${fakeWord(2)}`);

    // Lo guardado en R2 es el mismo objeto saneado, en la clave del plan.
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].key).toBe(GUIDE_KEY_MOVIE);
    const stored = JSON.parse(fake.puts[0].body) as Record<string, unknown>;
    expect(stored.dialogue).toBeUndefined();
    expect(stored.forms).toEqual(body.guide.forms);
    expect(fake.puts[0].body).not.toContain("-->");
    expect(fake.puts[0].body).not.toContain("00:00:");

    // Ningún console.* recibió texto del subtítulo ni la llave.
    const logged = [consoleSpy, errorSpy, warnSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join(" ");
    expect(logged).not.toContain(fakeWord(0));
    expect(logged).not.toContain("subdl-test-key");
    expect(logged).not.toContain("00:00:");
  });

  it("éxito tv: pide temporada/episodio y elige el .srt del episodio", async () => {
    const app = await freshScreen();
    const wanted = makeSrt().replaceAll(fakeWord(0), "wantedword");
    const other = makeSrt().replaceAll(fakeWord(0), "otherword");
    const seen: string[] = [];
    fetchHandler = async (url) => {
      seen.push(url);
      if (url.startsWith("https://api.subdl.com/")) return subdlFound();
      if (url.startsWith("https://dl.subdl.com/")) {
        return zipResponse({
          "Show.S01E01.1080p.srt": other,
          "Show.S01E02.1080p.srt": wanted,
          "Show.S01E03.1080p.srt": other,
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const { env: e, fake } = env();
    const res = await post(e, TV_REF, app);
    expect(res.status).toBe(200);
    const listUrl = seen.find((u) => u.includes("api.subdl.com"))!;
    expect(listUrl).toContain("type=tv");
    expect(listUrl).toContain("season_number=1");
    expect(listUrl).toContain("episode_number=2");
    expect(listUrl).toContain("languages=EN");
    const body = (await res.json()) as {
      guide: { forms: string[]; season: number; episode: number };
    };
    expect(body.guide.season).toBe(1);
    expect(body.guide.episode).toBe(2);
    // El .srt elegido fue el del episodio: «wantedword» está en forms.
    expect(body.guide.forms).toContain("wantedword");
    expect(body.guide.forms).not.toContain("otherword");
    expect(fake.puts[0].key).toBe(GUIDE_KEY_TV);
  });

  it("si solo hay pack de temporada se descarga y se extrae el episodio", async () => {
    const app = await freshScreen();
    const wanted = makeSrt().replaceAll(fakeWord(0), "wantedword");
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) {
        return jsonRes({
          status: true,
          subtitles: [
            {
              release_name: "pack completo",
              lang: "en",
              url: "/sub/pack",
              hi: "false",
              full_season: "true",
            },
          ],
          results: [],
        });
      }
      if (url.startsWith("https://dl.subdl.com/")) {
        return zipResponse({
          "Show.S01E01.1080p.srt": makeSrt(),
          "Show.S01E02.1080p.srt": wanted,
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res = await post(env().env, TV_REF, app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guide: { forms: string[] } };
    expect(body.guide.forms).toContain("wantedword");
  });

  it("pack sin el .srt del episodio → 502, nunca otro episodio", async () => {
    const app = await freshScreen();
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) return subdlFound();
      if (url.startsWith("https://dl.subdl.com/")) {
        return zipResponse({
          "Show.S01E05.1080p.srt": makeSrt(),
          "Show.S01E06.1080p.srt": makeSrt(),
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res = await post(env().env, TV_REF, app);
    expect(res.status).toBe(502);
  });

  it("un .srt único sin marca de episodio sí se acepta", async () => {
    const app = await freshScreen();
    const wanted = makeSrt().replaceAll(fakeWord(0), "wantedword");
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) return subdlFound();
      if (url.startsWith("https://dl.subdl.com/")) {
        return zipResponse({ "Show.1080p.BluRay.x264.srt": wanted });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res = await post(env().env, TV_REF, app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guide: { forms: string[] } };
    expect(body.guide.forms).toContain("wantedword");
  });

  it("movie no manda season/episode a SubDL", async () => {
    const app = await freshScreen();
    const seen: string[] = [];
    fetchHandler = async (url) => {
      seen.push(url);
      return happyGuideFetch()(url);
    };
    await post(env().env, MOVIE_REF, app);
    const listUrl = seen.find((u) => u.includes("api.subdl.com"))!;
    expect(listUrl).toContain("type=movie");
    expect(listUrl).not.toContain("season_number");
  });

  it("cuota agotada → 429 sin tocar SubDL", async () => {
    const app = await freshScreen();
    queryMock.mockResolvedValue({ rows: [] });
    fetchHandler = happyGuideFetch();
    const res = await post(env().env, MOVIE_REF, app);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SubDL 429 → 503 «mañana»; 403 → 503 sin llave ni URL en el log", async () => {
    const app429 = await freshScreen();
    fetchHandler = async () => new Response("rate", { status: 429 });
    const res429 = await post(env().env, MOVIE_REF, app429);
    expect(res429.status).toBe(503);
    expect(await res429.text()).toContain("mañana");

    const app403 = await freshScreen();
    fetchHandler = async () => new Response("denied", { status: 403 });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const res403 = await post(env().env, MOVIE_REF, app403);
    expect(res403.status).toBe(503);
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("subdl-test-key");
    expect(logged).not.toContain("api.subdl.com");
    expect(logged).not.toContain("dl.subdl.com");
    // La respuesta al cliente tampoco filtra nada de la URL.
    expect(await res403.text()).not.toContain("subdl");
  });

  it("SubDL sin resultados → 404 y la negativa se cachea 30 min", async () => {
    const app = await freshScreen();
    let calls = 0;
    fetchHandler = async (url) => {
      calls += 1;
      if (url.startsWith("https://api.subdl.com/")) {
        return jsonRes({ status: false, subtitles: [] });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const { env: e } = env();
    const ref = { type: "movie", imdbId: "tt08888888", language: "en" };
    const first = await post(e, ref, app);
    expect(first.status).toBe(404);
    expect(await first.text()).toContain("vocabulario");
    const second = await post(e, ref, app);
    expect(second.status).toBe(404);
    expect(calls).toBe(1); // la segunda ni siquiera llamó a SubDL
  });

  it("zip gigante → 502 sin abrir el cuerpo", async () => {
    const app = await freshScreen();
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) return subdlFound();
      if (url.startsWith("https://dl.subdl.com/")) {
        return new Response(new Blob([new Uint8Array(16)]), {
          headers: { "content-length": String(3 * 1024 * 1024) },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res = await post(env().env, MOVIE_REF, app);
    expect(res.status).toBe(502);
  });

  it("descarga que falla → 502; .srt con menos de 50 formas → 404", async () => {
    const app = await freshScreen();
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) return subdlFound();
      if (url.startsWith("https://dl.subdl.com/")) {
        return new Response("no zip", { status: 500 });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res502 = await post(env().env, MOVIE_REF, app);
    expect(res502.status).toBe(502);

    const app2 = await freshScreen();
    const tiny = "1\n00:00:01,000 --> 00:00:02,000\nonly few words here\n";
    fetchHandler = happyGuideFetch(tiny, { "tiny.srt": tiny });
    const res404 = await post(env().env, MOVIE_REF, app2);
    expect(res404.status).toBe(404);
  });

  it("ninguna respuesta de error lleva la llave de SubDL", async () => {
    const app = await freshScreen();
    fetchHandler = async (url) => {
      if (url.startsWith("https://api.subdl.com/")) {
        throw new Error("red caída");
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const res = await post(env().env, MOVIE_REF, app);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("subdl-test-key");
  });
});

describe("screenZoneGate (zona apagada, M0)", () => {
  const gated = () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.use("/api/screen/*", screenZoneGate);
    app.route("/", screen);
    app.route("/", screenDiscover);
    return app;
  };
  const call = (env: Partial<WorkerEnv>, path: string, init?: RequestInit) =>
    gated().fetch(new Request(`https://t${path}`, init), env as never);

  it.each([
    ["GET", "/api/screen/search?q=dark"],
    ["GET", "/api/screen/tv/tt0944947"],
    ["GET", "/api/screen/tv/tt0944947/season/1"],
    ["GET", "/api/screen/poster?imdbId=tt0944947"],
    ["POST", "/api/screen/guide"],
    ["GET", "/api/screen/discover"],
    ["GET", "/api/screen/related?imdbId=tt0944947&type=tv"],
  ])("sin SCREEN_ENABLED, %s %s → 503 sin sesión ni R2", async (method, path) => {
    const get = vi.fn();
    const res = await call(
      { OMDB_API_KEY: "k", SUBDL_API_KEY: "k", TRACKT_API_KEY: "k", BOOKS: { get } as never },
      path,
      { method, body: method === "POST" ? "{}" : undefined },
    );
    expect(res.status).toBe(503);
    expect(get).not.toHaveBeenCalled();
  });

  it("con SCREEN_ENABLED=1 deja pasar a la ruta", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await call({ SCREEN_ENABLED: "1" }, "/api/screen/search?q=dark");
    expect(res.status).toBe(401);
  });
});
