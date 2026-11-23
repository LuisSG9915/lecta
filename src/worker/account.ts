// Estado y datos de la cuenta: sello de reinicio, plan, pelaje inicial y
// «borrar datos». Extraído de app.ts (R2 de la deuda de complejidad).
import { Hono } from "hono";
import { purgeR2Prefix } from "./auth";
import { getConnectionString, readAccountResetAt, resetAccountDataDb, withClient, type WorkerEnv } from "./db";
import { runInBackground } from "./background";
import { purgeKindleBookCache } from "./kindle/cache";
import { normalizeLandingSource, recordLandingEvent } from "./landing-events";
import { readFreeAiRemaining } from "./free-courtesy";
import { getUserPlan, setStarterCoat, type UserPlanSnapshot } from "./plan-store";
import { getSession } from "./session";
import { hasLectaPlus, isStarterCoat } from "../shared/plan";

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
          // Cortesía de IA de este mes (UTC); null = sin tope (Lecta+/fundador).
          freeAiRemaining: freeAiLeft,
          // Prueba de 7 días disponible: plan free y nunca fue cliente en Stripe.
          trialEligible: snapshot.plan === "free" && !snapshot.stripeCustomerId,
        }
      : {}),
  });
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
