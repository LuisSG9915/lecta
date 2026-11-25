// Gating de Lecta+ en el worker (docs/designs/2026-11-12-planes-y-landing.md).
// Se monta ruta por ruta, nunca con app.use sobre un patrón: /api/books/:hash
// también atraparía /api/books/community. El middleware entrega la sesión con
// c.set("session") para que el handler no vuelva a consultar Better Auth.
import { createMiddleware } from "hono/factory";
import { dailyAiLimit, hasLectaPlus } from "../shared/plan";
import type { WorkerEnv } from "./db";
import { loadUserPlan } from "./plan-store";
import { getSession } from "./session";

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
/** `aiDailyLimit`: tope diario invisible de IA (F11); null en free. */
export type PlanVariables = { session: Session; aiDailyLimit?: number | null };

export type CourtesyVariables = PlanVariables & { lectaPlus: boolean };

export const LECTA_PLUS_REQUIRED = "LECTA_PLUS_REQUIRED";
export const LECTA_PLUS_ERROR = "Esta función es de Lecta+.";
const STORAGE_UNCONFIGURED = "El almacenamiento no está configurado.";
const STORAGE_UNAVAILABLE = "Servicio temporalmente no disponible";

/**
 * Orden: sin sesión → 401; sin base → 503; error de base → 503;
 * sin Lecta+ → 402 { error, code }. Si pasa, la sesión queda en c.get.
 */
export const requireLectaPlus = createMiddleware<{
  Bindings: WorkerEnv;
  Variables: PlanVariables;
}>(async (c, next) => {
  const session = await getSession(c);
  if (!session?.user?.id) return c.json({ error: "No autorizado" }, 401);
  let snapshot;
  try {
    snapshot = await loadUserPlan(c.env, session.user.id);
  } catch {
    return c.json({ error: STORAGE_UNAVAILABLE }, 503);
  }
  if (!snapshot) return c.json({ error: STORAGE_UNCONFIGURED }, 503);
  if (!hasLectaPlus(snapshot.plan)) {
    return c.json({ error: LECTA_PLUS_ERROR, code: LECTA_PLUS_REQUIRED }, 402);
  }
  c.set("session", session);
  c.set("aiDailyLimit", dailyAiLimit(snapshot.plan, snapshot.trialEndsAt));
  await next();
});

/**
 * Para las rutas de IA con cortesía free: exige sesión pero NO bloquea a las
 * cuentas sin Lecta+. Deja `session` y `lectaPlus` en c.get: el handler
 * descuenta la cortesía solo si hace falta llamar a la IA. Mismos 401/503
 * que requireLectaPlus.
 */
export const requireSessionWithPlan = createMiddleware<{
  Bindings: WorkerEnv;
  Variables: CourtesyVariables;
}>(async (c, next) => {
  const session = await getSession(c);
  if (!session?.user?.id) return c.json({ error: "No autorizado" }, 401);
  let snapshot;
  try {
    snapshot = await loadUserPlan(c.env, session.user.id);
  } catch {
    return c.json({ error: STORAGE_UNAVAILABLE }, 503);
  }
  if (!snapshot) return c.json({ error: STORAGE_UNCONFIGURED }, 503);
  c.set("session", session);
  c.set("lectaPlus", hasLectaPlus(snapshot.plan));
  c.set("aiDailyLimit", dailyAiLimit(snapshot.plan, snapshot.trialEndsAt));
  await next();
});

/** Rutas del portal que nunca consultan el plan (vinculación y sesión). */
export const KINDLE_PLAN_EXEMPT_PATHS: readonly string[] = [
  "/k/login",
  "/k/logout",
  "/k/kindle",
  "/k/link",
  "/k/verify",
  "/k/api/kindle/status",
  "/k/api/kindle/link",
];

export type KindlePlanRequiredRender = () => string;

/**
 * Gating del portal e-ink. Sin sesión deja pasar: los handlers ya redirigen a
 * /kindle o /k/login. Las rutas exentas se comparan con la ruta completa.
 * Sin plan responde la nota HTML con 402 (la vista la inyecta quien monta).
 */
export function createRequireKindlePlan(renderPlanRequired: KindlePlanRequiredRender) {
  return createMiddleware<{ Bindings: WorkerEnv; Variables: Partial<PlanVariables> }>(
    async (c, next) => {
      if (KINDLE_PLAN_EXEMPT_PATHS.includes(c.req.path)) return next();
      const session = await getSession(c);
      if (!session?.user?.id) return next();
      let snapshot;
      try {
        snapshot = await loadUserPlan(c.env, session.user.id);
      } catch {
        return c.text(STORAGE_UNAVAILABLE, 503);
      }
      if (!snapshot) return c.text(STORAGE_UNCONFIGURED, 503);
      if (!hasLectaPlus(snapshot.plan)) {
        return c.html(renderPlanRequired(), 402);
      }
      c.set("session", session);
      await next();
    },
  );
}
