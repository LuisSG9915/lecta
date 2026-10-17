import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_CALL_LIMITS,
  AI_CALL_TIMEOUT_MS,
  buildEnrichmentSystemPrompt,
  buildEvaluatePrompt,
  buildExplainInPassagePrompt,
  buildExplainPrompt,
  buildExplainSystemPrompt,
  buildItemSystemPrompt,
  buildStoryPrompt,
  buildPageRecapPrompt,
  buildCharacterRecapPrompt,
  buildVerifyPrompt,
  buildVerifySystemPrompt,
  callDeepSeek,
  createTtlCache,
  deterministicPageRecapFallback,
  deterministicCharacterRecapFallback,
  ENRICHMENT_MODEL,
  ENRICHMENT_PROMPT_VERSION,
  EVALUATE_CALL_OPTIONS,
  ITEM_PROMPT_VERSION,
  PAGE_RECAP_CALL_OPTIONS,
  PAGE_RECAP_PROMPT_VERSION,
  CHARACTER_RECAP_CALL_OPTIONS,
  CHARACTER_RECAP_PROMPT_VERSION,
  parseCharacterRecap,
  parseEvaluateSentence,
  parseExplain,
  parseItem,
  parseMicroStory,
  parsePassageExplanation,
  parsePageRecap,
  parseTip,
  parseVerify,
  requestEnrichment,
  sanitizeTipContext,
  STORY_CALL_OPTIONS,
  VERIFY_PROMPT_VERSION,
  clampInputText,
  AI_TASK_BUDGETS,
  buildContextualWordPrompt,
  buildParagraphTranslationPrompt,
  buildCharacterCardsPrompt,
} from "./ai";
import type { WorkerEnv } from "./db";

const validItem = {
  sentence: "La sierra es perenne y nunca pierde el verde.",
  distractors: [
    "Que se mueve con rapidez",
    "Parte alta de una casa",
    "Sentimiento de tristeza",
  ],
};

describe("parseItem", () => {
  it("acepta un ítem válido", () => {
    expect(parseItem(JSON.stringify(validItem))).toEqual(validItem);
  });

  it("devuelve null con JSON roto o que no es objeto", () => {
    expect(parseItem("no es json")).toBeNull();
    expect(parseItem('"solo texto"')).toBeNull();
    expect(parseItem("[1,2,3]")).toBeNull();
    expect(parseItem("null")).toBeNull();
  });

  it("rechaza oraciones vacías, de menos de 4 palabras o de más de 200 caracteres", () => {
    expect(parseItem(JSON.stringify({ ...validItem, sentence: "" }))).toBeNull();
    expect(parseItem(JSON.stringify({ ...validItem, sentence: "Muy corta." }))).toBeNull();
    expect(
      parseItem(JSON.stringify({ ...validItem, sentence: "Palabra ".repeat(30) })),
    ).toBeNull();
  });

  it("exige exactamente 3 distractores válidos", () => {
    expect(
      parseItem(JSON.stringify({ ...validItem, distractors: validItem.distractors.slice(0, 2) })),
    ).toBeNull();
    expect(
      parseItem(JSON.stringify({ ...validItem, distractors: [...validItem.distractors, "uno más"] })),
    ).toBeNull();
    expect(
      parseItem(JSON.stringify({ ...validItem, distractors: ["a", 5, "b"] })),
    ).toBeNull();
    expect(
      parseItem(JSON.stringify({ ...validItem, distractors: ["a", " ", "b"] })),
    ).toBeNull();
  });

  it("rechaza distractores repetidos, aunque cambien mayúsculas", () => {
    expect(
      parseItem(
        JSON.stringify({
          ...validItem,
          distractors: ["Misma cosa", "misma cosa", "Otra distinta"],
        }),
      ),
    ).toBeNull();
  });
});

describe("parseVerify", () => {
  it("acepta un veredicto válido", () => {
    expect(parseVerify('{"correct":true,"feedback":"Bien usada."}')).toEqual({
      correct: true,
      feedback: "Bien usada.",
    });
    expect(parseVerify('{"correct":false,"feedback":"Aquí significa otra cosa."}')).toEqual({
      correct: false,
      feedback: "Aquí significa otra cosa.",
    });
  });

  it("devuelve null con JSON roto o correct que no es boolean", () => {
    expect(parseVerify("no es json")).toBeNull();
    expect(parseVerify("null")).toBeNull();
    expect(parseVerify('{"correct":"sí","feedback":"x"}')).toBeNull();
    expect(parseVerify('{"feedback":"x"}')).toBeNull();
  });

  it("recorta feedback a 200 caracteres y acepta que falte", () => {
    const long = parseVerify(
      JSON.stringify({ correct: true, feedback: "y".repeat(250) }),
    );
    expect(long?.feedback).toHaveLength(200);
    expect(parseVerify('{"correct":true}')).toEqual({ correct: true, feedback: "" });
  });
});

describe("parseExplain", () => {
  it("acepta una explicación válida", () => {
    expect(
      parseExplain('{"explanation":"Aquí «férrea» quiere decir firme e inflexible."}'),
    ).toEqual({ explanation: "Aquí «férrea» quiere decir firme e inflexible." });
  });

  it("devuelve null con JSON roto o explanation vacía", () => {
    expect(parseExplain("no es json")).toBeNull();
    expect(parseExplain("null")).toBeNull();
    expect(parseExplain('{"explanation":""}')).toBeNull();
    expect(parseExplain('{"explanation":"   "}')).toBeNull();
    expect(parseExplain('{"otro":"campo"}')).toBeNull();
  });

  it("recorta explicaciones pasadas de 400 caracteres", () => {
    const long = parseExplain(JSON.stringify({ explanation: "x".repeat(500) }));
    expect(long?.explanation).toHaveLength(400);
  });
});

describe("parseTip", () => {
  it("acepta un consejo válido con y sin acción", () => {
    expect(
      parseTip('{"tip":"Ayer retrocediste más de lo normal: prueba la regla.","action":"focus_ruler"}'),
    ).toEqual({
      tip: "Ayer retrocediste más de lo normal: prueba la regla.",
      action: "focus_ruler",
    });
    expect(parseTip('{"tip":"Buen ritmo esta semana."}')).toEqual({
      tip: "Buen ritmo esta semana.",
      action: "none",
    });
  });

  it("el silencio es un resultado válido", () => {
    expect(parseTip('{"tip":null,"action":"none"}')).toEqual({
      tip: null,
      action: "none",
    });
  });

  it("degrada una action desconocida a none sin tirar el tip", () => {
    expect(
      parseTip('{"tip":"Descansa la vista.","action":"pomodoro"}'),
    ).toEqual({ tip: "Descansa la vista.", action: "none" });
  });

  it("devuelve null con JSON roto, tip que no es string/null o pasado de 240", () => {
    expect(parseTip("no es json")).toBeNull();
    expect(parseTip("null")).toBeNull();
    expect(parseTip("[1,2]")).toBeNull();
    expect(parseTip('{"tip":42}')).toBeNull();
    expect(parseTip('{"tip":"   "}')).toBeNull();
    expect(
      parseTip(JSON.stringify({ tip: "x".repeat(241), action: "none" })),
    ).toBeNull();
  });
});

describe("sanitizeTipContext", () => {
  it("exige dayKey y acota el contexto a números y cadenas cortas", () => {
    expect(sanitizeTipContext(null)).toBeNull();
    expect(sanitizeTipContext({})).toBeNull();
    expect(sanitizeTipContext({ dayKey: 7 })).toBeNull();

    const ctx = sanitizeTipContext({
      dayKey: "2026-10-08",
      localHour: 27,
      daysSinceLastRead: 2.7,
      days: [
        {
          dayKey: "2026-10-07",
          minutes: 99999,
          regressions: 4,
          consults: 2,
          fatigue: 1,
          wpm: 210,
        },
        { dayKey: 5, minutes: "mucho" },
      ],
      focusMode: "ruler",
      weeklyGoalDays: 9,
    });
    expect(ctx).toEqual({
      dayKey: "2026-10-08",
      localHour: 23,
      daysSinceLastRead: 3,
      days: [
        {
          dayKey: "2026-10-07",
          minutes: 1440,
          regressions: 4,
          consults: 2,
          fatigue: 1,
          wpm: 210,
        },
        {
          dayKey: "",
          minutes: 0,
          regressions: 0,
          consults: 0,
          fatigue: 0,
          wpm: 0,
        },
      ],
      focusMode: "ruler",
      weeklyGoalDays: 7,
    });
  });

  it("corta el historial a 14 días y descarta campos extraños", () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      dayKey: `2026-10-${String(i + 1).padStart(2, "0")}`,
      minutes: 10,
      regressions: 0,
      consults: 0,
      fatigue: 0,
      wpm: 0,
    }));
    const ctx = sanitizeTipContext({ dayKey: "2026-10-08", days });
    expect(ctx?.days).toHaveLength(14);
    expect(ctx?.weeklyGoalDays).toBeNull();
    expect(ctx?.focusMode).toBe("off");
  });
});

// ---------- callDeepSeek ----------
// Todas las llaves y textos son falsos; nunca se usan secretos reales.

const fakeEnv = (overrides: Partial<WorkerEnv> = {}): WorkerEnv => ({
  DEEPSEEK_API_KEY: "sk-fake-para-tests",
  ...overrides,
});

const prompt = { system: "sys de prueba", user: "usr de prueba" };

const itemOptions = {
  operation: "item" as const,
  promptVersion: ITEM_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.item,
};

const enrichOptions = {
  operation: "enrich" as const,
  promptVersion: ENRICHMENT_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.enrich,
};

const verifyOptions = {
  operation: "verify" as const,
  promptVersion: VERIFY_PROMPT_VERSION,
  maxTokens: AI_CALL_LIMITS.verify,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[0] as [string, RequestInit];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callDeepSeek", () => {
  it("normaliza la URL del gateway, manda headers/body esperados y mapea usage", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: "deepseek-flash",
        choices: [
          { message: { content: '{"dato":1}' }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 40,
          total_tokens: 160,
          prompt_cache_hit_tokens: 64,
          prompt_cache_miss_tokens: 56,
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(
      fakeEnv({ AI_GATEWAY_URL: " https://gateway.ejemplo.test/lecta/ " }),
      prompt,
      itemOptions,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("https://gateway.ejemplo.test/lecta/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBe("Bearer sk-fake-para-tests");
    expect(headers["cf-aig-collect-log-payload"]).toBe("false");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe(ENRICHMENT_MODEL);
    expect(body.temperature).toBe(0.1);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(AI_CALL_LIMITS.item);
    expect(body.messages).toEqual([
      { role: "system", content: "sys de prueba" },
      { role: "user", content: "usr de prueba" },
    ]);

    expect(result).toMatchObject({
      ok: true,
      content: '{"dato":1}',
      model: "deepseek-flash",
      finishReason: "stop",
      usage: {
        promptTokens: 120,
        completionTokens: 40,
        totalTokens: 160,
        cacheHitTokens: 64,
        cacheMissTokens: 56,
        reasoningTokens: 12,
      },
    });
    if (result.ok) {
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("sin gateway usa api.deepseek.com y no manda cf-aig-collect-log-payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(fakeEnv(), prompt, verifyOptions);

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-aig-collect-log-payload"]).toBeUndefined();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(AI_CALL_LIMITS.verify);
    expect(result.ok).toBe(true);
  });

  it("emplea maxTokens 180 para evaluate y story", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callDeepSeek(fakeEnv(), prompt, EVALUATE_CALL_OPTIONS);
    let [, init] = lastCall(fetchMock);
    let body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(180);

    fetchMock.mockClear();
    await callDeepSeek(fakeEnv(), prompt, STORY_CALL_OPTIONS);
    [, init] = lastCall(fetchMock);
    body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(180);
  });

  it("deja los campos de usage en null cuando la respuesta no los trae", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
      ),
    );

    const result = await callDeepSeek(fakeEnv(), prompt, enrichOptions);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBeNull();
      expect(result.usage).toEqual({
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        cacheHitTokens: null,
        cacheMissTokens: null,
        reasoningTokens: null,
      });
    }
  });

  it("devuelve api-error con respuesta HTTP no exitosa tras agotar reintentos", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "fallo" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep: async () => {} },
    });
    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      status: 500,
      attempts: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("devuelve api-error cuando fetch rechaza (red caída o timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep: async () => {} },
    });
    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      status: null,
      attempts: 3,
    });
  });

  it("devuelve api-error con JSON roto o sin content en choices, sin reintentar", async () => {
    const brokenJson = vi.fn(
      async () => new Response("esto no es json{{{", { status: 200 }),
    );
    vi.stubGlobal("fetch", brokenJson);
    expect(await callDeepSeek(fakeEnv(), prompt, itemOptions)).toEqual({
      ok: false,
      reason: "api-error",
      status: 200,
      attempts: 1,
    });
    expect(brokenJson).toHaveBeenCalledTimes(1);

    const emptyChoices = vi.fn(async () => jsonResponse({ choices: [] }));
    vi.stubGlobal("fetch", emptyChoices);
    expect(await callDeepSeek(fakeEnv(), prompt, itemOptions)).toEqual({
      ok: false,
      reason: "api-error",
      status: 200,
      attempts: 1,
    });
    expect(emptyChoices).toHaveBeenCalledTimes(1);
  });

  it("reporta finish_reason 'length' sin convertirlo en otro resultado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            { message: { content: '{"parcial":' }, finish_reason: "length" },
          ],
        }),
      ),
    );
    const result = await callDeepSeek(fakeEnv(), prompt, itemOptions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finishReason).toBe("length");
  });

  it("devuelve not-configured sin llamar a fetch si falta DEEPSEEK_API_KEY", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callDeepSeek(
      fakeEnv({ DEEPSEEK_API_KEY: undefined }),
      prompt,
      itemOptions,
    );
    expect(result).toEqual({
      ok: false,
      reason: "not-configured",
      status: null,
      attempts: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lanza error de configuración si maxTokens no es un entero positivo", async () => {
    await expect(
      callDeepSeek(fakeEnv(), prompt, { ...itemOptions, maxTokens: 0 }),
    ).rejects.toThrow();
    await expect(
      callDeepSeek(fakeEnv(), prompt, { ...itemOptions, maxTokens: 1.5 }),
    ).rejects.toThrow();
  });

  it("usa un timeout de 8 s por intento", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({
        choices: [{ message: { content: "ok" } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await callDeepSeek(fakeEnv(), prompt, itemOptions);
    expect(AI_CALL_TIMEOUT_MS).toBe(8_000);
  });

  it("reintenta un 429 y logra el intento siguiente", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "saturado" }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"dato":1}' }, finish_reason: "stop" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep },
    });

    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(400);
  });

  it("agota los intentos ante 429 persistente y reporta rate-limited", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "saturado" }, 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep: async () => {} },
    });

    expect(result).toEqual({
      ok: false,
      reason: "rate-limited",
      status: 429,
      attempts: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reintenta 504 y errores de red, pero no un 4xx no transitorio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "timeout" }, 504))
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep: async () => {} },
    });
    expect(result).toMatchObject({ ok: true, attempts: 3 });

    const badRequest = vi.fn(async () => jsonResponse({ error: "bad" }, 400));
    vi.stubGlobal("fetch", badRequest);
    const rejected = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep: async () => {} },
    });
    expect(rejected).toEqual({
      ok: false,
      reason: "api-error",
      status: 400,
      attempts: 1,
    });
    expect(badRequest).toHaveBeenCalledTimes(1);
  });

  it("honra Retry-After acotado sobre el backoff exponencial", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const retryAfter = (seconds: string) =>
      new Response(JSON.stringify({ error: "saturado" }), {
        status: 429,
        headers: { "retry-after": seconds },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(retryAfter("2"))
      .mockResolvedValueOnce(retryAfter("600"))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "ok" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek(fakeEnv(), prompt, {
      ...itemOptions,
      retry: { sleep },
    });

    expect(result.ok).toBe(true);
    expect(sleep.mock.calls[0]?.[0]).toBe(2_000);
    // 600 s se acota al tope de 10 s.
    expect(sleep.mock.calls[1]?.[0]).toBe(10_000);
  });
});

describe("requestEnrichment", () => {
  it("llama a la IA con el límite de la operación enrich", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lemma: "casa",
                pos: "sustantivo",
                freqRank: 50,
                forms: ["casas"],
                senses: [
                  {
                    definition: "Edificio para habitar.",
                    example: "Vivo en una casa.",
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestEnrichment(fakeEnv(), {
      form: "casa",
      language: "es",
    });

    expect(result.ok).toBe(true);
    const [, init] = lastCall(fetchMock);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(AI_CALL_LIMITS.enrich);
  });

  it("emplea el prompt de enriquecimiento bilingüe para inglés con lengua materna español", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lemma: "wander",
                pos: "verbo",
                freqRank: 800,
                forms: ["wandered", "wandering", "wanders"],
                senses: [
                  {
                    definition: "Caminar o vagar sin rumbo fijo.",
                    example: "He loved to wander through the quiet streets.",
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestEnrichment(fakeEnv(), {
      form: "wandering",
      language: "en",
      nativeLanguage: "es",
      context: "He was wandering through the forest.",
    });

    expect(result.ok).toBe(true);
    const [, init] = lastCall(fetchMock);
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0].content).toContain("lexicógrafo bilingüe");
    expect(body.messages[0].content).toContain("definición breve y clara en español");
    expect(body.messages[0].content).toContain("en inglés natural");
    expect(body.messages[1].content).toContain("idioma: en, lengua materna del lector: es");
  });
});

describe("Language learning prompts", () => {
  it("buildEnrichmentSystemPrompt adapta las instrucciones al par de idiomas", () => {
    const esPrompt = buildEnrichmentSystemPrompt("es", "es");
    expect(esPrompt).toContain("Eres un lexicógrafo de español");

    const enForEsPrompt = buildEnrichmentSystemPrompt("en", "es");
    expect(enForEsPrompt).toContain("lexicógrafo bilingüe inglés-español");
    expect(enForEsPrompt).toContain("definición breve y clara en español");

    const esForEnPrompt = buildEnrichmentSystemPrompt("es", "en");
    expect(esForEnPrompt).toContain("bilingual Spanish-English lexicographer");
  });

  it("buildExplainSystemPrompt adapta el rol de tutor al idioma del lector", () => {
    const esPrompt = buildExplainSystemPrompt("es", "es");
    expect(esPrompt).toContain("Eres un lexicógrafo de español");

    const enForEs = buildExplainSystemPrompt("en", "es");
    expect(enForEs).toContain("profesor bilingüe inglés-español");
    expect(enForEs).toContain("Explicas en español");

    const esForEn = buildExplainSystemPrompt("es", "en");
    expect(esForEn).toContain("bilingual Spanish-English language tutor");
  });

  it("buildExplainPrompt incluye instrucción de idioma de destino cuando difiere", () => {
    expect(buildExplainPrompt("casa", "es", "Vivo en una casa.", "es")).toBe(
      "Palabra: «casa» (idioma: es)\nOración: «Vivo en una casa.»",
    );
    expect(buildExplainPrompt("wander", "en", "He began to wander.", "es")).toBe(
      "Palabra: «wander» (idioma: en (explicar en: es))\nOración: «He began to wander.»",
    );
  });

  it("buildItemSystemPrompt adapta los distractores y la oración para estudiantes de inglés", () => {
    const esPrompt = buildItemSystemPrompt("es", "es");
    expect(esPrompt).toContain("oración en español neutro");

    const enPrompt = buildItemSystemPrompt("en", "es");
    expect(enPrompt).toContain("oración en inglés natural");
    expect(enPrompt).toContain('"distractors" son exactamente 3 definiciones breves en español');
  });

  it("buildVerifySystemPrompt y buildVerifyPrompt adaptan la revisión a inglés", () => {
    const esPrompt = buildVerifySystemPrompt("es", "es");
    expect(esPrompt).toContain("Eres un corrector de español");

    const enPrompt = buildVerifySystemPrompt("en", "es");
    expect(enPrompt).toContain("profesor de inglés para hispanohablantes");
    expect(enPrompt).toContain("feedback\" es una sola línea en español");

    expect(buildVerifyPrompt("wander", "vagar", "I wandered alone.", "en")).toContain(
      "Palabra: «wander» (inglés)",
    );
  });
});

describe("createTtlCache", () => {
  it("sirve lo guardado dentro del TTL y devuelve undefined al vencer", () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000 });
    cache.set("es:casa:ctx", "definición");
    expect(cache.get("es:casa:ctx")).toBe("definición");
    expect(cache.get("es:otra:ctx")).toBeUndefined();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 1_001);
      expect(cache.get("es:casa:ctx")).toBeUndefined();
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("desaloja la entrada más vieja al superar el tope", () => {
    const cache = createTtlCache<number>({ maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("d")).toBe(4);
  });

  it("reescribir una clave la refresca sin duplicarla", () => {
    const cache = createTtlCache<number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });
});

describe("parseEvaluateSentence", () => {
  it("acepta una evaluación positiva válida", () => {
    const raw = JSON.stringify({
      isCorrect: true,
      score: 95,
      catReaction: "purring",
      feedback: "¡Miau! Has capturado el matiz exacto con mucha elegancia.",
      improvedVersion: null,
    });
    expect(parseEvaluateSentence(raw)).toEqual({
      isCorrect: true,
      score: 95,
      catReaction: "purring",
      feedback: "¡Miau! Has capturado el matiz exacto con mucha elegancia.",
      improvedVersion: null,
    });
  });

  it("acepta una evaluación con corrección y propuesta mejorada", () => {
    const raw = JSON.stringify({
      isCorrect: false,
      score: 45,
      catReaction: "curious",
      feedback: "La palabra se usa para describir ideas duraderas, no un objeto roto.",
      improvedVersion: "Su devoción por el arte era perenne a pesar de los años.",
    });
    expect(parseEvaluateSentence(raw)).toEqual({
      isCorrect: false,
      score: 45,
      catReaction: "curious",
      feedback: "La palabra se usa para describir ideas duraderas, no un objeto roto.",
      improvedVersion: "Su devoción por el arte era perenne a pesar de los años.",
    });
  });

  it("normaliza score fuera de rango y asigna reaction por defecto si es inválida", () => {
    const raw = JSON.stringify({
      isCorrect: true,
      score: 150,
      catReaction: "angry",
      feedback: "Bien hecho.",
    });
    const parsed = parseEvaluateSentence(raw);
    expect(parsed?.score).toBe(100);
    expect(parsed?.catReaction).toBe("purring");

    const rawUnder = JSON.stringify({
      isCorrect: false,
      score: -20,
      catReaction: "dancing",
      feedback: "Prueba otra vez.",
    });
    const parsedUnder = parseEvaluateSentence(rawUnder);
    expect(parsedUnder?.score).toBe(0);
    expect(parsedUnder?.catReaction).toBe("curious");
  });

  it("asigna score por defecto si score no es número", () => {
    const parsedOk = parseEvaluateSentence(
      JSON.stringify({ isCorrect: true, feedback: "Bien." }),
    );
    expect(parsedOk?.score).toBe(100);

    const parsedFail = parseEvaluateSentence(
      JSON.stringify({ isCorrect: false, feedback: "Mal." }),
    );
    expect(parsedFail?.score).toBe(40);
  });

  it("devuelve null con JSON roto, no objeto, sin isCorrect o con feedback vacío", () => {
    expect(parseEvaluateSentence("roto")).toBeNull();
    expect(parseEvaluateSentence("null")).toBeNull();
    expect(parseEvaluateSentence("[]")).toBeNull();
    expect(parseEvaluateSentence(JSON.stringify({ isCorrect: "si", feedback: "ok" }))).toBeNull();
    expect(parseEvaluateSentence(JSON.stringify({ isCorrect: true, feedback: "" }))).toBeNull();
    expect(parseEvaluateSentence(JSON.stringify({ isCorrect: true, feedback: "   " }))).toBeNull();
  });

  it("recorta feedback e improvedVersion a 300 caracteres", () => {
    const long = parseEvaluateSentence(
      JSON.stringify({
        isCorrect: true,
        feedback: "f".repeat(400),
        improvedVersion: "v".repeat(400),
      }),
    );
    expect(long?.feedback).toHaveLength(300);
    expect(long?.improvedVersion).toHaveLength(300);
  });
});

describe("parseMicroStory", () => {
  it("acepta un micro-relato válido con palabras entre corchetes dobles", () => {
    const raw = JSON.stringify({
      title: "La sombra del jardín",
      story: "El viento traía un perfume [[antiguo]] mientras caminaba por la colina de olivos.",
      wordsUsed: ["antiguo"],
    });
    expect(parseMicroStory(raw)).toEqual({
      title: "La sombra del jardín",
      story: "El viento traía un perfume [[antiguo]] mientras caminaba por la colina de olivos.",
      wordsUsed: ["antiguo"],
    });
  });

  it("devuelve null si no contiene corchetes dobles en la historia", () => {
    const raw = JSON.stringify({
      title: "Sin corchetes",
      story: "El viento traía un perfume antiguo mientras caminaba por la colina.",
      wordsUsed: ["antiguo"],
    });
    expect(parseMicroStory(raw)).toBeNull();
  });

  it("devuelve null con JSON roto, título vacío o historia vacía", () => {
    expect(parseMicroStory("no es json")).toBeNull();
    expect(parseMicroStory("null")).toBeNull();
    expect(parseMicroStory(JSON.stringify({ title: "", story: "[[hola]]" }))).toBeNull();
    expect(parseMicroStory(JSON.stringify({ title: "Título", story: "" }))).toBeNull();
  });

  it("filtra elementos vacíos o no-strings en wordsUsed", () => {
    const raw = JSON.stringify({
      title: "Cuento",
      story: "Una historia con [[perenne]] y [[sombra]].",
      wordsUsed: ["perenne", "", null, 42, " sombra "],
    });
    const parsed = parseMicroStory(raw);
    expect(parsed?.wordsUsed).toEqual(["perenne", "sombra"]);
  });

  it("recorta el título a 100 caracteres y la historia a 600", () => {
    const raw = JSON.stringify({
      title: "t".repeat(150),
      story: "[[palabra]] " + "s".repeat(700),
      wordsUsed: ["palabra"],
    });
    const parsed = parseMicroStory(raw);
    expect(parsed?.title).toHaveLength(100);
    expect(parsed?.story).toHaveLength(600);
  });
});

describe("buildEvaluatePrompt & buildStoryPrompt", () => {
  it("buildEvaluatePrompt incluye palabra, acepción, oración y libro si existe", () => {
    const promptWithoutBook = buildEvaluatePrompt(
      "perenne",
      "Que dura siempre",
      "Los pinos tienen hojas perennes.",
    );
    expect(promptWithoutBook).toContain("Palabra: «perenne»");
    expect(promptWithoutBook).toContain("Acepción esperada: «Que dura siempre»");
    expect(promptWithoutBook).toContain("Oración del lector: «Los pinos tienen hojas perennes.»");
    expect(promptWithoutBook).not.toContain("Libro de origen");

    const promptWithBook = buildEvaluatePrompt(
      "perenne",
      "Que dura siempre",
      "Los pinos tienen hojas perennes.",
      "Cien años de soledad",
    );
    expect(promptWithBook).toContain("Libro de origen: «Cien años de soledad»");
  });

  it("buildStoryPrompt lista las palabras solicitadas y el tono", () => {
    const prompt = buildStoryPrompt(
      [
        { word: "efímero", meaning: "Que dura poco" },
        { word: "tintineo" },
      ],
      "Misterio nocturno",
    );
    expect(prompt).toContain("• «efímero»: Que dura poco");
    expect(prompt).toContain("• «tintineo»");
    expect(prompt).toContain("Estilo o tono: Misterio nocturno");
  });
});

describe("parsePassageExplanation & buildExplainInPassagePrompt", () => {
  it("acepta una explicación válida en pasaje", () => {
    const raw = JSON.stringify({
      contextualMeaning: "Aquí «azur» no es solo el color azul, sino el ideal artístico.",
      toneAndNuance: "Poético y elevado",
      catTip: "Rubén Darío usa esta palabra como emblema.",
    });
    expect(parsePassageExplanation(raw)).toEqual({
      contextualMeaning: "Aquí «azur» no es solo el color azul, sino el ideal artístico.",
      toneAndNuance: "Poético y elevado",
      catTip: "Rubén Darío usa esta palabra como emblema.",
    });
  });

  it("devuelve null con JSON inválido o sin contextualMeaning", () => {
    expect(parsePassageExplanation("no-json")).toBeNull();
    expect(parsePassageExplanation("null")).toBeNull();
    expect(parsePassageExplanation(JSON.stringify({ toneAndNuance: "Poético" }))).toBeNull();
    expect(parsePassageExplanation(JSON.stringify({ contextualMeaning: "" }))).toBeNull();
  });

  it("aplica valores por defecto si toneAndNuance o catTip están vacíos", () => {
    const raw = JSON.stringify({
      contextualMeaning: "Significado concreto.",
      toneAndNuance: "",
      catTip: "",
    });
    const parsed = parsePassageExplanation(raw);
    expect(parsed?.contextualMeaning).toBe("Significado concreto.");
    expect(parsed?.toneAndNuance).toBe("Literario");
    expect(parsed?.catTip).toBeTruthy();
  });

  it("buildExplainInPassagePrompt formatea palabra, pasaje, obra y autor", () => {
    const prompt = buildExplainInPassagePrompt({
      word: "azur",
      sentence: "Bajo la bóveda del azur resplandecían los astros.",
      bookTitle: "Azul...",
      author: "Rubén Darío",
    });
    expect(prompt).toContain("Palabra o expresión a explicar: «azur»");
    expect(prompt).toContain("Pasaje u oración: «Bajo la bóveda del azur resplandecían los astros.»");
    expect(prompt).toContain("Obra: «Azul...»");
    expect(prompt).toContain("Autor: «Rubén Darío»");
  });

  it("buildExplainInPassagePrompt omite campos opcionales no provistos", () => {
    const prompt = buildExplainInPassagePrompt({
      sentence: "Una frase solitaria.",
    });
    expect(prompt).not.toContain("Palabra o expresión a explicar");
    expect(prompt).toContain("Pasaje u oración: «Una frase solitaria.»");
    expect(prompt).not.toContain("Obra:");
    expect(prompt).not.toContain("Autor:");
  });

  it("buildExplainInPassagePrompt incluye instrucción L1/L2 para libros en inglés con lector hispanohablante", () => {
    const prompt = buildExplainInPassagePrompt({
      word: "wander",
      sentence: "He began to wander across the silent moors.",
      language: "en",
      nativeLanguage: "es",
    });
    expect(prompt).toContain("Instrucción L1/L2");
    expect(prompt).toContain("El libro está en inglés y el lector es hispanohablante");
  });
});

describe("page_recap (Recuperar el hilo)", () => {
  it("respeta el límite de 90 tokens y versión de prompt", () => {
    expect(PAGE_RECAP_CALL_OPTIONS.maxTokens).toBe(90);
    expect(PAGE_RECAP_CALL_OPTIONS.promptVersion).toBe(PAGE_RECAP_PROMPT_VERSION);
    expect(PAGE_RECAP_PROMPT_VERSION).toBe("page-recap-v1");
  });

  it("parsePageRecap valida JSON correcto con bullets y hookQuestion", () => {
    const raw = JSON.stringify({
      bullets: ["El héroe llega a la cumbre.", "Encuentra la puerta cerrada."],
      hookQuestion: "¿Cómo logrará entrar?",
    });
    const parsed = parsePageRecap(raw);
    expect(parsed).toEqual({
      bullets: ["El héroe llega a la cumbre.", "Encuentra la puerta cerrada."],
      hookQuestion: "¿Cómo logrará entrar?",
    });
  });

  it("parsePageRecap devuelve null para JSON inválido o sin contenido", () => {
    expect(parsePageRecap("no json")).toBeNull();
    expect(parsePageRecap("null")).toBeNull();
    expect(parsePageRecap(JSON.stringify({}))).toBeNull();
  });

  it("buildPageRecapPrompt incluye texto, libro y capítulo", () => {
    const prompt = buildPageRecapPrompt({
      text: "Caminaba sin rumbo por la calle desierta.",
      bookTitle: "La Ciudad Invisible",
      chapterTitle: "Capítulo 1",
    });
    expect(prompt).toContain("Libro: «La Ciudad Invisible»");
    expect(prompt).toContain("Capítulo: «Capítulo 1»");
    expect(prompt).toContain("Caminaba sin rumbo por la calle desierta.");
  });

  it("deterministicPageRecapFallback genera bullets y pregunta a partir del texto", () => {
    const text =
      "El sol brillaba con una fuerza inusual sobre la llanura. A lo lejos se divisaban las primeras torres de la ciudad.";
    const fallback = deterministicPageRecapFallback(text);
    expect(fallback.bullets).toHaveLength(2);
    expect(fallback.bullets[0]).toContain("El sol brillaba");
    expect(fallback.hookQuestion).toBeTruthy();
    expect(fallback.fallback).toBe(true);
  });
});

describe("character-recap (Innovación 2)", () => {
  it("parseCharacterRecap acepta un JSON válido", () => {
    const raw = JSON.stringify({
      summary: "Aureliano es el segundo hijo de la familia, silencioso y retraído.",
      role: "Protagonista / Coronel",
    });
    const parsed = parseCharacterRecap(raw);
    expect(parsed).toEqual({
      summary: "Aureliano es el segundo hijo de la familia, silencioso y retraído.",
      role: "Protagonista / Coronel",
    });
  });

  it("parseCharacterRecap devuelve null para JSON roto o vacío", () => {
    expect(parseCharacterRecap("invalido")).toBeNull();
    expect(parseCharacterRecap(JSON.stringify({}))).toBeNull();
    expect(parseCharacterRecap(JSON.stringify({ summary: "" }))).toBeNull();
  });

  it("buildCharacterRecapPrompt incluye entidad, libro, capítulo y fragmentos", () => {
    const prompt = buildCharacterRecapPrompt({
      entityName: "Aureliano",
      bookTitle: "Cien años de soledad",
      currentChapterTitle: "Capítulo 2",
      excerptsSoFar: [
        "Aureliano aprendió a leer con los pergaminos.",
        "Pasaba las tardes en el taller.",
      ],
    });
    expect(prompt).toContain("«Aureliano»");
    expect(prompt).toContain("«Cien años de soledad»");
    expect(prompt).toContain("«Capítulo 2»");
    expect(prompt).toContain("1. «Aureliano aprendió a leer con los pergaminos.»");
  });

  it("deterministicCharacterRecapFallback provee resumen sin red", () => {
    const fallback = deterministicCharacterRecapFallback("Melquíades", [
      "Melquíades era un gitano corpulento de barba montaraz.",
    ]);
    expect(fallback.summary).toContain("Melquíades");
    expect(fallback.summary).toContain("Primera aparición registrada");
    expect(fallback.fallback).toBe(true);
  });

  it("expone constantes de versión y opciones de llamada para character recap", () => {
    expect(CHARACTER_RECAP_PROMPT_VERSION).toBe("character-recap-v1");
    expect(CHARACTER_RECAP_CALL_OPTIONS.operation).toBe("character_recap");
    expect(CHARACTER_RECAP_CALL_OPTIONS.maxTokens).toBe(256);
  });
});

describe("Fase 3: Presupuestos Estrictos y Prompts Compactos Zero-Friction", () => {
  describe("clampInputText", () => {
    it("mantiene textos cortos intactos", () => {
      expect(clampInputText("hola mundo", 20)).toBe("hola mundo");
    });

    it("normaliza espacios repetidos", () => {
      expect(clampInputText("hola    mundo   literario", 50)).toBe("hola mundo literario");
    });

    it("recorta en el límite de palabra sin cortar por la mitad", () => {
      const text = "Este es un fragmento de lectura que debe ser recortado con sumo cuidado";
      const clamped = clampInputText(text, 35);
      expect(clamped.length).toBeLessThanOrEqual(35);
      expect(clamped).toBe("Este es un fragmento de lectura");
    });

    it("corta directamente si no hay espacio razonable", () => {
      const text = "SupercalifragilisticoespialidosoExtraordinario";
      const clamped = clampInputText(text, 20);
      expect(clamped).toBe("Supercalifragilistic");
    });
  });

  describe("AI_TASK_BUDGETS", () => {
    it("define las 4 tareas con sus presupuestos exactos", () => {
      expect(AI_TASK_BUDGETS.word_context).toEqual({
        task: "word_context",
        maxInputChars: 280,
        maxOutputTokens: 75,
        temperature: 0.15,
      });

      expect(AI_TASK_BUDGETS.paragraph_translate).toEqual({
        task: "paragraph_translate",
        maxInputChars: 900,
        maxOutputTokens: 260,
        temperature: 0.1,
      });

      expect(AI_TASK_BUDGETS.page_recap).toEqual({
        task: "page_recap",
        maxInputChars: 2400,
        maxOutputTokens: 140,
        temperature: 0.25,
      });

      expect(AI_TASK_BUDGETS.character_cards).toEqual({
        task: "character_cards",
        maxInputChars: 1600,
        maxOutputTokens: 120,
        temperature: 0.2,
      });
    });
  });

  describe("buildContextualWordPrompt", () => {
    it("construye un prompt compacto con presupuesto word_context", () => {
      const { prompt, budget } = buildContextualWordPrompt(
        "abigarrado",
        "El mercado ofrecía un espectáculo abigarrado y bullicioso.",
        "es",
      );
      expect(budget).toEqual(AI_TASK_BUDGETS.word_context);
      expect(prompt).toContain('significa "abigarrado" (es)');
      expect(prompt).toContain('exactamente en esta frase: "El mercado ofrecía un espectáculo abigarrado y bullicioso."');
      expect(prompt).toContain("Sin introducciones");
      expect(prompt).toContain("máx 18 palabras");
    });

    it("recorta palabras y oraciones excesivamente largas", () => {
      const longSentence = "palabra ".repeat(100);
      const { prompt } = buildContextualWordPrompt("palabra", longSentence, "en");
      expect(prompt.length).toBeLessThanOrEqual(280 + 130);
      expect(prompt).toContain("(en)");
    });
  });

  describe("buildParagraphTranslationPrompt", () => {
    it("construye el prompt literario con presupuesto paragraph_translate", () => {
      const paragraph = "The old town was shrouded in an ethereal mist as dawn broke over the silent towers.";
      const { prompt, budget } = buildParagraphTranslationPrompt(paragraph);
      expect(budget).toEqual(AI_TASK_BUDGETS.paragraph_translate);
      expect(prompt).toContain("Traduce al español manteniendo el tono literario.");
      expect(prompt).toContain("Devuelve SOLO la traducción:");
      expect(prompt).toContain(paragraph);
    });

    it("recorta párrafos que excedan maxInputChars", () => {
      const longPara = "A ".repeat(1200);
      const { prompt } = buildParagraphTranslationPrompt(longPara);
      expect(prompt.length).toBeLessThanOrEqual(900 + 80);
    });
  });

  describe("buildPageRecapPrompt (sobrecarga comprimida)", () => {
    it("cuando recibe string genera prompt comprimido con 3 viñetas y presupuesto", () => {
      const pagesText = "Página 1: El viajero divisó la montaña. Página 2: Empezó a nevar copiosamente.";
      const result = buildPageRecapPrompt(pagesText);
      expect(typeof result).toBe("object");
      expect(result.budget).toEqual(AI_TASK_BUDGETS.page_recap);
      expect(result.prompt).toContain("Resume en exactamente 3 viñetas cortas");
      expect(result.prompt).toContain("Prohibido inventar o adelantar hechos");
      expect(result.prompt).toContain("Página 1: El viajero divisó la montaña.");
    });

    it("recorta textos de entrada que excedan 2400 caracteres", () => {
      const longText = "Texto de página. ".repeat(250);
      const result = buildPageRecapPrompt(longText);
      expect(result.prompt.length).toBeLessThanOrEqual(2400 + 175);
    });
  });

  describe("buildCharacterCardsPrompt", () => {
    it("construye prompt anti-spoilers con presupuesto character_cards", () => {
      const names = ["Aureliano", "Úrsula", "José Arcadio", "Pilar Ternera", "Rebeca"];
      const snippet = "Aureliano trabajaba en los pescaditos de oro mientras Úrsula cuidaba la casa.";
      const { prompt, budget } = buildCharacterCardsPrompt(names, snippet);
      expect(budget).toEqual(AI_TASK_BUDGETS.character_cards);
      expect(prompt).toContain("Con base SOLO en este contexto previo del libro");
      expect(prompt).toContain("describe en 1 línea corta (máx 12 palabras)");
      expect(prompt).toContain("Aureliano, Úrsula, José Arcadio, Pilar Ternera");
      expect(prompt).not.toContain("Rebeca");
      expect(prompt).toContain(snippet);
    });
  });
});




