// Dominio canónico: lectal.app. El host viejo de workers.dev redirige con 301
// solo las páginas (HTML), nunca:
// - `/api/*`: el webhook de Stripe (POST) está registrado en workers.dev y no
//   sigue redirecciones; el MCP y las copias viejas de la app (servidas por el
//   service worker) siguen llamando a la API en su propio origen.
// - archivos con extensión (`/sw.js`, `/sw-manifest.json`, `/assets/*`…): el
//   service worker viejo tiene que poder actualizarse en workers.dev para que
//   su navegación (ya con `redirect: "manual"`) llegue al 301.
// - `/__lecta_shell__`: el install del SW precachea el HTML por esa ruta.
// - métodos que no son GET/HEAD: un 301 convierte el POST en GET.

export const CANONICAL_ORIGIN = "https://lectal.app";
export const LEGACY_HOSTS = new Set(["lecta.luis-sg9915.workers.dev"]);

/** Respuesta 301 al dominio canónico, o `null` si la petición se atiende aquí. */
export function legacyHostRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!LEGACY_HOSTS.has(url.hostname)) return null;

  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return null;
  if (path === "/__lecta_shell__") return null;
  const last = path.slice(path.lastIndexOf("/") + 1);
  if (last.includes(".") && !last.endsWith(".html")) return null;

  return new Response(null, {
    status: 301,
    headers: {
      location: `${CANONICAL_ORIGIN}${path}${url.search}`,
      "cache-control": "public, max-age=3600",
    },
  });
}

/** Rutas que atiende la app de Hono; lo demás va al binding de assets. */
export function isWorkerRoute(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/k" ||
    pathname.startsWith("/k/") ||
    pathname === "/kindle" ||
    pathname.startsWith("/kindle/") ||
    pathname.startsWith("/models/")
  );
}
