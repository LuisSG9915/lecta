// IA en contexto: reto del escritor, cuento de tinta, explicación en pasaje,
// nota del compañero, resumen de página, traducción y repaso de personaje
// (`/api/ai/*`). Extraído de app.ts (R2 de la deuda de complejidad).
import { Hono } from "hono";
import { type WorkerEnv } from "./db";
import { LECTA_PLUS_REQUIRED, requireLectaPlus, requireSessionWithPlan } from "./plan-middleware";
import { consumeFreeAiCourtesy, refundFreeAiCourtesy } from "./free-courtesy";
import { computeAiCacheKey, getCachedAiText, setCachedAiText } from "./ai-cache";
import { EXPLAIN_UNITS_PER_HOUR, EVALUATE_UNITS_PER_HOUR, STORY_UNITS_PER_HOUR, PAGE_RECAP_UNITS_PER_HOUR, TRANSLATE_UNITS_PER_HOUR, COMPANION_NOTE_UNITS_PER_HOUR } from "./ai-units";
import { createTtlCache, EVALUATE_CALL_OPTIONS, EVALUATE_SYSTEM_PROMPT, EXPLAIN_PASSAGE_CALL_OPTIONS, EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS, EXPLAIN_PASSAGE_SYSTEM_PROMPT, buildCompactExplainPrompt, normalizePassage, COMPANION_NOTE_SYSTEM_PROMPT, buildCompanionNotePrompt, parseCompanionNote, STORY_CALL_OPTIONS, STORY_SYSTEM_PROMPT, buildEvaluatePrompt, buildExplainInPassagePrompt, buildStoryPrompt, parseEvaluateSentence, parseMicroStory, parsePassageExplanation, type EvaluatedSentence, type MicroStory, type PassageExplanation, callDeepSeek, COMPANION_NOTE_CALL_OPTIONS, PAGE_RECAP_CALL_OPTIONS, PAGE_RECAP_SYSTEM_PROMPT, buildPageRecapPrompt, parsePageRecap, deterministicPageRecapFallback, CHARACTER_RECAP_CALL_OPTIONS, CHARACTER_RECAP_SYSTEM_PROMPT, buildCharacterRecapPrompt, parseCharacterRecap, deterministicCharacterRecapFallback, type CharacterRecapResponse, logAiCall, AI_TASK_BUDGETS, buildParagraphTranslationPrompt } from "./ai";
import { consumeRateUnits } from "./rate-limit";

export const aiRoutes = new Hono<{ Bindings: WorkerEnv }>();

// ---------- El Reto del Escritor y Cuento de Tinta IA ----------
const evaluateCache = createTtlCache<EvaluatedSentence>({ maxEntries: 150, ttlMs: 15 * 60_000 });
const storyCache = createTtlCache<MicroStory>({ maxEntries: 100, ttlMs: 30 * 60_000 });

aiRoutes.post("/api/ai/evaluate-sentence", requireLectaPlus, async (context) => {
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

aiRoutes.post("/api/ai/micro-story", requireLectaPlus, async (context) => {
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

// Cortesía de IA free (3 al día UTC, free-courtesy.ts): se descuenta DENTRO
// del handler, solo cuando de verdad se va a llamar a la IA (tras el caché), y
// se devuelve si la IA falla. Lecta+/fundador no consumen nada.
const COURTESY_EXHAUSTED = {
  error: "Agotaste tus consultas de IA gratuitas de hoy. Mañana tienes 3 más; Lecta+ las desbloquea.",
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
  // Un solo instante para descontar y devolver: si la IA falla pasada la
  // medianoche UTC, el reintegro vuelve al bucket del día en que se consumió.
  const at = Date.now();
  let ok: boolean;
  try {
    ok = await consumeFreeAiCourtesy(env, userId, at);
  } catch {
    return { deny: { body: { error: "Servicio temporalmente no disponible" }, status: 503 } };
  }
  if (!ok) return { deny: { body: { ...COURTESY_EXHAUSTED }, status: 402 } };
  return { refund: () => refundFreeAiCourtesy(env, userId, at) };
}

const explainPassageCache = createTtlCache<ExplainInPassageResponse>({
  maxEntries: 200,
  ttlMs: 15 * 60_000,
});

export function clearExplainPassageCache(): void {
  explainPassageCache.clear();
}

aiRoutes.post("/api/ai/explain-in-passage", requireSessionWithPlan, async (context) => {
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

aiRoutes.post("/api/ai/companion-note", requireLectaPlus, async (context) => {
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

aiRoutes.post("/api/ai/page-recap", requireSessionWithPlan, async (context) => {
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

aiRoutes.post("/api/ai/translate", requireSessionWithPlan, async (context) => {
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

aiRoutes.post("/api/ai/character-recap", requireLectaPlus, async (context) => {
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
