// Predicción de fluidez (Lecta+, F17): GET /api/fluency-forecast?lang=es|en.
// Lee solo fechas de palabras consolidadas (`lecta_user_words`); sin IA ni
// texto de libros. Cálculo puro en src/shared/fluency-forecast.ts.
import { Hono } from "hono";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";
import { requireLectaPlus, type PlanVariables } from "./plan-middleware";
import { buildFluencyForecast } from "../shared/fluency-forecast";

export const fluencyForecast = new Hono<{ Bindings: WorkerEnv; Variables: PlanVariables }>();

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

fluencyForecast.get("/api/fluency-forecast", requireLectaPlus, async (c) => {
  const userId = c.get("session").user.id;
  const requested = (c.req.query("lang") ?? "").trim().slice(0, 2).toLowerCase();
  const now = Date.now();
  try {
    const result = await withClient(c.env, async (raw) => {
      const client = raw as unknown as Queryable;
      let rows: Record<string, unknown>[] = [];
      try {
        // Consolidada = ya repasada al menos una vez; su fecha es la del guardado.
        rows = (
          await client.query(
            `SELECT language, saved_at FROM lecta_user_words
              WHERE user_id = $1 AND deleted = false
                AND COALESCE((card->>'reps')::INT8, 0) > 0
              LIMIT 20000`,
            [userId],
          )
        ).rows;
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
      }
      const byLang = new Map<string, number[]>();
      for (const r of rows) {
        const lang = String(r.language ?? "").slice(0, 2).toLowerCase();
        const at = Number(r.saved_at);
        if (!lang || !Number.isFinite(at)) continue;
        const list = byLang.get(lang) ?? [];
        list.push(at);
        byLang.set(lang, list);
      }
      // Sin `lang` válido: el idioma con más palabras consolidadas.
      const lang =
        requested && /^[a-z]{2}$/.test(requested)
          ? requested
          : ([...byLang.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "es");
      return { lang, forecast: buildFluencyForecast({ now, consolidatedAt: byLang.get(lang) ?? [] }) };
    });
    if (!result) return c.json({ error: "El almacenamiento no está configurado." }, 503);
    c.header("Cache-Control", "no-store");
    return c.json(result);
  } catch {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
});
