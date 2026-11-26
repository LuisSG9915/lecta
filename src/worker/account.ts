// Estado y datos de la cuenta: sello de reinicio, plan, pelaje inicial y
// «borrar datos». Extraído de app.ts (R2 de la deuda de complejidad).
import { Hono } from "hono";
import { purgeR2Prefix } from "./auth";
import { getConnectionString, isMissingTableError, readAccountResetAt, resetAccountDataDb, withClient, type WorkerEnv } from "./db";
import { runInBackground } from "./background";
import { purgeKindleBookCache } from "./kindle/cache";
import { normalizeLandingSource, recordLandingEvent } from "./landing-events";
import { readFreeAiRemaining } from "./free-courtesy";
import { getUserPlan, setStarterCoat, type UserPlanSnapshot } from "./plan-store";
import { getSession } from "./session";
import { hasLectaPlus, isStarterCoat, REVERSE_TRIAL_MS } from "../shared/plan";
import { USER_AI_SCOPES } from "./ai-units";

export const account = new Hono<{ Bindings: WorkerEnv }>();

// Sello del último «borrar datos de la cuenta» (epoch ms; 0 si nunca).
// Los otros dispositivos lo consultan antes de sincronizar: si es más
// nuevo que la marca que recuerdan, su copia local quedó obsoleta y
// tienen que vaciarse antes de empujar nada — sin él, re-subirían lo
// que la persona acabó de borrar.
account.get("/api/account/state", async (context) => {
  const session = await getSession(context);
  if (!session?.user?.id) {
    return context.json({ error: "No autorizado" }, 401);
  }
  const userId = session.user.id;

  let resetAt = 0;
  // Plan de la cuenta (027). Ante un error que no sea 42P01 se omite y el
  // cliente conserva su caché; sin tabla, getUserPlan ya devuelve el
  // fail-open founder_lifetime.
  let plan: UserPlanSnapshot | null = null;
  let freeAiLeft: number | null = null;
  try {
    if (getConnectionString(context.env)) {
      resetAt =
        (await withClient(context.env, async (client) => {
          const stamp = await readAccountResetAt(client, userId);
          try {
            plan = await getUserPlan(client, userId);
            if (plan && !plan.degraded && !hasLectaPlus(plan.plan)) {
              freeAiLeft = await readFreeAiRemaining(client, userId).catch(() => 0);
            }
          } catch (error) {
            console.error("Error al leer el plan de la cuenta:", error);
          }
          return stamp;
        })) ?? 0;
    }
  } catch (error) {
    console.error("Error al leer el sello de reinicio de la cuenta:", error);
  }

  const snapshot = plan as UserPlanSnapshot | null;
  return context.json({
    ok: true,
    resetAt,
    ...(snapshot
      ? {
          plan: snapshot.plan,
          starterCoat: snapshot.starterCoat,
          planExpiresAt: snapshot.expiresAt,
          // Cortesía de IA de hoy (UTC); null = sin tope (Lecta+, prueba, fundador).
          freeAiRemaining: freeAiLeft,
          // Fin de la prueba inversa en curso; null si no está en prueba.
          trialEndsAt: snapshot.trialEndsAt,
          // Fin de una prueba ya vencida (plan free); null si no tuvo o sigue en curso.
          trialEndedAt: snapshot.trialEndedAt ?? null,
        }
      : {}),
  });
});

// Resumen de uso durante la prueba inversa (una consulta acotada a su
// ventana). Sin prueba (nunca la tuvo) responde 404.
account.get("/api/account/trial-summary", async (context) => {
  const session = await getSession(context);
  if (!session?.user?.id) {
    return context.json({ error: "No autorizado" }, 401);
  }
  const userId = session.user.id;
  if (!getConnectionString(context.env)) {
    return context.json({ error: "Servicio no disponible" }, 503);
  }
  try {
    const summary = await withClient(context.env, async (client) => {
      const plan = await getUserPlan(client, userId);
      const end = plan.trialEndsAt ?? plan.trialEndedAt ?? null;
      if (plan.degraded || end === null) return null;
      const start = end - REVERSE_TRIAL_MS;
      const res = (await client.query(
        `SELECT
           (SELECT COALESCE(SUM(units_used), 0) FROM lecta_ai_quota
             WHERE user_id = $1 AND scope = ANY($2::STRING[])
               AND bucket_hour >= $3 AND bucket_hour <= $4)::INT8 AS ai_uses,
           (SELECT count(*) FROM lecta_user_words
             WHERE user_id = $1 AND deleted = false
               AND saved_at >= $5 AND saved_at <= $6)::INT8 AS words_saved,
           (SELECT count(*) FROM user_books
             WHERE user_id = $1 AND paper_only = false)::INT8 AS cloud_books,
           EXISTS (SELECT 1 FROM kindle_link_codes
             WHERE user_id = $1 AND status = 'linked') AS kindle_linked`,
        [userId, [...USER_AI_SCOPES], Math.floor(start / 3_600_000), Math.floor(end / 3_600_000), start, end],
      )) as { rows?: Array<Record<string, unknown>> };
      const row = res.rows?.[0] ?? {};
      // El código de vinculación se borra al consumirse: lo que persiste es
      // la fila de preferencias del portal Kindle (tabla ausente = sin dato).
      let kindleLinked = row.kindle_linked === true;
      if (!kindleLinked) {
        try {
          const prefs = (await client.query(
            `SELECT 1 FROM lecta_kindle_prefs WHERE user_id = $1 LIMIT 1`,
            [userId],
          )) as { rows?: unknown[] };
          kindleLinked = (prefs.rows?.length ?? 0) > 0;
        } catch (err) {
          if (!isMissingTableError(err)) throw err;
        }
      }
      return {
        // `explain` también cuenta las cartas de personaje (character-recap).
        aiUses: Number(row.ai_uses) || 0,
        wordsSaved: Number(row.words_saved) || 0,
        cloudBooks: Number(row.cloud_books) || 0,
        kindleLinked,
        trialEndsAt: end,
      };
    });
    if (!summary) return context.json({ error: "Sin prueba" }, 404);
    return context.json(summary);
  } catch (error) {
    console.error("Error al leer el resumen de la prueba:", error);
    return context.json({ error: "No se pudo leer el resumen" }, 500);
  }
});

// Pelaje inicial elegido en el landing o en el onboarding. Se escribe una
// sola vez: si ya existe, responde el guardado sin pisarlo.
account.put("/api/account/starter-coat", async (context) => {
  const session = await getSession(context);
  if (!session?.user?.id) {
    return context.json({ error: "No autorizado" }, 401);
  }
  const userId = session.user.id;
  const body = (await context.req.json().catch(() => null)) as {
    coat?: unknown;
    src?: unknown;
  } | null;
  if (!isStarterCoat(body?.coat)) {
    return context.json({ error: "Pelaje no válido" }, 400);
  }
  const coat = body.coat;
  const result = await withClient(context.env, async (client) => {
    const outcome = await setStarterCoat(client, userId, coat);
    if (outcome !== "exists") return { outcome, starterCoat: coat };
    const current = await getUserPlan(client, userId);
    return { outcome, starterCoat: current.starterCoat ?? coat };
  });
  if (!result || result.outcome === "unavailable") {
    return context.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  // Conversión de la landing: primera vez que la cuenta reclama el gato y
  // el cliente trae la fuente (`src` solo existe si llegó desde /inicio/).
  if (result.outcome === "written" && body.src !== undefined) {
    runInBackground(
      context,
      recordLandingEvent(context.env, {
        event: "signup",
        source: normalizeLandingSource(body.src),
      }).catch(() => false),
    );
  }
  return context.json({ starterCoat: result.starterCoat });
});

account.post("/api/account/reset", async (context) => {
  const session = await getSession(context);
  if (!session?.user?.id) {
    return context.json({ error: "No autorizado" }, 401);
  }
  const userId = session.user.id;

  try {
    // 0. Recoger book_id del usuario antes del reset para purgar sus
    // artefactos Kindle (kcache/*) derivados del contenido
    let userBookIds: string[] = [];
    try {
      if (getConnectionString(context.env)) {
        const ids = await withClient(context.env, async (client) => {
          const res = await client.query<{ book_id: string }>(
            `SELECT book_id FROM user_books WHERE user_id = $1`,
            [userId],
          );
          return res.rows;
        });
        userBookIds = (ids ?? []).map((r) => r.book_id);
      }
    } catch {
      userBookIds = [];
    }

    // 1. Limpiar registros de historial, palabras guardadas y libros en la BD remota
    // manteniendo intacto el registro del usuario y la tabla ai_quota
    const resetAtMs = await resetAccountDataDb(context.env, userId);

    // 2. Reutilizar purgeR2Prefix para limpiar EPUBs y portadas del usuario en R2
    const booksBucket = context.env.BOOKS;
    if (booksBucket) {
      await Promise.all([
        purgeR2Prefix(booksBucket, `books/${userId}/`),
        purgeR2Prefix(booksBucket, `covers/${userId}/`),
        purgeR2Prefix(booksBucket, `user-books/${userId}/`),
        purgeR2Prefix(booksBucket, `coach/v1/${userId}/`),
        ...userBookIds.map((id) => purgeKindleBookCache(booksBucket, id)),
      ]);
    }

    return context.json({ ok: true, resetAt: new Date(resetAtMs).toISOString(), resetAtMs });
  } catch (error) {
    console.error("Error al reiniciar los datos de la cuenta:", error);
    return context.json(
      { error: "No se pudo completar el reinicio de datos." },
      500,
    );
  }
});
