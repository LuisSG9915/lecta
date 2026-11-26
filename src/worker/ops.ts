// Operación y observabilidad: health, errores de cliente, embudo de la
// landing y agregado de errores. Extraído de app.ts (R2 de la deuda de
// complejidad). Rutas públicas salvo `/api/error-reports` (solo el dueño).
import { Hono } from "hono";
import { ownerUser } from "./admin";
import { runInBackground } from "./background";
import {
  CLIENT_ERROR_MAX_BODY_BYTES,
  allowClientError,
  parseClientErrorReport,
} from "./client-errors";
import { withClient, type WorkerEnv } from "./db";
import { listErrorSignatures, recordErrorSignature } from "./error-signatures";
import {
  LANDING_EVENT_MAX_BODY_BYTES,
  allowLandingEvent,
  parseLandingEvent,
  recordLandingEvent,
  recordPlanEvent,
} from "./landing-events";
import { getSession } from "./session";

export const ops = new Hono<{ Bindings: WorkerEnv }>();

ops.get("/api/health", async (c) => {
  try {
    const queryPromise = withClient(c.env, (client) => client.query("SELECT 1"));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB healthcheck timeout")), 2000),
    );
    const result = await Promise.race([queryPromise, timeoutPromise]);
    if (!result) {
      return c.json({ ok: false, db: "unreachable" }, 503);
    }
    return c.json({ ok: true, db: "connected", status: "ok" }, 200);
  } catch {
    return c.json({ ok: false, db: "unreachable" }, 503);
  }
});

// Errores de cliente: la respuesta sigue siendo 204 sin sesión, pero ahora el
// reporte aceptado también suma a la fila del día en lecta_error_signatures
// (una fila por firma, no por evento). La escritura va en waitUntil y se traga
// sus errores: reportar nunca puede romper la app ni retrasar la respuesta.
ops.post("/api/client-errors", async (context) => {
  const raw = await context.req.text().catch(() => "");
  if (raw.length > CLIENT_ERROR_MAX_BODY_BYTES) {
    return context.body(null, 204);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return context.body(null, 204);
  }

  const report = parseClientErrorReport(parsed);
  if (!report) {
    return context.body(null, 204);
  }

  const ip = context.req.header("cf-connecting-ip") ?? "local";
  if (!allowClientError(ip, Date.now())) {
    return context.body(null, 204);
  }

  console.error(JSON.stringify(report));
  const writing = recordErrorSignature(context.env, {
    name: report.name,
    code: report.code,
    route: report.route,
    version: report.version,
    ...(report.frames ? { frames: report.frames } : {}),
    ...(report.message ? { message: report.message } : {}),
  }).catch(() => false);
  // `c.executionCtx` lanza si la invocación no trae ExecutionContext
  // (pruebas armadas a mano): en ese caso la promesa sigue sin waitUntil.
  let scheduled = false;
  try {
    const executionCtx = context.executionCtx;
    if (executionCtx && typeof executionCtx.waitUntil === "function") {
      executionCtx.waitUntil(writing);
      scheduled = true;
    }
  } catch {
    scheduled = false;
  }
  if (!scheduled) void writing;
  return context.body(null, 204);
});

// Embudo de la landing (src/worker/landing-events.ts): sin sesión, siempre
// 204, escritura en segundo plano que se traga sus errores.
ops.post("/api/landing-events", async (context) => {
  const raw = await context.req.text().catch(() => "");
  if (raw.length > LANDING_EVENT_MAX_BODY_BYTES) return context.body(null, 204);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return context.body(null, 204);
  }

  const landingEvent = parseLandingEvent(parsed);
  if (!landingEvent) return context.body(null, 204);

  const ip = context.req.header("cf-connecting-ip") ?? "local";
  if (!allowLandingEvent(ip, Date.now())) return context.body(null, 204);

  runInBackground(context, recordLandingEvent(context.env, landingEvent).catch(() => false));

  // F19: un `app:*` con sesión suma también por cuenta. La sesión se resuelve
  // en segundo plano (el 204 no espera) y solo si hay cookie (barato); sin
  // sesión o ante cualquier fallo no se escribe nada por usuario.
  if (landingEvent.event.startsWith("app:")) {
    const { env } = context;
    const request = { raw: context.req.raw, url: context.req.url };
    runInBackground(
      context,
      getSession({ env, req: request })
        .then((session) => (session ? recordPlanEvent(env, session.user.id, landingEvent.event) : false))
        .catch(() => false),
    );
  }
  return context.body(null, 204);
});

// Apartado «Salud de la aplicación»: el agregado es global, no por usuario,
// así que solo lo ve el dueño. 404 y no 403: la ruta no se anuncia.
ops.get("/api/error-reports", async (context) => {
  const user = await ownerUser(context).catch(() => null);
  if (!user) return context.body(null, 404);

  const requested = Number(context.req.query("days") ?? 7);
  const days = Number.isFinite(requested) && requested > 0 ? requested : 7;
  const rows = await listErrorSignatures(context.env, days).catch(() => []);
  return context.json({ days, rows });
});
