import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlobWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { catalog } from "./catalog";

// El índice se cachea en memoria del isolate ~5 min: las pruebas que
// dependen de una lectura fría reimportan el módulo limpio.
async function freshCatalog() {
  vi.resetModules();
  return (await import("./catalog")).catalog;
}

// Sesión y base simuladas (mismo patrón que community-books/quota):
// getSession devuelve lo que cada prueba dicte y withClient entrega un
// cliente cuyo query es el mock central — las rutas del catálogo no
// llaman a ninguno de los dos salvo la búsqueda y el EPUB pg-.
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

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue(null);
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Bucket R2 falso: un Map clave→contenido con la forma que el endpoint
// usa (`body` para streams de archivo, `text()` para el índice). Lo
// que importa es el contrato HTTP y qué clave se pide — nunca R2 real.
function fakeBucket(objects: Record<string, string>) {
  const gets: string[] = [];
  return {
    gets,
    bucket: {
      async get(key: string) {
        gets.push(key);
        const body = objects[key];
        if (body == null) return null;
        return {
          body,
          text: async () => body,
        };
      },
    },
  };
}

const env = (objects: Record<string, string>) => {
  const fake = fakeBucket(objects);
  return { fake, env: { BOOKS: fake.bucket } };
};

const INDEX = JSON.stringify({
  bookCount: 1,
  books: [{ id: "quijote", title: "Don Quijote", author: "Cervantes" }],
});

const get = (env: unknown, path: string, app = catalog) =>
  app.fetch(new Request(`https://t${path}`), env as never);

describe("GET /api/catalog", () => {
  it("sirve el índice con JSON y cache-control corto", async () => {
    const { env: e } = env({ "catalog/index.json": INDEX });
    const res = await get(e, "/api/catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("public");
    const body = (await res.json()) as { bookCount: number; books: { id: string }[] };
    expect(body.bookCount).toBe(1);
    expect(body.books[0].id).toBe("quijote");
  });

  it("cachea el índice en el isolate: dos lecturas, una ida a R2", async () => {
    const app = await freshCatalog();
    const { env: e, fake } = env({ "catalog/index.json": INDEX });
    await get(e, "/api/catalog", app);
    await get(e, "/api/catalog", app);
    expect(fake.gets).toEqual(["catalog/index.json"]);
  });

  it("404 cuando el índice no existe en el bucket", async () => {
    const app = await freshCatalog();
    const res = await get(env({}).env, "/api/catalog", app);
    expect(res.status).toBe(404);
  });

  it("503 sin binding", async () => {
    const res = await get({}, "/api/catalog");
    expect(res.status).toBe(503);
  });
});

describe("GET /api/catalog/:id/:kind", () => {
  it("sirve el epub con tipo e inmutabilidad", async () => {
    const { env: e, fake } = env({ "catalog/v2/quijote.epub": "PKFAKE" });
    const res = await get(e, "/api/catalog/quijote/epub");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("PKFAKE");
    expect(fake.gets).toEqual(["catalog/v2/quijote.epub"]);
  });

  it("sirve el manifiesto de vocabulario", async () => {
    const { env: e } = env({ "catalog/quijote.vocab.json": '{"forms":[]}' });
    const res = await get(e, "/api/catalog/quijote/vocab");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("sirve la portada como jpeg", async () => {
    const { env: e } = env({ "catalog/quijote.cover.jpg": "JPEG" });
    const res = await get(e, "/api/catalog/quijote/cover");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("404 limpio cuando el objeto no existe", async () => {
    const { env: e } = env({});
    const res = await get(e, "/api/catalog/quijote/cover");
    expect(res.status).toBe(404);
  });

  it("404 en kind desconocido (no consulta el bucket)", async () => {
    const { env: e, fake } = env({});
    const res = await get(e, "/api/catalog/quijote/manifesto");
    expect(res.status).toBe(404);
    expect(fake.gets).toEqual([]);
  });

  it("400 en id que rompe el patrón (nada de path traversal)", async () => {
    const { env: e, fake } = env({});
    // Un solo segmento pero fuera del patrón → el handler responde 400.
    for (const bad of ["a_b", "ABC123", "x y", "a".repeat(65), "quijote!"]) {
      const res = await get(e, `/api/catalog/${encodeURIComponent(bad)}/epub`);
      expect(res.status, bad).toBe(400);
    }
    // Un id que al decodificarse rompe el segmento ni siquiera llega a
    // la ruta: 404 del router. En ambos casos el bucket no se toca.
    const traversal = await get(e, "/api/catalog/..%2Fadmin/epub");
    expect(traversal.status).not.toBe(200);
    expect(fake.gets).toEqual([]);
  });

  it("503 sin binding", async () => {
    const res = await get({}, "/api/catalog/quijote/epub");
    expect(res.status).toBe(503);
  });
});

// ---------- Búsqueda en el índice propio de Gutenberg ----------

const SQL_SEARCH = "SELECT gutenberg_id, language, title, author, subjects";
const SQL_INDEXED = "SELECT 1 AS ok FROM";
const SQL_QUOTA = "INSERT INTO lecta_ai_quota";

const gbRow = (over: Record<string, unknown> = {}) => ({
  gutenberg_id: 1342,
  language: "es",
  title: "Don Quijote",
  author: "Cervantes",
  subjects: ["Fiction", "Spanish literature"],
  ...over,
});

// Enruta el query mock según la sentencia: búsqueda, comprobación de
// índice y cuota comparten el mismo withClient.
const installCatalogDb = (opts: {
  rows?: Record<string, unknown>[];
  indexed?: boolean;
  quotaOk?: boolean;
} = {}) => {
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes(SQL_SEARCH)) {
      return Promise.resolve({ rows: opts.rows ?? [] });
    }
    if (sql.includes(SQL_INDEXED)) {
      return Promise.resolve({
        rows: opts.indexed === false ? [] : [{ ok: 1 }],
      });
    }
    if (sql.includes(SQL_QUOTA)) {
      return Promise.resolve({
        rows: opts.quotaOk === false ? [] : [{ units_used: 1 }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
};

describe("GET /api/catalog/search", () => {
  it("devuelve la forma del contrato sin sesión", async () => {
    const app = await freshCatalog();
    installCatalogDb({
      rows: [
        gbRow(),
        gbRow({
          gutenberg_id: 84,
          title: "Frankenstein",
          author: "Shelley",
          language: "en",
          subjects: ["Gothic fiction"],
        }),
      ],
    });
    const res = await get({}, "/api/catalog/search?q=quijote", app);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const body = (await res.json()) as {
      page: number;
      hasMore: boolean;
      books: Record<string, unknown>[];
    };
    expect(body.page).toBe(0);
    expect(body.hasMore).toBe(false);
    expect(body.books).toEqual([
      {
        id: "pg-1342",
        gutenbergId: 1342,
        title: "Don Quijote",
        author: "Cervantes",
        language: "es",
        subjects: ["Fiction", "Spanish literature"],
        cover: true,
      },
      {
        id: "pg-84",
        gutenbergId: 84,
        title: "Frankenstein",
        author: "Shelley",
        language: "en",
        subjects: ["Gothic fiction"],
        cover: true,
      },
    ]);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("sin q ni filtros devuelve los más descargados (ORDER BY downloads)", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [] });
    const res = await get({}, "/api/catalog/search", app);
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ORDER BY downloads DESC, gutenberg_id");
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual([25, 0]);
  });

  it("normaliza q como search_text y exige todas las palabras", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [] });
    await get({}, "/api/catalog/search?q=Bécquer%20poesía&lang=es", app);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("language = $1");
    expect(sql).toContain("search_tokens @> $2::text[]");
    expect(sql).toContain("AND");
    expect(params.slice(0, 2)).toEqual(["es", ["becquer", "poesia"]]);
  });

  it("escapa los comodines de LIKE en los temas", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [] });
    await get({}, "/api/catalog/search?topic=100%25_", app);
    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("100\\%\\_");
  });

  it("filtra por tema sobre subjects en minúsculas", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [] });
    await get({}, "/api/catalog/search?topic=Fiction", app);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("unnest(subjects)");
    expect(sql).toContain("lower(s) LIKE");
    expect(params[0]).toBe("fiction");
  });

  it("pagina con OFFSET = page*24 y la fila 25 solo marca hasMore", async () => {
    const app = await freshCatalog();
    const rows = Array.from({ length: 25 }, (_, i) =>
      gbRow({ gutenberg_id: 2000 + i }),
    );
    installCatalogDb({ rows });
    const res = await get({}, "/api/catalog/search?page=2", app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      page: number;
      hasMore: boolean;
      books: unknown[];
    };
    expect(body.page).toBe(2);
    expect(body.hasMore).toBe(true);
    expect(body.books).toHaveLength(24);
    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([25, 48]);
  });

  it("cachea la búsqueda en el isolate: misma consulta, una ida a la base", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [gbRow()] });
    await get({}, "/api/catalog/search?q=uno", app);
    await get({}, "/api/catalog/search?q=uno", app);
    // « Uno » normaliza a la misma clave de caché.
    await get({}, "/api/catalog/search?q=%20Uno%20", app);
    const searches = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes(SQL_SEARCH),
    );
    expect(searches).toHaveLength(1);
  });

  it("tabla ausente → 200 con lista vacía (migración pendiente)", async () => {
    const app = await freshCatalog();
    queryMock.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "42P01" }),
    );
    const res = await get({}, "/api/catalog/search?q=x", app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasMore: boolean; books: unknown[] };
    expect(body).toEqual({ page: 0, hasMore: false, books: [] });
  });

  it.each([
    ["/api/catalog/search?q=" + "a".repeat(81), "q larga"],
    ["/api/catalog/search?topic=" + "a".repeat(41), "tema largo"],
    ["/api/catalog/search?lang=fr", "idioma inválido"],
    ["/api/catalog/search?page=50", "página fuera de rango"],
    ["/api/catalog/search?page=-1", "página negativa"],
    ["/api/catalog/search?page=1.5", "página no entera"],
  ])("400 en parámetros inválidos: %s", async (path) => {
    const app = await freshCatalog();
    const res = await get({}, path, app);
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ---------- EPUB de Gutenberg bajo demanda ----------

// Bucket R2 con estado: put escribe y get lo devuelve, como el bucket
// real. Los EPUB de prueba empiezan con la firma ZIP «PK».
function fakeR2(initial: Record<string, string | Uint8Array> = {}) {
  const encoder = new TextEncoder();
  const store = new Map<string, Uint8Array>(
    Object.entries(initial).map(([k, v]) => [
      k,
      typeof v === "string" ? encoder.encode(v) : v,
    ]),
  );
  const gets: string[] = [];
  const puts: { key: string; bytes: number }[] = [];
  return {
    store,
    gets,
    puts,
    bucket: {
      async get(key: string) {
        gets.push(key);
        const body = store.get(key);
        if (body == null) return null;
        return {
          body,
          text: async () => new TextDecoder().decode(body),
        };
      },
      async put(key: string, body: ArrayBuffer | Uint8Array) {
        puts.push({ key, bytes: body.byteLength });
        store.set(
          key,
          body instanceof Uint8Array ? body : new Uint8Array(body),
        );
      },
    },
  };
}

// EPUB mínimo de verdad, con la cabecera de PG: el worker lo limpia
// (debrandGutenbergEpub) antes de guardarlo.
const EPUB_BYTES = await (async () => {
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 });
  await writer.add(
    "OEBPS/content.opf",
    new TextReader(
      '<package><metadata><dc:identifier id="id">http://www.gutenberg.org/1342</dc:identifier><dc:title>Pride and Prejudice</dc:title></metadata><manifest><item href="t.xhtml" id="t" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="t"/></spine></package>',
    ),
  );
  await writer.add(
    "OEBPS/t.xhtml",
    new TextReader(
      '<html><head><title>Pride and Prejudice</title></head><body><header id="pg-header"><p>The Project Gutenberg eBook of Pride and Prejudice</p></header><p>It is a truth universally acknowledged.</p></body></html>',
    ),
  );
  return new Uint8Array(await (await writer.close()).arrayBuffer());
})();

async function storedText(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
  let text = "";
  for (const entry of await reader.getEntries()) {
    if (!entry.directory) text += await entry.getData(new TextWriter());
  }
  await reader.close();
  return text;
}

const okEpubFetch = () =>
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(EPUB_BYTES, {
        status: 200,
        headers: { "content-length": String(EPUB_BYTES.byteLength) },
      }),
    ),
  );

describe("GET /api/catalog/pg-<id>/epub bajo demanda", () => {
  it("cacheado en R2 se sirve sin sesión ni fetch", async () => {
    const app = await freshCatalog();
    const r2 = fakeR2({ "catalog/v2/pg-1342.epub": EPUB_BYTES });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("sin sesión → 401 antes de tocar la base ni gutenberg.org", async () => {
    const app = await freshCatalog();
    installCatalogDb({ indexed: true });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toContain(
      "Inicia sesión",
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("id fuera del índice → 404 sin cuota ni descarga", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: false });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(404);
    const sqls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => sql.includes(SQL_QUOTA))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuota agotada → 429 sin descargar", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true, quotaOk: false });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain(
      "muchos libros",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respuesta que no empieza con PK → 502", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(new TextEncoder().encode("NOTAZIP"), { status: 200 }),
      ),
    );
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(502);
  });

  it("content-length por encima de 25 MB → 502 sin leer el cuerpo", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-length" ? "30000000" : null,
        },
        arrayBuffer: async () => EPUB_BYTES.buffer,
      }),
    );
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(502);
  });

  it("éxito: guarda en R2 y la segunda petición no vuelve a descargar", async () => {
    const app = await freshCatalog();
    const r2 = fakeR2();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    okEpubFetch();
    const env = { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket };
    const first = await get(env, "/api/catalog/pg-1342/epub", app);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/epub+zip");
    expect(r2.puts.map((put) => put.key)).toEqual(["catalog/v2/pg-1342.epub"]);
    // Se guarda y se sirve sin la marca Project Gutenberg.
    const served = await storedText(await first.arrayBuffer());
    expect(served).toContain("It is a truth universally acknowledged.");
    expect(served).not.toMatch(/project gutenberg|gutenberg\.org/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // La URL es la de epub3.images; el UA identifica al catálogo.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.gutenberg.org/ebooks/1342.epub3.images");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "lecta-catalog/1.0",
    );

    const second = await get(env, "/api/catalog/pg-1342/epub", app);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cae a la URL epub.images si epub3.images falla", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 404 })))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(EPUB_BYTES, { status: 200 }),
        ),
      );
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/epub",
      app,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      "https://www.gutenberg.org/ebooks/1342.epub.images",
    );
  });

  it("vocab de ids pg- sigue en 404 (sin rescate ni fetch)", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/vocab",
      app,
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pg- con sufijo no numérico → 404 sin tocar nada", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-abc/epub",
      app,
    );
    expect(res.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------- Portada de Gutenberg bajo demanda ----------

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const okCoverFetch = () =>
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JPEG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(JPEG_BYTES.byteLength),
        },
      }),
    ),
  );

describe("CATALOG_PG_FETCH apagado (M6)", () => {
  it("un miss de EPUB pg- responde 404 sin sesión, base ni gutenberg.org", async () => {
    const app = await freshCatalog();
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    installCatalogDb({ indexed: true });
    const res = await get({ BOOKS: fakeR2().bucket }, "/api/catalog/pg-1342/epub", app);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("un miss de portada pg- responde 404 sin tocar gutenberg.org", async () => {
    const app = await freshCatalog();
    installCatalogDb({ indexed: true });
    const res = await get({ BOOKS: fakeR2().bucket }, "/api/catalog/pg-1342/cover", app);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/catalog/pg-<id>/cover bajo demanda", () => {
  it("cacheada en R2 se sirve sin sesión ni fetch", async () => {
    const app = await freshCatalog();
    const r2 = fakeR2({ "catalog/pg-1342.cover.jpg": JPEG_BYTES });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket },
      "/api/catalog/pg-1342/cover",
      app,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("éxito: baja de gutenberg.org, guarda en R2 y la segunda sale de R2", async () => {
    const app = await freshCatalog();
    const r2 = fakeR2();
    installCatalogDb({ indexed: true });
    okCoverFetch();
    const e = { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket };
    const first = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(r2.puts).toEqual([
      { key: "catalog/pg-1342.cover.jpg", bytes: JPEG_BYTES.byteLength },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg",
    );
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "lecta-catalog/1.0",
    );

    const second = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("id fuera del índice → 404 sin tocar gutenberg.org", async () => {
    const app = await freshCatalog();
    installCatalogDb({ indexed: false });
    const res = await get(
      { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket },
      "/api/catalog/pg-1342/cover",
      app,
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("id visto por la búsqueda no repite el SELECT a la base", async () => {
    const app = await freshCatalog();
    installCatalogDb({ rows: [gbRow()], indexed: false });
    const e = { CATALOG_PG_FETCH: "1", BOOKS: fakeR2().bucket };
    // La búsqueda registra el id en indexedIdCache.
    await get(e, "/api/catalog/search?q=quijote", app);
    queryMock.mockClear();
    okCoverFetch();
    const res = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(res.status).toBe(200);
    const sqls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => sql.includes(SQL_INDEXED))).toBe(false);
  });

  it.each([
    ["404 de gutenberg.org", () => new Response("no", { status: 404 })],
    [
      "HTML con 200",
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ],
    [
      "jpeg declarado pero bytes que no son JPEG",
      () =>
        new Response(new TextEncoder().encode("NOTAJPEG"), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ],
    [
      "content-length por encima de 400 kB",
      () =>
        new Response(JPEG_BYTES, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(500 * 1024),
          },
        }),
    ],
  ])("%s → 404 sin guardar y la negativa se cachea 6 h", async (_name, make) => {
    const app = await freshCatalog();
    const r2 = fakeR2();
    installCatalogDb({ indexed: true });
    fetchMock.mockImplementation(() => Promise.resolve(make()));
    const e = { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket };
    const first = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(first.status).toBe(404);
    expect(r2.puts).toEqual([]);
    // Segunda petición: la negativa cacheada responde sin volver a
    // llamar a gutenberg.org.
    const second = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(second.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fallo de red → 404 sin cachear la negativa", async () => {
    const app = await freshCatalog();
    const r2 = fakeR2();
    installCatalogDb({ indexed: true });
    fetchMock.mockRejectedValue(new Error("timeout"));
    const e = { CATALOG_PG_FETCH: "1", BOOKS: r2.bucket };
    const first = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(first.status).toBe(404);
    okCoverFetch();
    const second = await get(e, "/api/catalog/pg-1342/cover", app);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
