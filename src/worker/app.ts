import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnectionString, type WorkerEnv } from "./db";
import { requireLectaPlus } from "./plan-middleware";
import { billing } from "./billing";
import { account } from "./account";
import { lexiconRoutes } from "./lexicon-routes";
import { userBooks } from "./user-books";
import { vocabSync } from "./vocab-sync";
import { ops } from "./ops";
import { weeklyDigest } from "./weekly-digest";
import { reengage } from "./reengage";
import { studyPlan } from "./study-plan";
import { fluencyForecast } from "./fluency-forecast";
import { coach } from "./coach";
import { createScopedAuth, closePoolSafe } from "./auth";
import { checkAuthRateLimit, isLimitedAuthRequest } from "./auth-rate-limit";
import { EPUB_MAX_BYTES } from "../shared/epub-check";
import { SessionInfraError } from "./session";
import { readingData } from "./reading-data";
import { companion } from "./companion";
import { catalog } from "./catalog";
import { screen, screenZoneGate } from "./screen";
import { screenDiscover } from "./screen-discover";
import { admin } from "./admin";
import { handleKindleLinkPage, handleKindleStatus, handleKindleLinkAction, handleKindlePrimingAction, requireKindlePlan, handleKindlePrefsApiGet, handleKindlePrefsApiPut, kindleRoutes, kindleHtmlCspFor } from "./kindle/routes";
import { aiRoutes } from "./ai-routes";
import { books } from "./books";
import { articleExtract } from "./article-extract";

export { clearExplainPassageCache, type ExplainInPassageResponse } from "./ai-routes";

export { consumeRateUnits } from "./rate-limit";
export { computeAiCacheKey, getCachedAiText, setCachedAiText } from "./ai-cache";
export const app = new Hono<{ Bindings: WorkerEnv }>();

// Las rutas de IA reciben texto de página/párrafo: 64 KB sobran para el
// caso legítimo y cortan en la puerta cualquier cuerpo desmedido antes
// de que c.req.json() lo materialice en memoria.
app.use(
  "/api/ai/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "Payload too large" }, 413),
  }),
);

// Tope para el resto de la API. 4 MB cubre el lote de sync más grande
// legítimo (500 anotaciones de hasta ~4,7 K caracteres ≈ 2,3 MB); las
// subidas de EPUB y portadas llevan el suyo, y `/api/lexicon/batch` es
// público y no necesita más que 2000 formas.
export const API_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const LEXICON_BATCH_MAX_BYTES = 128 * 1024;
const BOOK_COVER_MAX_BYTES = 300_000;

export function apiBodyLimitFor(path: string): number {
  if (path === "/api/lexicon/batch") return LEXICON_BATCH_MAX_BYTES;
  if (/^\/api\/books\/[^/]+\/cover$/.test(path)) return BOOK_COVER_MAX_BYTES;
  if (/^\/api\/books(\/[^/]+)?$/.test(path) || /^\/api\/user\/books\/[^/]+\/file$/.test(path))
    return EPUB_MAX_BYTES;
  return API_BODY_MAX_BYTES;
}

app.use("/api/*", (c, next) =>
  bodyLimit({
    maxSize: apiBodyLimitFor(c.req.path),
    onError: (ctx) => ctx.json({ error: "Payload too large" }, 413),
  })(c, next),
);

app.onError((err, c) => {
  const pathname = new URL(c.req.url).pathname;
  // Nunca el objeto crudo: puede llevar `detail` con valores de filas o
  // constraints de Postgres. Solo metadatos seguros para diagnóstico.
  const anyErr = err as { name?: string; code?: string; message?: string };
  console.error(`[worker-error] ${c.req.method} ${pathname}:`, {
    name: anyErr?.name ?? "Error",
    code: anyErr?.code,
    message: anyErr?.message ?? String(err),
  });
  if (
    err instanceof SessionInfraError ||
    (err as { code?: string })?.code === "DB_UNAVAILABLE"
  ) {
    return c.json(
      {
        error:
          "Base de datos temporalmente no disponible. Tus datos locales están a salvo.",
        code: "DB_UNAVAILABLE",
      },
      503,
    );
  }
  return c.json({ error: "Internal Server Error" }, 500);
});

// Cabeceras anti-caché para respuestas HTML servidas por el worker
app.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type");
  if (contentType?.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    c.res.headers.set("Expires", "0");
    c.res.headers.set("Content-Security-Policy", kindleHtmlCspFor(c.req.path));
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  }
});

app.route("/", readingData);
app.route("/", companion);
app.route("/", catalog);
app.use("/api/screen/*", screenZoneGate);
app.route("/", screen);
app.route("/", screenDiscover);
app.route("/", admin);
app.route("/", billing);
app.route("/", weeklyDigest);
app.route("/", reengage);
app.route("/", studyPlan);
app.route("/", fluencyForecast);
app.route("/", coach);
app.route("/", articleExtract);
// Formularios del portal Kindle (login, ajustes, vocabulario, subrayados):
// unos pocos cientos de bytes. `/k/login` es público, así que se corta
// en la puerta antes de que parseBody() materialice el cuerpo.
export const KINDLE_FORM_MAX_BYTES = 64 * 1024;
const kindleFormLimit = bodyLimit({
  maxSize: KINDLE_FORM_MAX_BYTES,
  onError: (c) => c.text("Formulario demasiado grande.", 413),
});
app.use("/k/*", kindleFormLimit);
app.use("/kindle/*", kindleFormLimit);

app.route("/k", kindleRoutes);
app.get("/kindle", handleKindleLinkPage);
app.get("/kindle/verify", handleKindleStatus);
app.get("/api/kindle/status", handleKindleStatus);
app.get("/api/kindle/prefs", requireLectaPlus, handleKindlePrefsApiGet);
app.put("/api/kindle/prefs", requireLectaPlus, handleKindlePrefsApiPut);
app.post("/api/kindle/link", handleKindleLinkAction);
app.post("/kindle/priming/action", requireKindlePlan, handleKindlePrimingAction);
app.get("/kindle/*", (context) => {
  const p = context.req.path.replace(/^\/kindle/, "/k");
  return context.redirect(p);
});
app.post("/kindle/*", async (context) => {
  const url = new URL(context.req.url);
  url.pathname = url.pathname.replace(/^\/kindle/, "/k");
  return app.fetch(new Request(url.toString(), context.req.raw), context.env, context.executionCtx);
});

app.route("/", ops);

app.on(["GET", "HEAD"], "/models/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!filename || filename.includes("..") || filename.includes("/")) {
    return c.json({ error: "Invalid model filename" }, 400);
  }

  const modelsBucket = c.env?.BOOKS;
  if (!modelsBucket) {
    return c.text("Model not found", 404);
  }

  const key = `models/${filename}`;

  const buildHeaders = (object: R2Object | R2ObjectBody) => {
    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    if (object.size !== undefined) {
      headers.set("Content-Length", String(object.size));
    }
    const etag = object.httpEtag ?? object.etag;
    if (etag) {
      headers.set("ETag", etag);
    }
    return headers;
  };

  // HEAD con head(): no se abre el cuerpo de un objeto de 24 MB para tirarlo.
  if (c.req.method === "HEAD") {
    const head = await modelsBucket.head(key);
    if (!head) {
      return c.text("Model not found", 404);
    }
    return new Response(null, { status: 200, headers: buildHeaders(head) });
  }

  const object = await modelsBucket.get(key);
  if (!object) {
    return c.text("Model not found", 404);
  }
  return new Response(object.body, { status: 200, headers: buildHeaders(object) });
});

app.on(["GET", "POST"], "/api/auth/*", async (context) => {
  if (
    isLimitedAuthRequest(context.req.method, context.req.path) &&
    !(await checkAuthRateLimit(context.env, context.req.raw, "auth"))
  ) {
    return context.json(
      { code: "RATE_LIMITED", message: "Demasiados intentos. Espera un minuto y vuelve a probar." },
      429,
      { "Retry-After": "60" },
    );
  }
  if (!getConnectionString(context.env))
    return context.json({ error: "La autenticación no está configurada." }, 503);
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  const { auth, closePool } = createScopedAuth(context.env, baseURL);
  try {
    return await auth.handler(context.req.raw);
  } finally {
    await closePoolSafe(closePool, context);
  }
});

app.route("/", lexiconRoutes);

app.route("/", aiRoutes);

app.route("/", books);

app.route("/", vocabSync);

app.route("/", userBooks);

app.route("/", account);
