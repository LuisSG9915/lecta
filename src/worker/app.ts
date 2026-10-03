import { Hono } from "hono";
import { withClient, type WorkerEnv } from "./db";
import { findEntries, insertEnrichment } from "./lexicon";
import { requestEnrichment } from "./ai";

export const app = new Hono<{ Bindings: WorkerEnv }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/lexicon/lookup", async (context) => {
  const form = context.req.query("form")?.trim();
  const language = context.req.query("lang")?.trim() || "es";
  if (!form || form.length > 100) return context.json({ found: false }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) => findEntries(client, language, form));
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json(
    { found: entries.length > 0, entries },
    entries.length > 0 ? 200 : 404,
  );
});

app.post("/api/lexicon/enrich", async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.slice(0, 500) : undefined;
  if (!form || form.length > 100) return context.json({ error: "Falta la palabra." }, 400);

  let result;
  try {
    result = await withClient(context.env, async (client) => {
      const existing = await findEntries(client, language, form);
      if (existing.length) return { status: "existing" as const, entries: existing };

      const ai = await requestEnrichment(context.env, { form, language, context: contextText });
      if (!ai.ok) return { status: ai.reason } as const;

      await insertEnrichment(client, language, ai.enrichment);
      const entries = await findEntries(client, language, form);
      return { status: "created" as const, entries };
    });
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!result) return context.json({ error: "El catálogo no está configurado." }, 503);
  switch (result.status) {
    case "existing":
      return context.json({ status: "existing", entries: result.entries });
    case "created":
      return context.json({ status: "created", entries: result.entries });
    case "not-configured":
      return context.json({ error: "El enriquecimiento no está configurado." }, 503);
    default:
      return context.json({ error: "La IA no devolvió una ficha válida." }, 502);
  }
});
