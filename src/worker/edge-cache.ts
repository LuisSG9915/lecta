// Caché por centro de datos (Cache API) para lecturas públicas del catálogo
// (docs: AGENTS.md «Producción»). Solo para respuestas que no dependen de la
// sesión: la clave es una URL sintética sin cookies. La copia guardada lleva
// su max-age; al navegador siempre le llega no-store, así que una palabra
// recién enriquecida nunca queda vieja en su caché HTTP. Verificado el
// 2026-11-24: guarda en lectal.app y también en workers.dev. Sin `caches`
// (pruebas, vite dev) solo se calcula.
import type { Context } from "hono";
import { runInBackground } from "./background";

export type EdgeCacheOptions = {
  /** Segundos para respuestas 200. */
  ttlSeconds: number;
  /** Segundos para 404 («no encontrada»); sin valor, un 404 no se guarda. */
  missTtlSeconds?: number;
};

type EdgeCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

function edgeCache(): EdgeCache | null {
  const store = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  return store && typeof store.match === "function" && typeof store.put === "function"
    ? store
    : null;
}

function forClient(response: Response, state: "hit" | "miss"): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-lecta-cache", state);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * `key` es ruta + query normalizada (con versión para invalidar de golpe),
 * p. ej. `lexicon/lookup?v=1&lang=es&form=casa`.
 */
export async function withEdgeCache(
  c: Context,
  key: string,
  options: EdgeCacheOptions,
  compute: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache();
  if (!cache) return compute();
  const cacheKey = new Request(`${new URL(c.req.url).origin}/__edge/${key}`, { method: "GET" });

  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return forClient(hit, "hit");

  const response = await compute();
  const ttl =
    response.status === 200
      ? options.ttlSeconds
      : response.status === 404
        ? (options.missTtlSeconds ?? 0)
        : 0;
  if (ttl > 0) {
    const headers = new Headers(response.headers);
    headers.set("cache-control", `public, max-age=${ttl}`);
    const stored = new Response(response.clone().body, { status: response.status, headers });
    runInBackground(c, cache.put(cacheKey, stored).catch(() => undefined));
  }
  return forClient(response, "miss");
}
