import type { WorkerEnv } from "./db";

// Freno a la fuerza bruta y al bombardeo de correos en el acceso.
//
// Better Auth trae un limitador propio, pero guarda los contadores en
// memoria y aquí la instancia vive una sola petición (createScopedAuth):
// nunca limitaba nada. Este usa el binding de Workers Rate Limiting
// (`AUTH_LIMITER` en wrangler.jsonc), que cuenta por ubicación de
// Cloudflare entre peticiones e isolates. Es un freno, no un candado:
// un ataque distribuido entre muchas IP lo esquiva.

/**
 * Solo los POST de /api/auth/* gastan cuota: ahí viven el acceso, el
 * registro y los envíos de correo. `get-session` (GET) es el camino
 * caliente de cada carga y queda fuera, igual que verificar el enlace
 * mágico (GET con token de un solo uso). `sign-out` tampoco cuenta:
 * cerrar sesión nunca debe fallar por cuota.
 */
export function isLimitedAuthRequest(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  if (!pathname.startsWith("/api/auth/")) return false;
  return pathname !== "/api/auth/sign-out";
}

/**
 * true = deja pasar. Sin binding (dev, pruebas) o sin `cf-connecting-ip`
 * no hay a quién contar y se deja pasar; si el binding falla, también
 * (un fallo de la cuota no debe dejar a nadie fuera de su cuenta).
 */
export async function checkAuthRateLimit(
  env: WorkerEnv,
  req: Request,
  scope: "auth" | "klogin",
): Promise<boolean> {
  const limiter = env.AUTH_LIMITER;
  const ip = req.headers.get("cf-connecting-ip")?.trim();
  if (!limiter || !ip) return true;
  try {
    const { success } = await limiter.limit({ key: `${scope}:${ip}` });
    return success;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "auth_rate_limit_error",
        scope,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return true;
  }
}

/**
 * Formulario enviado desde otro sitio (login CSRF). Rechaza si el
 * navegador dice `Sec-Fetch-Site: cross-site` o si `Origin` trae otro
 * host. Sin ninguna de las dos cabeceras deja pasar: el navegador del
 * Kindle puede no mandarlas. `Origin: null` sin `Sec-Fetch-Site` también
 * pasa por lo mismo; un navegador moderno que mande `null` desde otro
 * sitio manda además `Sec-Fetch-Site: cross-site`.
 */
export function isCrossSiteForm(req: Request): boolean {
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}
