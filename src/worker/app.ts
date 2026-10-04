import { Hono } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "./db";
import { findEntries, findEntriesForForms, insertEnrichment } from "./lexicon";
import { requestEnrichment } from "./ai";
import { createAuth } from "./auth";

export const app = new Hono<{ Bindings: WorkerEnv }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));

const getSession = async (context: {
  env: WorkerEnv;
  req: { raw: Request; url: string };
}) => {
  if (!getConnectionString(context.env)) return null;
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  return createAuth(context.env, baseURL).api
    .getSession({ headers: context.req.raw.headers })
    .catch(() => null);
};

app.on(["GET", "POST"], "/api/auth/*", (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "La autenticación no está configurada." }, 503);
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  return createAuth(context.env, baseURL).handler(context.req.raw);
});

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

app.post("/api/lexicon/batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const forms = Array.isArray(body?.forms)
    ? body.forms.filter((form: unknown) => typeof form === "string").slice(0, 500)
    : [];
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  if (!forms.length) return context.json({ error: "Faltan las palabras." }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) =>
      findEntriesForForms(client, language, forms),
    );
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ entries });
});

app.post("/api/lexicon/enrich", async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.slice(0, 500) : undefined;
  if (!form || form.length > 100) return context.json({ error: "Falta la palabra." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);

  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para definir palabras con IA." }, 401);

  let result;
  try {
    const existing = await withClient(context.env, (client) =>
      findEntries(client, language, form),
    );
    if (existing === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);
    if (existing.length) {
      result = { status: "existing" as const, entries: existing };
    } else {
      const ai = await requestEnrichment(context.env, { form, language, context: contextText });
      if (!ai.ok) {
        result = { status: ai.reason } as const;
      } else {
        const entries = await withClient(context.env, async (client) => {
          await insertEnrichment(client, language, ai.enrichment);
          return findEntries(client, language, form);
        });
        result = { status: "created" as const, entries: entries ?? [] };
      }
    }
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

app.post("/api/lexicon/enrich-batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const forms = Array.isArray(body?.forms)
    ? body.forms.filter((form: unknown) => typeof form === "string").slice(0, 50)
    : [];
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  if (!forms.length) return context.json({ error: "Faltan las palabras." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (!context.env.ENRICHMENT_WORKFLOW)
    return context.json({ error: "El procesamiento por lotes no está configurado." }, 503);

  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para definir palabras con IA." }, 401);

  const instance = await context.env.ENRICHMENT_WORKFLOW.create({
    params: { forms, language },
  });
  return context.json({ instanceId: instance.id, count: forms.length }, 202);
});

const bookKey = (userId: string, hash: string) => `books/${userId}/${hash}.epub`;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

app.get("/api/books", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const listed = await context.env.BOOKS.list({ prefix: `books/${session.user.id}/` });
  return context.json({
    books: listed.objects.map((object) => ({
      hash: object.key.split("/").pop()?.replace(/\.epub$/, ""),
      uploaded: object.uploaded,
      name: object.customMetadata?.name ?? "",
    })),
  });
});

app.put("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para guardar libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);
  const data = await context.req.arrayBuffer();
  if (!data.byteLength || data.byteLength > 60 * 1024 * 1024)
    return context.json({ error: "Archivo vacío o demasiado grande." }, 400);

  await context.env.BOOKS.put(bookKey(session.user.id, hash), data, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: { name: context.req.query("name")?.slice(0, 200) ?? "" },
  });
  return context.json({ ok: true });
});

app.get("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const object = await context.env.BOOKS.get(bookKey(session.user.id, hash));
  if (!object) return context.json({ error: "Libro no encontrado." }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/epub+zip" },
  });
});

app.delete("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para borrar libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  await context.env.BOOKS.delete(bookKey(session.user.id, hash));
  return context.json({ ok: true });
});
