// Coach semanal (Lecta+, F15): GET /api/coach/weekly. Párrafo de IA a partir
// SOLO de cifras agregadas (nunca texto de libros). Caché en R2
// `coach/v1/<userId>/<semana ISO>.json`; 1 generación por usuario y semana
// contada en `lecta_ai_quota` scope `coach`. Si la IA falla: texto
// determinista y se devuelve la cuota. Sin migración.
import { Hono } from "hono";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";
import { requireLectaPlus, type PlanVariables } from "./plan-middleware";
import { guardDailyAi } from "./ai-daily";
import { consumeRateUnits, refundRateUnits } from "./rate-limit";
import {
  COACH_CALL_OPTIONS,
  COACH_SYSTEM_PROMPT,
  buildCoachPrompt,
  callDeepSeek,
  deterministicCoachFallback,
  logAiCall,
  parseCoach,
  type CoachInput,
} from "./ai";

export const coach = new Hono<{ Bindings: WorkerEnv; Variables: PlanVariables }>();

const DAY_MS = 24 * 60 * 60 * 1000;
export const COACH_SCOPE = "coach";

export type CoachResult = { text: string; source: "ai" | "fallback"; week: string };

/** Semana ISO 8601 (`2026-W48`) en UTC. */
export function isoWeekKey(now: number): string {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Cubeta de cuota de la semana: hora epoch del lunes 00:00 UTC. Es una hora
 * real reciente, así que la limpieza diaria de `lecta_ai_quota`
 * (`bucket_hour < now-30d`) no la borra mientras la semana está en curso.
 */
export function weekBucket(now: number): number {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)) / 3_600_000);
}

/** Un respaldo guardado tras una respuesta de IA inválida caduca pronto. */
export const COACH_FALLBACK_TTL_MS = 60 * 60 * 1000;

export const coachCacheKey = (userId: string, week: string) => `coach/v1/${userId}/${week}.json`;

export async function readCachedCoach(
  env: WorkerEnv,
  userId: string,
  now = Date.now(),
): Promise<CoachResult | null> {
  if (!env.BOOKS) return null;
  const week = isoWeekKey(now);
  try {
    const obj = await env.BOOKS.get(coachCacheKey(userId, week));
    if (!obj) return null;
    const data = (await obj.json()) as { text?: unknown; source?: unknown; createdAt?: unknown };
    if (typeof data.text !== "string" || !data.text) return null;
    if (data.source !== "ai" && now - (Number(data.createdAt) || 0) > COACH_FALLBACK_TTL_MS) return null;
    return { text: data.text, source: data.source === "ai" ? "ai" : "fallback", week };
  } catch {
    return null;
  }
}

async function writeCachedCoach(env: WorkerEnv, userId: string, result: CoachResult, now = Date.now()): Promise<void> {
  if (!env.BOOKS) return;
  try {
    await env.BOOKS.put(
      coachCacheKey(userId, result.week),
      JSON.stringify({ text: result.text, source: result.source, createdAt: now }),
      { httpMetadata: { contentType: "application/json" } },
    );
  } catch {
    // Sin caché solo se pierde el ahorro; la cuota semanal sigue limitando.
  }
}

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

async function tolerant(run: () => Promise<Record<string, unknown>[]>) {
  try {
    return await run();
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Cifras agregadas de la semana: nunca contenido de libros. */
export async function collectCoachInput(env: WorkerEnv, userId: string, now: number): Promise<CoachInput> {
  const weekStart = now - 7 * DAY_MS;
  const out = await withClient(env, async (raw) => {
    const q = raw as unknown as Queryable;
    const act = await tolerant(
      async () =>
        (
          await q.query(
            `SELECT COUNT(DISTINCT (started_at / 86400000))::INT8 AS days,
                    COALESCE(SUM(ended_at - started_at), 0)::INT8 AS ms
               FROM lecta_user_activity WHERE user_id = $1 AND started_at >= $2`,
            [userId, weekStart],
          )
        ).rows,
    );
    const words = await tolerant(
      async () =>
        (
          await q.query(
            `SELECT COUNT(*)::INT8 AS n FROM lecta_user_words
              WHERE user_id = $1 AND saved_at >= $2 AND deleted = false`,
            [userId, weekStart],
          )
        ).rows,
    );
    const reviews = await tolerant(
      async () =>
        (
          await q.query(
            `SELECT COUNT(*)::INT8 AS n FROM lecta_user_reviews WHERE user_id = $1 AND created_at >= $2`,
            [userId, weekStart],
          )
        ).rows,
    );
    const due = await tolerant(
      async () =>
        (
          await q.query(
            `SELECT COUNT(*)::INT8 AS n FROM lecta_user_words
              WHERE user_id = $1 AND deleted = false AND card ? 'due'
                AND (presented_at IS NOT NULL OR COALESCE((card->>'reps')::INT8, 0) > 0)
                AND (CASE WHEN card->>'due' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (card->>'due')::timestamptz END) < now()`,
            [userId],
          )
        ).rows,
    );
    const book = await tolerant(
      async () =>
        (
          await q.query(
            `SELECT b.title FROM lecta_user_positions p
               JOIN user_books b ON b.user_id = p.user_id AND b.book_id = p.book_hash
              WHERE p.user_id = $1 ORDER BY p.updated_at DESC, p.book_hash ASC LIMIT 1`,
            [userId],
          )
        ).rows,
    );
    return { act: act[0], words: words[0], reviews: reviews[0], due: due[0], book: book[0] };
  });
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    daysRead: Math.min(7, n(out?.act?.days)),
    minutes: Math.round(n(out?.act?.ms) / 60000),
    newWords: n(out?.words?.n),
    reviews: n(out?.reviews?.n),
    overdue: n(out?.due?.n),
    currentBook: out?.book?.title ? String(out.book.title) : null,
  };
}

/**
 * Caché → (1 generación por semana) → IA → respaldo determinista.
 * `null` = la cuota semanal ya se gastó y no hay texto guardado.
 */
export async function getWeeklyCoach(
  env: WorkerEnv,
  userId: string,
  dailyLimit: number | null | undefined,
  now = Date.now(),
): Promise<CoachResult | null> {
  const cached = await readCachedCoach(env, userId, now);
  if (cached) return cached;

  const week = isoWeekKey(now);
  const bucket = weekBucket(now);
  let allowed = true;
  try {
    allowed = await consumeRateUnits(env, userId, 1, 1, COACH_SCOPE, bucket);
  } catch (err) {
    if (!isMissingTableError(err)) throw err; // tabla ausente: sin tope (caché R2 limita)
  }
  if (!allowed) return null;
  const refundWeek = () => refundRateUnits(env, userId, 1, COACH_SCOPE, bucket);

  const input = await collectCoachInput(env, userId, now);
  const fallback = (): CoachResult => ({ text: deterministicCoachFallback(input), source: "fallback", week });

  const daily = await guardDailyAi(env, userId, dailyLimit, COACH_SCOPE, { now });
  if (daily.deny) {
    await refundWeek();
    return fallback();
  }
  const ai = await callDeepSeek(
    env,
    { system: COACH_SYSTEM_PROMPT, user: buildCoachPrompt(input) },
    COACH_CALL_OPTIONS,
  );
  const parsed = ai.ok && ai.finishReason !== "length" ? parseCoach(ai.content) : null;
  logAiCall(
    COACH_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!parsed) {
    await refundWeek();
    if (!ai.ok) {
      // IA caída o error de red: no cobra nada y el siguiente intento puede usar IA.
      await daily.refund();
      return fallback();
    }
    // La IA respondió pero con JSON inválido o truncado: el consumo diario se
    // queda y el respaldo se guarda con TTL corto, así no hay llamadas sin tope.
    const result = fallback();
    await writeCachedCoach(env, userId, result, now);
    return result;
  }
  const result: CoachResult = { text: parsed, source: "ai", week };
  await writeCachedCoach(env, userId, result);
  return result;
}

coach.get("/api/coach/weekly", requireLectaPlus, async (c) => {
  const userId = c.get("session").user.id;
  try {
    const result = await getWeeklyCoach(c.env, userId, c.get("aiDailyLimit"));
    c.header("Cache-Control", "no-store");
    if (!result) return c.json({ error: "Tu coach de esta semana ya se generó." }, 429);
    return c.json(result);
  } catch {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
});
