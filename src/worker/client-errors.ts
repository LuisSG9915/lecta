// Errores de cliente: recibe reportes del navegador y los deja en Workers Logs.
//
// Límites de diseño, en este orden y todos deliberados:
// - **Sin sesión y sin base de datos.** Este endpoint no llama a `withClient` ni a
//   `getConnectionString`: un bucle de errores en el cliente no puede consumir RUs
//   ni tumbar Hyperdrive. Es la única defensa que importa.
// - **Rechazo silencioso.** Cuerpo grande, campo desconocido, tipo raro o ruta no
//   reconocida ⇒ 204 igual y nada registrado: no se le da señal a un atacante ni se
//   rompe al cliente.
// - **Allowlist estricta.** Se registra `name`, `code`, `route` (solo pathname, con
//   los segmentos dinámicos colapsados), `version` y, solo si el usuario lo activó,
//   `message`. Nunca stack, ni query, ni hash, ni texto libre del libro.
// - **Tope por isolate**, no un rate limit global: 30/min y 300/hora por IP. Sirve
//   para que un bucle no inunde los logs, no como medida de seguridad.

export const CLIENT_ERROR_MAX_BODY_BYTES = 2_048;
export const CLIENT_ERROR_LIMIT_PER_MINUTE = 30;
export const CLIENT_ERROR_LIMIT_PER_HOUR = 300;
export const CLIENT_ERROR_MAX_NAME = 60;
export const CLIENT_ERROR_MAX_CODE = 60;
export const CLIENT_ERROR_MAX_VERSION = 40;
export const CLIENT_ERROR_MAX_MESSAGE = 200;
/** Frames que viajan para agrupar y depurar: solo los 3 primeros. */
export const CLIENT_ERROR_MAX_FRAMES = 3;
/** Caracteres por frame ya limpio (`index-ABC.js:12:345`). */
export const CLIENT_ERROR_MAX_FRAME = 80;

/** Primer segmento de ruta que la app reconoce. Lo demás se colapsa a «/otra». */
const KNOWN_ROUTE_PREFIXES = new Set([
  "",
  "reader",
  "vocabulary",
  "journey",
  "account",
  "library",
  "shelf",
  "stats",
  "diagnostics",
  "legal",
  "settings",
  "practice",
  "kindle",
]);

export interface ClientErrorReport {
  event: "client_error";
  name: string;
  code: string;
  route: string;
  version: string;
  message?: string;
  /** Frames limpios del stack, del más cercano al más lejano (máx. 3). */
  frames?: string[];
}

/**
 * Reduce la ruta a algo registrable: sin query, sin hash, sin segmentos
 * dinámicos (`/k/ABCD` se convierte en `/k/*`, que es un código de vinculación
 * y no debe viajar a los logs).
 */
export function sanitizeRoute(raw: unknown): string {
  if (typeof raw !== "string") return "/otra";
  const path = raw.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) return "/otra";

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (segments.length > 3) return "/otra";

  const first = segments[0] ?? "";
  // El código de vinculación de Kindle no debe llegar a los logs.
  if (first === "k") return "/k/*";
  if (!KNOWN_ROUTE_PREFIXES.has(first)) return "/otra";
  if (!first) return "/";
  if (segments.length === 1) return `/${first}`;
  return `/${first}/*`;
}

/**
 * UUID, hash largo, número largo o sufijo numérico (`book-98123`): todo eso
 * identifica un recurso, no una ruta. Si cambia el id, la firma no cambia.
 */
const DYNAMIC_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4,}|[0-9a-f]{16,}|[a-z]+[-_]\d{4,})$/i;

/**
 * Normaliza la ruta **antes** de calcular la huella: un mismo bug en
 * `/reader/book-98123` y `/reader/book-44512` tiene que dar la misma firma.
 * Es idempotente, así que se puede aplicar sobre lo que ya devolvió
 * `sanitizeRoute`.
 */
export function normalizeRouteForSignature(route: string): string {
  return route
    .split("/")
    .map((segment) =>
      segment && (DYNAMIC_SEGMENT.test(segment) || segment.length > 40) && segment !== "*"
        ? ":id"
        : segment,
    )
    .join("/");
}

/** `https://host/assets/index-ABC.js:1:234` ⇒ `index-ABC.js:1:234`. */
const FRAME_PATTERN = /([A-Za-z0-9_.-]+\.(?:js|mjs|cjs|ts|tsx|jsx)):(\d+)(?::(\d+))?/;

/**
 * Limpia un frame: se queda solo con el archivo y la línea/columna. Nunca
 * origen, query ni ruta absoluta del dispositivo.
 */
export function sanitizeFrame(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return null;
  const match = FRAME_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, file, line, column] = match;
  const frame = column ? `${file}:${line}:${column}` : `${file}:${line}`;
  return frame.slice(0, CLIENT_ERROR_MAX_FRAME);
}

function readBounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Valida el cuerpo y devuelve el evento a registrar, o `null` si hay que
 * descartarlo en silencio.
 */
export function parseClientErrorReport(raw: unknown): ClientErrorReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const input = raw as Record<string, unknown>;
  const allowed = new Set(["name", "code", "route", "version", "message", "frames"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return null;
  }

  const name = readBounded(input.name, CLIENT_ERROR_MAX_NAME);
  if (!name) return null;

  let code = "";
  if (input.code !== undefined) {
    code = readBounded(input.code, CLIENT_ERROR_MAX_CODE) ?? "";
  }

  let version = "web";
  if (input.version !== undefined) {
    version = readBounded(input.version, CLIENT_ERROR_MAX_VERSION) ?? "web";
  }

  let message: string | undefined;
  if (input.message !== undefined) {
    const read = readBounded(input.message, CLIENT_ERROR_MAX_MESSAGE);
    // Un mensaje fuera de rango descarta el reporte: no se recorta a medias.
    if (!read) return null;
    message = read;
  }

  // Los frames son diagnóstico, no un interruptor de privacidad: un frame
  // ilegible se descarta y el reporte sigue (a diferencia de `message`).
  let frames: string[] | undefined;
  if (input.frames !== undefined) {
    if (!Array.isArray(input.frames)) return null;
    const cleaned: string[] = [];
    for (const candidate of input.frames) {
      const frame = sanitizeFrame(candidate);
      if (frame && !cleaned.includes(frame)) cleaned.push(frame);
      if (cleaned.length >= CLIENT_ERROR_MAX_FRAMES) break;
    }
    if (cleaned.length > 0) frames = cleaned;
  }

  return {
    event: "client_error",
    name,
    code,
    route: sanitizeRoute(input.route),
    version,
    ...(message ? { message } : {}),
    ...(frames ? { frames } : {}),
  };
}

interface Bucket {
  minuteWindow: number;
  minuteCount: number;
  hourWindow: number;
  hourCount: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_CLIENTS = 5_000;

/**
 * ¿Se puede registrar un error de esta IP? Ventanas fijas de 1 minuto y 1 hora.
 * Es un tope por isolate: con varias instancias, el límite efectivo se multiplica.
 */
export function allowClientError(ip: string, now: number): boolean {
  const minuteWindow = Math.floor(now / 60_000);
  const hourWindow = Math.floor(now / 3_600_000);

  let bucket = buckets.get(ip);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.clear();
    bucket = { minuteWindow, minuteCount: 0, hourWindow, hourCount: 0 };
  }
  if (bucket.minuteWindow !== minuteWindow) {
    bucket.minuteWindow = minuteWindow;
    bucket.minuteCount = 0;
  }
  if (bucket.hourWindow !== hourWindow) {
    bucket.hourWindow = hourWindow;
    bucket.hourCount = 0;
  }

  bucket.minuteCount += 1;
  bucket.hourCount += 1;
  buckets.set(ip, bucket);

  return (
    bucket.minuteCount <= CLIENT_ERROR_LIMIT_PER_MINUTE &&
    bucket.hourCount <= CLIENT_ERROR_LIMIT_PER_HOUR
  );
}

/** Solo para pruebas: deja el estado de límites como recién arrancado. */
export function resetClientErrorLimiters(): void {
  buckets.clear();
}
