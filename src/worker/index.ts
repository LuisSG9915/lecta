import { app } from "./app";
import { withClient, type WorkerEnv } from "./db";
import { EnrichmentWorkflow } from "./enrichment-workflow";

export { EnrichmentWorkflow };

const handler: ExportedHandler<WorkerEnv> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(
      (withClient(env, async (client) => {
        await client.query('DELETE FROM "session" WHERE "expiresAt" < NOW()');
        await client.query('DELETE FROM "verification" WHERE "expiresAt" < NOW()');
      }) ?? Promise.resolve()),
    );
  },
};

export default handler;
