// Contrato y reglas compartidas del panel de análisis del dueño.
//
// Lo que aquí se define viaja en `/api/admin/insights` y
// `/api/admin/users/:id`, y alimenta el modal del dueño en el cliente.
// Las reglas de negocio (aciertos, etapas de palabra, dispositivo,
// cuentas de prueba) viven aquí para que el servidor y el panel
// usen exactamente la misma definición.

// ---------- Periodo y zona horaria ----------

export const ADMIN_PERIOD_DAYS = [7, 30, 90, 180] as const;
export type AdminPeriodDays = (typeof ADMIN_PERIOD_DAYS)[number];
export const DEFAULT_ADMIN_DAYS: AdminPeriodDays = 30;

/** Periodo válido del panel; lo que no cuadra cae al valor por omisión. */
export function normalizeAdminDays(input: unknown): AdminPeriodDays {
  const days = Number(input);
  return (ADMIN_PERIOD_DAYS as readonly number[]).includes(days)
    ? (days as AdminPeriodDays)
    : DEFAULT_ADMIN_DAYS;
}

/** Zona horaria IANA válida; lo que no cuadra cae a UTC. */
export function normalizeTimeZone(input: unknown, fallback = "UTC"): string {
  const tz = typeof input === "string" ? input.trim() : "";
  if (!tz || tz.length > 64) return fallback;
  try {
    // Intl valida el nombre: "Marte/Olympus" lanza RangeError.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

// ---------- Dispositivos ----------

export type AdminDeviceClass =
  | "kindle"
  | "phone"
  | "tablet"
  | "desktop"
  | "bot"
  | "unknown";

// La clase se calcula en el servidor sobre el user-agent de la sesión
// vigente; el agente crudo jamás sale en la respuesta.
export function classifyDevice(
  userAgent: string | null | undefined,
): AdminDeviceClass {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (/bot|crawler|spider|headless|preview|curl|wget|python/.test(ua)) {
    return "bot";
  }
  if (/kindle|ereader|e-ink|silk/.test(ua)) return "kindle";
  if (/ipad|tablet|playbook/.test(ua)) return "tablet";
  if (/android(?!.*mobile)/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/.test(ua)) return "phone";
  return "desktop";
}

// ---------- Cuentas de prueba ----------

// Los smoke tests crean cuentas que inflan las cifras: `smoke:auth`
// usa `*@smoke.test` y `smoke:sync` usa `*@example.com` más la cuenta
// canónica. El panel las excluye por omisión (el interruptor las
// incluye de nuevo).
export function isTestAccount(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase();
  return e.endsWith("@smoke.test") || e.endsWith("@example.com");
}

// ---------- Regla de aciertos (espejo de computeRetentionSummary) ----------

// Repaso verificado = cualquier tipo que no sea autoinforme 'declared'.
// Acierto = calificación 'good', 'easy' o 'correct'. Tiene que ser la
// MISMA regla que `computeRetentionSummary` (client/src/lib/journey.ts)
// para que el panel y «Tu recorrido» den el mismo porcentaje.
export const REVIEW_KIND_EXCLUDED_FROM_RECALL = "declared";
export const RECALL_HIT_RATINGS = ["good", "easy", "correct"] as const;

export function isRecallHit(rating: string): boolean {
  return (RECALL_HIT_RATINGS as readonly string[]).includes(rating);
}

export function isVerifiedReview(kind: string): boolean {
  return kind !== REVIEW_KIND_EXCLUDED_FROM_RECALL;
}

/** recallPct redondeado como el cliente; null si no hay verificados. */
export function recallPct(verified: number, hits: number): number | null {
  return verified > 0 ? Math.round((hits / verified) * 100) : null;
}

// ---------- Etapas de palabra (espejo de markLevel) ----------

// `markLevel` (client/src/lib/word-level.ts) corta la estabilidad FSRS
// en días: reps 0 y s<2 «nueva», s<21 «aprendiendo», s<90 «asentada» y
// por encima «dominada» (sin marca). El servidor usa estos mismos
// cortes sobre card->>'stability' y card->>'reps'.
export type FsrsStage = "new" | "learning" | "settled" | "mastered";

export function fsrsStage(stability: number, reps: number): FsrsStage {
  if (stability < 2) return reps === 0 ? "new" : "learning";
  if (stability < 21) return "learning";
  if (stability < 90) return "settled";
  return "mastered";
}

// Número tolerante en SQL: ts-fsrs escribe números limpios, pero una
// fila heredada o de otro cliente no debe poder tirar la consulta
// entera. Devuelve 0 ante valores vacíos o no numéricos.
export const FSRS_NUM_SQL = (field: "stability" | "reps") =>
  `CASE WHEN card->>'${field}' ~ '^-?\\d+(\\.\\d+)?([eE][+-]?\\d+)?$' ` +
  `THEN (card->>'${field}')::float8 ELSE 0 END`;

// Expresión SQL equivalente a fsrsStage, para contar por etapa en la
// base. Los cortes son los de arriba: cualquier cambio se hace aquí y
// en markLevel a la vez.
export const FSRS_STAGE_SQL = `CASE
  WHEN ${FSRS_NUM_SQL("stability")} < 2
    THEN CASE WHEN ${FSRS_NUM_SQL("reps")} = 0 THEN 'new' ELSE 'learning' END
  WHEN ${FSRS_NUM_SQL("stability")} < 21 THEN 'learning'
  WHEN ${FSRS_NUM_SQL("stability")} < 90 THEN 'settled'
  ELSE 'mastered'
END`;

// ---------- Huecos entre páginas del Kindle ----------

// Cada vuelta de página del Kindle guarda un evento puntual (0 ms).
// El tiempo se estima sumando huecos entre páginas consecutivas de
// hasta 5 minutos; un hueco mayor es una pausa real, no lectura.
export const KINDLE_GAP_MS = 5 * 60_000;

// ---------- Contrato del panel ----------

export interface AdminKpis {
  totalAccounts: number;
  newAccounts: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  /** activeToday / active30d (0–1); null si aún no hay nadie. */
  stickiness: number | null;
  /** Minutos de intervalos reales unidos en el periodo. */
  readingMinutes: number;
  /** Estimado desde los huecos del Kindle (etiquetado aparte). */
  kindleMinutesEst: number;
  /** Minutos por persona activa en el periodo. */
  readingMinutesPerActive: number | null;
  booksFinished: number;
  wordsSaved: number;
  reviews: number;
  recallPct: number | null;
  annotations: number;
}

export interface AdminDaySeries {
  /** YYYY-MM-DD en la zona elegida. */
  day: string;
  activeUsers: number;
  readingMinutes: number;
  kindlePages: number;
  kindleMinutesEst: number;
  reviews: number;
  wordsSaved: number;
  consults: number;
  signups: number;
}

export interface AdminFunnelStep {
  /** signup | read | saved | reviewed | returned | finished */
  id:
    | "signup"
    | "read"
    | "saved"
    | "reviewed"
    | "returned"
    | "finished";
  users: number;
}

export interface AdminCohortRow {
  /** Lunes de la semana de alta (YYYY-MM-DD en la zona elegida). */
  week: string;
  size: number;
  /** % activos en cada semana desde el alta (índice = semana N). */
  retainedPct: (number | null)[];
  /** Personas activas en cada semana desde el alta. */
  retainedUsers: number[];
}

export interface AdminHeatCell {
  /** Día ISO 1–7 (1 = lunes). */
  dow: number;
  hour: number;
  minutes: number;
}

export interface AdminBookStat {
  bookHash: string;
  title: string | null;
  author: string | null;
  /** Idioma declarado en la subida (null = libros viejos sin la columna). */
  language: string | null;
  readers: number;
  minutes: number;
  avgProgress: number;
  finished: number;
  lastOpenAt: number;
}

export interface AdminDeviceMix {
  device: AdminDeviceClass;
  sessions: number;
  users: number;
}

export interface AdminAiUsage {
  scope: string;
  units: number;
  users: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  lastActiveAt: number | null;
  minutesPeriod: number;
  minutesTotal: number;
  booksStarted: number;
  booksFinished: number;
  wordsSaved: number;
  reviews: number;
  recallPct: number | null;
  usesKindle: boolean;
  annotations: number;
}

export interface AdminOverview {
  generatedAt: number;
  days: AdminPeriodDays;
  timeZone: string;
  kpis: AdminKpis;
  /** Mismas cifras del periodo anterior de igual duración. */
  kpisPrev: AdminKpis;
  series: AdminDaySeries[];
  funnel: AdminFunnelStep[];
  cohorts: AdminCohortRow[];
  hourHeatmap: AdminHeatCell[];
  topBooks: AdminBookStat[];
  pausedBooks: AdminBookStat[];
  learning: {
    stages: Record<FsrsStage, number>;
    ratings: Record<string, number>;
    reviewKinds: Record<string, number>;
    knowledgeByLang: {
      language: string;
      known: number;
      sources: Record<string, number>;
    }[];
  };
  devices: AdminDeviceMix[];
  aiByScope: AdminAiUsage[];
  users: AdminUserRow[];
  truncatedUsers: boolean;
  /** Cuentas de prueba excluidas de todos los números anteriores. */
  testAccountsExcluded: boolean;
}

export interface AdminUserDetail {
  user: { id: string; email: string; name: string; createdAt: number };
  lastActiveAt: number | null;
  days: AdminPeriodDays;
  series: {
    day: string;
    minutes: number;
    kindlePages: number;
    reviews: number;
    wordsSaved: number;
    consults: number;
  }[];
  books: {
    bookHash: string;
    title: string | null;
    author: string | null;
    language: string | null;
    progress: number;
    minutes: number;
    lastOpenAt: number;
    finished: boolean;
  }[];
  stages: Record<FsrsStage, number>;
  recallByWeek: {
    week: string;
    reviews: number;
    recallPct: number | null;
  }[];
  languages: {
    language: string;
    lemmasKnown: number;
    wordsSaved: number;
  }[];
  devices: AdminDeviceMix[];
  consultsTotal: number;
  aiByScope: AdminAiUsage[];
}

// ---------- Días del calendario en una zona ----------

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD de un sello en la zona elegida (mismo formato que dayKeyOf). */
export function dayKeyInTz(ts: number, timeZone: string): string {
  let fmt = dayKeyFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(ts));
}

export function todayKeyInTz(timeZone: string, now = Date.now()): string {
  return dayKeyInTz(now, timeZone);
}

/** Lunes (YYYY-MM-DD) de la semana a la que pertenece el día dado. */
export function mondayOf(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = lunes
  dt.setUTCDate(dt.getUTCDate() - dow);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Diferencia en días entre dos claves YYYY-MM-DD. */
export function dayKeyDiff(a: string, b: string): number {
  const parse = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(a) - parse(b)) / 86_400_000);
}

// ---------- Relleno de series ----------

/** Suma segura de un día del calendario en la zona elegida (para rellenar). */
export function addDays(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * Rellena con ceros los días sin actividad entre `firstDay` y
 * `firstDay + days - 1`, para que la gráfica no salte huecos.
 */
export function fillDaySeries<T extends { day: string }>(
  rows: T[],
  lastDay: string,
  days: number,
  empty: (day: string) => T,
): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const first = addDays(lastDay, -(days - 1));
  const out: T[] = [];
  let cursor = first;
  for (let i = 0; i < days; i++) {
    out.push(byDay.get(cursor) ?? empty(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}
