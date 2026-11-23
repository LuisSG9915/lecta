import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { chunks, getConnectionString, isMissingColumnError, isMissingTableError, readAccountResetAt, resetAccountDataDb, withClient, type WorkerEnv } from "./db";
import {
  CLIENT_ERROR_MAX_BODY_BYTES,
  allowClientError,
  parseClientErrorReport,
} from "./client-errors";
import { listErrorSignatures, recordErrorSignature } from "./error-signatures";
import {
  LANDING_EVENT_MAX_BODY_BYTES,
  allowLandingEvent,
  normalizeLandingSource,
  parseLandingEvent,
  recordLandingEvent,
} from "./landing-events";
import { getUserPlan, setStarterCoat, type UserPlanSnapshot } from "./plan-store";
import {
  LECTA_PLUS_REQUIRED,
  requireLectaPlus,
  requireSessionWithPlan,
  type PlanVariables,
} from "./plan-middleware";
import { consumeFreeAiCourtesy, readFreeAiRemaining, refundFreeAiCourtesy } from "./free-courtesy";
import { billing } from "./billing";
import { weeklyDigest } from "./weekly-digest";
import { hasLectaPlus, isStarterCoat } from "../shared/plan";
import {
  CATALOG,
  findEntries,
  findEntriesForForms,
  insertEnrichment,
  pendingEnrichmentJobs,
  sampleForCalibration,
  type LexiconEntryView,
} from "./lexicon";
import {
  ENRICHMENT_MODEL,
  createTtlCache,
  EXPLAIN_CALL_OPTIONS,
  EVALUATE_CALL_OPTIONS,
  EVALUATE_SYSTEM_PROMPT,
  EXPLAIN_PASSAGE_CALL_OPTIONS,
  EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS,
  EXPLAIN_PASSAGE_SYSTEM_PROMPT,
  buildCompactExplainPrompt,
  normalizePassage,
  COMPANION_NOTE_SYSTEM_PROMPT,
  buildCompanionNotePrompt,
  parseCompanionNote,
  STORY_CALL_OPTIONS,
  STORY_SYSTEM_PROMPT,
  buildEvaluatePrompt,
  buildExplainInPassagePrompt,
  buildStoryPrompt,
  parseEvaluateSentence,
  parseMicroStory,
  parsePassageExplanation,
  type EvaluatedSentence,
  type MicroStory,
  type PassageExplanation,
  ITEM_CALL_OPTIONS,
  VERIFY_CALL_OPTIONS,
  buildExplainPrompt,
  buildExplainSystemPrompt,
  buildItemPrompt,
  buildItemSystemPrompt,
  buildVerifyPrompt,
  buildVerifySystemPrompt,
  callDeepSeek,
  COMPANION_NOTE_CALL_OPTIONS,
  PAGE_RECAP_CALL_OPTIONS,
  PAGE_RECAP_SYSTEM_PROMPT,
  buildPageRecapPrompt,
  parsePageRecap,
  deterministicPageRecapFallback,
  CHARACTER_RECAP_CALL_OPTIONS,
  CHARACTER_RECAP_SYSTEM_PROMPT,
  buildCharacterRecapPrompt,
  parseCharacterRecap,
  deterministicCharacterRecapFallback,
  type CharacterRecapResponse,
  logAiCall,
  parseExplain,
  parseItem,
  parseVerify,
  requestEnrichment,
  AI_TASK_BUDGETS,
  buildParagraphTranslationPrompt,
} from "./ai";
export {
  buildContextualWordPrompt,
  buildParagraphTranslationPrompt,
  buildPageRecapPrompt,
  buildCharacterCardsPrompt,
} from "./ai";
import { createScopedAuth, closePoolSafe, purgeR2Prefix } from "./auth";
import { checkAuthRateLimit, isLimitedAuthRequest } from "./auth-rate-limit";
import { isStopword } from "../shared/stopwords";
import { hasUsableDefinition } from "../shared/lexicon";
import { isFsrsCardShape } from "../shared/reading-data";
import {
  calibrationBankVersion,
  type CalibrationProfile,
} from "../shared/calibration-bank";
import { checkEpubHeader, checkEpubBuffer, EPUB_MAX_BYTES } from "../shared/epub-check";
import { extractEpubMeta, extractEpubCover, isHashLikeIdentifier } from "../shared/epub-meta";
import { genreFromSubjects, isBookGenre } from "../shared/book-genres";
import { sanitizePaperBookGuide } from "../shared/paper-guide";
import {
  invalidateCommunityGuides,
  publishedGuideHashes,
} from "./community-guides";
import { getSession, getSessionUser, SessionInfraError } from "./session";
import { readingData } from "./reading-data";
import { companion } from "./companion";
import { catalog } from "./catalog";
import { screen, screenZoneGate } from "./screen";
import { screenDiscover } from "./screen-discover";
import { consumeRateUnits } from "./rate-limit";
import { admin, ownerUser } from "./admin";
import {
  handleKindleLinkPage,
  handleKindleStatus,
  handleKindleLinkAction,
  handleKindlePrimingAction,
  requireKindlePlan,
  handleKindlePrefsApiGet,
  handleKindlePrefsApiPut,
  kindleRoutes,
  kindleHtmlCspFor,
} from "./kindle/routes";
import { purgeKindleBookCache } from "./kindle/cache";
import {
  isResetBlocked,
  readResetAck,
  resetBlockedResponse,
  staleResetAt,
  StaleResetError,
  withResetGuard,
} from "./reset-guard";

export { consumeRateUnits } from "./rate-limit";
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

// ---------- Caché Deduplicado de IA por Hash SHA-256 (LRU 300) ----------

const workerAiMemoryCache = new Map<string, string>();
const MAX_WORKER_AI_CACHE = 300;

export async function computeAiCacheKey(
  task: string,
  payload: string,
): Promise<string> {
  const normalized = `${task}::${payload.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `ai:${task}:${hex}`;
}

export function getCachedAiText(key: string): string | null {
  const hit = workerAiMemoryCache.get(key);
  if (hit !== undefined) {
    workerAiMemoryCache.delete(key);
    workerAiMemoryCache.set(key, hit);
    return hit;
  }
  return null;
}

export function setCachedAiText(key: string, value: string): void {
  workerAiMemoryCache.delete(key);
  if (workerAiMemoryCache.size >= MAX_WORKER_AI_CACHE) {
    const oldest = workerAiMemoryCache.keys().next().value;
    if (oldest) workerAiMemoryCache.delete(oldest);
  }
  workerAiMemoryCache.set(key, value);
}

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

app.get("/api/health", async (c) => {
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
app.post("/api/client-errors", async (context) => {
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

/** Corre `work` en waitUntil si hay ExecutionContext; si no, suelto. */
function runInBackground(context: Context, work: Promise<unknown>): void {
  try {
    const executionCtx = context.executionCtx;
    if (executionCtx && typeof executionCtx.waitUntil === "function") {
      executionCtx.waitUntil(work);
      return;
    }
  } catch {
    /* pruebas sin ExecutionContext */
  }
  void work;
}

// Embudo de la landing (src/worker/landing-events.ts): sin sesión, siempre
// 204, escritura en segundo plano que se traga sus errores.
app.post("/api/landing-events", async (context) => {
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
  return context.body(null, 204);
});

// Apartado «Salud de la aplicación»: el agregado es global, no por usuario,
// así que solo lo ve el dueño. 404 y no 403: la ruta no se anuncia.
app.get("/api/error-reports", async (context) => {
  const user = await ownerUser(context).catch(() => null);
  if (!user) return context.body(null, 404);

  const requested = Number(context.req.query("days") ?? 7);
  const days = Number.isFinite(requested) && requested > 0 ? requested : 7;
  const rows = await listErrorSignatures(context.env, days).catch(() => []);
  return context.json({ days, rows });
});

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

app.get("/api/lexicon/lookup", async (context) => {
  const form = context.req.query("form")?.trim();
  const language = context.req.query("lang")?.trim() || "es";
  if (!form || form.length > 100) return context.json({ found: false }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) => findEntries(client, language, form), true);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json(
    { found: entries.length > 0, entries },
    entries.length > 0 ? 200 : 404,
  );
});

// Muestra de lemas para la calibración inicial de vocabulario:
// lectura pública del catálogo, como lookup/batch (sin sesión). Cada
// lema de la muestra entra solo con definición cargada y zipf dentro
// de su banda — el selector verifica la medición real, nada entra a
// ciegas desde el banco.
// Disponible en español e inglés.
const sampleCache = createTtlCache<{ words: unknown; version: string }>({
  maxEntries: 4,
  ttlMs: 5 * 60_000,
});

app.get("/api/lexicon/sample", async (context) => {
  const language = context.req.query("language")?.trim() || "es";
  const rawProfile = context.req.query("profile")?.trim();
  const profile: CalibrationProfile = rawProfile === "learner" ? "learner" : "native";
  if (language !== "es" && language !== "en")
    return context.json({ error: "La muestra solo existe en español e inglés por ahora." }, 400);

  const cacheKey = `${language}:${profile}`;
  const cached = sampleCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  let words;
  try {
    words = await withClient(context.env, (client) =>
      sampleForCalibration(client, language, profile),
    true);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!words) return context.json({ error: "El catálogo no está configurado." }, 503);
  const payload = { words, version: calibrationBankVersion(language, profile) };
  sampleCache.set(cacheKey, payload);
  return context.json(payload);
});

app.post("/api/lexicon/batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const forms = Array.isArray(body?.forms)
    ? body.forms.filter((form: unknown) => typeof form === "string").slice(0, 2000)
    : [];
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  if (!forms.length) return context.json({ error: "Faltan las palabras." }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) =>
      findEntriesForForms(client, language, forms),
    true);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ entries });
});

const handleEnrich = async (context: Context<{ Bindings: WorkerEnv }>) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.slice(0, 500) : undefined;
  if (!form || form.length > 100) return context.json({ error: "Falta la palabra." }, 400);

  // Si no hay configuración de base de datos ni de IA, reportar 503
  if (!getConnectionString(context.env) && !context.env.DEEPSEEK_API_KEY) {
    return context.json({ error: "El catálogo no está configurado." }, 503);
  }

  const session = await getSession(context);
  if (!session) return context.json({ error: "No autorizado." }, 401);

  if (isStopword(form, language))
    return context.json({ error: "«" + form + "» es una palabra muy común; no necesita ficha de IA." }, 400);

  let existing: LexiconEntryView[] = [];
  if (getConnectionString(context.env)) {
    try {
      const found = await withClient(context.env, (client) =>
        findEntries(client, language, form),
      true);
      if (found) existing = found;
    } catch {
      // Si la base no responde, se continúa con enriquecimiento directo
    }
  }

  if (hasUsableDefinition(existing)) {
    return context.json({ status: "existing", entries: existing });
  }

  if (session) {
    const allowed = await consumeRateUnits(context.env, session.user.id, 1);
    if (!allowed) {
      return context.json(
        { error: "Llegaste al límite de definiciones con IA por hora. Intenta más tarde." },
        429,
      );
    }
  }

  const ai = await requestEnrichment(context.env, { form, language, context: contextText, nativeLanguage });
  if (!ai.ok) {
    if (existing.length > 0) {
      return context.json({ status: "existing", entries: existing });
    }
    switch (ai.reason) {
      case "not-configured":
        return context.json({ error: "El catálogo no está configurado." }, 503);
      case "rate-limited":
        return context.json({ error: "La IA está saturada. Intenta de nuevo en unos minutos." }, 503);
      default:
        return context.json({ error: "La IA no devolvió una ficha válida." }, 502);
    }
  }

  const fallbackEntry: LexiconEntryView = {
    entryId: null,
    lemma: ai.enrichment.lemma,
    pos: ai.enrichment.pos,
    freqRank: ai.enrichment.freqRank,
    zipf: null,
    senses: ai.enrichment.senses.map((s, idx) => ({
      definition: s.definition,
      example: s.example,
      senseOrder: idx + 1,
    })),
  };

  // El catálogo es compartido por todas las cuentas: una ficha generada con
  // `context` (texto libre del cliente que entra al prompt) nunca se persiste.
  // Es lo más simple que protege a cualquier cuenta, también a las sin Lecta+.
  if (!contextText && getConnectionString(context.env)) {
    try {
      const entries = await withClient(context.env, async (client) => {
        await insertEnrichment(client, language, ai.enrichment, form);
        return findEntries(client, language, form);
      });
      if (entries && entries.length > 0) {
        return context.json({ status: "created", entries });
      }
    } catch {
      // Si falla la inserción en BD, devolver igualmente el resultado generado en 200
    }
  }

  return context.json({ status: "created", entries: [fallbackEntry] }, 200);
};

app.post("/api/lexicon/enrich", handleEnrich);
app.post("/api/ai/enrich", handleEnrich);

app.post("/api/lexicon/enrich-batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const rawForms: string[] = Array.isArray(body?.forms)
    ? body.forms.filter((f: unknown): f is string => typeof f === "string").slice(0, 200)
    : [];
  // Las stopwords no gastan cuota ni IA: el workflow las omitiría igual.
  const forms = [...new Set(rawForms.map((f) => f.trim().toLowerCase()))]
    .filter((f) => f && !isStopword(f, language))
    .slice(0, 50);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (!context.env.ENRICHMENT_WORKFLOW)
    return context.json({ error: "El procesamiento por lotes no está configurado." }, 503);

  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para definir palabras con IA." }, 401);
  if (!forms.length) return context.json({ count: 0, skipped: rawForms.length });

  let pending;
  try {
    const catalog = await withClient(context.env, (client) =>
      findEntriesForForms(client, language, forms),
    true);
    if (catalog === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);
    pending = pendingEnrichmentJobs(forms, catalog);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }
  if (!pending.length)
    return context.json({ count: 0, skipped: rawForms.length });

  const allowed = await consumeRateUnits(context.env, session.user.id, pending.length);
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de definiciones con IA por hora. Intenta más tarde." },
      429,
    );

  const instance = await context.env.ENRICHMENT_WORKFLOW.create({
    params: { forms: pending.map((job) => job.form), language },
  });
  return context.json({ instanceId: instance.id, count: pending.length }, 202);
});

// Los ids del catálogo son INT8 de unique_rowid() (~1.2e18 > 2^53):
// por JSON viajan como string de dígitos, porque un number los
// truncaría (…305 → …300). Se acepta también un entero seguro y se
// canoniza («007» → «7»); Postgres castea el texto a int8/int4.
const INT8_MAX = 9223372036854775807n;
const INT4_MAX = 2147483647n;
// Entero positivo en [1, max]: string de dígitos o number. Un number
// por encima de 2^53 ya perdió dígitos al serializarse — aceptarlo
// ligaría la acepción equivocada, así que se rechaza.
const toBoundedDigits = (value: unknown, max: bigint): string | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && BigInt(value) <= max
      ? String(value)
      : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id >= 1n && id <= max ? id.toString() : null;
};
const toCatalogId = (value: unknown): string | null => toBoundedDigits(value, INT8_MAX);
// sense_order es INT4 en el catálogo: su rango no es el de los ids.
const toSenseOrder = (value: unknown): string | null => toBoundedDigits(value, INT4_MAX);

// Reporte «esta acepción no corresponde»: solo sube el contador
// editorial de la fila de lexicon_senses; no crea ni edita fichas.
app.post("/api/lexicon/report", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para reportar una acepción." }, 401);

  const body = await context.req.json().catch(() => null);
  const entryId = toCatalogId(body?.entryId);
  const senseOrder = toSenseOrder(body?.senseOrder);
  if (entryId === null || senseOrder === null)
    return context.json({ error: "Falta la acepción que reportar." }, 400);

  const reports = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE ${CATALOG}lexicon_senses SET reports = reports + 1
       WHERE entry_id = $1 AND sense_order = $2
       RETURNING reports`,
      [entryId, senseOrder],
    );
    if (!result.rowCount) return null;
    return Number(result.rows[0]?.reports ?? 0);
  });
  if (reports === undefined)
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (reports === null)
    return context.json({ error: "Esa acepción no existe." }, 404);
  return context.json({ ok: true, reports });
});

// ---------- Ítems de ejercicio (Nivel B) ----------
//
// Un ítem por acepción (tabla lexicon_items, migración 006): una
// oración nueva generada por IA más tres definiciones distractoras,
// validada por reglas al insertar (status 'auto_validado'). Sirve
// tanto para «elegir el significado en contexto» como para
// «completar la oración».

// entryId viaja como string de dígitos (int8 > 2^53): las llaves de
// dedupe y las comparaciones internas se hacen con el texto canónico.
type ItemRef = { entryId: string; senseOrder: string };
const MAX_ITEM_REFS = 50;
// Las llamadas a la IA son secuenciales y con timeout de 8 s por
// intento (más reintentos): generar muchas en una sola petición haría
// esperar de más al cliente.
const MAX_ITEMS_GENERATED_PER_CALL = 8;

const toItemRef = (value: unknown): ItemRef | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const entryId = toCatalogId(raw.entryId);
  const senseOrder = toSenseOrder(raw.senseOrder);
  return entryId !== null && senseOrder !== null ? { entryId, senseOrder } : null;
};

const refKey = (ref: ItemRef) => `${ref.entryId}:${ref.senseOrder}`;

type LexiconItemRow = {
  id: string;
  entry_id: string | number;
  sense_order: string | number;
  sentence: string;
  distractors: unknown;
  attempts: string | number;
  correct: string | number;
  definition: string;
};

// Barajado determinista con semilla del id del ítem: la posición de la
// respuesta correcta es estable entre peticiones y dispositivos (mismo
// esquema mulberry32 que la mezcla de opciones del repaso en el
// cliente, src/client/lib/practice.ts).
const seedFromId = (id: string) => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Forma de respuesta: `options` mezcla la definición correcta con los
// distractores y `answerIndex` marca cuál es la buena. Decisión: no
// devolver `distractors` por separado — el cliente ya conoce la
// acepción (la trajo con la ficha) y lo único que necesita del ítem
// es la pregunta lista para mostrar; una sola lista con índice evita
// que la correcta se distinga por posición fija o por un campo aparte.
function toItemResponse(row: LexiconItemRow) {
  const definition = row.definition.trim();
  const distractors = (
    Array.isArray(row.distractors)
      ? row.distractors.filter((d): d is string => typeof d === "string")
      : []
  ).filter((d) => d.trim().toLowerCase() !== definition.toLowerCase());
  const options = shuffleSeeded([definition, ...distractors], seedFromId(row.id));
  return {
    id: row.id,
    entryId: String(row.entry_id),
    senseOrder: Number(row.sense_order),
    sentence: row.sentence,
    options,
    answerIndex: options.indexOf(definition),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
  };
}

const ITEM_SELECT_SQL = `
  SELECT i.id, i.entry_id, i.sense_order, i.sentence, i.distractors,
         i.attempts, i.correct, s.definition
  FROM ${CATALOG}lexicon_items i
  JOIN ${CATALOG}lexicon_senses s
    ON s.entry_id = i.entry_id AND s.sense_order = i.sense_order
`;

app.post("/api/lexicon/items", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const rawRefs: unknown[] = Array.isArray(body?.refs) ? body.refs : [];
  const refs = [
    ...new Map(
      rawRefs
        .map(toItemRef)
        .filter((ref): ref is ItemRef => ref !== null)
        .map((ref) => [refKey(ref), ref] as const),
    ).values(),
  ].slice(0, MAX_ITEM_REFS);
  if (!refs.length) return context.json({ error: "Faltan las acepciones." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const items: ReturnType<typeof toItemResponse>[] = [];
  try {
    // Una sola conexión para leer: los ítems existentes (son del
    // catálogo compartido, no por cuenta) y los sentidos de los refs
    // que falten por generar.
    const catalog = await withClient(context.env, async (client) => {
      const existing = await client.query<LexiconItemRow>(
        `${ITEM_SELECT_SQL}
         JOIN (
           SELECT (j.value ->> 'entryId')::int8 AS entry_id,
                  (j.value ->> 'senseOrder')::int4 AS sense_order
           FROM jsonb_array_elements($1::jsonb) AS j(value)
         ) r ON r.entry_id = i.entry_id AND r.sense_order = i.sense_order
         WHERE i.status <> 'rechazado'`,
        [JSON.stringify(refs)],
      );
      const found = new Set(
        existing.rows.map((row) =>
          refKey({ entryId: String(row.entry_id), senseOrder: String(row.sense_order) }),
        ),
      );
      const missing = refs.filter((ref) => !found.has(refKey(ref)));
      const senses = missing.length
        ? await client.query<{
            entry_id: string | number;
            sense_order: string | number;
            lemma: string;
            pos: string | null;
            language?: string;
            definition: string;
          }>(
            `SELECT r.entry_id, r.sense_order, e.lemma, e.pos, e.language, s.definition
             FROM (
               SELECT (j.value ->> 'entryId')::int8 AS entry_id,
                      (j.value ->> 'senseOrder')::int4 AS sense_order
               FROM jsonb_array_elements($1::jsonb) AS j(value)
             ) r
             JOIN ${CATALOG}lexicon_senses s
               ON s.entry_id = r.entry_id AND s.sense_order = r.sense_order
             JOIN ${CATALOG}lexicon_entries e ON e.id = s.entry_id`,
            [JSON.stringify(missing)],
          )
        : { rows: [] };
      return { existing: existing.rows, missing, senses: senses.rows };
    }, true);
    if (catalog === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);

    for (const row of catalog.existing) items.push(toItemResponse(row));
    const senseByRef = new Map(
      catalog.senses.map((row) => [
        refKey({ entryId: String(row.entry_id), senseOrder: String(row.sense_order) }),
        row,
      ]),
    );

    // Generación: una unidad de cuota por ítem intentado (como en
    // enrich, que cobra antes de llamar a la IA). Si la cuota se
    // agota a media tanda se devuelve lo ya reunido, sin error.
    for (const ref of catalog.missing.slice(0, MAX_ITEMS_GENERATED_PER_CALL)) {
      const sense = senseByRef.get(refKey(ref));
      if (!sense) continue;
      const allowed = await consumeRateUnits(
        context.env,
        session.user.id,
        1,
        ITEM_UNITS_PER_HOUR,
        "item",
      );
      if (!allowed) break;
      const ai = await callDeepSeek(context.env, {
        system: buildItemSystemPrompt(sense.language ?? "es", "es"),
        user: buildItemPrompt(sense.lemma, sense.pos, sense.definition),
      }, ITEM_CALL_OPTIONS);
      const parsed =
        ai.ok && ai.finishReason !== "length" ? parseItem(ai.content) : null;
      logAiCall(
        ITEM_CALL_OPTIONS,
        ai,
        !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
      );
      if (!ai.ok) continue;
      if (!parsed) continue;
      const row = await withClient(context.env, async (client) => {
        const inserted = await client.query<LexiconItemRow>(
          `INSERT INTO ${CATALOG}lexicon_items
             (id, entry_id, sense_order, sentence, distractors, status,
              model_version, prompt_version, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'auto_validado', $6, $7, $8)
           ON CONFLICT (entry_id, sense_order) DO NOTHING
           RETURNING id, entry_id, sense_order, sentence, distractors, attempts, correct`,
          [
            crypto.randomUUID(),
            ref.entryId,
            ref.senseOrder,
            parsed.sentence,
            JSON.stringify(parsed.distractors),
            ENRICHMENT_MODEL,
            ITEM_CALL_OPTIONS.promptVersion,
            Date.now(),
          ],
        );
        if (inserted.rows[0])
          return { ...inserted.rows[0], definition: sense.definition };
        // Carrera: otra petición generó el mismo ítem; se sirve el que
        // quedó insertado (si no está rechazado).
        const raced = await client.query<LexiconItemRow>(
          `${ITEM_SELECT_SQL}
           WHERE i.entry_id = $1 AND i.sense_order = $2 AND i.status <> 'rechazado'`,
          [ref.entryId, ref.senseOrder],
        );
        return raced.rows[0] ?? null;
      });
      if (row) items.push(toItemResponse(row));
    }
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }
  return context.json({ items });
});

// Registro de intentos del ejercicio: sube attempts siempre y correct
// solo cuando el cliente reporta acierto.
app.post("/api/lexicon/items/answer", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const correct = body?.correct;
  if (!id || id.length > 64 || typeof correct !== "boolean")
    return context.json({ error: "Falta la respuesta." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const updated = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE ${CATALOG}lexicon_items
       SET attempts = attempts + 1, correct = correct + $2
       WHERE id = $1`,
      [id, correct ? 1 : 0],
    );
    return result.rowCount ?? 0;
  });
  if (updated === undefined)
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (!updated) return context.json({ error: "Ese ejercicio no existe." }, 404);
  return context.json({ ok: true });
});

// Corrección IA de la oración que el usuario escribe con una palabra
// (ejercicio «write»). Privacidad: solo viajan la forma, el sentido
// esperado y el texto propio del usuario — nunca el contexto del libro
// ni identificadores de ficha o cuenta (la sesión solo gobierna cuota).
app.post("/api/lexicon/verify-sentence", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const meaning = typeof body?.meaning === "string" ? body.meaning.trim() : "";
  const sentence = typeof body?.sentence === "string" ? body.sentence.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  if (!form || form.length > 100 || !meaning || meaning.length > 500 || !sentence || sentence.length > 300)
    return context.json({ error: "Falta la oración o la palabra." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    VERIFY_UNITS_PER_HOUR,
    "verify",
  );
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de correcciones por hora. Intenta más tarde." },
      429,
    );

  const ai = await callDeepSeek(context.env, {
    system: buildVerifySystemPrompt(language, nativeLanguage),
    user: buildVerifyPrompt(form, meaning, sentence, language),
  }, VERIFY_CALL_OPTIONS);
  const parsed =
    ai.ok && ai.finishReason !== "length" ? parseVerify(ai.content) : null;
  logAiCall(
    VERIFY_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!ai.ok)
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "La corrección no está configurada."
            : "La IA no pudo revisar la oración.",
      },
      ai.reason === "not-configured" ? 503 : 502,
    );
  if (!parsed)
    return context.json({ error: "La IA no devolvió una corrección válida." }, 502);
  return context.json({ correct: parsed.correct, feedback: parsed.feedback });
});

// Explicación puntual del sentido de una palabra en la oración que el
// usuario está leyendo (botón «Explicar en esta oración» de la ficha).
// A diferencia de enrich: no escribe al catálogo ni compone fichas —
// el diccionario sigue siendo la respuesta gratuita; esto es el extra
// opcional. Privacidad: viajan solo la forma y la oración.
//
// Caché por aislante: un toque repetido a la misma palabra en la misma
// oración no vuelve a llamar a la IA ni gasta cuota del usuario. TTL
// y tope acotados; el dato es regenerable, así que perderlo al rotar
// el aislante no tiene costo.
const explainCache = createTtlCache<string>({ maxEntries: 200 });

app.post("/api/lexicon/explain", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.trim() : "";
  if (!form || form.length > 100 || !contextText || contextText.length > 500)
    return context.json({ error: "Faltan la palabra o la oración." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para pedir explicaciones." }, 401);

  const cacheKey = `${language}:${nativeLanguage}:${form.toLowerCase()}:${contextText}`;
  const shaKey = await computeAiCacheKey("word_context", `${language}:${nativeLanguage}:${form}:${contextText}`);
  const cached = getCachedAiText(shaKey) ?? explainCache.get(cacheKey);
  if (cached) return context.json({ explanation: cached, cached: true });

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de explicaciones por hora. Intenta más tarde." },
      429,
    );

  const budget = AI_TASK_BUDGETS.word_context;

  const ai = await callDeepSeek(
    context.env,
    {
      system: buildExplainSystemPrompt(language, nativeLanguage),
      user: buildExplainPrompt(form, language, contextText, nativeLanguage),
    },
    {
      ...EXPLAIN_CALL_OPTIONS,
      maxTokens: budget.maxOutputTokens,
      temperature: budget.temperature,
    },
  );
  const parsed =
    ai.ok && ai.finishReason !== "length" ? parseExplain(ai.content) : null;
  logAiCall(
    EXPLAIN_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!ai.ok) {
    // Degradación limpia: si la IA no responde y el catálogo tiene la
    // palabra, se sirve su definición general marcada como degradada.
    const entries = await withClient(context.env, (client) =>
      findEntries(client, language, form),
    true).catch(() => undefined);
    const definition = entries
      ?.flatMap((entry) => entry.senses)
      .find((sense) => sense.definition)?.definition;
    if (definition)
      return context.json({ explanation: definition, degraded: true });
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Las explicaciones con IA no están configuradas."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo explicar la palabra.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }
  if (!parsed)
    return context.json({ error: "La IA no devolvió una explicación válida." }, 502);
  explainCache.set(cacheKey, parsed.explanation);
  setCachedAiText(shaKey, parsed.explanation);
  return context.json({ explanation: parsed.explanation });
});

// ---------- El Reto del Escritor y Cuento de Tinta IA ----------
const evaluateCache = createTtlCache<EvaluatedSentence>({ maxEntries: 150, ttlMs: 15 * 60_000 });
const storyCache = createTtlCache<MicroStory>({ maxEntries: 100, ttlMs: 30 * 60_000 });

app.post("/api/ai/evaluate-sentence", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const word = typeof body?.word === "string" ? body.word.trim() : "";
  const targetSense = typeof body?.targetSense === "string" ? body.targetSense.trim() : "";
  const userSentence = typeof body?.userSentence === "string" ? body.userSentence.trim() : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;

  if (!word || !targetSense || !userSentence) {
    return context.json({ error: "Faltan la palabra, la acepción o la oración del usuario." }, 400);
  }
  if (userSentence.length > 400) {
    return context.json({ error: "La oración no puede superar 400 caracteres." }, 400);
  }

  const cacheKey = `${word.toLowerCase()}::${targetSense.toLowerCase()}::${userSentence.toLowerCase()}`;
  const cached = evaluateCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = context.get("session");
  if (!session) {
    return context.json({ error: "Inicia sesión para evaluar oraciones con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EVALUATE_UNITS_PER_HOUR,
    "evaluate",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de evaluaciones por hora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: EVALUATE_SYSTEM_PROMPT,
      user: buildEvaluatePrompt(word, targetSense, userSentence, bookTitle),
    },
    EVALUATE_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseEvaluateSentence(ai.content) : null;
  logAiCall(
    EVALUATE_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "La evaluación de frases con IA no está configurada."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo evaluar la oración.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    return context.json({ error: "La IA no devolvió una evaluación válida." }, 502);
  }

  evaluateCache.set(cacheKey, parsed);
  return context.json(parsed);
});

app.post("/api/ai/micro-story", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const wordsRaw = Array.isArray(body?.words) ? body.words : [];
  const styleHint = typeof body?.styleHint === "string" ? body.styleHint.trim().slice(0, 100) : undefined;

  const words: Array<{ word: string; meaning?: string }> = wordsRaw
    .filter(
      (w: unknown): w is Record<string, unknown> =>
        typeof w === "object" && w !== null && typeof (w as Record<string, unknown>).word === "string",
    )
    .map((w: Record<string, unknown>) => ({
      word: String(w.word).trim(),
      meaning: typeof w.meaning === "string" ? String(w.meaning).trim() : undefined,
    }))
    .filter((w: { word: string; meaning?: string }) => Boolean(w.word))
    .slice(0, 4);

  if (!words.length) {
    return context.json({ error: "Debes proporcionar al menos una palabra para el micro-relato." }, 400);
  }

  const cacheKey = words.map((w: { word: string }) => w.word.toLowerCase()).sort().join(",") + (styleHint ? `:${styleHint}` : "");
  const cached = storyCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = context.get("session");
  if (!session) {
    return context.json({ error: "Inicia sesión para generar micro-relatos con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    STORY_UNITS_PER_HOUR,
    "story",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de micro-relatos por hora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: STORY_SYSTEM_PROMPT,
      user: buildStoryPrompt(words, styleHint),
    },
    STORY_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseMicroStory(ai.content) : null;
  logAiCall(
    STORY_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Los micro-relatos con IA no están configurados."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo tejer el micro-relato.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    return context.json({ error: "La IA no devolvió un micro-relato estructurado correctamente." }, 502);
  }

  storyCache.set(cacheKey, parsed);
  return context.json(parsed);
});

// ---------- Explicación literaria en pasaje (B.3.3 & B.4) ----------
export interface ExplainInPassageResponse extends PassageExplanation {
  dictionary: {
    word: string | null;
    lemma: string | null;
    definition: string | null;
  } | null;
  dictionaryEntry: {
    word: string | null;
    lemma: string | null;
    definition: string | null;
  } | null;
  contextualNuance: string;
  cached?: boolean;
}

// Cortesía de IA free (5 al mes, free-courtesy.ts): se descuenta DENTRO del
// handler, solo cuando de verdad se va a llamar a la IA (tras el caché), y se
// devuelve si la IA falla. Lecta+/fundador no consumen nada.
const COURTESY_EXHAUSTED = {
  error: "Agotaste tus consultas de IA gratuitas de este mes. Lecta+ las desbloquea.",
  code: LECTA_PLUS_REQUIRED,
} as const;

type CourtesyGuard =
  | { deny: { body: Record<string, string>; status: 402 | 503 } }
  | { deny?: undefined; refund: () => Promise<void> };

async function guardAiCourtesy(
  env: WorkerEnv,
  userId: string,
  lectaPlus: boolean,
): Promise<CourtesyGuard> {
  if (lectaPlus) return { refund: async () => undefined };
  let ok: boolean;
  try {
    ok = await consumeFreeAiCourtesy(env, userId);
  } catch {
    return { deny: { body: { error: "Servicio temporalmente no disponible" }, status: 503 } };
  }
  if (!ok) return { deny: { body: { ...COURTESY_EXHAUSTED }, status: 402 } };
  return { refund: () => refundFreeAiCourtesy(env, userId) };
}

const explainPassageCache = createTtlCache<ExplainInPassageResponse>({
  maxEntries: 200,
  ttlMs: 15 * 60_000,
});

export function clearExplainPassageCache(): void {
  explainPassageCache.clear();
}

app.post("/api/ai/explain-in-passage", requireSessionWithPlan, async (context) => {
  const body = await context.req.json().catch(() => null);
  const word = typeof body?.word === "string" ? body.word.trim().slice(0, 100) : undefined;
  const sentence =
    typeof body?.sentence === "string" && body.sentence.trim()
      ? body.sentence.trim()
      : typeof body?.passage === "string"
        ? body.passage.trim()
        : "";
  const lemma = typeof body?.lemma === "string" ? body.lemma.trim().slice(0, 100) : undefined;
  const localDefinition =
    typeof body?.localDefinition === "string" ? body.localDefinition.trim().slice(0, 500) : undefined;
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const author = typeof body?.author === "string" ? body.author.trim().slice(0, 100) : undefined;
  const language = typeof body?.language === "string" ? body.language.trim().slice(0, 10) : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim().slice(0, 10) : "es";

  if (!sentence) {
    return context.json({ error: "Falta el pasaje u oración a explicar." }, 400);
  }
  if (sentence.length > 800) {
    return context.json({ error: "El pasaje no puede superar 800 caracteres." }, 400);
  }

  // El prompt compacto (sólo matiz, sin significado) aplica únicamente
  // cuando el lector ya tiene visible la definición de diccionario: sin
  // localDefinition la IA debe devolver también el significado directo.
  const isCompact = Boolean(word && localDefinition);
  // Fix de Caché: (lemma || word || 'passage').toLowerCase().trim() + ':' + normalizePassage(passage)
  // La variante entra en la clave: una respuesta compacta (sin
  // directMeaning) nunca se sirve a una petición completa con los
  // mismos datos.
  const keyWord = (lemma || word || "passage").toLowerCase().trim();
  const normalizedPass = normalizePassage(sentence);
  // La variante completa también depende de idioma, lengua materna, libro y
  // autor (entran al prompt): sin ellos dos lectores con otra lengua materna
  // recibirían la misma respuesta. El prompt compacto sólo usa palabra,
  // definición y pasaje.
  const cacheKey = isCompact
    ? `c:${keyWord}:${normalizedPass}`
    : `f:${keyWord}:${normalizedPass}:${JSON.stringify([language, nativeLanguage, bookTitle ?? "", author ?? ""])}`;

  const cached = explainPassageCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = context.get("session");
  if (!session) {
    return context.json({ error: "Inicia sesión para pedir explicaciones literarias con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de explicaciones por hora. Intenta más tarde." },
      429,
    );
  }

  const courtesy = await guardAiCourtesy(context.env, session.user.id, context.get("lectaPlus"));
  if (courtesy.deny) return context.json(courtesy.deny.body, courtesy.deny.status);

  const systemPrompt = isCompact
    ? buildCompactExplainPrompt({
        word: word!,
        localDefinition,
        passage: sentence,
      })
    : EXPLAIN_PASSAGE_SYSTEM_PROMPT;

  const userPrompt = isCompact
    ? `Palabra: «${word}». Pasaje: «${sentence}»`
    : buildExplainInPassagePrompt({
        word,
        sentence,
        lemma,
        localDefinition,
        bookTitle,
        author,
        language,
        nativeLanguage,
      });

  const callOptions = isCompact
    ? EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS
    : EXPLAIN_PASSAGE_CALL_OPTIONS;

  const ai = await callDeepSeek(
    context.env,
    {
      system: systemPrompt,
      user: userPrompt,
    },
    callOptions,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parsePassageExplanation(ai.content) : null;
  logAiCall(
    callOptions,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    await courtesy.refund();
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Las explicaciones con IA no están configuradas."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo explicar el pasaje.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    await courtesy.refund();
    return context.json({ error: "La IA no devolvió una explicación estructurada correctamente." }, 502);
  }

  const dictionary = word || localDefinition
    ? {
        word: word ?? null,
        lemma: lemma ?? word ?? null,
        definition: localDefinition ?? null,
      }
    : null;

  const resultPayload: ExplainInPassageResponse = {
    ...parsed,
    dictionary,
    dictionaryEntry: dictionary,
    contextualNuance: parsed.contextualMeaning,
  };

  explainPassageCache.set(cacheKey, resultPayload);
  return context.json(resultPayload);
});

const companionNoteCache = createTtlCache<string>({ maxEntries: 100, ttlMs: 20 * 60_000 });

app.post("/api/ai/companion-note", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const catName = typeof body?.catName === "string" ? body.catName.trim().slice(0, 50) : "Michi";
  const achievement = typeof body?.achievement === "string" ? body.achievement.trim().slice(0, 100) : undefined;
  const rankName = typeof body?.rankName === "string" ? body.rankName.trim().slice(0, 100) : undefined;
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const masteredWord = typeof body?.masteredWord === "string" ? body.masteredWord.trim().slice(0, 100) : undefined;

  const session = context.get("session");
  if (!session?.user?.id) {
    return context.json({ error: "Inicia sesión para recibir cartas del compañero." }, 401);
  }

  const fallback = () =>
    context.json({
      title: "¡Felicidades por tu lectura, amigo!",
      note: `¡Qué gran paso diste hoy con tu lectura! Me encanta ver cómo sigues enriqueciendo tus libros día a día.`,
      signOff: `Con cariño, ${catName} 🐾`,
      fallback: true,
    });

  // La nota depende de la cuenta y del contexto exacto: misma entrada,
  // misma carta. El userId evita reutilizar una nota personalizada de
  // otra cuenta y la cuota solo se gasta cuando de verdad hay llamada.
  const cacheKey = await computeAiCacheKey(
    "companion_note",
    [session.user.id, catName, achievement ?? "", rankName ?? "", bookTitle ?? "", masteredWord ?? ""].join("::"),
  );
  const cached =
    getCachedAiText(cacheKey) ??
    companionNoteCache.get(cacheKey);
  const cachedNote = cached ? parseCompanionNote(cached) : null;
  if (cachedNote) return context.json({ ...cachedNote, cached: true });

  if (!context.env.DEEPSEEK_API_KEY) return fallback();

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    COMPANION_NOTE_UNITS_PER_HOUR,
    "companion-note",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de cartas del compañero por ahora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: COMPANION_NOTE_SYSTEM_PROMPT,
      user: buildCompanionNotePrompt({ catName, achievement, rankName, bookTitle, masteredWord }),
    },
    COMPANION_NOTE_CALL_OPTIONS,
  );

  const parsed = ai.ok ? parseCompanionNote(ai.content) : null;
  if (!parsed) return fallback();

  const serialized = JSON.stringify(parsed);
  setCachedAiText(cacheKey, serialized);
  companionNoteCache.set(cacheKey, serialized);
  return context.json(parsed);
});

app.post("/api/ai/page-recap", requireSessionWithPlan, async (context) => {
  const body = await context.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const chapterTitle = typeof body?.chapterTitle === "string" ? body.chapterTitle.trim().slice(0, 150) : undefined;

  if (!text) {
    return context.json({ error: "Se requiere el texto de la página para resumir." }, 400);
  }

  const session = context.get("session");
  if (!session?.user?.id) {
    return context.json({ error: "Inicia sesión para resumir páginas con IA." }, 401);
  }

  const cacheKey = await computeAiCacheKey("page_recap", `${bookTitle ?? ""}::${chapterTitle ?? ""}::${text}`);
  const cached = getCachedAiText(cacheKey);
  if (cached) {
    try {
      return context.json({ ...JSON.parse(cached), cached: true });
    } catch {
      // Ignorar caché inválido y recomputar
    }
  }

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json(deterministicPageRecapFallback(text));
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    PAGE_RECAP_UNITS_PER_HOUR,
    "page-recap",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de resúmenes con IA por ahora. Intenta más tarde." },
      429,
    );
  }

  const courtesy = await guardAiCourtesy(context.env, session.user.id, context.get("lectaPlus"));
  if (courtesy.deny) return context.json(courtesy.deny.body, courtesy.deny.status);

  const budget = AI_TASK_BUDGETS.page_recap;
  const ai = await callDeepSeek(
    context.env,
    {
      system: PAGE_RECAP_SYSTEM_PROMPT,
      user: buildPageRecapPrompt({ text, bookTitle, chapterTitle }),
    },
    {
      ...PAGE_RECAP_CALL_OPTIONS,
      maxTokens: budget.maxOutputTokens,
      temperature: budget.temperature,
    },
  );

  const parsed = ai.ok ? parsePageRecap(ai.content) : null;
  if (!parsed) {
    await courtesy.refund();
    return context.json(deterministicPageRecapFallback(text));
  }

  const serialized = JSON.stringify(parsed);
  setCachedAiText(cacheKey, serialized);
  return context.json(parsed);
});

app.post("/api/ai/translate", requireSessionWithPlan, async (context) => {
  const body = await context.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const from = typeof body?.from === "string" ? body.from : "en";
  const to = typeof body?.to === "string" ? body.to : "es";

  if (!text) {
    return context.json({ error: "Se requiere texto para traducir." }, 400);
  }

  const session = context.get("session");
  if (!session?.user?.id) {
    return context.json({ error: "Inicia sesión para traducir párrafos con IA." }, 401);
  }

  const cacheKey = await computeAiCacheKey("paragraph_translate", `${from}:${to}:${text}`);
  const cached = getCachedAiText(cacheKey);
  if (cached) {
    return context.json({ translation: cached, cached: true });
  }

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json({ translation: text });
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    TRANSLATE_UNITS_PER_HOUR,
    "translate",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de traducciones con IA por ahora. Intenta más tarde." },
      429,
    );
  }

  const courtesy = await guardAiCourtesy(context.env, session.user.id, context.get("lectaPlus"));
  if (courtesy.deny) return context.json(courtesy.deny.body, courtesy.deny.status);

  const { prompt, budget } = buildParagraphTranslationPrompt(text);

  const ai = await callDeepSeek(
    context.env,
    {
      system: `Eres un traductor literario bilingüe de ${from} a ${to}. Traduce el siguiente párrafo con fluidez, elegancia y fidelidad literaria. Devuelve ÚNICAMENTE la traducción directa, sin notas ni explicaciones.`,
      user: prompt,
    },
    {
      operation: "explain_passage",
      promptVersion: "bilingual_v1",
      maxTokens: budget.maxOutputTokens,
      temperature: budget.temperature,
    },
  );

  const translation = ai.ok && ai.content ? ai.content.trim() : text;
  if (ai.ok && ai.content) {
    setCachedAiText(cacheKey, translation);
  } else {
    await courtesy.refund();
  }
  return context.json({ translation });
});

const characterRecapCache = createTtlCache<CharacterRecapResponse>({
  maxEntries: 200,
  ttlMs: 20 * 60_000,
});

app.post("/api/ai/character-recap", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const entityName = typeof body?.entityName === "string" ? body.entityName.trim().slice(0, 100) : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const currentChapterTitle = typeof body?.currentChapterTitle === "string" ? body.currentChapterTitle.trim().slice(0, 150) : undefined;
  const excerptsRaw: unknown[] = Array.isArray(body?.excerptsSoFar) ? body.excerptsSoFar : [];
  const excerptsSoFar = excerptsRaw
    .filter((e: unknown): e is string => typeof e === "string" && Boolean(e.trim()))
    .map((e: string) => e.trim().slice(0, 300))
    .slice(0, 6);

  if (!entityName) {
    return context.json({ error: "Se requiere el nombre del personaje o lugar." }, 400);
  }

  const cacheKey = `${entityName.toLowerCase()}::${(bookTitle ?? "").toLowerCase()}::${excerptsSoFar.join("|").toLowerCase()}`;
  const shaKey = await computeAiCacheKey("character_cards", `${entityName}::${bookTitle ?? ""}::${excerptsSoFar.join("|")}`);
  const cachedSha = getCachedAiText(shaKey);
  if (cachedSha) {
    try {
      return context.json({ ...JSON.parse(cachedSha), cached: true });
    } catch {
      // Ignorar caché inválido y recomputar
    }
  }
  const cached = characterRecapCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const session = context.get("session");
  if (!session) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const budget = AI_TASK_BUDGETS.character_cards;
  const ai = await callDeepSeek(
    context.env,
    {
      system: CHARACTER_RECAP_SYSTEM_PROMPT,
      user: buildCharacterRecapPrompt({ entityName, bookTitle, currentChapterTitle, excerptsSoFar }),
    },
    {
      ...CHARACTER_RECAP_CALL_OPTIONS,
      maxTokens: budget.maxOutputTokens,
      temperature: budget.temperature,
    },
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseCharacterRecap(ai.content) : null;
  logAiCall(
    CHARACTER_RECAP_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok || !parsed) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  characterRecapCache.set(cacheKey, parsed);
  const serialized = JSON.stringify(parsed);
  setCachedAiText(shaKey, serialized);
  return context.json(parsed);
});

// Presupuestos por hora y por alcance: cada función IA gasta de su
// propia bolsa (columna scope de lecta_rate_log), así una tanda de
// ítems o de correcciones no consume la cuota de enriquecimiento.
const ITEM_UNITS_PER_HOUR = 24;
const VERIFY_UNITS_PER_HOUR = 30;
const EXPLAIN_UNITS_PER_HOUR = 30;
const EVALUATE_UNITS_PER_HOUR = 40;
const STORY_UNITS_PER_HOUR = 20;
const PAGE_RECAP_UNITS_PER_HOUR = 40;
const TRANSLATE_UNITS_PER_HOUR = 60;
const COMPANION_NOTE_UNITS_PER_HOUR = 12;

export const MAX_USER_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB por cuenta
export const MAX_USER_BOOKS = 100;

export async function checkUserBooksQuota(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  newFileBytes: number,
): Promise<{ allowed: boolean; reason?: string }> {
  let totalBytes = 0;
  let bookCount = 0;

  if (getConnectionString(env)) {
    const res = await withClient(env, (client) =>
      client.query<{ total_bytes: string | number; book_count: string | number }>(
        `SELECT
           COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes,
           COUNT(*)::int AS book_count
         FROM user_books
         WHERE user_id = $1 AND book_id != $2`,
        [userId, bookId],
      ),
    );
    if (res?.rows[0]) {
      totalBytes = Number(res.rows[0].total_bytes);
      bookCount = Number(res.rows[0].book_count);
    }
  }

  if (bookCount >= MAX_USER_BOOKS) {
    return { allowed: false, reason: "Storage quota exceeded: maximum books limit reached (100)" };
  }
  if (totalBytes + newFileBytes > MAX_USER_STORAGE_BYTES) {
    return { allowed: false, reason: "Storage quota exceeded for this account" };
  }

  return { allowed: true };
}

export async function recordUserBook(
  env: WorkerEnv,
  book: {
    userId: string;
    bookId: string;
    title: string;
    author: string;
    language?: string;
    // Género editorial (BOOK_GENRES); "" = sin clasificar. En conflicto
    // solo pisa si trae valor: la elección manual del lector al
    // compartir sobrevive a una resubida sin género.
    genre?: string;
    r2Key: string;
    sizeBytes: number;
    sha256: string;
    hasCover?: boolean;
    // Marca de reinicio que el cliente declara; definida, la fila se
    // escribe dentro de la transacción guardada (StaleResetError si un
    // reinicio remoto la invalida).
    resetAck?: number;
  },
): Promise<void> {
  const now = Date.now();
  const hasCoverVal = book.hasCover ? true : false;
  if (getConnectionString(env)) {
    // Tolera la columna `language` ausente (despliegue antes de la
    // migración 022): el error se traga y la fila no se registra, como
    // cuando falta la conexión.
    // Con resetAck la fila corre dentro de la transacción guardada: un
    // sello más nuevo aborta con StaleResetError en vez de resucitar.
    // Dos variantes: con `genre` (migración 025 aplicada) y sin ella
    // (worker desplegado antes de migrar) — el género es metadato
    // complementario y jamás debe tirar la fila del libro.
    const sqlBase = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           updated_at = EXCLUDED.updated_at`;
    const sqlGenre = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, genre, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           genre = CASE WHEN EXCLUDED.genre <> '' THEN EXCLUDED.genre ELSE user_books.genre END,
           updated_at = EXCLUDED.updated_at`;
    // Tercera variante (027): la subida deja el archivo en R2, así que la
    // fila pasa a has_file = true aunque antes fuera solo de metadatos.
    const sqlGenreFile = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, genre, has_file, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           genre = CASE WHEN EXCLUDED.genre <> '' THEN EXCLUDED.genre ELSE user_books.genre END,
           has_file = EXCLUDED.has_file,
           updated_at = EXCLUDED.updated_at`;
    const baseParams = [
      book.userId,
      book.bookId,
      book.title,
      book.author,
      book.language ?? "",
      book.r2Key,
      book.sizeBytes,
      book.sha256,
      hasCoverVal,
      now,
      now,
    ];
    const genreParams = [...baseParams.slice(0, 9), book.genre ?? "", ...baseParams.slice(9)];
    // Cadena ante 42703: genre + has_file → genre → base.
    const insert = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client
        .query(sqlGenreFile, genreParams)
        .catch((err: unknown) =>
          isMissingColumnError(err)
            ? client.query(sqlGenre, genreParams)
            : Promise.reject(err),
        )
        .catch((err: unknown) =>
          isMissingColumnError(err)
            ? client.query(sqlBase, baseParams)
            : Promise.reject(err),
        );
    const res = await (book.resetAck === undefined
      ? withClient(env, insert)
      : withResetGuard(env, book.resetAck, book.userId, insert)
    ).catch((err: unknown) => {
      if (err instanceof StaleResetError) throw err;
      return undefined;
    });
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

export async function setUserBookCover(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  hasCover: boolean,
  resetAck?: number,
): Promise<void> {
  const now = Date.now();
  if (getConnectionString(env)) {
    const update = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client.query(
        `UPDATE user_books SET has_cover = $1, updated_at = $2 WHERE user_id = $3 AND book_id = $4`,
        [hasCover, now, userId, bookId],
      );
    const res = await (resetAck === undefined
      ? withClient(env, update)
      : withResetGuard(env, resetAck, userId, update)
    ).catch((err: unknown) => {
      if (err instanceof StaleResetError) throw err;
      return undefined;
    });
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

export async function deleteUserBookRecord(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  resetAck?: number,
): Promise<void> {
  if (getConnectionString(env)) {
    const remove = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client.query(`DELETE FROM user_books WHERE user_id = $1 AND book_id = $2`, [userId, bookId]);
    const res = await (resetAck === undefined
      ? withClient(env, remove)
      : withResetGuard(env, resetAck, userId, remove));
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

const bookKey = (userId: string, hash: string) => `books/${userId}/${hash}.epub`;
const bookCoverKey = (userId: string, hash: string) => `covers/${userId}/${hash}.jpg`;
// Guías de papel comunitarias (modelo A1): un solo objeto por sha256,
// fuera del espacio `books/` de cualquier usuario — jamás contiene el
// EPUB, solo el índice de capítulos y sus listas de palabras.
const guideKey = (hash: string) => `guides/${hash}.json`;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

app.get("/api/books", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const listed = await booksBucket.list({ prefix: `books/${session.user.id}/` });

  const books = listed.objects.map((object) => {
    const hash = object.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
    const rawTitle = object.customMetadata?.title ?? "";
    const cleanTitle = isHashLikeIdentifier(rawTitle) ? "" : rawTitle;
    const author = object.customMetadata?.author ?? "";
    const name = object.customMetadata?.name ?? "";
    const sections = Number(object.customMetadata?.sections) || 0;
    const language = object.customMetadata?.language ?? "";
    const hasCover = object.customMetadata?.hasCover === "true";
    const repairAttemptedAt = object.customMetadata?.repairAttemptedAt;

    return {
      hash,
      uploaded: object.uploaded,
      name: name && !isHashLikeIdentifier(name) ? name : (cleanTitle ? `${cleanTitle}.epub` : ""),
      title: cleanTitle,
      author,
      sections,
      language,
      hasCover,
      repairAttemptedAt,
    };
  });

  // Flags por cuenta que viven en la fila `user_books` (el customMetadata
  // de R2 no se actualiza sin resubir): `shared` marca libros ofrecidos
  // a la comunidad y `paper_only` las copias comunitarias que solo abren
  // el modo papel. Columnas 024 ausentes → mapa vacío, nada cambia.
  try {
    // Una sola consulta a user_books para flags, guías paper_only, filas de
    // la era user-books/ y libros solo-metadatos (antes eran cuatro).
    const summary = await listUserBooksSummary(context.env, session.user.id);
    const flags = new Map<string, BookFlags>();
    for (const row of summary) {
      flags.set(String(row.book_id), {
        shared: row.shared === true || row.shared === 1,
        paperOnly: row.paper_only === true || row.paper_only === 1,
        genre: String(row.genre ?? ""),
      });
    }
    for (const book of books) {
      const flag = flags.get(book.hash);
      if (flag?.shared) (book as { shared?: boolean }).shared = true;
      if (flag?.paperOnly) (book as { paperOnly?: boolean }).paperOnly = true;
      if (flag?.genre) (book as { genre?: string }).genre = flag.genre;
    }
    // Las entradas paper_only son guías (modelo A1): no hay objeto EPUB
    // en `books/{userId}/`, así que la lista de R2 no las trae. Se
    // agregan desde la fila para que la estantería las vea remotas.
    const listed = new Set(books.map((book) => book.hash));
    for (const row of summary.filter((r) => r.paper_only === true || r.paper_only === 1)) {
      if (listed.has(row.book_id)) continue;
      books.push({
        hash: row.book_id,
        uploaded: new Date(Number(row.created_at) || Date.now()),
        name: row.title ? `${row.title}.epub` : "",
        title: row.title,
        author: row.author,
        sections: 0,
        language: row.language,
        hasCover: false,
        repairAttemptedAt: undefined,
        paperOnly: true,
      } as (typeof books)[number]);
      listed.add(row.book_id);
    }
    // Era `user-books/` (sync BYO-EPUB anterior): esas filas apuntan
    // fuera del prefijo books/{userId}/ y la lista de R2 no las trae.
    // Sin ellas la estantería se ve vacía aunque la cuenta tenga libros.
    for (const row of summary.filter(
      (r) => !String(r.r2_key ?? "").startsWith("books/") && r.has_file !== false,
    )) {
      if (listed.has(row.book_id)) continue;
      if (flags.get(row.book_id)?.paperOnly) continue;
      const title = isHashLikeIdentifier(row.title) ? "" : row.title;
      books.push({
        hash: row.book_id,
        uploaded: new Date(Number(row.updated_at) || Date.now()),
        name: title ? `${title}.epub` : "",
        title,
        author: row.author,
        sections: 0,
        language: row.language,
        hasCover: false,
        repairAttemptedAt: undefined,
        shared: flags.get(row.book_id)?.shared || undefined,
        genre: flags.get(row.book_id)?.genre || undefined,
      } as (typeof books)[number]);
      listed.add(row.book_id);
    }
    // 027: libros propios de cuentas free (solo metadatos). Se listan con
    // hasFile: false para que el cliente pida adjuntar el archivo.
    for (const row of summary.filter((r) => r.has_file === false)) {
      if (listed.has(row.book_id)) continue;
      const title = isHashLikeIdentifier(row.title) ? "" : row.title;
      books.push({
        hash: row.book_id,
        uploaded: new Date(Number(row.created_at) || Date.now()),
        name: title ? `${title}.epub` : "",
        title,
        author: row.author,
        sections: 0,
        language: row.language,
        hasCover: false,
        repairAttemptedAt: undefined,
        hasFile: false,
      } as (typeof books)[number]);
      listed.add(row.book_id);
    }
  } catch {
    // La lista de libros no depende de la comunidad.
  }

  const repairObjs = listed.objects
    .filter((object) => {
      const title = object.customMetadata?.title ?? "";
      const repairAttemptedAt = object.customMetadata?.repairAttemptedAt;
      return (!title || isHashLikeIdentifier(title)) && !repairAttemptedAt;
    })
    .slice(0, 5);

  let executionCtx: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
  try {
    executionCtx = context.executionCtx;
  } catch {
    executionCtx = undefined;
  }

  if (repairObjs.length > 0 && executionCtx?.waitUntil) {
    executionCtx.waitUntil(
      Promise.all(
        repairObjs.map(async (repairObj) => {
          try {
            const key = repairObj.key;
            const hash = key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
            const r2Obj = await booksBucket.get(key);
            if (!r2Obj) return;
            const data = new Uint8Array(await r2Obj.arrayBuffer());
            const meta = await extractEpubMeta(data);
            const nowStr = String(Date.now());

            let hasCover = repairObj.customMetadata?.hasCover === "true";
            if (!hasCover) {
              const coverResult = await extractEpubCover(data).catch(() => null);
              if (coverResult && coverResult.data.byteLength <= 300_000) {
                await booksBucket.put(bookCoverKey(session.user.id, hash), coverResult.data, {
                  httpMetadata: { contentType: coverResult.mediaType || "image/jpeg" },
                });
                hasCover = true;
              }
            }

            const repTitle = (meta?.title && !isHashLikeIdentifier(meta.title))
              ? meta.title.slice(0, 200)
              : (repairObj.customMetadata?.title ?? "");
            const repAuthor = (meta?.author ?? repairObj.customMetadata?.author ?? "").slice(0, 200);
            const repSections = meta?.sections ? String(meta.sections) : (repairObj.customMetadata?.sections ?? "");
            const repLang = (meta?.language ?? repairObj.customMetadata?.language ?? "").slice(0, 10);
            const repName = repTitle ? `${repTitle}.epub` : (repairObj.customMetadata?.name ?? "");

            const updatedCustomMetadata: Record<string, string> = {
              ...repairObj.customMetadata,
              repairAttemptedAt: nowStr,
              hasCover: hasCover ? "true" : "false",
            };
            if (repName) updatedCustomMetadata.name = repName;
            if (repTitle) updatedCustomMetadata.title = repTitle;
            if (repAuthor) updatedCustomMetadata.author = repAuthor;
            if (repSections) updatedCustomMetadata.sections = repSections;
            if (repLang) updatedCustomMetadata.language = repLang;

            await booksBucket.put(key, data, {
              httpMetadata: { contentType: "application/epub+zip" },
              customMetadata: updatedCustomMetadata,
            });

            if (repTitle) {
              await recordUserBook(context.env, {
                userId: session.user.id,
                bookId: hash,
                title: repTitle,
                author: repAuthor,
                r2Key: key,
                sizeBytes: data.byteLength,
                sha256: hash,
                hasCover,
                resetAck: readResetAck(context),
              });
            }
          } catch {
            // Ignora fallos silenciosos en segundo plano
          }
        }),
      ),
    );
  }

  return context.json({ books });
});

const handleBookUpload = async (
  context: Context<{ Bindings: WorkerEnv; Variables: PlanVariables }>,
  declaredHash?: string,
) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = context.get("session");
  if (!session) return context.json({ error: "Inicia sesión para guardar libros." }, 401);

  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);

  const data = new Uint8Array(await context.req.arrayBuffer());
  if (!data.byteLength || data.byteLength > EPUB_MAX_BYTES)
    return context.json({ error: "Archivo vacío o demasiado grande (máximo 50 MB)." }, 400);
  if (!checkEpubHeader(data).ok)
    return context.json({ error: "El archivo no es un EPUB válido." }, 400);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  if (declaredHash) {
    if (!HASH_PATTERN.test(declaredHash)) {
      return context.json({ error: "Identificador de libro inválido." }, 400);
    }
    if (hex !== declaredHash) {
      return context.json({ error: "El contenido no coincide con el identificador declarado." }, 400);
    }
  }

  const hash = declaredHash ?? hex;

  // Verificación de cuota por cuenta antes de escribir en R2
  const quota = await checkUserBooksQuota(context.env, session.user.id, hash, data.byteLength);
  if (!quota.allowed) {
    return context.json({ error: quota.reason ?? "Storage quota exceeded for this account" }, 413);
  }

  const meta = context.req.query();
  let title = meta.title?.slice(0, 200) ?? "";
  let author = meta.author?.slice(0, 200) ?? "";
  let sections = /^\d{1,5}$/.test(meta.sections ?? "") ? meta.sections! : "";
  let name = meta.name?.slice(0, 200) ?? "";
  let language = meta.language?.slice(0, 10) ?? "";
  // Género editorial de la lista cerrada BOOK_GENRES; "" = sin clasificar.
  let genre = isBookGenre(meta.genre) ? meta.genre : "";

  if (!title || !language || !genre) {
    const extracted = await extractEpubMeta(data).catch(() => null);
    if (extracted?.title) {
      title = title || extracted.title.slice(0, 200);
      author = author || (extracted.author?.slice(0, 200) ?? "");
      sections = sections || (extracted.sections ? String(extracted.sections) : "");
      name = name || `${title}.epub`;
      language = language || (extracted.language?.slice(0, 10) ?? "");
    }
    genre = genre || genreFromSubjects(extracted?.subjects ?? []);
  }

  let hasCover = false;
  const coverResult = await extractEpubCover(data).catch(() => null);
  if (coverResult && coverResult.data.byteLength <= 300_000) {
    await booksBucket.put(bookCoverKey(session.user.id, hash), coverResult.data, {
      httpMetadata: { contentType: coverResult.mediaType || "image/jpeg" },
    });
    hasCover = true;
  }

  const r2Key = bookKey(session.user.id, hash);
  await booksBucket.put(r2Key, data, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: {
      name,
      title,
      author,
      sections,
      language,
      hasCover: hasCover ? "true" : "false",
    },
  });

  // La fila corre en la transacción guardada: si un reinicio comiteó
  // mientras subía el archivo, no queda ni la fila ni el objeto en R2.
  try {
    await recordUserBook(context.env, {
      userId: session.user.id,
      bookId: hash,
      title: title || name.replace(/\.epub$/i, "") || hash,
      author,
      language,
      genre,
      r2Key,
      sizeBytes: data.byteLength,
      sha256: hash,
      hasCover,
      resetAck: readResetAck(context),
    });
  } catch (err) {
    if (err instanceof StaleResetError) {
      await booksBucket.delete(r2Key).catch(() => undefined);
      if (hasCover)
        await booksBucket.delete(bookCoverKey(session.user.id, hash)).catch(() => undefined);
      return resetBlockedResponse(context, err.resetAt);
    }
    throw err;
  }

  return context.json({ ok: true, hash });
};

app.put("/api/books/:hash", requireLectaPlus, (context) => handleBookUpload(context, context.req.param("hash")));
app.post("/api/books/:hash", requireLectaPlus, (context) => handleBookUpload(context, context.req.param("hash")));
app.post("/api/books", requireLectaPlus, (context) => handleBookUpload(context));

// Catálogo comunitario: una entrada por book_id aunque lo compartan
// varios lectores, ordenado por la primera vez que apareció. Debe
// registrarse ANTES de `/api/books/:hash`: si no, «community» se traga
// como hash y el catálogo nunca responde.
app.get("/api/books/community", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver la comunidad." }, 401);

  // Las copias del propio lector no aparecen: ya las tiene — mostrarlas
  // solo daba un 409 («Ese libro ya es tuyo») al pulsar «Usar en papel».
  // `genre` (migración 025) se pide aparte: sin la columna la consulta
  // base sigue sirviendo el catálogo — solo sale sin género.
  const communitySql = (extraCols: string, placeholder: string) =>
    `SELECT book_id,
       MAX(title) AS title, MAX(author) AS author, MAX(language) AS language,
       MAX(size_bytes) AS size_bytes, BOOL_OR(has_cover) AS has_cover,
       MIN(shared_at) AS shared_at, COUNT(DISTINCT user_id)::int AS sharers${extraCols}
     FROM user_books
     WHERE shared = true AND user_id <> ${placeholder}
     GROUP BY book_id
     ORDER BY shared_at DESC
     LIMIT 200`;
  const sqlPg = communitySql(", MAX(genre) AS genre", "$1");
  const sqlPgBase = communitySql("", "$1");

  const collect = (
    rows: Array<Record<string, unknown>>,
  ) =>
    rows.map((row) => ({
      hash: String(row.book_id),
      title: String(row.title ?? ""),
      author: String(row.author ?? ""),
      language: String(row.language ?? ""),
      sizeBytes: Number(row.size_bytes ?? 0),
      // Modelo A1: las entradas comunitarias son guías de papel — la
      // portada siempre es la tipográfica generada en el cliente.
      hasCover: false,
      sharers: Number(row.sharers ?? 1),
      genre: String(row.genre ?? ""),
    }));

  const finish = async (rows: Array<Record<string, unknown>>) => {
    const books = collect(rows);
    const guides = await publishedGuideHashes(context.env.BOOKS);
    if (!guides) return books;
    return books.filter((book) => guides.has(book.hash));
  };

  if (getConnectionString(context.env)) {
    let res = await withClient(context.env, (client) =>
      client.query(sqlPg, [session.user.id]),
    ).catch((err) => (isMissingColumnError(err) ? null : Promise.reject(err)));
    if (res === null) {
      // Falta `genre` (pre-025): reintenta sin la columna — la comunidad
      // sale sin género en vez de vacía. Si falta `shared` (pre-024)
      // la consulta base también falla y sí devuelve vacío.
      res = await withClient(context.env, (client) =>
        client.query(sqlPgBase, [session.user.id]),
      ).catch((err) => (isMissingColumnError(err) ? null : Promise.reject(err)));
      if (res === null) return context.json({ books: [] });
    }
    return context.json({ books: await finish(res?.rows ?? []) });
  }
  return context.json({ books: [] });
});

app.get("/api/books/:hash", requireLectaPlus, async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = context.get("session");
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  // Defensa del modelo A1: una entrada paper_only no tiene EPUB — la
  // guía es todo lo que existe y se sirve por /:hash/guide. Si la fila
  // lo marca, la descarga del libro se niega aunque alguien hubiera
  // subido un objeto a su llave.
  const flags = await listUserBookFlags(context.env, session.user.id).catch(
    () => new Map(),
  );
  if (flags.get(hash)?.paperOnly)
    return context.json(
      { error: "Esta entrada es una guía de papel, no un libro descargable." },
      403,
    );

  const object = await booksBucket.get(bookKey(session.user.id, hash));
  if (object) {
    return new Response(object.body, {
      headers: { "content-type": "application/epub+zip" },
    });
  }

  // Compatibilidad era `user-books/`: la fila user_books guarda la llave
  // real del archivo; la ruta convencional cubre filas anteriores a ella.
  // Solo se sirven llaves dentro del espacio propio del usuario.
  const r2Key = await readUserBookR2Key(context.env, session.user.id, hash);
  const legacyPrefix = `user-books/${session.user.id}/`;
  const candidates = [r2Key, `${legacyPrefix}${hash}.epub`].filter(
    (key): key is string =>
      typeof key === "string" && key.startsWith(legacyPrefix),
  );
  for (const key of candidates) {
    const fallback = await booksBucket.get(key);
    if (fallback) {
      return new Response(fallback.body, {
        headers: { "content-type": "application/epub+zip" },
      });
    }
  }
  return context.json({ error: "Libro no encontrado." }, 404);
});

// Descarga de la guía de papel: para quien la adjuntó (fila propia) o
// para cualquier lector mientras el libro siga compartido. El objeto
// vive fuera del espacio de usuarios — sirve el JSON tal cual.
app.get("/api/books/:hash/guide", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver guías." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const flags = await listUserBookFlags(context.env, session.user.id).catch(
    () => new Map(),
  );
  const donor = flags.has(hash) ? null : await findCommunityDonor(context.env, hash);
  if (!flags.has(hash) && (!donor || donor === "unavailable"))
    return context.json({ error: "Guía no encontrada." }, 404);

  const object = await booksBucket.get(guideKey(hash));
  if (!object) return context.json({ error: "Guía no encontrada." }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=86400, immutable",
    },
  });
});

app.delete("/api/books/:hash", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para borrar libros." }, 401);

  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  await booksBucket.delete(bookKey(session.user.id, hash));
  await booksBucket.delete(bookCoverKey(session.user.id, hash));
  try {
    await deleteUserBookRecord(context.env, session.user.id, hash, readResetAck(context));
  } catch (err) {
    if (err instanceof StaleResetError) return resetBlockedResponse(context, err.resetAt);
    throw err;
  }
  // Purgar artefactos Kindle cacheados del libro (K4)
  try {
    context.executionCtx.waitUntil(purgeKindleBookCache(booksBucket, hash));
  } catch {
    void purgeKindleBookCache(booksBucket, hash);
  }
  return context.json({ ok: true });
});

app.put("/api/books/:hash/cover", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para guardar portadas." }, 401);

  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const contentType = context.req.header("content-type") || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType.toLowerCase())) {
    return context.json({ error: "Formato de imagen no soportado (use JPEG, PNG o WebP)." }, 400);
  }

  const data = new Uint8Array(await context.req.arrayBuffer());
  if (!data.byteLength || data.byteLength > 300_000) {
    return context.json({ error: "Portada vacía o demasiado grande (máximo 300 KB)." }, 400);
  }

  await booksBucket.put(bookCoverKey(session.user.id, hash), data, {
    httpMetadata: { contentType },
  });

  try {
    await setUserBookCover(context.env, session.user.id, hash, true, readResetAck(context));
  } catch (err) {
    if (err instanceof StaleResetError) {
      await booksBucket.delete(bookCoverKey(session.user.id, hash)).catch(() => undefined);
      return resetBlockedResponse(context, err.resetAt);
    }
    throw err;
  }

  // Intentar actualizar también customMetadata del libro en R2
  try {
    const epubObj = await booksBucket.get(bookKey(session.user.id, hash));
    if (epubObj) {
      const epubData = new Uint8Array(await epubObj.arrayBuffer());
      await booksBucket.put(bookKey(session.user.id, hash), epubData, {
        httpMetadata: epubObj.httpMetadata,
        customMetadata: {
          ...epubObj.customMetadata,
          hasCover: "true",
        },
      });
    }
  } catch {
    // Best-effort
  }

  return context.json({ ok: true });
});

app.get("/api/books/:hash/cover", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver portadas." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const object = await booksBucket.get(bookCoverKey(session.user.id, hash));
  if (!object) return context.json({ error: "Portada no encontrada." }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "private, max-age=86400, immutable",
    },
  });
});

// ------------------------------------------------------------------
// Biblioteca comunitaria «solo papel» (migración 024, modelo A1)
//
// El lector marca su EPUB como compartido (`shared`) y sube la GUÍA
// de papel generada en su dispositivo: `guides/{hash}.json` guarda el
// índice de capítulos y la lista alfabética de formas — cero texto del
// autor, cero portada. Otras cuentas la ven en «Comunidad» y la
// adjuntan como entrada propia `paper_only` (size_bytes=0, sin cuota):
// abre el índice del modo papel y jamás el lector, porque el EPUB
// nunca sale del espacio privado del donante. El catálogo deduplica
// por `book_id` (= sha256 del archivo origen).
// ------------------------------------------------------------------

type BookFlags = { shared: boolean; paperOnly: boolean; genre: string };

// Flags que viven en la fila (el customMetadata de R2 no se actualiza
// sin resubir el archivo). `genre` (025) se pide primero en la misma
// consulta; sin la columna se reintenta con las de la 024 — los flags
// base no se pierden por un género que aún no existe.
async function listUserBookFlags(
  env: WorkerEnv,
  userId: string,
): Promise<Map<string, BookFlags>> {
  const flags = new Map<string, BookFlags>();
  const sqlPgGenre = `SELECT book_id, shared, paper_only, genre FROM user_books WHERE user_id = $1`;
  const sqlPgBase = `SELECT book_id, shared, paper_only FROM user_books WHERE user_id = $1`;
  const collect = (rows: Array<{ book_id: unknown; shared: unknown; paper_only: unknown; genre?: unknown }>) => {
    for (const row of rows) {
      flags.set(String(row.book_id), {
        shared: row.shared === true || row.shared === 1,
        paperOnly: row.paper_only === true || row.paper_only === 1,
        genre: String(row.genre ?? ""),
      });
    }
  };
  if (getConnectionString(env)) {
    const query = (sql: string) =>
      withClient(env, (client) =>
        client.query<{ book_id: unknown; shared: unknown; paper_only: unknown; genre?: unknown }>(sql, [userId]),
      ).catch((err) => (isMissingColumnError(err) ? null : Promise.reject(err)));
    const res = (await query(sqlPgGenre)) ?? (await query(sqlPgBase)) ?? undefined;
    if (res) collect(res.rows);
    return flags;
  }
  return flags;
}

// Fila de user_books para GET /api/books. Las columnas opcionales llegan
// según las migraciones aplicadas (024 shared/paper_only, 025 genre, 027
// has_file); sin ellas el campo es undefined y se trata como antes (flag
// apagado / con archivo).
type UserBookSummaryRow = {
  book_id: string;
  title: string;
  author: string;
  language: string;
  r2_key: string;
  created_at: unknown;
  updated_at: unknown;
  shared?: unknown;
  paper_only?: unknown;
  genre?: unknown;
  has_file?: unknown;
};

// Reparto en JS (GET /api/books): paper_only = guías de la comunidad (la fila
// ES la entrada remota); r2_key fuera de `books/` = la era `user-books/` del
// sync BYO-EPUB viejo, que la lista de R2 no alcanza (sus paper_only se
// filtran por flags); has_file = false = libros propios solo con metadatos
// (027, plan free).
async function listUserBooksSummary(
  env: WorkerEnv,
  userId: string,
): Promise<UserBookSummaryRow[]> {
  if (!getConnectionString(env)) return [];
  const base = "book_id, title, author, language, r2_key, created_at, updated_at";
  // De la más completa a la más antigua: una columna ausente (42703) baja un
  // escalón. Sin ni siquiera la base → lista vacía, como antes.
  const tiers = [
    `${base}, shared, paper_only, genre, has_file`,
    `${base}, shared, paper_only, genre`,
    `${base}, shared, paper_only`,
    base,
  ];
  for (const columns of tiers) {
    try {
      const res = await withClient(env, (client) =>
        client.query<UserBookSummaryRow>(
          `SELECT ${columns} FROM user_books WHERE user_id = $1`,
          [userId],
        ),
      );
      return res?.rows ?? [];
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
    }
  }
  return [];
}

// La llave R2 real del archivo según su fila user_books — la era
// `user-books/` la guarda explícita; lectura tolerante a tabla ausente
// (devuelve null y el llamador usa la ruta convencional).
async function readUserBookR2Key(
  env: WorkerEnv,
  userId: string,
  bookId: string,
): Promise<string | null> {
  const sqlPg = `SELECT r2_key FROM user_books WHERE user_id = $1 AND book_id = $2`;
  if (getConnectionString(env)) {
    const res = await withClient(env, (client) =>
      client.query<{ r2_key: string }>(sqlPg, [userId, bookId]),
    ).catch((err) => (isMissingTableError(err) ? null : Promise.reject(err)));
    if (res) return res.rows[0]?.r2_key ?? null;
    if (res === null) return null;
  }
  return null;
}

// Fila donante del catálogo: cualquier copia compartida del mismo
// book_id sirve — el archivo es idéntico (sha256).
type CommunityDonor = {
  user_id: string;
  title: string;
  author: string;
  language: string;
};

async function findCommunityDonor(
  env: WorkerEnv,
  bookId: string,
): Promise<CommunityDonor | null | "unavailable"> {
  const sqlPg = `SELECT user_id, title, author, language
     FROM user_books
     WHERE book_id = $1 AND shared = true
     ORDER BY shared_at ASC
     LIMIT 1`;
  if (getConnectionString(env)) {
    const res = await withClient(env, (client) =>
      client.query<CommunityDonor>(sqlPg, [bookId]),
    ).catch((err) => (isMissingColumnError(err) ? null : Promise.reject(err)));
    if (res === null) return "unavailable";
    return res?.rows[0] ?? null;
  }
  return null;
}

// Compartir / dejar de compartir tu propio libro. `genre` viaja solo
// cuando el lector lo declara al compartir (undefined = no tocar la
// columna): la elección manual pisa a la detectada del EPUB.
const setBookShared = async (
  env: WorkerEnv,
  context: Context,
  userId: string,
  bookId: string,
  shared: boolean,
  genre?: string,
): Promise<Response> => {
  const now = Date.now();
  const runUpdate = (
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number }> },
    includeGenre: boolean,
  ) =>
    client.query(
      includeGenre
        ? `UPDATE user_books SET shared = $3, shared_at = $4, updated_at = $5, genre = $6
           WHERE user_id = $1 AND book_id = $2`
        : `UPDATE user_books SET shared = $3, shared_at = $4, updated_at = $5
           WHERE user_id = $1 AND book_id = $2`,
      includeGenre
        ? [userId, bookId, shared, shared ? now : 0, now, genre]
        : [userId, bookId, shared, shared ? now : 0, now],
    );
  if (getConnectionString(env)) {
    try {
      const updated = await withResetGuard(env, readResetAck(context), userId, async (client) => {
        // Sin la columna (pre-025) se reintenta sin género: compartir
        // no puede fallar por un metadato complementario.
        const res = await runUpdate(client, genre !== undefined).catch((err: unknown) =>
          genre !== undefined && isMissingColumnError(err)
            ? runUpdate(client, false)
            : Promise.reject(err),
        );
        return res.rowCount ?? 0;
      });
      if (isResetBlocked(updated)) return resetBlockedResponse(context, updated.blockedAt);
      if (updated === undefined)
        return context.json({ error: "El almacenamiento no está configurado." }, 503);
      if (updated === 0) return context.json({ error: "Libro no encontrado." }, 404);
      return context.json({ ok: true, shared });
    } catch (err) {
      if (isMissingColumnError(err))
        return context.json({ error: "La comunidad aún no está disponible." }, 503);
      throw err;
    }
  }
  return context.json({ error: "El almacenamiento no está configurado." }, 503);
};

app.put("/api/books/:hash/share", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para compartir libros." }, 401);
  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);
  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  // Modelo A1: el cuerpo trae la guía de papel generada en el
  // dispositivo del dueño (índice + formas por capítulo, cero texto).
  // Se valida y se guarda en `guides/{hash}.json` — el EPUB jamás se
  // copia ni sale del espacio privado del donante.
  const body = (await context.req.json().catch(() => null)) as {
    guide?: unknown;
    genre?: unknown;
  } | null;
  if (body?.guide !== undefined) {
    const booksBucket = context.env.BOOKS;
    if (!booksBucket)
      return context.json({ error: "El almacenamiento no está configurado." }, 503);
    const guide = sanitizePaperBookGuide(body.guide, hash);
    if (!guide)
      return context.json({ error: "La guía del libro no es válida." }, 400);
    await booksBucket.put(guideKey(hash), JSON.stringify(guide), {
      httpMetadata: { contentType: "application/json" },
    });
    // La guía ya es visible para el listado comunitario: la caché del
    // isolate debe olvidarla en la siguiente petición.
    invalidateCommunityGuides();
  }
  // Género declarado al compartir: solo valores de BOOK_GENRES; un
  // string ajeno se normaliza a "" (la columna queda sin clasificar,
  // jamás guarda texto libre). Clave ausente = no tocar la columna.
  const genre =
    typeof body?.genre === "string"
      ? isBookGenre(body.genre)
        ? body.genre
        : ""
      : undefined;
  return setBookShared(context.env, context, session.user.id, hash, true, genre);
});

app.delete("/api/books/:hash/share", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para compartir libros." }, 401);
  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);
  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);
  return setBookShared(context.env, context, session.user.id, hash, false);
});

// Portada de una entrada comunitaria: con el modelo A1 las guías no
// traen la portada del donante (la imagen es del editorial). La
// estantería dibuja siempre la portada tipográfica de Lecta — esta
// ruta queda como 404 explícito para clientes viejos.
app.get("/api/books/community/:hash/cover", async (context) => {
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver portadas." }, 401);
  return context.json({ error: "Portada no encontrada." }, 404);
});

// Adjuntar (modelo A1): NO se copia el EPUB ni la portada del donante.
// Se lee la guía `guides/{hash}.json`, se inserta la fila paper_only
// del usuario (size_bytes=0, sin cuota) y se devuelve la guía en la
// respuesta para que el cliente la guarde en IndexedDB — ~40 kB y el
// modo papel queda disponible offline desde el primer toque.
app.post("/api/books/community/:hash/attach", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para guardar libros." }, 401);

  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const donor = await findCommunityDonor(context.env, hash);
  if (donor === "unavailable")
    return context.json({ error: "La comunidad aún no está disponible." }, 503);
  if (!donor) return context.json({ error: "Ese libro ya no está en la comunidad." }, 404);
  if (donor.user_id === session.user.id)
    return context.json({ error: "Ese libro ya es tuyo." }, 409);

  const guideObject = await booksBucket.get(guideKey(hash));
  if (!guideObject)
    return context.json({ error: "La guía de este libro ya no está disponible." }, 404);
  const guide = sanitizePaperBookGuide(
    await guideObject.json().catch(() => null),
    hash,
  );
  if (!guide)
    return context.json({ error: "La guía de este libro ya no está disponible." }, 404);

  // Idempotente: si la fila ya existe, se devuelve la guía de todos
  // modos — el dispositivo puede haberla perdido (IndexedDB limpiada).
  if (getConnectionString(context.env)) {
    const existing = await withClient(context.env, (client) =>
      client.query(
        `SELECT 1 FROM user_books WHERE user_id = $1 AND book_id = $2`,
        [session.user.id, hash],
      ),
    ).catch(() => null);
    if (existing?.rows?.length)
      return context.json({ ok: true, hash, already: true, guide });
  }

  const now = Date.now();
  const title = guide.title || donor.title || "";
  const author = guide.author || donor.author || "";
  const language = guide.language || donor.language || "";
  const insertRow = (client: { query: (sql: string, p?: unknown[]) => Promise<{ rowCount?: number }> }) =>
    client.query(
      `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, shared, shared_at, paper_only, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 0, true, $10, $11)
       ON CONFLICT (user_id, book_id) DO NOTHING`,
      [
        session.user.id,
        hash,
        title,
        author,
        language,
        guideKey(hash),
        0,
        hash,
        false,
        now,
        now,
      ],
    );

  if (getConnectionString(context.env)) {
    try {
      const inserted = await withResetGuard(
        context.env,
        readResetAck(context),
        session.user.id,
        insertRow,
      );
      if (isResetBlocked(inserted))
        return resetBlockedResponse(context, inserted.blockedAt);
      if (inserted === undefined)
        return context.json({ error: "El almacenamiento no está configurado." }, 503);
      return context.json({ ok: true, hash, guide });
    } catch (err) {
      if (isMissingColumnError(err))
        return context.json({ error: "La comunidad aún no está disponible." }, 503);
      throw err;
    }
  }
  return context.json({ error: "El almacenamiento no está configurado." }, 503);
});

app.post("/api/books/:hash/repair", async (context) => {
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para reparar libros." }, 401);

  const staleReset = await staleResetAt(context.env, context, session.user.id);
  if (staleReset) return resetBlockedResponse(context, staleReset);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const key = bookKey(session.user.id, hash);
  const r2Obj = await booksBucket.get(key);
  if (!r2Obj) return context.json({ error: "Libro no encontrado." }, 404);

  const data = new Uint8Array(await r2Obj.arrayBuffer());
  const meta = await extractEpubMeta(data);
  const nowStr = String(Date.now());

  let hasCover = r2Obj.customMetadata?.hasCover === "true";
  if (!hasCover) {
    const coverResult = await extractEpubCover(data).catch(() => null);
    if (coverResult && coverResult.data.byteLength <= 300_000) {
      await booksBucket.put(bookCoverKey(session.user.id, hash), coverResult.data, {
        httpMetadata: { contentType: coverResult.mediaType || "image/jpeg" },
      });
      hasCover = true;
    }
  }

  const repTitle = (meta?.title && !isHashLikeIdentifier(meta.title))
    ? meta.title.slice(0, 200)
    : (r2Obj.customMetadata?.title ?? "");
  const repAuthor = (meta?.author ?? r2Obj.customMetadata?.author ?? "").slice(0, 200);
  const repSections = meta?.sections ? String(meta.sections) : (r2Obj.customMetadata?.sections ?? "");
  const repLang = (meta?.language ?? r2Obj.customMetadata?.language ?? "").slice(0, 10);
  const repName = repTitle ? `${repTitle}.epub` : (r2Obj.customMetadata?.name ?? "");

  const updatedCustomMetadata: Record<string, string> = {
    ...r2Obj.customMetadata,
    repairAttemptedAt: nowStr,
    hasCover: hasCover ? "true" : "false",
  };
  if (repName) updatedCustomMetadata.name = repName;
  if (repTitle) updatedCustomMetadata.title = repTitle;
  if (repAuthor) updatedCustomMetadata.author = repAuthor;
  if (repSections) updatedCustomMetadata.sections = repSections;
  if (repLang) updatedCustomMetadata.language = repLang;

  await booksBucket.put(key, data, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: updatedCustomMetadata,
  });

  try {
    await recordUserBook(context.env, {
      userId: session.user.id,
      bookId: hash,
      title: repTitle,
      author: repAuthor,
      r2Key: key,
      sizeBytes: data.byteLength,
      sha256: hash,
      hasCover,
      resetAck: readResetAck(context),
    });
  } catch (err) {
    if (err instanceof StaleResetError) return resetBlockedResponse(context, err.resetAt);
    throw err;
  }

  return context.json({
    title: repTitle,
    author: repAuthor,
    language: repLang || "es",
    sectionCount: Number(repSections) || 0,
    hasCover,
  });
});

type UserWordInput = {
  form?: unknown;
  language?: unknown;
  lemma?: unknown;
  pos?: unknown;
  meaning?: unknown;
  context?: unknown;
  bookHash?: unknown;
  card?: unknown;
  senseEntryId?: unknown;
  senseOrder?: unknown;
  presentedAt?: unknown;
  savedAt?: unknown;
  updatedAt?: unknown;
  deleted?: unknown;
};

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;
const cleanNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function parseSinceParam(param?: string | null): number {
  if (!param) return 0;
  const num = Number(param);
  if (Number.isFinite(num) && num > 0) return num;
  const parsedDate = Date.parse(param);
  if (!Number.isNaN(parsedDate) && parsedDate > 0) return parsedDate;
  return 0;
}

app.get("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tu vocabulario." }, 401);
  const language = context.req.query("lang")?.trim() || "es";
  const since = parseSinceParam(context.req.query("since"));
  const afterWord = context.req.query("afterWord")?.trim() || null;
  // availableLanguages solo hace falta al descubrir idiomas en la primera
  // página. En las siguientes (o cuando el cliente lo desactiva) se evita
  // el DISTINCT: es una consulta cara que se repetía por cada página.
  const includeLanguages =
    context.req.query("includeLanguages") !== "0" && !afterWord;
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const resultData = await withClient(context.env, async (client) => {
    const params: unknown[] = [session.user.id, language];
    const filters = ["user_id = $1", "language = $2"];
    if (since > 0) {
      if (afterWord) {
        filters.push(
          "(synced_at > $3 OR (synced_at = $3 AND form > $4))",
        );
        params.push(since, afterWord);
      } else {
        filters.push("synced_at > $3");
        params.push(since);
      }
    }

    const rows = await client
      .query(
        `SELECT language, form, lemma, pos, meaning, context, book_hash AS "bookHash",
                sense_entry_id AS "senseEntryId", sense_order AS "senseOrder",
                card, presented_at AS "presentedAt",
                saved_at AS "savedAt", updated_at AS "updatedAt",
                synced_at AS "syncedAt", deleted
         FROM lecta_user_words
         WHERE ${filters.join(" AND ")}
         ORDER BY synced_at ASC, form ASC
         LIMIT ${LIMIT}`,
        params,
      )
      .then((result) => result.rows);

    const langRows = includeLanguages
      ? await client
          .query(
            `SELECT DISTINCT language FROM lecta_user_words WHERE user_id = $1`,
            [session.user.id],
          )
          .then((result) => result.rows)
          .catch(() => [])
      : [];

    return { rows, langRows, includeLanguages };
  });

  if (resultData === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);

  const { rows, langRows, includeLanguages: withLanguages } = resultData;
  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.syncedAt)
      : Math.max(0, queryStartMs - 5_000);
  const nextAfterWord = hasMore && lastRow ? String(lastRow.form) : null;

  const availableLanguages = withLanguages
    ? Array.from(
        new Set([
          ...langRows
            .map((r: { language?: unknown }) =>
              typeof r.language === "string" ? r.language.trim() : "",
            )
            .filter(Boolean),
          language,
        ]),
      )
    : undefined;

  return context.json({
    words: rows.map((row) => ({
      ...row,
      key: `${row.language}:${row.form.toLowerCase()}`,
      // int8 > 2^53: se devuelve como string; un Number lo truncaría.
      senseEntryId: row.senseEntryId != null ? String(row.senseEntryId) : null,
      senseOrder: row.senseOrder != null ? Number(row.senseOrder) : null,
      presentedAt: row.presentedAt != null ? Number(row.presentedAt) : null,
      savedAt: Number(row.savedAt),
      updatedAt: Number(row.updatedAt),
      syncedAt: row.syncedAt != null ? Number(row.syncedAt) : Number(row.updatedAt),
      card: typeof row.card === "string" ? JSON.parse(row.card) : row.card,
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
    nextAfterWord,
    availableLanguages,
  });
});

app.put("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu vocabulario." }, 401);

  const serverNow = Date.now();
  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.words) ? (body.words as UserWordInput[]) : [];
  // Una card malformada invalida la petición completa antes del SQL:
  // guardarla corrompería el historial de repaso y descartarla en
  // silencio perdería la tarjeta sin avisar al cliente.
  if (
    inputs.some(
      (input) => input.card != null && !isFsrsCardShape(input.card),
    )
  )
    return context.json({ error: "Hay una tarjeta de repaso inválida." }, 400);
  const words = inputs
    .map((input) => {
      const form = cleanText(input.form, 100)?.trim().toLowerCase();
      const language = cleanText(input.language, 10)?.trim() || "es";
      const rawUpdatedAt = cleanNumber(input.updatedAt);
      const updatedAt =
        rawUpdatedAt !== undefined ? Math.min(rawUpdatedAt, serverNow) : serverNow;
      if (!form) return null;
      const rawSavedAt = cleanNumber(input.savedAt);
      const savedAt =
        rawSavedAt !== undefined ? Math.min(rawSavedAt, serverNow) : updatedAt;
      return {
        form,
        language,
        lemma: cleanText(input.lemma, 100) ?? null,
        pos: cleanText(input.pos, 30) ?? null,
        meaning: cleanText(input.meaning, 500) ?? null,
        context: cleanText(input.context, 500) ?? null,
        bookHash: cleanText(input.bookHash, 80) ?? null,
        // Referencia a la acepción guardada: los mismos validadores del
        // catálogo (int8/int4 positivos); lo inválido queda en null.
        senseEntryId: toCatalogId(input.senseEntryId),
        senseOrder: toSenseOrder(input.senseOrder),
        card: input.card ?? null,
        // Sello de primera exposición: reloj del cliente acotado al del
        // servidor, como updatedAt. Ausente queda en null y no borra el previo.
        presentedAt: (() => {
          const raw = cleanNumber(input.presentedAt);
          return raw !== undefined && raw > 0 ? Math.min(raw, serverNow) : null;
        })(),
        savedAt,
        updatedAt,
        deleted: input.deleted === true,
      };
    })
    .filter((word): word is NonNullable<typeof word> => word !== null)
    .slice(0, 500);
  if (!words.length) return context.json({ error: "Faltan las palabras." }, 400);

  const resetAck = readResetAck(context);
  const upserted = await withResetGuard(context.env, resetAck, session.user.id, async (client) => {
    let total = 0;
    for (const chunk of chunks(words)) {
      const result = await client.query(
      `INSERT INTO lecta_user_words
         (user_id, language, form, lemma, pos, meaning, context, book_hash,
          sense_entry_id, sense_order, card, presented_at, saved_at, updated_at,
          deleted, synced_at)
       SELECT $1,
              j.value ->> 'language', j.value ->> 'form', j.value ->> 'lemma',
              j.value ->> 'pos', j.value ->> 'meaning', j.value ->> 'context',
              j.value ->> 'bookHash',
              (j.value ->> 'senseEntryId')::int8, (j.value ->> 'senseOrder')::int4,
              NULLIF(j.value -> 'card', 'null'::jsonb) AS card,
              (j.value ->> 'presentedAt')::int8,
              (j.value ->> 'savedAt')::int8, (j.value ->> 'updatedAt')::int8,
              COALESCE((j.value ->> 'deleted')::bool, false),
              $3::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma, pos = excluded.pos, meaning = excluded.meaning,
         context = excluded.context, book_hash = excluded.book_hash,
         sense_entry_id = excluded.sense_entry_id,
         sense_order = excluded.sense_order,
         card = CASE
           WHEN excluded.deleted THEN NULL
           ELSE COALESCE(NULLIF(excluded.card, 'null'::jsonb), lecta_user_words.card)
         END,
         presented_at = COALESCE(excluded.presented_at, lecta_user_words.presented_at),
         updated_at = excluded.updated_at,
         deleted = excluded.deleted,
         synced_at = excluded.synced_at
       WHERE lecta_user_words.updated_at <= excluded.updated_at`,
      [session.user.id, JSON.stringify(chunk), serverNow],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (isResetBlocked(upserted))
    return resetBlockedResponse(context, upserted.blockedAt);
  if (upserted === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  return context.json({ ok: true, upserted, serverTime: serverNow });
});

app.get("/api/sync/counts", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para consultar sincronización." }, 401);

  const counts = await withClient(context.env, async (client) => {
    // Una sola sentencia: seis COUNT sueltos en un solo client se
    // serializan igual (pg no paraleliza) y pagan ~100 ms por round-trip.
    const res = await client.query<Record<string, number | string>>(
      `SELECT
         (SELECT COUNT(*) FROM lecta_user_words WHERE user_id = $1 AND deleted = false)::int8 AS words,
         (SELECT COUNT(*) FROM lecta_user_annotations WHERE user_id = $1 AND deleted = false)::int8 AS annotations,
         (SELECT COUNT(*) FROM lecta_user_activity WHERE user_id = $1)::int8 AS activity,
         (SELECT COUNT(*) FROM lecta_user_reviews WHERE user_id = $1)::int8 AS reviews,
         (SELECT COUNT(*) FROM lecta_user_positions WHERE user_id = $1)::int8 AS positions,
         (SELECT COUNT(*) FROM lecta_user_knowledge WHERE user_id = $1 AND deleted = false)::int8 AS knowledge`,
      [session.user.id],
    );
    const row = res.rows[0] ?? {};
    return {
      words: Number(row.words ?? 0),
      annotations: Number(row.annotations ?? 0),
      activity: Number(row.activity ?? 0),
      reviews: Number(row.reviews ?? 0),
      positions: Number(row.positions ?? 0),
      knowledge: Number(row.knowledge ?? 0),
    };
  });
  if (counts === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  return context.json({ counts, serverTime: Date.now() });
});

// ---------- Sincronización Cloud de EPUBs Propios (BYO-EPUB) en CockroachDB y R2 ----------

// Libro propio solo con metadatos (027): gratis y con sesión. Registra la
// fila para que la estantería de otro dispositivo vea el libro; el archivo
// se adjunta allá (emparejado por sha256). Nunca toca r2_key, size_bytes ni
// has_file de una fila que ya tenga archivo.
app.put("/api/user/books/:bookId/meta", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "No autenticado" }, 401);
  const bookId = c.req.param("bookId");
  const body = (await c.req.json().catch(() => null)) as {
    title?: unknown;
    author?: unknown;
    language?: unknown;
    sha256?: unknown;
  } | null;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  const sha256 = text(body?.sha256, 64).toLowerCase();
  if (!HASH_PATTERN.test(bookId) || sha256 !== bookId) {
    return c.json({ error: "El archivo no coincide con el libro." }, 400);
  }
  if (!getConnectionString(c.env)) {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  const quota = await checkUserBooksQuota(c.env, user.id, bookId, 0);
  if (!quota.allowed) {
    return c.json({ error: quota.reason ?? "Llegaste al límite de libros de tu cuenta." }, 413);
  }
  const now = Date.now();
  const params = [
    user.id,
    bookId,
    text(body?.title, 300),
    text(body?.author, 200),
    text(body?.language, 16),
    sha256,
    now,
  ];
  const insert = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
    client.query(
      `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_file, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '', 0, $6, false, $7, $7)
       ON CONFLICT (user_id, book_id) DO UPDATE SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         language = EXCLUDED.language,
         updated_at = EXCLUDED.updated_at`,
      params,
    );
  let res;
  try {
    res = await withResetGuard(c.env, readResetAck(c), user.id, insert);
  } catch (err) {
    if (err instanceof StaleResetError) return resetBlockedResponse(c, err.resetAt);
    if (isMissingColumnError(err)) {
      return c.json({ error: "Servicio temporalmente no disponible" }, 503);
    }
    throw err;
  }
  if (isResetBlocked(res)) return resetBlockedResponse(c, res.blockedAt);
  return c.json({ ok: true, hasFile: false });
});

app.put("/api/user/books/:bookId/file", requireLectaPlus, async (c) => {
  const user = c.get("session")?.user ?? null;
  if (!user) return c.json({ error: "No autenticado" }, 401);

  const staleReset = await staleResetAt(c.env, c, user.id);
  if (staleReset) return resetBlockedResponse(c, staleReset);

  const booksBucket = c.env.BOOKS;
  if (!booksBucket) {
    return c.json({ error: "Almacenamiento no configurado" }, 503);
  }

  const bookId = c.req.param("bookId");
  const rawTitle = c.req.header("x-book-title");
  const rawAuthor = c.req.header("x-book-author");
  const rawLanguage = c.req.header("x-book-language");
  const title = rawTitle ? decodeURIComponent(rawTitle) : bookId;
  const author = rawAuthor ? decodeURIComponent(rawAuthor) : "";
  const language = rawLanguage ? decodeURIComponent(rawLanguage) : "";
  const sha256 = c.req.header("x-book-sha256") ?? "";

  const buffer = await c.req.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > EPUB_MAX_BYTES) {
    return c.json({ error: "El archivo EPUB excede el límite permitido" }, 413);
  }

  const check = checkEpubBuffer(buffer);
  if (!check.ok) {
    return c.json({ error: check.reason ?? "Archivo EPUB inválido" }, 400);
  }

  // Verificar cuota acumulada del usuario
  const quota = await checkUserBooksQuota(c.env, user.id, bookId, buffer.byteLength);
  if (!quota.allowed) {
    return c.json({ error: quota.reason ?? "Storage quota exceeded for this account" }, 413);
  }

  const r2Key = `user-books/${user.id}/${bookId}.epub`;
  await booksBucket.put(r2Key, buffer, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: { userId: user.id, bookId, title, author },
  });

  const now = Date.now();
  try {
    await recordUserBook(c.env, {
      userId: user.id,
      bookId,
      title,
      author,
      language,
      r2Key,
      sizeBytes: buffer.byteLength,
      sha256,
      resetAck: readResetAck(c),
    });
  } catch (err) {
    if (err instanceof StaleResetError) {
      await booksBucket.delete(r2Key).catch(() => undefined);
      return resetBlockedResponse(c, err.resetAt);
    }
    throw err;
  }

  return c.json({ ok: true, bookId, sizeBytes: buffer.byteLength, updatedAt: now });
});

app.get("/api/user/books", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ books: [] });

  // Defensa del modelo A1: las entradas paper_only no son libros
  // descargables — su «archivo» es la guía (r2_key = guides/…). Si
  // salieran en esta lista, un sync que bajara lo que falta guardaría
  // el JSON de la guía como EPUB local.
  const flags = await listUserBookFlags(c.env, user.id).catch(
    () => new Map<string, BookFlags>(),
  );
  const notPaper = (id: unknown) => !flags.get(String(id))?.paperOnly;

  if (getConnectionString(c.env)) {
    const rows = await withClient(c.env, async (client) => {
      const res = await client.query<{
        id: string;
        title: string;
        author: string;
        sizebytes: number | string;
        sha256: string;
        updatedat: number | string;
      }>(
        // 027: sin archivo no hay nada que bajar; sin la columna se
        // reintenta con la consulta anterior.
        `SELECT book_id AS id, title, author, size_bytes AS sizebytes, sha256, updated_at AS updatedat
         FROM user_books WHERE user_id = $1 AND has_file = true ORDER BY updated_at DESC`,
        [user.id],
      ).catch((err: unknown) =>
        isMissingColumnError(err)
          ? client.query<{
              id: string;
              title: string;
              author: string;
              sizebytes: number | string;
              sha256: string;
              updatedat: number | string;
            }>(
              `SELECT book_id AS id, title, author, size_bytes AS sizebytes, sha256, updated_at AS updatedat
               FROM user_books WHERE user_id = $1 ORDER BY updated_at DESC`,
              [user.id],
            )
          : Promise.reject(err),
      );
      return res.rows.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        sizeBytes: Number(r.sizebytes),
        sha256: r.sha256,
        updatedAt: Number(r.updatedat),
      }));
    });
    if (rows) return c.json({ books: rows.filter((b) => notPaper(b.id)) });
  }


  return c.json({ books: [] });
});

app.get("/api/user/books/:bookId/file", requireLectaPlus, async (c) => {
  const user = c.get("session")?.user ?? null;
  if (!user) return c.json({ error: "No autenticado" }, 401);

  const booksBucket = c.env.BOOKS;
  if (!booksBucket) {
    return c.json({ error: "Almacenamiento no configurado" }, 503);
  }

  const bookId = c.req.param("bookId");

  // Misma defensa A1 que /api/books/:hash — una entrada paper_only no
  // tiene EPUB; su r2_key apunta a la guía y servirla aquí la haría
  // pasar por libro descargable.
  const fileFlags = await listUserBookFlags(c.env, user.id).catch(
    () => new Map<string, BookFlags>(),
  );
  if (fileFlags.get(bookId)?.paperOnly)
    return c.json(
      { error: "Esta entrada es una guía de papel, no un libro descargable." },
      403,
    );

  let r2Key: string | null = null;

  if (getConnectionString(c.env)) {
    const res = await withClient(c.env, (client) =>
      client.query<{ r2_key: string }>(
        `SELECT r2_key FROM user_books WHERE user_id = $1 AND book_id = $2`,
        [user.id, bookId],
      ),
    );
    r2Key = res?.rows[0]?.r2_key ?? null;
  }

  const keysToTry = [
    r2Key,
    `user-books/${user.id}/${bookId}.epub`,
    `books/${user.id}/${bookId}.epub`,
  ].filter(Boolean) as string[];

  for (const key of keysToTry) {
    const obj = await booksBucket.get(key);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          "Content-Type": "application/epub+zip",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  return c.json({ error: "Libro no encontrado en la nube" }, 404);
});

// Sello del último «borrar datos de la cuenta» (epoch ms; 0 si nunca).
// Los otros dispositivos lo consultan antes de sincronizar: si es más
// nuevo que la marca que recuerdan, su copia local quedó obsoleta y
// tienen que vaciarse antes de empujar nada — sin él, re-subirían lo
// que la persona acabó de borrar.
app.get("/api/account/state", async (context) => {
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
app.put("/api/account/starter-coat", async (context) => {
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

app.post("/api/account/reset", async (context) => {
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
