// Plan de estudio adaptativo (Lecta+, F16): GET /api/study-plan. Solo lee
// metadatos del usuario (vencimientos, intervalos, última posición); nunca
// texto de libros ni IA. Cálculo puro en src/shared/study-plan.ts.
import { Hono } from "hono";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";
import { requireLectaPlus, type PlanVariables } from "./plan-middleware";
import { buildStudyPlan, STUDY_PLAN_DAYS } from "../shared/study-plan";

export const studyPlan = new Hono<{ Bindings: WorkerEnv; Variables: PlanVariables }>();

const DAY_MS = 24 * 60 * 60 * 1000;

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Tabla ausente (despliegue antes de migrar) = sin datos, no error. */
async function tolerant(run: () => Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> {
  try {
    return await run();
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

studyPlan.get("/api/study-plan", requireLectaPlus, async (c) => {
  const userId = c.get("session").user.id;
  const now = Date.now();
  try {
    const result = await withClient(c.env, async (raw) => {
      const client = raw as unknown as Queryable;
      const words = await tolerant(
        async () =>
          (
            await client.query(
              `SELECT (extract(epoch FROM (CASE WHEN card->>'due' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (card->>'due')::timestamptz END)) * 1000)::INT8 AS due
                 FROM lecta_user_words
                WHERE user_id = $1 AND deleted = false AND card ? 'due'
                  AND (presented_at IS NOT NULL OR COALESCE((card->>'reps')::INT8, 0) > 0)
                  AND (CASE WHEN card->>'due' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (card->>'due')::timestamptz END) < now() + ($2 || ' days')::INTERVAL
                ORDER BY due ASC
                LIMIT 5000`,
              [userId, String(STUDY_PLAN_DAYS)],
            )
          ).rows,
      );
      const activity = await tolerant(
        async () =>
          (
            await client.query(
              `SELECT started_at, ended_at FROM lecta_user_activity
                WHERE user_id = $1 AND started_at >= $2
                ORDER BY started_at DESC, ended_at DESC LIMIT 500`,
              [userId, now - 14 * DAY_MS],
            )
          ).rows,
      );
      const positions = await tolerant(
        async () =>
          (
            await client.query(
              `SELECT book_hash, section_index, progress FROM lecta_user_positions
                WHERE user_id = $1 ORDER BY updated_at DESC, book_hash ASC LIMIT 1`,
              [userId],
            )
          ).rows,
      );
      const pos = positions[0];
      return buildStudyPlan({
        now,
        dueAt: words.map((r) => Number(r.due)).filter((n) => Number.isFinite(n)),
        intervals: activity.map((r) => ({ startedAt: Number(r.started_at), endedAt: Number(r.ended_at) })),
        lastPosition: pos
          ? {
              bookHash: String(pos.book_hash),
              sectionIndex: Number(pos.section_index) || 0,
              progress: pos.progress === null || pos.progress === undefined ? null : Number(pos.progress),
            }
          : null,
      });
    });
    if (!result) return c.json({ error: "El almacenamiento no está configurado." }, 503);
    c.header("Cache-Control", "no-store");
    return c.json(result);
  } catch {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
});
