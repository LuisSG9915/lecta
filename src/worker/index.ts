import { app } from "./app";
import { withClient, type WorkerEnv } from "./db";
import { EnrichmentWorkflow } from "./enrichment-workflow";
import {
  collectErrorDigest,
  purgeErrorSignatures,
  sendErrorDigest,
} from "./error-signatures";

export { EnrichmentWorkflow };

const handler: ExportedHandler<WorkerEnv> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(
      (withClient(env, async (client) => {
        await client.query('DELETE FROM "session" WHERE "expiresAt" < NOW()');
        await client.query('DELETE FROM "verification" WHERE "expiresAt" < NOW()');
        await client.query("DELETE FROM lecta_rate_log WHERE created_at < $1", [
          Date.now() - 48 * 3_600_000,
        ]);
        await client.query("DELETE FROM lecta_ai_quota WHERE bucket_hour < $1", [
          Math.floor((Date.now() - 48 * 3_600_000) / 3_600_000),
        ]);
      }) ?? Promise.resolve()),
    );

    // Observabilidad: poda de firmas viejas (30 días) + aviso de las que
    // cruzaron el umbral en las últimas 24 h. Cada paso falla en silencio:
    // la casa se limpia aunque la base o Resend digan que no.
    ctx.waitUntil(
      (async () => {
        await purgeErrorSignatures(env).catch(() => 0);
        const rows = await collectErrorDigest(env).catch(() => []);
        if (rows.length > 0) await sendErrorDigest(env, rows).catch(() => false);
      })(),
    );
  },
};

export default handler;
