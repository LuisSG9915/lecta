import { Hono, type Context } from "hono";
import {
  isMissingTableError,
  isMissingColumnError,
  withClient,
  type WorkerEnv,
} from "./db";
import { createTtlCache } from "./ai";
import { CATALOG } from "./lexicon";
import { getSession } from "./session";
import { consumeRateUnits } from "./rate-limit";
import { debrandGutenbergEpub } from "../shared/gutenberg-debrand";

// Catálogo público de Lecta: clásicos en dominio público servidos desde
// el bucket compartido bajo el prefijo `catalog/` (nada que ver con
// `books/{userId}/`, que es privado y se purga al borrar la cuenta).
//
//   GET /api/catalog               → índice curado (index.json)
//   GET /api/catalog/search        → índice propio de Gutenberg en Postgres
//   GET /api/catalog/:id/epub      → el EPUB completo, inmutable
//   GET /api/catalog/:id/vocab     → manifiesto de vocabulario precomputado
//   GET /api/catalog/:id/cover     → portada JPG (404 si el título no tiene)
//
// Sin sesión: es contenido de lectura compartido, no datos del usuario.
// El índice se cachea en el isolate ~5 min para no pegarle a R2 en cada
// apertura de la estantería; los objetos del catálogo son inmutables —
// un libro nuevo estrena id, nunca se sobrescribe el mismo.
//
// Los ids `pg-<n>` (Gutenberg) son la excepción: no vienen del índice
// curado en R2, se resuelven bajo demanda contra
// lecta_dev.gutenberg_books (la tabla es la huella de que la obra pasó
// la regla de derechos) y la primera descarga la trae de gutenberg.org
// para guardarla en `catalog/pg-<n>.epub` — desde ahí se sirve como
// cualquier otro objeto inmutable del bucket. Su portada sigue el
// mismo patrón bajo `catalog/pg-<n>.cover.jpg`, pero sin sesión ni
// cuota: es una imagen pública de gutenberg.org, no el libro.
export const catalog = new Hono<{ Bindings: WorkerEnv }>();

// Solo minúsculas, dígitos y guiones: los ids salen de la curación y
// sirven como llave R2 — el patrón impide path traversal a otros
// prefijos del bucket.
const CATALOG_ID = /^[a-z0-9-]{1,64}$/;
const INDEX_KEY = "catalog/index.json";
const IMMUTABLE = "public, max-age=31536000, immutable";
const INDEX_CACHE_CONTROL = "public, max-age=300";

// Índice en memoria del isolate (~5 min): es un JSON compartido que
// solo cambia al resembrar el catálogo — el TTL basta para no pegarle
// a R2 en cada apertura de la estantería.
const indexCache = createTtlCache<string>({ maxEntries: 1, ttlMs: 5 * 60_000 });
const INDEX_CACHE_KEY = "catalog-index";

const key = (id: string, suffix: string) => `catalog/${id}.${suffix}`;
// Los EPUB se sirven sin la marca Project Gutenberg desde catalog/v2/
// (scripts/catalog-debrand.mjs para el curado, debrandGutenbergEpub al
// bajar un pg-). Las claves viejas catalog/<id>.epub llevan la marca y
// ya no se leen. Ver docs/designs/2026-11-15-explora-derechos.md (R4).
const epubKey = (id: string) => `catalog/v2/${id}.epub`;

catalog.get("/api/catalog", async (context) => {
  const bucket = context.env.BOOKS;
  if (!bucket) {
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  }

  const cached = indexCache.get(INDEX_CACHE_KEY);
  if (cached != null) {
    return new Response(cached, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": INDEX_CACHE_CONTROL,
      },
    });
  }

  const object = await bucket.get(INDEX_KEY);
  if (!object) {
    return context.json({ error: "El catálogo no está disponible." }, 404);
  }
  const body = await object.text();
  indexCache.set(INDEX_CACHE_KEY, body);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": INDEX_CACHE_CONTROL,
    },
  });
});

// ---------- Búsqueda en el índice propio de Gutenberg ----------
//
// La tabla lecta_dev.gutenberg_books (migración 029) la llena
// scripts/gutenberg-index.mjs: título + autor ya normalizados en
// search_text (minúsculas, sin acentos). Todas las palabras de `q`
// deben aparecer como subcadena — un AND implícito por palabra.
// Sin sesión, igual que el resto del catálogo; si la tabla todavía
// no existe en el entorno, responde lista vacía en vez de error.

const SEARCH_MAX_Q = 80;
const SEARCH_MAX_TOPIC = 40;
const SEARCH_MAX_PAGE = 49;
const SEARCH_WORDS = 5;
const SEARCH_PAGE_SIZE = 24;

// Resultados cacheados en el isolate 10 min por combinación de
// parámetros normalizados: la tabla solo cambia al recargar el
// índice, así que el TTL es generoso y acota el trabajo por búsqueda.
const searchCache = createTtlCache<string>({
  maxEntries: 200,
  ttlMs: 10 * 60_000,
});

// Ids que la búsqueda ya vio en la tabla: la portada pg- los acepta
// sin repetir el SELECT a la base (la tabla solo cambia al recargar
// el índice, así que una hora de confianza sobra).
const indexedIdCache = createTtlCache<true>({
  maxEntries: 2000,
  ttlMs: 60 * 60_000,
});

// Misma normalización que searchTextOf (scripts/catalog-seed-lib.mjs):
// las dos puntas del LIKE tienen que coincidir o «Bécquer» no halla
// «becquer».
const normalizeTerms = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// LIKE usa \ como escape por defecto: %, _ y la propia \ del término
// se escapan para que la búsqueda del usuario nunca actúe de comodín.
const likeEscape = (value: string) =>
  value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

type GutenbergRow = {
  gutenberg_id: number;
  language: string;
  title: string;
  author: string;
  subjects: string[] | null;
};

catalog.get("/api/catalog/search", async (context) => {
  const rawQ = context.req.query("q") ?? "";
  const lang = context.req.query("lang");
  const rawTopic = context.req.query("topic") ?? "";
  const pageRaw = context.req.query("page") ?? "0";

  if (rawQ.length > SEARCH_MAX_Q) {
    return context.json({ error: "La búsqueda es demasiado larga." }, 400);
  }
  if (rawTopic.length > SEARCH_MAX_TOPIC) {
    return context.json({ error: "El tema es demasiado largo." }, 400);
  }
  if (lang != null && lang !== "" && lang !== "es" && lang !== "en") {
    return context.json({ error: "Idioma no válido." }, 400);
  }
  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 0 || page > SEARCH_MAX_PAGE) {
    return context.json({ error: "Página inválida." }, 400);
  }

  const q = normalizeTerms(rawQ);
  const words = q
    ? q
        .split(" ")
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter(Boolean)
        .slice(0, SEARCH_WORDS)
    : [];
  const topic = normalizeTerms(rawTopic);

  const cacheKey = [q, lang ?? "", topic, page].join("|");
  const cached = searchCache.get(cacheKey);
  if (cached != null) {
    return new Response(cached, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": INDEX_CACHE_CONTROL,
      },
    });
  }

  // Construye la consulta. En modo 'tokens' la búsqueda por palabras usa
  // `search_tokens @> $terms` (índice invertido, sin full scan). En modo
  // 'like' cae al LIKE con comodín inicial, que funciona aunque la columna
  // search_tokens no exista todavía (entornos sin la migración 030).
  const buildSql = (mode: "tokens" | "like") => {
    const params: unknown[] = [];
    const filters: string[] = [];
    if (lang) {
      params.push(lang);
      filters.push(`language = $${params.length}`);
    }
    if (words.length) {
      if (mode === "tokens") {
        params.push(words);
        filters.push(`search_tokens @> $${params.length}::text[]`);
      } else {
        for (const word of words) {
          params.push(likeEscape(word));
          filters.push(`search_text LIKE '%' || $${params.length} || '%'`);
        }
      }
    }
    if (topic) {
      params.push(likeEscape(topic));
      filters.push(
        `EXISTS (SELECT 1 FROM unnest(subjects) s WHERE lower(s) LIKE '%' || $${params.length} || '%')`,
      );
    }
    // Se piden PAGE_SIZE+1: la fila extra solo sirve para hasMore.
    params.push(SEARCH_PAGE_SIZE + 1, page * SEARCH_PAGE_SIZE);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT gutenberg_id, language, title, author, subjects
      FROM ${CATALOG}gutenberg_books
      ${where}
      ORDER BY downloads DESC, gutenberg_id
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    return { sql, params };
  };

  let rows: GutenbergRow[] | undefined;
  // Intento primario: tokens (usa el índice invertido). Si la columna o la
  // tabla no existen en este entorno, degradar a LIKE.
  let fallbackToLike = false;
  for (const mode of ["tokens", "like"] as const) {
    if (mode === "like" && !fallbackToLike) break;
    const { sql, params } = buildSql(mode);
    try {
      const result = await withClient(
        context.env,
        (client) => client.query<GutenbergRow>(sql, params),
        true,
      );
      rows = result?.rows;
      break;
    } catch (err) {
      const missingCol = isMissingColumnError(err);
      const missingTbl = isMissingTableError(err);
      if (missingTbl) {
        rows = undefined;
        break;
      }
      if (missingCol && mode === "tokens") {
        fallbackToLike = true;
        continue;
      }
      throw err;
    }
  }

  const hasMore = (rows?.length ?? 0) > SEARCH_PAGE_SIZE;
  const books = (rows ?? [])
    .slice(0, SEARCH_PAGE_SIZE)
    .map((row) => {
      // La portada existe bajo demanda (serveGutenbergCover): `cover`
      // le dice al cliente que pida la imagen y caiga a la tipográfica
      // si algún título no la tiene.
      indexedIdCache.set(String(row.gutenberg_id), true);
      return {
        id: `pg-${row.gutenberg_id}`,
        gutenbergId: row.gutenberg_id,
        title: row.title,
        author: row.author,
        language: row.language,
        subjects: row.subjects ?? [],
        cover: true,
      };
    });
  const body = JSON.stringify({ page, hasMore, books });
  searchCache.set(cacheKey, body);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": INDEX_CACHE_CONTROL,
    },
  });
});

// ---------- EPUB de Gutenberg bajo demanda ----------
//
// Los ids pg-<n> no existen en el índice curado: solo se sirven si la
// obra está en gutenberg_books (pasó derechos al indexarse) y la
// primera petición la trae de gutenberg.org — con sesión y cuota —
// para dejarla en `catalog/pg-<n>.epub`. A partir de ahí el bucket la
// sirve como cualquier otro catálogo, sin sesión.

const GUTENBERG_ID = /^pg-(\d{1,7})$/;
const GUTENBERG_EPUB3_URL = (id: number) =>
  `https://www.gutenberg.org/ebooks/${id}.epub3.images`;
const GUTENBERG_EPUB_URL = (id: number) =>
  `https://www.gutenberg.org/ebooks/${id}.epub.images`;
const GUTENBERG_MAX_BYTES = 25 * 1024 * 1024;
const GUTENBERG_TIMEOUT_MS = 25_000;

type CatalogBucket = NonNullable<WorkerEnv["BOOKS"]>;

// Intenta las dos URLs del EPUB (epub3 primero, como el seed). Devuelve
// el ArrayBuffer solo si responde 200, no pasa de 25 MB y empieza con
// la firma ZIP «PK»; cualquier otra cosa prueba la siguiente URL y, si
// ninguna sirve, null → 502.
async function downloadGutenbergEpub(
  gutenbergId: number,
): Promise<ArrayBuffer | null> {
  for (const url of [
    GUTENBERG_EPUB3_URL(gutenbergId),
    GUTENBERG_EPUB_URL(gutenbergId),
  ]) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "lecta-catalog/1.0" },
        signal: AbortSignal.timeout(GUTENBERG_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > GUTENBERG_MAX_BYTES) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > GUTENBERG_MAX_BYTES) continue;
      const bytes = new Uint8Array(buf);
      if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        continue;
      }
      return buf;
    } catch {
      // Timeout o red caída: se prueba la otra URL antes de rendirse.
    }
  }
  return null;
}

async function serveGutenbergEpub(
  context: Context<{ Bindings: WorkerEnv }>,
  bucket: CatalogBucket,
  gutenbergId: number,
) {
  const session = await getSession(context);
  if (!session) {
    return context.json(
      { error: "Inicia sesión para obtener este libro." },
      401,
    );
  }

  // La fila en gutenberg_books es la prueba de que la obra pasó la
  // regla de derechos al indexarse: sin ella no se sirve ni se gasta
  // cuota ni se toca gutenberg.org.
  let indexed = false;
  try {
    const result = await withClient(
      context.env,
      (client) =>
        client.query(
          `SELECT 1 AS ok FROM ${CATALOG}gutenberg_books WHERE gutenberg_id = $1`,
          [gutenbergId],
        ),
      true,
    );
    indexed = Boolean(result?.rows[0]);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  if (!indexed) {
    return context.json({ error: "No encontrado." }, 404);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    20,
    "catalog-fetch",
  );
  if (!allowed) {
    return context.json(
      {
        error:
          "Ya obtuviste muchos libros en esta hora. Intenta más tarde.",
      },
      429,
    );
  }

  const raw = await downloadGutenbergEpub(gutenbergId);
  const epub = raw
    ? await debrandGutenbergEpub(new Uint8Array(raw), `pg-${gutenbergId}`)
        .then(({ bytes, residual }) =>
          residual.some((hit) => hit.where !== "mention") ? null : bytes,
        )
        .catch(() => null)
    : null;
  if (!epub) {
    return context.json(
      { error: "No pudimos traer este libro. Intenta más tarde." },
      502,
    );
  }

  const objectKey = epubKey(`pg-${gutenbergId}`);
  await bucket.put(objectKey, epub);
  return new Response(epub, {
    headers: {
      "content-type": "application/epub+zip",
      "cache-control": IMMUTABLE,
    },
  });
}

// ---------- Portada de Gutenberg bajo demanda ----------
//
// gutenberg.org publica una portada por obra en una URL predecible
// (`/cache/epub/<n>/pg<n>.cover.medium.jpg`, ~15–40 kB). La primera
// petición la trae, la valida (JPEG real, ≤400 kB) y la guarda en
// `catalog/pg-<n>.cover.jpg`; desde ahí el bucket la sirve como
// cualquier portada del catálogo. Sin sesión ni cuota — es una
// imagen pública, no el libro. La negativa «este id no tiene
// portada» se cachea 6 h para no martillear gutenberg.org; un fallo
// de red NO se cachea (la próxima petición lo reintenta).

const GUTENBERG_COVER_URL = (id: number) =>
  `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
const GUTENBERG_COVER_MAX_BYTES = 400 * 1024;
const GUTENBERG_COVER_TIMEOUT_MS = 10_000;
const coverMissCache = createTtlCache<true>({
  maxEntries: 2000,
  ttlMs: 6 * 60 * 60_000,
});

// JPEG empieza por FF D8 FF: firma mínima para no guardar el HTML de
// un 404 disfrazado de imagen.
const isJpegBytes = (bytes: Uint8Array) =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

async function serveGutenbergCover(
  context: Context<{ Bindings: WorkerEnv }>,
  bucket: CatalogBucket,
  gutenbergId: number,
) {
  const notFoundCover = () =>
    context.json({ error: "No encontrado." }, 404);

  if (coverMissCache.get(String(gutenbergId)) !== undefined) {
    return notFoundCover();
  }

  // La fila en gutenberg_books es la prueba de que la obra pasó la
  // regla de derechos al indexarse — la misma guarda que el EPUB. La
  // búsqueda ya poblo indexedIdCache con los ids de sus páginas, así
  // que la mayoría de peticiones no tocan la base.
  let indexed = indexedIdCache.get(String(gutenbergId)) === true;
  if (!indexed) {
    try {
      const result = await withClient(
        context.env,
        (client) =>
          client.query(
            `SELECT 1 AS ok FROM ${CATALOG}gutenberg_books WHERE gutenberg_id = $1`,
            [gutenbergId],
          ),
        true,
      );
      indexed = Boolean(result?.rows[0]);
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
    if (indexed) indexedIdCache.set(String(gutenbergId), true);
  }
  if (!indexed) return notFoundCover();

  let res: Response | null;
  try {
    res = await fetch(GUTENBERG_COVER_URL(gutenbergId), {
      headers: { "User-Agent": "lecta-catalog/1.0" },
      signal: AbortSignal.timeout(GUTENBERG_COVER_TIMEOUT_MS),
    });
  } catch {
    res = null;
  }
  // Respuesta definitiva «no hay portada» → negativa cacheada. Un
  // fallo de red (res null) devuelve 404 sin cachear: gutenberg.org
  // puede estar caído un rato y la próxima petición debe reintentar.
  const miss = (cache: boolean) => {
    if (cache) coverMissCache.set(String(gutenbergId), true);
    return notFoundCover();
  };
  if (!res) return miss(false);
  if (!res.ok) return miss(true);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/jpeg")) return miss(true);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > GUTENBERG_COVER_MAX_BYTES) return miss(true);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > GUTENBERG_COVER_MAX_BYTES) return miss(true);
  const bytes = new Uint8Array(buf);
  if (!isJpegBytes(bytes)) return miss(true);

  const objectKey = `catalog/pg-${gutenbergId}.cover.jpg`;
  await bucket.put(objectKey, buf);
  return new Response(buf, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": IMMUTABLE,
    },
  });
}

// Las tres rutas de objeto comparten validación y 404 limpio.
catalog.get("/api/catalog/:id/:kind", async (context) => {
  const bucket = context.env.BOOKS;
  if (!bucket) {
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  }
  const id = context.req.param("id");
  const kind = context.req.param("kind");
  if (!CATALOG_ID.test(id)) {
    return context.json({ error: "Identificador inválido." }, 400);
  }
  const file =
    kind === "epub"
      ? { key: epubKey(id), type: "application/epub+zip" }
      : kind === "vocab"
        ? { key: key(id, "vocab.json"), type: "application/json; charset=utf-8" }
        : kind === "cover"
          ? { key: key(id, "cover.jpg"), type: "image/jpeg" }
          : null;
  if (!file) {
    return context.json({ error: "Recurso desconocido." }, 404);
  }

  const object = await bucket.get(file.key);
  if (object) {
    return new Response(object.body, {
      headers: { "content-type": file.type, "cache-control": IMMUTABLE },
    });
  }

  // Los ids pg- tienen rescate bajo demanda para epub y cover: el
  // primero exige sesión y baja el libro; el segundo es solo la
  // portada pública. vocab de esos ids sigue en 404 (el cliente
  // analiza sin manifiesto). Solo con CATALOG_PG_FETCH=1: apagado, un
  // miss no toca gutenberg.org (política de robots; ver
  // docs/designs/2026-11-15-explora-derechos.md, M6).
  if (context.env.CATALOG_PG_FETCH !== "1") {
    return context.json({ error: "No encontrado." }, 404);
  }
  if (kind === "epub") {
    const gutenberg = GUTENBERG_ID.exec(id);
    if (gutenberg) {
      return serveGutenbergEpub(context, bucket, Number(gutenberg[1]));
    }
  }
  if (kind === "cover") {
    const gutenberg = GUTENBERG_ID.exec(id);
    if (gutenberg) {
      return serveGutenbergCover(context, bucket, Number(gutenberg[1]));
    }
  }
  return context.json({ error: "No encontrado." }, 404);
});
