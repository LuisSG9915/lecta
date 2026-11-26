import { app } from "./app";
import { isProbePath, isWorkerRoute, legacyHostRedirect } from "./canonical-host";
import { withClient, type WorkerEnv } from "./db";
import { EnrichmentWorkflow } from "./enrichment-workflow";
import {
  collectErrorDigest,
  purgeErrorSignatures,
  sendErrorDigest,
} from "./error-signatures";
import { purgeLandingEvents } from "./landing-events";
import { runReengage } from "./reengage";
import { readCachedCoach } from "./coach";
import { loadUserPlan } from "./plan-store";
import { hasLectaPlus } from "../shared/plan";
import { buildUserDigest, buildDigestHtml, isEmptyDigest, sendDigestEmail } from "./weekly-digest";

export { EnrichmentWorkflow };

const handler: ExportedHandler<WorkerEnv> = {
  // `run_worker_first` manda aquí también las páginas (para poder redirigir
  // el host viejo); lo que no es ruta del Worker vuelve a los assets.
  fetch: (request, env, ctx) => {
    if (isProbePath(new URL(request.url).pathname)) {
      return new Response("Not found", { status: 404 });
    }
    const redirect = legacyHostRedirect(request);
    if (redirect) return redirect;
    if (env.ASSETS && !isWorkerRoute(new URL(request.url).pathname)) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, ctx);
  },
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(
      (withClient(env, async (client) => {
        await client.query('DELETE FROM "session" WHERE "expiresAt" < NOW()');
        await client.query('DELETE FROM "verification" WHERE "expiresAt" < NOW()');
        await client.query("DELETE FROM lecta_rate_log WHERE created_at < $1", [
          Date.now() - 48 * 3_600_000,
        ]);
        // Retención de 30 días: el bucket por hora alcanza para la
        // cuota (solo importa la hora actual) y ahora también alimenta
        // el análisis de uso de IA del panel.
        await client.query("DELETE FROM lecta_ai_quota WHERE bucket_hour < $1", [
          Math.floor((Date.now() - 30 * 86_400_000) / 3_600_000),
        ]);
      }) ?? Promise.resolve()),
    );

    // Observabilidad: poda de firmas viejas (30 días) + aviso de las que
    // cruzaron el umbral en las últimas 24 h. Cada paso falla en silencio:
    // la casa se limpia aunque la base o Resend digan que no.
    ctx.waitUntil(
      (async () => {
        await purgeErrorSignatures(env).catch(() => 0);
        await purgeLandingEvents(env).catch(() => 0);
        const rows = await collectErrorDigest(env).catch(() => []);
        if (rows.length > 0) await sendErrorDigest(env, rows).catch(() => false);
      })(),
    );

    // Correo de regreso a los 7 días (docs/designs/2026-11-24-correo-de-regreso.md)
    // y, los lunes, el resumen semanal. Van en serie en un solo waitUntil:
    // juntos en paralelo pasarían el tope de Resend (2 por segundo). El
    // resumen va a las cuentas con opt-in; cada envío falla en silencio para
    // no abortar el resto.
    ctx.waitUntil(
      (async () => {
        await runReengage(env).catch(() => undefined);
        if (new Date().getUTCDay() !== 1) return;
        let users: { user_id: string; email: string; token: string | null }[];
        try {
          const result = await withClient(env, (client) =>
            client.query<{ user_id: string; email: string; token: string | null }>(
              `SELECT p.user_id, u.email, p.digest_unsubscribe_token AS token
                 FROM lecta_user_plan p
                 JOIN "user" u ON u.id = p.user_id
                WHERE p.digest_opt_in = true AND u.email IS NOT NULL`,
            ),
          );
          users = result?.rows ?? [];
        } catch {
          users = [];
        }
        const base = "https://lectal.app";
        for (const u of users) {
          try {
            const data = await buildUserDigest(env, u.user_id);
            if (isEmptyDigest(data)) continue;
            const unsubUrl = u.token
              ? `${base}/api/digest/unsubscribe?token=${encodeURIComponent(u.token)}`
              : base;
            // Lecta+: reutiliza el texto ya generado (nunca llama a la IA en el cron).
            let coachText: string | null = null;
            try {
              const snap = await loadUserPlan(env, u.user_id);
              if (snap && hasLectaPlus(snap.plan)) coachText = (await readCachedCoach(env, u.user_id))?.text ?? null;
            } catch {
              coachText = null;
            }
            const html = buildDigestHtml(data, unsubUrl, coachText);
            await sendDigestEmail(env, u.email, html, "Tu semana en Lecta");
            await new Promise((r) => setTimeout(r, 500));
          } catch {
            // falla en silencio por usuario
          }
        }
      })(),
    );
  },
};

export default handler;
