import { Hono, type Context } from "hono";
import { getSession } from "./session";
import { consumeRateUnits } from "./rate-limit";
import { createTtlCache } from "./ai";
import { CURATED_SCREEN } from "./screen-curated";
import type { WorkerEnv } from "./db";

// Rieles de descubrimiento de «Series y películas»: Trakt
// (api.trakt.tv) con respaldo curado propio. La respuesta solo lleva
// metadatos públicos — imdbId, tipo, título, año — nunca datos de
// usuarios ni contenido de obras. La llave viaja en la cabecera
// trakt-api-key y jamás aparece en respuestas ni logs.
//
// Todas las rutas exigen sesión. Sin TRACKT_API_KEY (o si Trakt
// falla y no hay copia en R2) se sirve la lista curada de
// screen-curated.ts — el respaldo es parte del diseño, no un extra.

export const screenDiscover = new Hono<{ Bindings: WorkerEnv }>();

const TRAKT_BASE = "https://api.trakt.tv";
const TRAKT_TIMEOUT_MS = 10_000;
const RAILS_KEY = "screen-discover/v1/rails.json";
const relatedKey = (type: string, imdbId: string) =>
  `screen-discover/v1/related-${type}-${imdbId}.json`;
const RAILS_FRESH_MS = 12 * 60 * 60_000; // copia R2 fresca: 12 h
const RELATED_FRESH_MS = 14 * 24 * 60 * 60_000; // related: 14 días
const RAIL_MAX = 16;
const TRAKT_LIST_LIMIT = 12;

const IMDB_ID_RE = /^tt\d{7,9}$/;
const PRIVATE_CACHE = "private, max-age=300";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": PRIVATE_CACHE,
};

const unauthorized = (context: Context<{ Bindings: WorkerEnv }>) =>
  context.json({ error: "Inicia sesión para usar esta función." }, 401);

export type DiscoverItem = {
  imdbId: string;
  type: "movie" | "tv";
  title: string;
  year: string;
  hasPoster: boolean;
};

type DiscoverRailId = "trending" | "recent" | "popular";
type DiscoverRail = { id: DiscoverRailId; items: DiscoverItem[] };
type DiscoverPayload = { source: "trakt" | "curated"; rails: DiscoverRail[] };

// Caché del isolate: los rieles cambian poco y son iguales para
// todos — 10 min evita repetir la lectura de R2 en cada visita.
const railsCache = createTtlCache<DiscoverPayload>({
  maxEntries: 4,
  ttlMs: 10 * 60_000,
});

// ---------- Trakt ----------

// Una lista de Trakt → items de Lecta. Parser tolerante: los
// endpoints de trending envuelven en { movie|show: {...} } y los de
// popular/related devuelven el objeto directo (sonda 2026-11-15).
// Solo sobreviven imdbId válido + título + año; cualquier fallo de
// red/forma devuelve null y el caller decide el respaldo.
async function traktList(
  env: WorkerEnv,
  path: string,
  type: "movie" | "tv",
): Promise<DiscoverItem[] | null> {
  const key = env.TRACKT_API_KEY;
  if (!key) return null;
  let data: unknown;
  try {
    const res = await fetch(`${TRAKT_BASE}${path}`, {
      headers: {
        "trakt-api-key": key,
        "trakt-api-version": "2",
        "Content-Type": "application/json",
        "User-Agent": "Lecta/1.0",
      },
      signal: AbortSignal.timeout(TRAKT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const seen = new Set<string>();
  const items: DiscoverItem[] = [];
  for (const row of data) {
    const m =
      row && typeof row === "object"
        ? ((row as Record<string, unknown>).movie ??
          (row as Record<string, unknown>).show ??
          row)
        : null;
    const rec = m as Record<string, unknown> | null;
    const ids = rec?.ids as Record<string, unknown> | undefined;
    const imdbId = ids?.imdb;
    const title = rec?.title;
    if (
      typeof imdbId !== "string" ||
      !IMDB_ID_RE.test(imdbId) ||
      typeof title !== "string" ||
      !title ||
      seen.has(imdbId)
    ) {
      continue;
    }
    seen.add(imdbId);
    items.push({
      imdbId,
      type,
      title,
      year: typeof rec?.year === "number" ? String(rec.year) : "",
      hasPoster: true,
    });
  }
  return items;
}

// Intercala película/serie y deduplica por imdbId: un mismo título
// no debe aparecer dos veces en el riel.
function mergeRailLists(
  movies: DiscoverItem[],
  shows: DiscoverItem[],
): DiscoverItem[] {
  const out: DiscoverItem[] = [];
  const seen = new Set<string>();
  const len = Math.max(movies.length, shows.length);
  for (let i = 0; i < len && out.length < RAIL_MAX; i++) {
    for (const item of [movies[i], shows[i]]) {
      if (!item || seen.has(item.imdbId) || out.length >= RAIL_MAX) continue;
      seen.add(item.imdbId);
      out.push(item);
    }
  }
  return out;
}

// Revalida lo leído de R2: solo los 5 campos permitidos, por si el
// JSON guardado fue manipulado.
function sanitizeItems(raw: unknown): DiscoverItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoverItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const it = item as Partial<DiscoverItem> | null;
    if (
      typeof it?.imdbId !== "string" ||
      !IMDB_ID_RE.test(it.imdbId) ||
      (it.type !== "movie" && it.type !== "tv") ||
      typeof it.title !== "string" ||
      typeof it.year !== "string" ||
      seen.has(it.imdbId)
    ) {
      continue;
    }
    seen.add(it.imdbId);
    out.push({
      imdbId: it.imdbId,
      type: it.type,
      title: it.title,
      year: it.year,
      hasPoster: true,
    });
  }
  return out;
}

function sanitizeRails(raw: unknown): DiscoverRail[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<DiscoverRailId>(["trending", "recent", "popular"]);
  const out: DiscoverRail[] = [];
  const seen = new Set<DiscoverRailId>();
  for (const rail of raw) {
    const r = rail as { id?: unknown; items?: unknown } | null;
    if (typeof r?.id !== "string" || !ids.has(r.id as DiscoverRailId)) continue;
    if (seen.has(r.id as DiscoverRailId)) continue;
    seen.add(r.id as DiscoverRailId);
    const items = sanitizeItems(r.items);
    if (items.length) out.push({ id: r.id as DiscoverRailId, items });
  }
  return out;
}

// Respaldo curado: un solo riel «popular» con la lista editorial.
const curatedPayload = (): DiscoverPayload => ({
  source: "curated",
  rails: [
    {
      id: "popular",
      items: CURATED_SCREEN.map((entry) => ({
        imdbId: entry.imdbId,
        type: entry.type,
        title: entry.title,
        year: entry.year,
        hasPoster: true,
      })),
    },
  ],
});

const respond = (payload: DiscoverPayload) =>
  new Response(JSON.stringify(payload), { headers: jsonHeaders });

async function readRailsCopy(
  bucket: R2Bucket,
): Promise<{ fetchedAt: number; rails: DiscoverRail[] } | null> {
  const stored = await bucket.get(RAILS_KEY).catch(() => null);
  if (!stored) return null;
  try {
    const data = JSON.parse(await stored.text()) as {
      fetchedAt?: unknown;
      rails?: unknown;
    };
    if (typeof data?.fetchedAt !== "number") return null;
    return { fetchedAt: data.fetchedAt, rails: sanitizeRails(data.rails) };
  } catch {
    return null;
  }
}

// ---------- Rutas ----------

screenDiscover.get("/api/screen/discover", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);
  const env = context.env;

  const memHit = railsCache.get("rails");
  if (memHit) return respond(memHit);

  const bucket = env.BOOKS;
  const copy = bucket ? await readRailsCopy(bucket) : null;
  if (copy && Date.now() - copy.fetchedAt < RAILS_FRESH_MS && copy.rails.length) {
    const payload: DiscoverPayload = { source: "trakt", rails: copy.rails };
    railsCache.set("rails", payload);
    return respond(payload);
  }

  if (!env.TRACKT_API_KEY) {
    const payload = curatedPayload();
    railsCache.set("rails", payload);
    return respond(payload);
  }

  // 6 llamadas en paralelo: trending/popular/recent × movie/show.
  const year = new Date().getUTCFullYear();
  const years = `${year - 1}-${year}`;
  const limit = `limit=${TRAKT_LIST_LIMIT}`;
  const [
    trendingMovies,
    trendingShows,
    recentMovies,
    recentShows,
    popularMovies,
    popularShows,
  ] = await Promise.all([
    traktList(env, `/movies/trending?${limit}`, "movie"),
    traktList(env, `/shows/trending?${limit}`, "tv"),
    traktList(env, `/movies/popular?years=${years}&${limit}`, "movie"),
    traktList(env, `/shows/popular?years=${years}&${limit}`, "tv"),
    traktList(env, `/movies/popular?${limit}`, "movie"),
    traktList(env, `/shows/popular?${limit}`, "tv"),
  ]);

  const rails = (
    [
      ["trending", trendingMovies, trendingShows],
      ["recent", recentMovies, recentShows],
      ["popular", popularMovies, popularShows],
    ] as const
  )
    .map(([id, movies, shows]) => ({
      id: id as DiscoverRailId,
      items: mergeRailLists(movies ?? [], shows ?? []),
    }))
    .filter((rail) => rail.items.length > 0);

  if (!rails.length) {
    // Trakt cayó o devolvió vacío: la copia vieja de R2 (aunque
    // vencida) es mejor que la lista curada estática.
    if (copy?.rails.length) {
      const payload: DiscoverPayload = { source: "trakt", rails: copy.rails };
      railsCache.set("rails", payload);
      return respond(payload);
    }
    const payload = curatedPayload();
    railsCache.set("rails", payload);
    return respond(payload);
  }

  const payload: DiscoverPayload = { source: "trakt", rails };
  if (bucket) {
    await bucket
      .put(RAILS_KEY, JSON.stringify({ fetchedAt: Date.now(), rails }), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      })
      .catch(() => undefined);
  }
  railsCache.set("rails", payload);
  return respond(payload);
});

// «Porque preparaste X»: obras relacionadas con una ya instalada.
// La copia de R2 solo sirve fresca (<14 días); si no, se gasta 1
// unidad de cuota «screen-related» (30/h) y se consulta Trakt.
// Cualquier fallo devuelve lista vacía — el cliente oculta el riel.
screenDiscover.get("/api/screen/related", async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized(context);

  const imdbId = context.req.query("imdbId") ?? "";
  const type = context.req.query("type") ?? "";
  if (!IMDB_ID_RE.test(imdbId) || (type !== "movie" && type !== "tv")) {
    return context.json({ error: "Identificador inválido." }, 400);
  }

  const key = relatedKey(type, imdbId);
  const bucket = context.env.BOOKS;
  if (bucket) {
    const stored = await bucket.get(key).catch(() => null);
    if (stored) {
      try {
        const data = JSON.parse(await stored.text()) as {
          fetchedAt?: unknown;
          items?: unknown;
        };
        if (
          typeof data?.fetchedAt === "number" &&
          Date.now() - data.fetchedAt < RELATED_FRESH_MS
        ) {
          return context.json({ items: sanitizeItems(data.items) });
        }
      } catch {
        /* JSON corrupto: se regenera */
      }
    }
  }

  if (!context.env.TRACKT_API_KEY) return context.json({ items: [] });

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    30,
    "screen-related",
  );
  if (!allowed) return context.json({ items: [] });

  const traktType = type === "tv" ? "shows" : "movies";
  const items = await traktList(
    context.env,
    `/${traktType}/${imdbId}/related?limit=${TRAKT_LIST_LIMIT}`,
    type,
  );
  if (items === null) return context.json({ items: [] });

  if (bucket) {
    await bucket
      .put(key, JSON.stringify({ fetchedAt: Date.now(), items }), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      })
      .catch(() => undefined);
  }
  return context.json({ items });
});
