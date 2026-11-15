import { Hono, type Context } from "hono";
import {
  BlobReader,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry,
} from "@zip.js/zip.js";
import { getSession } from "./session";
import { consumeRateUnits } from "./rate-limit";
import { createTtlCache } from "./ai";
import { detectMultiwordPhrases } from "../shared/foreign-idioms";
import {
  sanitizeScreenGuideObject,
  screenGuideKey,
  subtitleToForms,
  SCREEN_GUIDE_VERSION,
  type ScreenWorkRef,
} from "../shared/screen-guide";
import type { WorkerEnv } from "./db";

// «Series y películas»: metadatos de OMDb (búsqueda, detalle de serie,
// póster) y la guía de vocabulario por episodio/película armada desde
// subtítulos de SubDL. El .srt existe SOLO en memoria durante la
// petición: lo que queda en R2 bajo screen-guides/v1/… es el índice
// «solo palabras» — formas y claves del banco de frases, nunca
// diálogo, timestamps ni orden narrativo (ver shared/screen-guide).
//
// Todas las rutas exigen sesión. Las de OMDb piden OMDB_API_KEY y la
// de guía pide SUBDL_API_KEY: sin la llave que necesitan responden
// 503 «Esta función aún no está disponible.» Un acierto en R2 no
// necesita ninguna llave ni toca cuota.
export const screen = new Hono<{ Bindings: WorkerEnv }>();

const OMDB_BASE = "https://www.omdbapi.com/";
const SUBDL_LIST = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";
const OMDB_TIMEOUT_MS = 10_000;
const SUBDL_TIMEOUT_MS = 10_000;
const SUBDL_ZIP_TIMEOUT_MS = 15_000;
const SUBDL_ZIP_MAX_BYTES = 2 * 1024 * 1024;
const SUBTITLE_MAX_BYTES = 1024 * 1024;
const GUIDE_MIN_FORMS = 50;
const SEARCH_MAX_Q = 80;
const GUIDE_BODY_MAX_BYTES = 4 * 1024;
const IMMUTABLE = "public, max-age=31536000, immutable";
const JSON_CACHE = "public, max-age=300";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": JSON_CACHE,
};

// Cachés del isolate: metadatos OMDb (1 h), búsqueda (10 min) y la
// negativa «este título no tiene subtítulos utilizables» (30 min,
// para no repetir la llamada a SubDL en cada intento del usuario).
const omdbDetailCache = createTtlCache<OmdbPayload | null>({
  maxEntries: 200,
  ttlMs: 60 * 60_000,
});
const omdbSeasonCache = createTtlCache<number[] | null>({
  maxEntries: 200,
  ttlMs: 60 * 60_000,
});
const omdbSearchCache = createTtlCache<string>({
  maxEntries: 100,
  ttlMs: 10 * 60_000,
});
// URL del póster vista en los resultados de búsqueda o en el detalle:
// el póster de un título recién listado no debe costar una llamada
// ?i= extra (cuota OMDb). null = el título no tiene póster.
const posterUrlCache = createTtlCache<string | null>({
  maxEntries: 300,
  ttlMs: 60 * 60_000,
});
const guideMissCache = createTtlCache<true>({
  maxEntries: 200,
  ttlMs: 30 * 60_000,
});

const unauthorized = (context: Context<{ Bindings: WorkerEnv }>) =>
  context.json({ error: "Inicia sesión para usar esta función." }, 401);

const unavailable = (context: Context<{ Bindings: WorkerEnv }>) =>
  context.json({ error: "Esta función aún no está disponible." }, 503);

const notFound = (context: Context<{ Bindings: WorkerEnv }>) =>
  context.json({ error: "No encontrado." }, 404);

const noVocabulary = (context: Context<{ Bindings: WorkerEnv }>) =>
  context.json(
    { error: "Todavía no hay vocabulario para este título." },
    404,
  );

type OmdbPayload = {
  Response?: string;
  Title?: string;
  Type?: string;
  Poster?: string;
  Year?: string;
  totalSeasons?: string;
  Episodes?: Array<{ Episode?: string }>;
  Search?: Array<{
    Title?: string;
    Year?: string;
    imdbID?: string;
    Type?: string;
    Poster?: string;
  }>;
};

const IMDB_ID_RE = /^tt\d{7,9}$/;
// Solo pósters servidos por los hosts que OMDb usa de verdad: la URL
// nunca viene del cliente, pero el allowlist evita que un Poster
// manipulado convierta la ruta en un proxy abierto.
const POSTER_HOSTS = new Set(["m.media-amazon.com", "img.omdbapi.com"]);

// Detalle ?i= compartido por las rutas de serie y póster: cachea la
// respuesta parseada (incluido el Response:"False" de un imdbId
// inexistente) durante 1 h; un fallo de red no se cachea.
async function fetchOmdbDetail(
  env: WorkerEnv,
  imdbId: string,
): Promise<OmdbPayload | null> {
  const hit = omdbDetailCache.get(imdbId);
  if (hit !== undefined) return hit;
  if (!env.OMDB_API_KEY) return null;
  try {
    const res = await fetch(
      `${OMDB_BASE}?i=${encodeURIComponent(imdbId)}&apikey=${env.OMDB_API_KEY}`,
      { signal: AbortSignal.timeout(OMDB_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as OmdbPayload;
    const detail = data && typeof data === "object" ? data : null;
    omdbDetailCache.set(imdbId, detail);
    // El detalle también enseña la URL del póster: la ruta de póster
    // la reusa sin otra llamada a OMDb.
    if (detail) {
      const p = detail.Poster;
      posterUrlCache.set(
        imdbId,
        detail.Response === "true" &&
          typeof p === "string" &&
          p !== "" &&
          p !== "N/A"
          ? p
          : null,
      );
    }
    return detail;
  } catch {
    return null;
  }
}

// Episodios de una temporada: solo los números — los títulos de
// episodio revelan trama y jamás salen del worker.
async function fetchOmdbEpisodes(
  env: WorkerEnv,
  imdbId: string,
  season: number,
): Promise<number[] | null> {
  const cacheKey = `${imdbId}:${season}`;
  const hit = omdbSeasonCache.get(cacheKey);
  if (hit !== undefined) return hit;
  if (!env.OMDB_API_KEY) return null;
  try {
    const res = await fetch(
      `${OMDB_BASE}?i=${encodeURIComponent(imdbId)}&Season=${season}&apikey=${env.OMDB_API_KEY}`,
      { signal: AbortSignal.timeout(OMDB_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as OmdbPayload;
    if (data?.Response !== "true" || !Array.isArray(data.Episodes)) {
      omdbSeasonCache.set(cacheKey, null);
      return null;
    }
    const episodes = [
      ...new Set(
        data.Episodes.map((ep) => Number.parseInt(ep?.Episode ?? "", 10)).filter(
          (n) => Number.isInteger(n) && n >= 0,
        ),
      ),
    ].sort((a, b) => a - b);
    omdbSeasonCache.set(cacheKey, episodes);
    return episodes;
  } catch {
    return null;
  }
}

// ---------- Búsqueda ----------

screen.get("/api/screen/search", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);
  if (!context.env.OMDB_API_KEY) return unavailable(context);

  const q = (context.req.query("q") ?? "").trim();
  if (q.length > SEARCH_MAX_Q) {
    return context.json({ error: "La búsqueda es demasiado larga." }, 400);
  }
  if (!q) return context.json({ results: [] });

  const cacheKey = q.toLowerCase();
  const cached = omdbSearchCache.get(cacheKey);
  if (cached != null) {
    return new Response(cached, { headers: jsonHeaders });
  }

  let data: OmdbPayload;
  try {
    const res = await fetch(
      `${OMDB_BASE}?s=${encodeURIComponent(q)}&apikey=${context.env.OMDB_API_KEY}`,
      { signal: AbortSignal.timeout(OMDB_TIMEOUT_MS) },
    );
    if (!res.ok) return context.json({ results: [] });
    data = (await res.json()) as OmdbPayload;
  } catch {
    return context.json({ results: [] });
  }

  const results = (Array.isArray(data?.Search) ? data.Search : [])
    .filter(
      (item) =>
        typeof item?.imdbID === "string" &&
        IMDB_ID_RE.test(item.imdbID) &&
        (item.Type === "movie" || item.Type === "series"),
    )
    .slice(0, 10)
    .map((item) => {
      // La búsqueda ya trae la URL del póster sin costo extra: queda
      // en caché para que /api/screen/poster no gaste una llamada ?i=.
      // Solo positivos: un «N/A» de búsqueda no impide que el detalle
      // sí tenga póster.
      if (
        typeof item.Poster === "string" &&
        item.Poster !== "" &&
        item.Poster !== "N/A"
      ) {
        posterUrlCache.set(item.imdbID!, item.Poster);
      }
      return {
        imdbId: item.imdbID!,
        // OMDb dice «series»; el contrato de Lecta lo llama «tv».
        type: item.Type === "series" ? ("tv" as const) : ("movie" as const),
        title: item.Title ?? "",
        year: item.Year ?? "",
        hasPoster:
          typeof item.Poster === "string" &&
          item.Poster !== "" &&
          item.Poster !== "N/A",
      };
    });
  const body = JSON.stringify({ results });
  omdbSearchCache.set(cacheKey, body);
  return new Response(body, { headers: jsonHeaders });
});

// ---------- Detalle de serie y temporada ----------

screen.get("/api/screen/tv/:imdbId", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);
  if (!context.env.OMDB_API_KEY) return unavailable(context);

  const imdbId = context.req.param("imdbId");
  if (!IMDB_ID_RE.test(imdbId)) {
    return context.json({ error: "Identificador inválido." }, 400);
  }
  const detail = await fetchOmdbDetail(context.env, imdbId);
  if (!detail || detail.Response !== "true" || detail.Type !== "series") {
    return notFound(context);
  }
  const parsed = Number.parseInt(detail.totalSeasons ?? "", 10);
  return context.json({
    title: detail.Title ?? "",
    seasons: Number.isInteger(parsed) ? parsed : null,
  });
});

screen.get("/api/screen/tv/:imdbId/season/:season", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);
  if (!context.env.OMDB_API_KEY) return unavailable(context);

  const imdbId = context.req.param("imdbId");
  const seasonRaw = context.req.param("season");
  const season = Number(seasonRaw);
  if (
    !IMDB_ID_RE.test(imdbId) ||
    !/^\d{1,2}$/.test(seasonRaw) ||
    season < 0 ||
    season > 99
  ) {
    return context.json({ error: "Identificador inválido." }, 400);
  }
  const episodes = await fetchOmdbEpisodes(context.env, imdbId, season);
  if (episodes == null) return notFound(context);
  return context.json({ episodes });
});

// ---------- Póster ----------
//
// La CSP solo permite img-src 'self': el cliente pide el póster aquí
// y el worker lo reenvía. La URL sale de OMDb (nunca del cliente),
// solo pasa si es https en uno de los dos hosts conocidos, y la
// imagen queda en R2: un acierto no gasta ni cuota OMDb ni viaje a
// Amazon. Sin bucket configurado se sirve sin cachear.

const POSTER_MAX_BYTES = 2 * 1024 * 1024;
const posterKey = (imdbId: string) => `screen/posters/${imdbId}.jpg`;

screen.get("/api/screen/poster", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);
  if (!context.env.OMDB_API_KEY) return unavailable(context);

  const imdbId = context.req.query("imdbId") ?? "";
  if (!IMDB_ID_RE.test(imdbId)) {
    return context.json({ error: "Identificador inválido." }, 400);
  }

  const bucket = context.env.BOOKS;
  const key = posterKey(imdbId);
  if (bucket) {
    const stored = await bucket.get(key);
    if (stored) {
      return new Response(stored.body, {
        headers: {
          "content-type":
            stored.httpMetadata?.contentType ?? "image/jpeg",
          "cache-control": IMMUTABLE,
        },
      });
    }
  }

  // La URL del póster suele venir ya en la búsqueda: si no, un
  // detalle ?i= la resuelve y la deja en posterUrlCache.
  let posterUrl = posterUrlCache.get(imdbId);
  if (posterUrl === undefined) {
    await fetchOmdbDetail(context.env, imdbId);
    posterUrl = posterUrlCache.get(imdbId) ?? null;
  }
  if (!posterUrl) return notFound(context);
  let url: URL;
  try {
    url = new URL(posterUrl);
  } catch {
    return notFound(context);
  }
  if (url.protocol !== "https:" || !POSTER_HOSTS.has(url.hostname)) {
    return notFound(context);
  }
  let upstream: Response | null;
  try {
    upstream = await fetch(url.toString(), {
      signal: AbortSignal.timeout(OMDB_TIMEOUT_MS),
    });
  } catch {
    upstream = null;
  }
  if (!upstream?.ok || !upstream.body) return notFound(context);
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return notFound(context);
  const bytes = await upstream.arrayBuffer().catch(() => null);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > POSTER_MAX_BYTES) {
    return notFound(context);
  }
  if (bucket) {
    await bucket
      .put(key, bytes, { httpMetadata: { contentType } })
      .catch(() => undefined);
  }
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "cache-control": IMMUTABLE,
    },
  });
});

// ---------- Guía de vocabulario (SubDL → índice «solo palabras») ----------

type SubdlSubtitle = {
  url?: unknown;
  hi?: unknown;
  full_season?: unknown;
};

type SubdlOutcome =
  | { kind: "found"; url: string }
  | { kind: "empty" }
  | { kind: "limited" }
  | { kind: "forbidden" }
  | { kind: "error" };

// SubDL devuelve hi/full_season como strings ("true"/"false"), no
// booleanos — la sonda del 2026-11-15 lo confirmó.
const subdlTruthy = (value: unknown) => value === true || value === "true";

// Preferencia del plan: primero un subtítulo suelto (hi y
// full_season falsos); si no hay, el primero que no sea pack de
// temporada completa.
function pickSubdlSubtitle(
  subtitles: SubdlSubtitle[],
): string | null {
  const usable = subtitles.filter(
    (s): s is SubdlSubtitle & { url: string } =>
      typeof s?.url === "string" && s.url.length > 0,
  );
  const pick =
    usable.find((s) => !subdlTruthy(s.hi) && !subdlTruthy(s.full_season)) ??
    usable.find((s) => !subdlTruthy(s.full_season));
  return pick?.url ?? null;
}

// Búsqueda en SubDL por imdb_id (+ temporada/episodio en series).
// `subtitles` llega en la raíz de la respuesta (la sonda lo verificó);
// se acepta también la forma anidada en results[] por si cambia.
async function subdlFindSubtitle(
  env: WorkerEnv,
  ref: ScreenWorkRef,
): Promise<SubdlOutcome> {
  const apiKey = env.SUBDL_API_KEY;
  if (!apiKey) return { kind: "error" };
  const params = new URLSearchParams({
    api_key: apiKey,
    imdb_id: ref.imdbId,
    type: ref.type,
    languages: ref.language === "es" ? "ES" : "EN",
    subs_per_page: "30",
  });
  if (ref.type === "tv") {
    params.set("season_number", String(ref.season));
    params.set("episode_number", String(ref.episode));
  }
  let res: Response;
  try {
    res = await fetch(`${SUBDL_LIST}?${params.toString()}`, {
      signal: AbortSignal.timeout(SUBDL_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error" };
  }
  if (res.status === 429) return { kind: "limited" };
  if (res.status === 403) return { kind: "forbidden" };
  if (!res.ok) return { kind: "error" };
  let data: {
    subtitles?: SubdlSubtitle[];
    results?: Array<{ subtitles?: SubdlSubtitle[] }>;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { kind: "error" };
  }
  const subtitles =
    Array.isArray(data?.subtitles) && data.subtitles.length > 0
      ? data.subtitles
      : (data?.results ?? []).flatMap((r) => r?.subtitles ?? []);
  const url = pickSubdlSubtitle(subtitles);
  return url ? { kind: "found", url } : { kind: "empty" };
}

// Descarga el zip (máx 2 MB, 15 s), abre el primer .srt que quepa en
// 1 MB descomprimido y devuelve su texto. En series prefiere el
// archivo que case con SxxEyy del episodio pedido — un pack de
// temporada trae varios .srt y servir el equivocado daría una guía
// de otro episodio. null = cualquier fallo (el caller responde 502).
async function subdlDownloadSubtitle(
  url: string,
  ref: ScreenWorkRef,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${SUBDL_DL}${url}`, {
      signal: AbortSignal.timeout(SUBDL_ZIP_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > SUBDL_ZIP_MAX_BYTES) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > SUBDL_ZIP_MAX_BYTES) return null;

  const zip = new ZipReader(new BlobReader(new Blob([buf])));
  try {
    const entries = await zip.getEntries();
    const files = entries.filter(
      (entry): entry is FileEntry =>
        !entry.directory && entry.filename.toLowerCase().endsWith(".srt"),
    );
    const fits = (entry: FileEntry) =>
      typeof entry.uncompressedSize === "number" &&
      entry.uncompressedSize <= SUBTITLE_MAX_BYTES;
    let chosen: FileEntry | undefined;
    if (ref.type === "tv") {
      const episodeRe = new RegExp(
        `s0*${ref.season}e0*${ref.episode}(?!\\d)`,
        "i",
      );
      const matching = files.filter((entry) =>
        episodeRe.test(entry.filename),
      );
      // Si algún nombre casa con el episodio solo se consideran esos:
      // caer al «primero» de un pack sería servir otro episodio.
      chosen =
        matching.find(fits) ??
        (matching.length === 0 ? files.find(fits) : undefined);
    } else {
      chosen = files.find(fits);
    }
    if (!chosen) return null;
    const bytes = await chosen.getData(new Uint8ArrayWriter());
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    // Subtítulos en windows-1252 decodificados como UTF-8 dejan una
    // estela de U+FFFD; si hay demasiados se reintenta con esa página.
    const broken = (utf8.match(/�/g) ?? []).length;
    return broken > 5
      ? new TextDecoder("windows-1252").decode(bytes)
      : utf8;
  } catch {
    return null;
  } finally {
    await zip.close().catch(() => undefined);
  }
}

// El cuerpo del POST es una ScreenWorkRef diminuta: el tope evita
// parsear JSON arbitrario enorme.
screen.post("/api/screen/guide", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);

  const declared = Number(context.req.header("content-length") ?? 0);
  if (declared > GUIDE_BODY_MAX_BYTES) {
    return context.json({ error: "Datos inválidos." }, 400);
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Datos inválidos." }, 400);
  }
  const ref = body as ScreenWorkRef;
  const key = screenGuideKey(ref);
  if (!key) return context.json({ error: "Datos inválidos." }, 400);
  // La clave solo existe si la referencia validó; para tv season y
  // episode ya son enteros en rango.
  const work: ScreenWorkRef =
    ref.type === "tv"
      ? {
          type: "tv",
          imdbId: ref.imdbId,
          language: ref.language,
          season: ref.season as number,
          episode: ref.episode as number,
        }
      : { type: "movie", imdbId: ref.imdbId, language: ref.language };

  const bucket = context.env.BOOKS;
  if (!bucket) {
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  }

  // Acierto en R2: no toca cuota ni SubDL. sanitizeScreenGuideObject
  // reconstruye el objeto campo a campo por si el JSON guardado fue
  // manipulado — un extra nunca llega al cliente.
  const stored = await bucket.get(key);
  if (stored) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await stored.text());
    } catch {
      parsed = null;
    }
    const guide = sanitizeScreenGuideObject(parsed, work);
    if (guide) return context.json({ guide, cached: true });
    // JSON corrupto: se regenera como si la guía no existiera.
  }

  if (!context.env.SUBDL_API_KEY) return unavailable(context);
  if (guideMissCache.get(key) !== undefined) return noVocabulary(context);

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    6,
    "screen-guide",
  );
  if (!allowed) {
    return context.json(
      { error: "Ya preparaste varios títulos en esta hora. Intenta más tarde." },
      429,
    );
  }

  const found = await subdlFindSubtitle(context.env, work);
  if (found.kind === "limited") {
    return context.json(
      {
        error:
          "Hoy ya no podemos preparar títulos nuevos. Intenta mañana.",
      },
      503,
    );
  }
  if (found.kind === "forbidden") {
    // Sin llave ni URL completa en el log: solo qué título falló.
    console.error("SubDL 403 al buscar subtítulos", {
      imdbId: work.imdbId,
      type: work.type,
    });
    return unavailable(context);
  }
  if (found.kind === "error") {
    return context.json(
      { error: "No pudimos preparar este título. Intenta más tarde." },
      502,
    );
  }
  if (found.kind === "empty") {
    guideMissCache.set(key, true);
    return noVocabulary(context);
  }

  const subtitleText = await subdlDownloadSubtitle(found.url, work);
  if (subtitleText == null) {
    return context.json(
      { error: "No pudimos preparar este título. Intenta más tarde." },
      502,
    );
  }

  const { forms, capitalOnly } = subtitleToForms(
    subtitleText,
    work.language,
  );
  const phrases = [
    ...new Set(
      detectMultiwordPhrases(subtitleText, work.language).map(
        (p) => p.normalizedId,
      ),
    ),
  ];
  // Menos de 50 formas = archivo roto o audio-description vacía:
  // mismo 404 que «sin subtítulos» y misma negativa cacheada.
  if (forms.length < GUIDE_MIN_FORMS) {
    guideMissCache.set(key, true);
    return noVocabulary(context);
  }

  const guide = sanitizeScreenGuideObject(
    {
      v: SCREEN_GUIDE_VERSION,
      type: work.type,
      imdbId: work.imdbId,
      ...(work.type === "tv"
        ? { season: work.season, episode: work.episode }
        : {}),
      language: work.language,
      forms,
      capitalOnly,
      phrases,
      createdAt: Date.now(),
    },
    work,
  );
  if (!guide) {
    return context.json(
      { error: "No pudimos preparar este título. Intenta más tarde." },
      502,
    );
  }
  await bucket.put(key, JSON.stringify(guide), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return context.json({ guide, cached: false });
});
