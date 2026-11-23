import { Hono, type Context } from "hono";
import type pg from "pg";
import { withClient, type WorkerEnv } from "./db";
import { getSessionUser } from "./session";
import { createTimer } from "./kindle/timing";
import {
  FSRS_STAGE_SQL,
  KINDLE_GAP_MS,
  addDays,
  classifyDevice,
  dayKeyInTz,
  fillDaySeries,
  isTestAccount,
  mondayOf,
  normalizeAdminDays,
  normalizeTimeZone,
  recallPct,
  todayKeyInTz,
  type AdminAiUsage,
  type AdminBookStat,
  type AdminCohortRow,
  type AdminDaySeries,
  type AdminDeviceClass,
  type AdminDeviceMix,
  type AdminFunnelStep,
  type AdminHeatCell,
  type AdminKpis,
  type AdminOverview,
  type AdminUserDetail,
  type AdminUserRow,
  type FsrsStage,
} from "../shared/admin-insights";

// Panel de análisis del dueño. Todas las rutas se esconden: quien no
// es el dueño recibe 404, como si la ruta no existiera (misma regla
// que /api/error-reports). Las respuestas llevan no-store: son datos
// de otras personas y no deben quedar en caché de nadie.
//
// Solo llegan al servidor los datos que ya se sincronizan: uso sin
// cuenta es invisible aquí y el panel lo dice.

export const admin = new Hono<{ Bindings: WorkerEnv }>();

export type OwnerUser = { id: string; email?: string | null };

/**
 * Devuelve el usuario de la sesión si —y solo si— su correo es el de
 * `LECTA_OWNER_EMAIL` y está verificado. Sin verificación, cualquiera
 * podría registrar ese correo con contraseña antes que el dueño y entrar
 * al panel. Sin variable configurada, sin sesión, con otro correo o sin
 * verificar devuelve null y quien llama responde 404. Quien llame decide
 * si traga el error de infraestructura de sesión: /api/error-reports
 * lo convierte en 404 y las rutas de admin prefieren propagarlo para
 * que onError responda 503 (la base caída no es «no eres el dueño»).
 */
export async function ownerUser(
  context: Context<{ Bindings: WorkerEnv }>,
): Promise<OwnerUser | null> {
  const owner = context.env?.LECTA_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return null;
  const user = await getSessionUser(context);
  const email = user?.email?.toLowerCase();
  if (!email || email !== owner || user?.emailVerified !== true) return null;
  return user as OwnerUser;
}

function notFound(c: Context<{ Bindings: WorkerEnv }>) {
  return c.body(null, 404);
}

// ---------- Filas crudas ----------

interface FactRow {
  metric: string;
  user_id: string | null;
  day: string | null;
  k1: string | null;
  k2: string | null;
  n1: string | number | null;
  n2: string | number | null;
  n3: string | number | null;
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
  created_at: string | number;
}

interface SessionRow {
  user_id: string;
  ua: string | null;
}

interface AiRow {
  scope: string;
  units: string | number;
  users: string | number;
}

interface UserBookRow {
  user_id: string;
  book_id: string;
  title: string | null;
  author: string | null;
  language?: string | null;
}

// ---------- SQL: hechos por día ----------

// Una sola consulta trae todos los hechos diarios: cada UNION agrega
// una fuente y la etiqueta con `metric`, así un solo round-trip al
// servidor remoto cubre minutos, Kindle, repasos, palabras, altas,
// eventos del compañero y días activos.
//
// `merged` une los intervalos traslapados por usuario (islas con
// running-max), igual que mergeIntervals del cliente: sin ese paso,
// leer en dos dispositivos a la vez contaría el tiempo dos veces.
// $1 = inicio de la ventana (periodo anterior incluido), $2 = ahora,
// $3 = zona horaria, $4 = hueco máximo Kindle, $5 = inicio de días
// activos.
const DAILY_FACTS_SQL = `
WITH act AS (
  SELECT user_id, started_at, ended_at
    FROM lecta_user_activity
   WHERE ended_at > started_at
),
flagged AS (
  SELECT user_id, started_at, ended_at,
         CASE WHEN started_at <= MAX(ended_at) OVER w THEN 0 ELSE 1 END AS flag
    FROM act
    WINDOW w AS (
      PARTITION BY user_id ORDER BY started_at, ended_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    )
),
islands AS (
  SELECT user_id, started_at, ended_at,
         SUM(flag) OVER (
           PARTITION BY user_id ORDER BY started_at, ended_at
           ROWS UNBOUNDED PRECEDING
         ) AS grp
    FROM flagged
),
merged AS (
  SELECT user_id, MIN(started_at) AS s, MAX(ended_at) AS e
    FROM islands GROUP BY user_id, grp
),
windowed AS (
  SELECT user_id, GREATEST(s, $1::float8) AS s, LEAST(e, $2::float8) AS e
    FROM merged
   WHERE e > $1::float8 AND s < $2::float8
)
SELECT metric, user_id, day::text AS day, k1, k2,
       n1::text AS n1, n2::text AS n2, n3::text AS n3
FROM (
  SELECT 'minutes' AS metric, user_id,
         (to_timestamp(s::float8/1000) AT TIME ZONE $3)::date AS day,
         NULL::text AS k1, NULL::text AS k2,
         SUM(e - s)::numeric AS n1, 0::numeric AS n2, 0::numeric AS n3
    FROM windowed
   GROUP BY user_id, (to_timestamp(s::float8/1000) AT TIME ZONE $3)::date
  UNION ALL
  SELECT 'minutes_total', user_id, NULL, NULL, NULL,
         SUM(e - s)::numeric, 0::numeric, 0::numeric
    FROM merged GROUP BY user_id
  UNION ALL
  SELECT 'kindle', user_id,
         (to_timestamp(started_at::float8/1000) AT TIME ZONE $3)::date, NULL, NULL,
         count(*)::numeric,
         SUM(CASE WHEN gap > 0 AND gap <= $4::float8 THEN gap ELSE 0 END)::numeric,
         0::numeric
    FROM (
      SELECT user_id, started_at,
             started_at - lag(started_at) OVER (
               PARTITION BY user_id ORDER BY started_at) AS gap
        FROM lecta_user_activity
       WHERE started_at = ended_at
         AND started_at >= $1::float8 AND started_at <= $2::float8
    ) k GROUP BY user_id,
        (to_timestamp(started_at::float8/1000) AT TIME ZONE $3)::date
  UNION ALL
  SELECT 'review', user_id,
         (to_timestamp(created_at::float8/1000) AT TIME ZONE $3)::date, NULL, NULL,
         count(*)::numeric,
         count(*) FILTER (WHERE kind <> 'declared')::numeric,
         count(*) FILTER (WHERE kind <> 'declared'
                          AND rating IN ('hard','good','easy','correct'))::numeric
    FROM lecta_user_reviews
   WHERE created_at >= $1::float8 AND created_at <= $2::float8
   GROUP BY user_id, (to_timestamp(created_at::float8/1000) AT TIME ZONE $3)::date
  UNION ALL
  SELECT 'word_saved', user_id,
         (to_timestamp(saved_at::float8/1000) AT TIME ZONE $3)::date, NULL, NULL,
         count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_words
   WHERE deleted = false AND saved_at >= $1::float8 AND saved_at <= $2::float8
   GROUP BY user_id, (to_timestamp(saved_at::float8/1000) AT TIME ZONE $3)::date
  UNION ALL
  SELECT 'signup', id AS user_id,
         ("createdAt" AT TIME ZONE $3)::date, NULL, NULL,
         count(*)::numeric, 0::numeric, 0::numeric
    FROM "user"
   WHERE "createdAt" >= to_timestamp($1::float8/1000)
     AND "createdAt" <= to_timestamp($2::float8/1000)
   GROUP BY id, ("createdAt" AT TIME ZONE $3)::date
  UNION ALL
  SELECT 'companion', user_id,
         (to_timestamp((payload->>'at')::bigint::float8/1000) AT TIME ZONE $3)::date,
         payload->'event'->>'kind', NULL,
         count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_companion_events
   WHERE payload->>'at' ~ '^\\d{1,15}$'
     AND (payload->>'at')::bigint >= $1::float8
     AND (payload->>'at')::bigint <= $2::float8
   GROUP BY user_id,
        (to_timestamp((payload->>'at')::bigint::float8/1000) AT TIME ZONE $3)::date,
        payload->'event'->>'kind'
  UNION ALL
  SELECT 'active_day', user_id, day, NULL, NULL,
         count(*)::numeric, 0::numeric, 0::numeric
    FROM (
      SELECT user_id,
             (to_timestamp(started_at::float8/1000) AT TIME ZONE $3)::date AS day
        FROM lecta_user_activity WHERE started_at >= $5::float8
      UNION
      SELECT user_id,
             (to_timestamp(created_at::float8/1000) AT TIME ZONE $3)::date
        FROM lecta_user_reviews WHERE created_at >= $5::float8
    ) ad GROUP BY user_id, day
) facts`;

// ---------- SQL: mapa horario ----------

// Minutos por (día de la semana, hora) en la zona elegida. Cada isla
// se parte por hora con generate_series para no atribuir una sesión
// larga entera a la hora en que empezó. $1 = inicio, $2 = ahora,
// $3 = zona. dow sale 0–6 (domingo–sábado) y se remapea a ISO en JS.
const HOUR_HEATMAP_SQL = `
WITH act AS (
  SELECT user_id, started_at, ended_at
    FROM lecta_user_activity
   WHERE ended_at > started_at
),
flagged AS (
  SELECT user_id, started_at, ended_at,
         CASE WHEN started_at <= MAX(ended_at) OVER w THEN 0 ELSE 1 END AS flag
    FROM act
    WINDOW w AS (
      PARTITION BY user_id ORDER BY started_at, ended_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    )
),
islands AS (
  SELECT user_id, started_at, ended_at,
         SUM(flag) OVER (
           PARTITION BY user_id ORDER BY started_at, ended_at
           ROWS UNBOUNDED PRECEDING
         ) AS grp
    FROM flagged
),
merged AS (
  SELECT user_id, MIN(started_at) AS s, MAX(ended_at) AS e
    FROM islands GROUP BY user_id, grp
),
windowed AS (
  SELECT user_id, GREATEST(s, $1::float8)::bigint AS s,
         LEAST(e, $2::float8)::bigint AS e
    FROM merged
   WHERE e > $1::float8 AND s < $2::float8
)
SELECT extract(dow FROM to_timestamp(h::float8/1000) AT TIME ZONE $3)::int AS dow,
       extract(hour FROM to_timestamp(h::float8/1000) AT TIME ZONE $3)::int AS hr,
       SUM(LEAST(e, h + 3600000) - GREATEST(s, h))::numeric AS ms
  FROM windowed
  JOIN LATERAL generate_series(
         (floor(s::float8/3600000))::bigint * 3600000,
         (floor((e-1)::float8/3600000))::bigint * 3600000,
         3600000) h ON true
 GROUP BY dow, hr`;

// ---------- SQL: hechos por usuario ----------

// Totales por cuenta (sin ventana salvo lo marcado): palabras,
// repasos, anotaciones, etapas FSRS, conocimiento, posiciones,
// minutos por libro en el periodo, última actividad, usuarios Kindle,
// «volvió otro día» y libros terminados por evento del compañero.
// $1 = inicio del periodo actual, $2 = inicio del periodo anterior
// (para las comparaciones), $3 = zona horaria.
const USER_FACTS_SQL = `
SELECT metric, user_id, k1, k2,
       n1::text AS n1, n2::text AS n2, n3::text AS n3
FROM (
  SELECT 'words' AS metric, user_id, NULL::text AS k1, NULL::text AS k2,
         count(*)::numeric AS n1, 0::numeric AS n2, 0::numeric AS n3
    FROM lecta_user_words WHERE deleted = false GROUP BY user_id
  UNION ALL
  SELECT 'word_lang', user_id, language, NULL, count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_words WHERE deleted = false GROUP BY user_id, language
  UNION ALL
  SELECT 'reviews', user_id, NULL, NULL, count(*)::numeric,
         count(*) FILTER (WHERE kind <> 'declared')::numeric,
         count(*) FILTER (WHERE kind <> 'declared'
                          AND rating IN ('hard','good','easy','correct'))::numeric
    FROM lecta_user_reviews GROUP BY user_id
  UNION ALL
  SELECT 'annotations', user_id, NULL, NULL, count(*)::numeric,
         count(*) FILTER (WHERE created_at >= $1::float8)::numeric,
         count(*) FILTER (WHERE created_at >= $2::float8
                          AND created_at < $1::float8)::numeric
    FROM lecta_user_annotations WHERE deleted = false GROUP BY user_id
  UNION ALL
  SELECT 'stage', user_id, ${FSRS_STAGE_SQL}, NULL, count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_words WHERE deleted = false
   GROUP BY user_id, ${FSRS_STAGE_SQL}
  UNION ALL
  SELECT 'knowledge', user_id, language, source, count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_knowledge
   WHERE deleted = false AND known = true
   GROUP BY user_id, language, source
  UNION ALL
  SELECT 'position', user_id, book_hash, NULL,
         GREATEST(COALESCE(progress, 0), COALESCE(ratio, 0))::numeric,
         updated_at::numeric, 0::numeric
    FROM lecta_user_positions
  UNION ALL
  SELECT 'book_minutes', user_id, book_hash, NULL,
         SUM(ended_at - started_at)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_activity
   WHERE ended_at > started_at AND started_at >= $1::float8
   GROUP BY user_id, book_hash
  UNION ALL
  SELECT 'last_active', user_id, NULL, NULL, MAX(v)::numeric, 0::numeric, 0::numeric
    FROM (
      SELECT user_id, ended_at AS v FROM lecta_user_activity
      UNION ALL
      SELECT user_id, created_at FROM lecta_user_reviews
      UNION ALL
      SELECT user_id, updated_at FROM lecta_user_positions
      UNION ALL
      SELECT user_id, (payload->>'at')::bigint
        FROM lecta_user_companion_events
       WHERE payload->>'at' ~ '^\\d{1,15}$'
    ) la GROUP BY user_id
  UNION ALL
  SELECT 'kindle_user', user_id, NULL, NULL, 1::numeric, 0::numeric, 0::numeric
    FROM lecta_user_activity WHERE started_at = ended_at GROUP BY user_id
  UNION ALL
  SELECT 'returned', user_id, NULL, NULL, 1::numeric, 0::numeric, 0::numeric
    FROM (
      SELECT user_id FROM (
        SELECT user_id, to_timestamp(started_at::float8/1000)::date AS d
          FROM lecta_user_activity
        UNION
        SELECT user_id, to_timestamp(created_at::float8/1000)::date
          FROM lecta_user_reviews
      ) dd GROUP BY user_id HAVING count(DISTINCT d) >= 2
    ) r
  UNION ALL
  SELECT 'companion_finished', user_id, payload->'event'->>'bookHash',
         (to_timestamp((payload->>'at')::bigint::float8/1000) AT TIME ZONE $3)::date::text,
         count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_companion_events
   WHERE payload->'event'->>'kind' = 'book_finished'
     AND payload->>'at' ~ '^\\d{1,15}$'
   GROUP BY user_id, payload->'event'->>'bookHash',
        (to_timestamp((payload->>'at')::bigint::float8/1000) AT TIME ZONE $3)::date::text
  UNION ALL
  SELECT 'rating', NULL, rating, NULL, count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_reviews WHERE created_at >= $1::float8 GROUP BY rating
  UNION ALL
  SELECT 'kind', NULL, kind, NULL, count(*)::numeric, 0::numeric, 0::numeric
    FROM lecta_user_reviews WHERE created_at >= $1::float8 GROUP BY kind
) facts`;

const USERS_SQL = `
SELECT id, email, COALESCE(name, '') AS name,
       (extract(epoch from "createdAt") * 1000)::bigint AS created_at
  FROM "user" ORDER BY "createdAt" DESC LIMIT 1001`;

const SESSIONS_SQL = `
SELECT "userId" AS user_id, "userAgent" AS ua
  FROM "session" WHERE "expiresAt" > now()`;

// Uso de IA dentro del periodo: bucket_hour es epoch-hora, así que el
// filtro es una conversión, no una fecha. La retención es de 30 días —
// en periodos más largos el número refleja solo lo retenido.
const AI_SQL = `
SELECT scope, SUM(units_used)::bigint AS units,
       count(DISTINCT user_id)::bigint AS users
  FROM lecta_ai_quota WHERE bucket_hour >= $1 GROUP BY scope
  ORDER BY units DESC`;

// `language` llega con la migración 022: si la columna aún no existe
// se reintenta sin ella (desplegar antes que migrar).
const USER_BOOKS_SQL = `
SELECT user_id, book_id, title, author, language FROM user_books`;
const USER_BOOKS_NO_LANG_SQL = `
SELECT user_id, book_id, title, author, NULL AS language FROM user_books`;

// ---------- Utilidades de ensamblado ----------

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const DAY_MS = 86_400_000;
const COHORT_WEEKS = 8;
const COHORT_WINDOW_MS = (COHORT_WEEKS + 8) * 7 * DAY_MS;
const PAUSED_AFTER_MS = 14 * DAY_MS;
const USERS_TABLE_LIMIT = 1000;
const MIN_MS = 60_000;

export interface OverviewInput {
  users: AccountRow[];
  facts: FactRow[];
  hourCells: { dow: number; hr: number; ms: string | number }[];
  sessions: SessionRow[];
  aiUsage: AiRow[];
  userBooks: UserBookRow[];
  days: number;
  timeZone: string;
  now: number;
  includeTest: boolean;
}

interface PerUserAgg {
  minutesPeriodMs: number;
  minutesPrevMs: number;
  minutesTotalMs: number;
  lastActiveAt: number | null;
  wordsSaved: number;
  reviews: number;
  reviewsVerified: number;
  reviewsHits: number;
  annotations: number;
  annotationsPrev: number;
  positions: Map<string, { progress: number; updatedAt: number }>;
  bookMinutesMs: Map<string, number>;
  finishedBooks: Set<string>;
  usesKindle: boolean;
  returned: boolean;
}

function emptyAgg(): PerUserAgg {
  return {
    minutesPeriodMs: 0,
    minutesPrevMs: 0,
    minutesTotalMs: 0,
    lastActiveAt: null,
    wordsSaved: 0,
    reviews: 0,
    reviewsVerified: 0,
    reviewsHits: 0,
    annotations: 0,
    annotationsPrev: 0,
    positions: new Map(),
    bookMinutesMs: new Map(),
    finishedBooks: new Set(),
    usesKindle: false,
    returned: false,
  };
}

/** Ensambla el panel completo a partir de las filas crudas. Pura. */
export function assembleOverview(input: OverviewInput): AdminOverview {
  const {
    users,
    facts,
    hourCells,
    sessions,
    aiUsage,
    userBooks,
    days,
    timeZone,
    now,
    includeTest,
  } = input;

  const testIds = new Set(
    users.filter((u) => isTestAccount(u.email)).map((u) => u.id),
  );
  const kept = (id: string | null) =>
    id != null && (includeTest || !testIds.has(id));
  const keptUsers = users.filter((u) => !isTestAccount(u.email) || includeTest);

  const today = todayKeyInTz(timeZone, now);
  const sinceMs = now - days * DAY_MS;
  const sinceDay = dayKeyInTz(sinceMs, timeZone);
  const prevSinceMs = now - 2 * days * DAY_MS;
  const inPeriod = (day: string | null) => day != null && day >= sinceDay;
  const inPrev = (day: string | null) =>
    day != null && day < sinceDay && day >= dayKeyInTz(prevSinceMs, timeZone);

  const agg = new Map<string, PerUserAgg>();
  const aggOf = (id: string) => {
    let a = agg.get(id);
    if (!a) {
      a = emptyAgg();
      agg.set(id, a);
    }
    return a;
  };

  // ---- Series por día ----
  const seriesMap = new Map<string, AdminDaySeries>();
  const dayRow = (day: string): AdminDaySeries => {
    let r = seriesMap.get(day);
    if (!r) {
      r = {
        day,
        activeUsers: 0,
        readingMinutes: 0,
        kindlePages: 0,
        kindleMinutesEst: 0,
        reviews: 0,
        wordsSaved: 0,
        consults: 0,
        signups: 0,
      };
      seriesMap.set(day, r);
    }
    return r;
  };
  const activeUsersByDay = new Map<string, Set<string>>();

  const markActive = (day: string | null, userId: string | null) => {
    if (!day || !kept(userId)) return;
    let set = activeUsersByDay.get(day);
    if (!set) {
      set = new Set();
      activeUsersByDay.set(day, set);
    }
    set.add(userId!);
  };

  // ---- KPIs y aprendizaje ----
  let minutesPeriod = 0;
  let minutesPrev = 0;
  let kindleEstPeriod = 0;
  let kindleEstPrev = 0;
  let wordsPeriod = 0;
  let wordsPrev = 0;
  let reviewsPeriod = 0;
  let reviewsPrev = 0;
  let hitsPeriod = 0;
  let hitsPrev = 0;
  let verifiedPeriod = 0;
  let verifiedPrev = 0;
  let signupsPeriod = 0;
  let signupsPrev = 0;
  let annotationsPeriod = 0;
  let annotationsPrev = 0;
  const stages: Record<FsrsStage, number> = {
    new: 0,
    learning: 0,
    settled: 0,
    mastered: 0,
  };
  const ratings: Record<string, number> = {};
  const reviewKinds: Record<string, number> = {};
  const knowledgeByLang = new Map<
    string,
    { language: string; known: number; sources: Record<string, number> }
  >();
  const finishedInPeriod = new Set<string>();
  const finishedPrev = new Set<string>();
  const activeInPeriod = new Set<string>();

  for (const f of facts) {
    const userId = f.user_id;
    if (f.metric !== "signup" && !kept(userId)) continue;
    if (f.metric === "signup" && userId != null && !kept(userId)) continue;

    switch (f.metric) {
      case "minutes": {
        const ms = num(f.n1);
        if (inPeriod(f.day)) {
          minutesPeriod += ms;
          aggOf(userId!).minutesPeriodMs += ms;
          if (ms > 0) {
            markActive(f.day, userId);
            activeInPeriod.add(userId!);
          }
          if (f.day) dayRow(f.day).readingMinutes += ms / MIN_MS;
        } else if (inPrev(f.day)) {
          minutesPrev += ms;
          aggOf(userId!).minutesPrevMs += ms;
        }
        break;
      }
      case "minutes_total": {
        aggOf(userId!).minutesTotalMs = num(f.n1);
        break;
      }
      case "kindle": {
        const pages = num(f.n1);
        const estMs = num(f.n2);
        if (inPeriod(f.day)) {
          kindleEstPeriod += estMs;
          markActive(f.day, userId);
          activeInPeriod.add(userId!);
          if (f.day) {
            const r = dayRow(f.day);
            r.kindlePages += pages;
            r.kindleMinutesEst += estMs / MIN_MS;
          }
        } else if (inPrev(f.day)) {
          kindleEstPrev += estMs;
        }
        break;
      }
      case "review": {
        const n = num(f.n1);
        const verified = num(f.n2);
        const hits = num(f.n3);
        if (inPeriod(f.day)) {
          reviewsPeriod += n;
          verifiedPeriod += verified;
          hitsPeriod += hits;
          markActive(f.day, userId);
          activeInPeriod.add(userId!);
          if (f.day) dayRow(f.day).reviews += n;
        } else if (inPrev(f.day)) {
          reviewsPrev += n;
          verifiedPrev += verified;
          hitsPrev += hits;
        }
        break;
      }
      case "word_saved": {
        const n = num(f.n1);
        if (inPeriod(f.day)) {
          wordsPeriod += n;
          markActive(f.day, userId);
          activeInPeriod.add(userId!);
          if (f.day) dayRow(f.day).wordsSaved += n;
        } else if (inPrev(f.day)) {
          wordsPrev += n;
        }
        break;
      }
      case "signup": {
        const n = num(f.n1);
        if (inPeriod(f.day)) {
          signupsPeriod += n;
          if (f.day) dayRow(f.day).signups += n;
        } else if (inPrev(f.day)) {
          signupsPrev += n;
        }
        break;
      }
      case "companion": {
        const n = num(f.n1);
        if (!inPeriod(f.day)) break;
        markActive(f.day, userId);
        activeInPeriod.add(userId!);
        if (f.k1 === "consulted" && f.day) dayRow(f.day).consults += n;
        break;
      }
      case "active_day": {
        markActive(f.day, userId);
        if (inPeriod(f.day)) activeInPeriod.add(userId!);
        break;
      }
    }
  }

  for (const [day, set] of activeUsersByDay) {
    if (inPeriod(day)) dayRow(day).activeUsers = set.size;
  }

  // ---- Hechos por usuario ----
  const returnedUsers = new Set<string>();
  const kindleUsers = new Set<string>();

  for (const f of facts) {
    const userId = f.user_id;
    if (userId != null && !kept(userId)) continue;

    switch (f.metric) {
      case "words":
        aggOf(userId!).wordsSaved = num(f.n1);
        break;
      case "reviews":
        aggOf(userId!).reviews = num(f.n1);
        aggOf(userId!).reviewsVerified = num(f.n2);
        aggOf(userId!).reviewsHits = num(f.n3);
        break;
      case "annotations":
        aggOf(userId!).annotations = num(f.n1);
        aggOf(userId!).annotationsPrev = num(f.n3);
        annotationsPeriod += num(f.n2);
        annotationsPrev += num(f.n3);
        break;
      case "stage": {
        const stage = (f.k1 ?? "new") as FsrsStage;
        if (stage in stages) stages[stage] += num(f.n1);
        break;
      }
      case "knowledge": {
        const lang = f.k1 ?? "?";
        const source = f.k2 ?? "?";
        let row = knowledgeByLang.get(lang);
        if (!row) {
          row = { language: lang, known: 0, sources: {} };
          knowledgeByLang.set(lang, row);
        }
        const n = num(f.n1);
        row.known += n;
        row.sources[source] = (row.sources[source] ?? 0) + n;
        break;
      }
      case "position": {
        if (!f.k1) break;
        const a = aggOf(userId!);
        const progress = num(f.n1);
        const updatedAt = num(f.n2);
        a.positions.set(f.k1, { progress, updatedAt });
        if (progress >= 0.99) {
          a.finishedBooks.add(f.k1);
          if (updatedAt >= sinceMs) {
            finishedInPeriod.add(`${userId}:${f.k1}`);
          } else if (updatedAt >= prevSinceMs) {
            finishedPrev.add(`${userId}:${f.k1}`);
          }
        }
        break;
      }
      case "book_minutes": {
        if (!f.k1) break;
        const a = aggOf(userId!);
        a.bookMinutesMs.set(f.k1, num(f.n1));
        break;
      }
      case "last_active": {
        const at = num(f.n1);
        const a = aggOf(userId!);
        a.lastActiveAt = Math.max(a.lastActiveAt ?? 0, at) || null;
        break;
      }
      case "kindle_user":
        aggOf(userId!).usesKindle = true;
        kindleUsers.add(userId!);
        break;
      case "returned":
        aggOf(userId!).returned = true;
        returnedUsers.add(userId!);
        break;
      case "companion_finished":
        if (f.k1) {
          aggOf(userId!).finishedBooks.add(f.k1);
          // k2 lleva el día del evento: fecha el término aunque la
          // posición se haya quedado atrás (el progreso ≥0.99 no
          // siempre se sincroniza).
          if (inPeriod(f.k2)) {
            finishedInPeriod.add(`${userId}:${f.k1}`);
          } else if (inPrev(f.k2)) {
            finishedPrev.add(`${userId}:${f.k1}`);
          }
        }
        break;
      case "rating":
        ratings[f.k1 ?? "?"] = num(f.n1);
        break;
      case "kind":
        reviewKinds[f.k1 ?? "?"] = num(f.n1);
        break;
    }
  }

  // ---- Cohortes por semana de alta ----
  const currentWeek = mondayOf(today);
  const firstCohortWeek = addDays(currentWeek, -(COHORT_WEEKS - 1) * 7);
  const usersByCohort = new Map<string, AccountRow[]>();
  for (const u of keptUsers) {
    const week = mondayOf(dayKeyInTz(num(u.created_at), timeZone));
    if (week < firstCohortWeek) continue;
    let list = usersByCohort.get(week);
    if (!list) {
      list = [];
      usersByCohort.set(week, list);
    }
    list.push(u);
  }
  const activeWeeksByUser = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.metric !== "active_day" || !f.day || !kept(f.user_id)) continue;
    let weeks = activeWeeksByUser.get(f.user_id!);
    if (!weeks) {
      weeks = new Set();
      activeWeeksByUser.set(f.user_id!, weeks);
    }
    weeks.add(mondayOf(f.day));
  }
  const cohorts: AdminCohortRow[] = [...usersByCohort.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, COHORT_WEEKS)
    .map(([week, members]) => {
      const retainedPct: (number | null)[] = [];
      const retainedUsers: number[] = [];
      for (let w = 0; w < COHORT_WEEKS; w++) {
        const weekKey = addDays(week, w * 7);
        if (weekKey > currentWeek) {
          retainedPct.push(null);
          retainedUsers.push(0);
          continue;
        }
        const active = members.filter((u) =>
          activeWeeksByUser.get(u.id)?.has(weekKey),
        ).length;
        retainedUsers.push(active);
        retainedPct.push(Math.round((active / members.length) * 100));
      }
      return { week, size: members.length, retainedPct, retainedUsers };
    });

  // ---- Libros ----
  const titles = new Map<string, Map<string, number>>();
  const authors = new Map<string, string>();
  const langs = new Map<string, Map<string, number>>();
  for (const ub of userBooks) {
    if (!kept(ub.user_id)) continue;
    if (ub.title) {
      let counts = titles.get(ub.book_id);
      if (!counts) {
        counts = new Map();
        titles.set(ub.book_id, counts);
      }
      counts.set(ub.title, (counts.get(ub.title) ?? 0) + 1);
    }
    if (ub.author && !authors.has(ub.book_id)) authors.set(ub.book_id, ub.author);
    if (ub.language) {
      let counts = langs.get(ub.book_id);
      if (!counts) {
        counts = new Map();
        langs.set(ub.book_id, counts);
      }
      counts.set(ub.language, (counts.get(ub.language) ?? 0) + 1);
    }
  }
  const mostOf = (counts: Map<string, number> | undefined): string | null =>
    counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
  const bestTitle = (book: string): string | null => mostOf(titles.get(book));
  const bestLang = (book: string): string | null => mostOf(langs.get(book));

  const bookStats = new Map<
    string,
    AdminBookStat & {
      readersSet: Set<string>;
      pausedReaders: number;
      progressHolders: number;
    }
  >();
  const bookOf = (hash: string) => {
    let b = bookStats.get(hash);
    if (!b) {
      b = {
        bookHash: hash,
        title: bestTitle(hash),
        author: authors.get(hash) ?? null,
        language: bestLang(hash),
        readers: 0,
        minutes: 0,
        avgProgress: 0,
        finished: 0,
        lastOpenAt: 0,
        readersSet: new Set(),
        pausedReaders: 0,
        progressHolders: 0,
      };
      bookStats.set(hash, b);
    }
    return b;
  };
  const progressSum = new Map<string, number>();
  for (const [userId, a] of agg) {
    for (const [book, pos] of a.positions) {
      const b = bookOf(book);
      b.readersSet.add(userId);
      b.progressHolders += 1;
      progressSum.set(book, (progressSum.get(book) ?? 0) + pos.progress);
      b.lastOpenAt = Math.max(b.lastOpenAt, pos.updatedAt);
      if (pos.progress >= 0.99) b.finished += 1;
      if (
        pos.progress >= 0.05 &&
        pos.progress < 0.99 &&
        pos.updatedAt < now - PAUSED_AFTER_MS
      ) {
        b.pausedReaders += 1;
      }
    }
    for (const book of a.finishedBooks) {
      const b = bookOf(book);
      b.readersSet.add(userId);
    }
    for (const [book, ms] of a.bookMinutesMs) {
      bookOf(book).minutes += ms / MIN_MS;
    }
  }
  for (const b of bookStats.values()) {
    b.readers = b.readersSet.size;
    const holders = Math.max(1, b.progressHolders);
    b.avgProgress = (progressSum.get(b.bookHash) ?? 0) / holders;
  }

  const topBooks = [...bookStats.values()]
    .filter((b) => b.readers > 0)
    .sort((a, b) => b.minutes - a.minutes || b.readers - a.readers)
    .slice(0, 10)
    .map(stripBookInternals);
  const pausedBooks = [...bookStats.values()]
    .filter((b) => b.pausedReaders > 0)
    .sort(
      (a, b) => b.pausedReaders - a.pausedReaders || b.minutes - a.minutes,
    )
    .slice(0, 10)
    .map(stripBookInternals);

  // ---- Embudo (vida completa) ----
  const usersWithWords = new Set<string>();
  const usersWithReviews = new Set<string>();
  const usersFinished = new Set<string>();
  const usersRead = new Set<string>();
  for (const [userId, a] of agg) {
    if (a.wordsSaved > 0) usersWithWords.add(userId);
    if (a.reviews > 0) usersWithReviews.add(userId);
    if (a.finishedBooks.size > 0) usersFinished.add(userId);
    if (a.minutesTotalMs > 0 || a.usesKindle) usersRead.add(userId);
  }
  const funnel: AdminFunnelStep[] = [
    { id: "signup", users: keptUsers.length },
    { id: "read", users: usersRead.size },
    { id: "saved", users: usersWithWords.size },
    { id: "reviewed", users: usersWithReviews.size },
    { id: "returned", users: returnedUsers.size },
    { id: "finished", users: usersFinished.size },
  ];

  // ---- Dispositivos ----
  const deviceSessions = new Map<AdminDeviceClass, number>();
  const deviceUsers = new Map<AdminDeviceClass, Set<string>>();
  for (const s of sessions) {
    if (!kept(s.user_id)) continue;
    const device = classifyDevice(s.ua);
    deviceSessions.set(device, (deviceSessions.get(device) ?? 0) + 1);
    let set = deviceUsers.get(device);
    if (!set) {
      set = new Set();
      deviceUsers.set(device, set);
    }
    set.add(s.user_id);
  }
  const devices: AdminDeviceMix[] = [...deviceSessions.entries()]
    .map(([device, sessions]) => ({
      device,
      sessions,
      users: deviceUsers.get(device)?.size ?? 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const aiByScope: AdminAiUsage[] = aiUsage.map((r) => ({
    scope: r.scope,
    units: num(r.units),
    users: num(r.users),
  }));

  // ---- Tabla de cuentas ----
  const userRows: AdminUserRow[] = keptUsers
    .map((u) => {
      const a = agg.get(u.id) ?? emptyAgg();
      const booksStarted = a.positions.size;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: num(u.created_at),
        lastActiveAt: a.lastActiveAt,
        minutesPeriod: a.minutesPeriodMs / MIN_MS,
        minutesTotal: a.minutesTotalMs / MIN_MS,
        booksStarted,
        booksFinished: a.finishedBooks.size,
        wordsSaved: a.wordsSaved,
        reviews: a.reviews,
        recallPct: recallPct(a.reviewsVerified, a.reviewsHits),
        usesKindle: a.usesKindle,
        annotations: a.annotations,
      };
    })
    .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  const truncatedUsers = userRows.length > USERS_TABLE_LIMIT;
  const usersTable = userRows.slice(0, USERS_TABLE_LIMIT);

  // ---- KPIs ----
  // activeUsersByDay tiene un set por día; para contar usuarios únicos
  // en una ventana hay que unir los sets, no sumarlos.
  const activeInWindow = (fromDay: string, untilDay?: string): number => {
    const union = new Set<string>();
    for (const [day, set] of activeUsersByDay) {
      if (day >= fromDay && (untilDay === undefined || day <= untilDay)) {
        for (const u of set) union.add(u);
      }
    }
    return union.size;
  };
  const activeToday = activeUsersByDay.get(today)?.size ?? 0;
  const active7d = activeInWindow(addDays(today, -6));
  const active30d = activeInWindow(addDays(today, -29));
  const prevUntil = addDays(sinceDay, -1);
  const prevFrom = dayKeyInTz(prevSinceMs, timeZone);
  const active30dPrev = activeInWindow(prevFrom, prevUntil);
  const active7dPrev = activeInWindow(addDays(prevUntil, -6), prevUntil);

  const kpis: AdminKpis = {
    totalAccounts: keptUsers.length,
    newAccounts: signupsPeriod,
    activeToday,
    active7d,
    active30d,
    stickiness: active30d > 0 ? activeToday / active30d : null,
    readingMinutes: minutesPeriod / MIN_MS,
    kindleMinutesEst: kindleEstPeriod / MIN_MS,
    readingMinutesPerActive:
      activeInPeriod.size > 0
        ? minutesPeriod / MIN_MS / activeInPeriod.size
        : null,
    booksFinished: finishedInPeriod.size,
    wordsSaved: wordsPeriod,
    reviews: reviewsPeriod,
    recallPct: recallPct(verifiedPeriod, hitsPeriod),
    annotations: annotationsPeriod,
  };
  const kpisPrev: AdminKpis = {
    totalAccounts: keptUsers.length,
    newAccounts: signupsPrev,
    activeToday: activeToday,
    active7d: active7dPrev,
    active30d: active30dPrev,
    stickiness: null,
    readingMinutes: minutesPrev / MIN_MS,
    kindleMinutesEst: kindleEstPrev / MIN_MS,
    readingMinutesPerActive: null,
    booksFinished: finishedPrev.size,
    wordsSaved: wordsPrev,
    reviews: reviewsPrev,
    recallPct: recallPct(verifiedPrev, hitsPrev),
    annotations: annotationsPrev,
  };

  const series = fillDaySeries(
    [...seriesMap.values()].filter((r) => inPeriod(r.day)),
    today,
    days,
    (day) => ({
      day,
      activeUsers: 0,
      readingMinutes: 0,
      kindlePages: 0,
      kindleMinutesEst: 0,
      reviews: 0,
      wordsSaved: 0,
      consults: 0,
      signups: 0,
    }),
  );

  const hourHeatmap: AdminHeatCell[] = hourCells.map((c) => ({
    dow: ((num(c.dow) + 6) % 7) + 1, // dow postgres (0=dom) → ISO 1–7
    hour: num(c.hr),
    minutes: num(c.ms) / MIN_MS,
  }));

  return {
    generatedAt: now,
    days: normalizeAdminDays(days),
    timeZone,
    kpis,
    kpisPrev,
    series,
    funnel,
    cohorts,
    hourHeatmap,
    topBooks,
    pausedBooks,
    learning: {
      stages,
      ratings,
      reviewKinds,
      knowledgeByLang: [...knowledgeByLang.values()].sort(
        (a, b) => b.known - a.known,
      ),
    },
    devices,
    aiByScope,
    users: usersTable,
    truncatedUsers,
    testAccountsExcluded: !includeTest,
  };
}

function stripBookInternals(
  b: AdminBookStat & {
    readersSet: Set<string>;
    pausedReaders: number;
    progressHolders: number;
  },
): AdminBookStat {
  return {
    bookHash: b.bookHash,
    title: b.title,
    author: b.author,
    language: b.language,
    readers: b.readers,
    minutes: Math.round(b.minutes * 10) / 10,
    avgProgress: Math.round(b.avgProgress * 1000) / 1000,
    finished: b.finished,
    lastOpenAt: b.lastOpenAt,
  };
}

// ---------- Ensamblado de la ficha por persona ----------

export interface UserDetailInput {
  account: AccountRow | null;
  facts: FactRow[];
  userFacts: FactRow[];
  sessions: SessionRow[];
  aiUsage: AiRow[];
  userBooks: UserBookRow[];
  days: number;
  timeZone: string;
  now: number;
}

export function assembleUserDetail(
  input: UserDetailInput,
): AdminUserDetail | null {
  const { account, facts, userFacts, sessions, aiUsage, userBooks, days, timeZone, now } =
    input;
  if (!account) return null;

  const userId = account.id;
  const today = todayKeyInTz(timeZone, now);

  type DayRow = AdminUserDetail["series"][number];
  const seriesMap = new Map<string, DayRow>();
  const dayRow = (day: string): DayRow => {
    let r = seriesMap.get(day);
    if (!r) {
      r = {
        day,
        minutes: 0,
        kindlePages: 0,
        reviews: 0,
        wordsSaved: 0,
        consults: 0,
      };
      seriesMap.set(day, r);
    }
    return r;
  };

  const stages: Record<FsrsStage, number> = {
    new: 0,
    learning: 0,
    settled: 0,
    mastered: 0,
  };
  let consultsTotal = 0;
  let lastActiveAt: number | null = null;
  const positions = new Map<string, { progress: number; updatedAt: number }>();
  const finishedViaEvent = new Set<string>();
  const bookMinutesMs = new Map<string, number>();
  const knownByLang = new Map<string, number>();
  const wordsByLang = new Map<string, number>();
  const reviewWeeks = new Map<string, { reviews: number; verified: number; hits: number }>();

  for (const f of facts) {
    if (f.user_id !== userId) continue;
    switch (f.metric) {
      case "minutes":
        if (f.day) dayRow(f.day).minutes += num(f.n1) / MIN_MS;
        break;
      case "kindle":
        if (f.day) dayRow(f.day).kindlePages += num(f.n1);
        break;
      case "review": {
        if (!f.day) break;
        dayRow(f.day).reviews += num(f.n1);
        const week = mondayOf(f.day);
        const w = reviewWeeks.get(week) ?? { reviews: 0, verified: 0, hits: 0 };
        w.reviews += num(f.n1);
        w.verified += num(f.n2);
        w.hits += num(f.n3);
        reviewWeeks.set(week, w);
        break;
      }
      case "word_saved":
        if (f.day) dayRow(f.day).wordsSaved += num(f.n1);
        break;
      case "companion":
        if (f.k1 === "consulted") {
          consultsTotal += num(f.n1);
          if (f.day) dayRow(f.day).consults += num(f.n1);
        }
        break;
    }
  }

  for (const f of userFacts) {
    if (f.user_id !== userId) continue;
    switch (f.metric) {
      case "stage": {
        const stage = (f.k1 ?? "new") as FsrsStage;
        if (stage in stages) stages[stage] += num(f.n1);
        break;
      }
      case "knowledge": {
        const lang = f.k1 ?? "?";
        knownByLang.set(lang, (knownByLang.get(lang) ?? 0) + num(f.n1));
        break;
      }
      case "position":
        if (f.k1) {
          positions.set(f.k1, { progress: num(f.n1), updatedAt: num(f.n2) });
        }
        break;
      case "book_minutes":
        if (f.k1) bookMinutesMs.set(f.k1, num(f.n1));
        break;
      case "last_active":
        lastActiveAt = Math.max(lastActiveAt ?? 0, num(f.n1)) || null;
        break;
      case "companion_finished":
        if (f.k1) finishedViaEvent.add(f.k1);
        break;
      case "word_lang":
        if (f.k1) wordsByLang.set(f.k1, num(f.n1));
        break;
    }
  }

  const titleOf = new Map<
    string,
    { title: string | null; author: string | null; language: string | null }
  >();
  for (const ub of userBooks) {
    if (ub.user_id === userId) {
      titleOf.set(ub.book_id, {
        title: ub.title,
        author: ub.author,
        language: ub.language || null,
      });
    }
  }

  const bookHashes = new Set([...positions.keys(), ...bookMinutesMs.keys()]);
  const books = [...bookHashes]
    .map((bookHash) => {
      const pos = positions.get(bookHash);
      const meta = titleOf.get(bookHash);
      return {
        bookHash,
        title: meta?.title ?? null,
        author: meta?.author ?? null,
        language: meta?.language ?? null,
        progress: pos?.progress ?? 0,
        minutes: Math.round(((bookMinutesMs.get(bookHash) ?? 0) / MIN_MS) * 10) / 10,
        lastOpenAt: pos?.updatedAt ?? 0,
        finished:
          (pos?.progress ?? 0) >= 0.99 || finishedViaEvent.has(bookHash),
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const languages = new Map<string, { language: string; lemmasKnown: number; wordsSaved: number }>();
  for (const [lang, n] of knownByLang) {
    languages.set(lang, { language: lang, lemmasKnown: n, wordsSaved: 0 });
  }
  for (const [lang, n] of wordsByLang) {
    const row = languages.get(lang) ?? { language: lang, lemmasKnown: 0, wordsSaved: 0 };
    row.wordsSaved += n;
    languages.set(lang, row);
  }

  const deviceSessions = new Map<AdminDeviceClass, number>();
  for (const s of sessions) {
    if (s.user_id !== userId) continue;
    const d = classifyDevice(s.ua);
    deviceSessions.set(d, (deviceSessions.get(d) ?? 0) + 1);
  }
  const devices: AdminDeviceMix[] = [...deviceSessions.entries()]
    .map(([device, count]) => ({ device, sessions: count, users: 1 }))
    .sort((a, b) => b.sessions - a.sessions);

  const recallByWeek = [...reviewWeeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, w]) => ({
      week,
      reviews: w.reviews,
      recallPct: recallPct(w.verified, w.hits),
    }));

  const series = fillDaySeries(
    [...seriesMap.values()],
    today,
    days,
    (day) => ({
      day,
      minutes: 0,
      kindlePages: 0,
      reviews: 0,
      wordsSaved: 0,
      consults: 0,
    }),
  );

  return {
    user: {
      id: userId,
      email: account.email,
      name: account.name,
      createdAt: num(account.created_at),
    },
    lastActiveAt,
    days: normalizeAdminDays(days),
    series,
    books,
    stages,
    recallByWeek,
    languages: [...languages.values()].sort((a, b) => b.lemmasKnown - a.lemmasKnown),
    devices,
    consultsTotal,
    aiByScope: aiUsage
      .filter((r) => r.scope != null)
      .map((r) => ({ scope: r.scope, units: num(r.units), users: num(r.users) })),
  };
}

// ---------- Consultas al servidor remoto ----------

async function queryFacts(
  client: pg.Client,
  params: {
    since: number;
    prevSince: number;
    now: number;
    tz: string;
    activeSince: number;
  },
): Promise<{ daily: FactRow[]; perUser: FactRow[] }> {
  const [daily, perUser] = await Promise.all([
    client.query(DAILY_FACTS_SQL, [
      params.prevSince,
      params.now,
      params.tz,
      KINDLE_GAP_MS,
      params.activeSince,
    ]),
    client.query(USER_FACTS_SQL, [params.since, params.prevSince, params.tz]),
  ]);
  return {
    daily: (daily.rows ?? []) as FactRow[],
    perUser: (perUser.rows ?? []) as FactRow[],
  };
}

// Los dos bloques de hechos viven en UNA consulta cada uno para no
// pagar un round-trip (~100 ms) por métrica. En paralelo salen los
// datos de cuentas, sesiones, IA y libros, que son consultas sueltas.
async function loadOverviewData(
  env: WorkerEnv,
  opts: { days: number; tz: string; now: number },
): Promise<OverviewInput | undefined> {
  const prevSince = opts.now - 2 * opts.days * DAY_MS;
  const since = opts.now - opts.days * DAY_MS;
  const activeSince = opts.now - COHORT_WINDOW_MS;

  const [blockA, blockB] = await Promise.all([
    withClient(env, async (client) => {
      const [facts, heat] = await Promise.all([
        queryFacts(client, {
          since,
          prevSince,
          now: opts.now,
          tz: opts.tz,
          activeSince,
        }),
        client
          .query(HOUR_HEATMAP_SQL, [since, opts.now, opts.tz])
          .then(
            (r) =>
              (r.rows ?? []) as {
                dow: number;
                hr: number;
                ms: string | number;
              }[],
          )
          .catch(() => []),
      ]);
      return { ...facts, heat };
    }),
    withClient(env, async (client) => {
      const [users, sessions, ai, userBooks] = await Promise.all([
        client.query(USERS_SQL).then((r) => (r.rows ?? []) as AccountRow[]),
        client
          .query(SESSIONS_SQL)
          .then((r) => (r.rows ?? []) as SessionRow[])
          .catch(() => []),
        client
          .query(AI_SQL, [Math.floor((opts.now - opts.days * DAY_MS) / 3_600_000)])
          .then((r) => (r.rows ?? []) as AiRow[])
          .catch(() => []),
        client
          .query(USER_BOOKS_SQL)
          .catch(() => client.query(USER_BOOKS_NO_LANG_SQL))
          .then((r) => (r.rows ?? []) as UserBookRow[])
          .catch(() => []),
      ]);
      return { users, sessions, ai, userBooks };
    }),
  ]);

  if (!blockA || !blockB) return undefined;

  return {
    users: blockB.users,
    facts: [...blockA.daily, ...blockA.perUser],
    hourCells: blockA.heat,
    sessions: blockB.sessions,
    aiUsage: blockB.ai,
    userBooks: blockB.userBooks,
    days: opts.days,
    timeZone: opts.tz,
    now: opts.now,
    includeTest: false,
  };
}

// ---------- Rutas ----------

admin.get("/api/admin/access", async (c) => {
  const owner = await ownerUser(c);
  return owner ? c.body(null, 204) : notFound(c);
});

admin.get("/api/admin/insights", async (c) => {
  const owner = await ownerUser(c);
  if (!owner) return notFound(c);
  const timer = createTimer();

  const days = normalizeAdminDays(c.req.query("days"));
  const tz = normalizeTimeZone(c.req.query("tz"));
  const includeTest = c.req.query("includeTest") === "1";

  const data = await loadOverviewData(c.env, { days, tz, now: Date.now() });
  timer.mark("db");
  if (!data) {
    return c.json({ error: "El almacenamiento no está configurado." }, 503);
  }

  const overview = assembleOverview({ ...data, includeTest });
  timer.mark("assemble");

  return c.json(overview, 200, {
    "cache-control": "no-store",
    "server-timing": timer.header(),
  });
});

admin.get("/api/admin/users/:id", async (c) => {
  const owner = await ownerUser(c);
  if (!owner) return notFound(c);
  const timer = createTimer();

  const userId = c.req.param("id");
  const days = normalizeAdminDays(c.req.query("days"));
  const tz = normalizeTimeZone(c.req.query("tz"));
  const now = Date.now();
  const prevSince = now - 2 * days * DAY_MS;
  const since = now - days * DAY_MS;
  const activeSince = now - COHORT_WINDOW_MS;

  const data = await withClient(c.env, async (client) => {
    const [daily, perUser, account, sessions, ai, userBooks] =
      await Promise.all([
        client.query(DAILY_FACTS_SQL, [
          prevSince,
          now,
          tz,
          KINDLE_GAP_MS,
          activeSince,
        ]),
        client.query(USER_FACTS_SQL, [since, prevSince, tz]),
        client.query(
          `SELECT id, email, COALESCE(name, '') AS name,
                  (extract(epoch from "createdAt") * 1000)::bigint AS created_at
             FROM "user" WHERE id = $1`,
          [userId],
        ),
        client
          .query(
            `SELECT "userId" AS user_id, "userAgent" AS ua
               FROM "session" WHERE "expiresAt" > now() AND "userId" = $1`,
            [userId],
          )
          .catch(() => ({ rows: [] as SessionRow[] })),
        client
          .query(
            `SELECT scope, SUM(units_used)::bigint AS units,
                    count(DISTINCT user_id)::bigint AS users
               FROM lecta_ai_quota
              WHERE user_id = $1 AND bucket_hour >= $2 GROUP BY scope`,
            [userId, Math.floor((now - days * DAY_MS) / 3_600_000)],
          )
          .catch(() => ({ rows: [] as AiRow[] })),
        client
          .query(
            `SELECT user_id, book_id, title, author, language
               FROM user_books WHERE user_id = $1`,
            [userId],
          )
          .catch(() =>
            client.query(
              `SELECT user_id, book_id, title, author, NULL AS language
                 FROM user_books WHERE user_id = $1`,
              [userId],
            ),
          )
          .catch(() => ({ rows: [] as UserBookRow[] })),
      ]);
    return {
      daily: (daily.rows ?? []) as FactRow[],
      perUser: (perUser.rows ?? []) as FactRow[],
      account: ((account.rows ?? []) as AccountRow[])[0] ?? null,
      sessions: (sessions.rows ?? []) as SessionRow[],
      ai: (ai.rows ?? []) as AiRow[],
      userBooks: (userBooks.rows ?? []) as UserBookRow[],
    };
  });
  timer.mark("db");

  if (!data) {
    return c.json({ error: "El almacenamiento no está configurado." }, 503);
  }

  const detail = assembleUserDetail({
    account: data.account,
    facts: data.daily,
    userFacts: data.perUser,
    sessions: data.sessions,
    aiUsage: data.ai,
    userBooks: data.userBooks,
    days,
    timeZone: tz,
    now,
  });
  timer.mark("assemble");

  if (!detail) return notFound(c);
  return c.json(detail, 200, {
    "cache-control": "no-store",
    "server-timing": timer.header(),
  });
});
