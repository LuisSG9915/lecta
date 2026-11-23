import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnectionString, isMissingColumnError, isMissingTableError, withClient, type WorkerEnv } from "./db";
import { LECTA_PLUS_REQUIRED, requireLectaPlus, requireSessionWithPlan, type PlanVariables } from "./plan-middleware";
import { consumeFreeAiCourtesy, refundFreeAiCourtesy } from "./free-courtesy";
import { billing } from "./billing";
import { account } from "./account";
import { computeAiCacheKey, getCachedAiText, setCachedAiText } from "./ai-cache";
import { EXPLAIN_UNITS_PER_HOUR, EVALUATE_UNITS_PER_HOUR, STORY_UNITS_PER_HOUR, PAGE_RECAP_UNITS_PER_HOUR, TRANSLATE_UNITS_PER_HOUR, COMPANION_NOTE_UNITS_PER_HOUR } from "./ai-units";
import { lexiconRoutes } from "./lexicon-routes";
import { userBooks } from "./user-books";
import { vocabSync } from "./vocab-sync";
import { ops } from "./ops";
import { weeklyDigest } from "./weekly-digest";
import { createTtlCache, EVALUATE_CALL_OPTIONS, EVALUATE_SYSTEM_PROMPT, EXPLAIN_PASSAGE_CALL_OPTIONS, EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS, EXPLAIN_PASSAGE_SYSTEM_PROMPT, buildCompactExplainPrompt, normalizePassage, COMPANION_NOTE_SYSTEM_PROMPT, buildCompanionNotePrompt, parseCompanionNote, STORY_CALL_OPTIONS, STORY_SYSTEM_PROMPT, buildEvaluatePrompt, buildExplainInPassagePrompt, buildStoryPrompt, parseEvaluateSentence, parseMicroStory, parsePassageExplanation, type EvaluatedSentence, type MicroStory, type PassageExplanation, callDeepSeek, COMPANION_NOTE_CALL_OPTIONS, PAGE_RECAP_CALL_OPTIONS, PAGE_RECAP_SYSTEM_PROMPT, buildPageRecapPrompt, parsePageRecap, deterministicPageRecapFallback, CHARACTER_RECAP_CALL_OPTIONS, CHARACTER_RECAP_SYSTEM_PROMPT, buildCharacterRecapPrompt, parseCharacterRecap, deterministicCharacterRecapFallback, type CharacterRecapResponse, logAiCall, AI_TASK_BUDGETS, buildParagraphTranslationPrompt } from "./ai";
import { createScopedAuth, closePoolSafe } from "./auth";
import { checkAuthRateLimit, isLimitedAuthRequest } from "./auth-rate-limit";
import { checkEpubHeader, EPUB_MAX_BYTES } from "../shared/epub-check";
import { extractEpubMeta, extractEpubCover, isHashLikeIdentifier } from "../shared/epub-meta";
import { genreFromSubjects, isBookGenre } from "../shared/book-genres";
import { sanitizePaperBookGuide } from "../shared/paper-guide";
import { invalidateCommunityGuides, publishedGuideHashes } from "./community-guides";
import { getSession, SessionInfraError } from "./session";
import { readingData } from "./reading-data";
import { companion } from "./companion";
import { catalog } from "./catalog";
import { screen, screenZoneGate } from "./screen";
import { screenDiscover } from "./screen-discover";
import { consumeRateUnits } from "./rate-limit";
import { admin } from "./admin";
import { handleKindleLinkPage, handleKindleStatus, handleKindleLinkAction, handleKindlePrimingAction, requireKindlePlan, handleKindlePrefsApiGet, handleKindlePrefsApiPut, kindleRoutes, kindleHtmlCspFor } from "./kindle/routes";
import { purgeKindleBookCache } from "./kindle/cache";
import { HASH_PATTERN, checkUserBooksQuota, deleteUserBookRecord, listUserBookFlags, recordUserBook, setUserBookCover, type BookFlags } from "./book-store";
import { isResetBlocked, readResetAck, resetBlockedResponse, staleResetAt, StaleResetError, withResetGuard } from "./reset-guard";

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

const bookKey = (userId: string, hash: string) => `books/${userId}/${hash}.epub`;
const bookCoverKey = (userId: string, hash: string) => `covers/${userId}/${hash}.jpg`;
// Guías de papel comunitarias (modelo A1): un solo objeto por sha256,
// fuera del espacio `books/` de cualquier usuario — jamás contiene el
// EPUB, solo el índice de capítulos y sus listas de palabras.
const guideKey = (hash: string) => `guides/${hash}.json`;

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

app.route("/", vocabSync);

app.route("/", userBooks);

app.route("/", account);
