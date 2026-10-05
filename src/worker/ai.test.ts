import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_CALL_LIMITS,
  callDeepSeek,
  ENRICHMENT_MODEL,
  ENRICHMENT_PROMPT_VERSION,
  ITEM_PROMPT_VERSION,
  parseItem,
  parseVerify,
  requestEnrichment,
  VERIFY_PROMPT_VERSION,
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

  it("devuelve api-error con respuesta HTTP no exitosa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "fallo" }, 500)),
    );
    const result = await callDeepSeek(fakeEnv(), prompt, itemOptions);
    expect(result).toEqual({ ok: false, reason: "api-error" });
  });

  it("devuelve api-error cuando fetch rechaza (red caída o timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await callDeepSeek(fakeEnv(), prompt, itemOptions);
    expect(result).toEqual({ ok: false, reason: "api-error" });
  });

  it("devuelve api-error con JSON roto o sin content en choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("esto no es json{{{", { status: 200 })),
    );
    expect(await callDeepSeek(fakeEnv(), prompt, itemOptions)).toEqual({
      ok: false,
      reason: "api-error",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ choices: [] })),
    );
    expect(await callDeepSeek(fakeEnv(), prompt, itemOptions)).toEqual({
      ok: false,
      reason: "api-error",
    });
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
    expect(result).toEqual({ ok: false, reason: "not-configured" });
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
});
