import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, clearExplainPassageCache, type ExplainInPassageResponse } from "./app";
import * as dbModule from "./db";
import {
  buildCompactExplainPrompt,
  normalizePassage,
  EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS,
} from "./ai";

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("POST /api/ai/explain-in-passage (FASE 3: Latencia, Caché y Anti-Duplicación)", () => {
  const fakeEnv = {
    DEEPSEEK_API_KEY: "test-deepseek-key",
  };

  const capturedFetchCalls: Array<{
    messages: Array<{ role: string; content: string }>;
    max_tokens: number;
    model: string;
  }> = [];

  beforeEach(() => {
    clearExplainPassageCache();
    capturedFetchCalls.length = 0;
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: "user-anti-abandono" } });

    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, callback) => {
      return callback({
        query: vi.fn().mockResolvedValue({ rows: [{ units_used: 1 }] }),
      } as unknown as Parameters<typeof callback>[0]);
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const parsedBody = JSON.parse(init?.body as string);
      capturedFetchCalls.push(parsedBody);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  contextualMeaning: "Connota una serenidad espiritual imperturbable ante la muerte.",
                  toneAndNuance: "Filosófico / Estoico",
                  catTip: "Epicuro concebía este estado como la cima del bienestar.",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 38, completion_tokens: 22, total_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  });

  // Caso 1: Test de Payload
  it("1. Test de Payload: acepta 'word', 'lemma', 'localDefinition' y 'passage'", async () => {
    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: "ataraxia",
          lemma: "ataraxia",
          localDefinition: "Estado de imperturbabilidad y serenidad del ánimo.",
          passage: "Buscaba la ataraxia del alma en tiempos inciertos.",
        }),
      },
      fakeEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ExplainInPassageResponse;
    expect(data).toHaveProperty("contextualMeaning");
    expect(data).toHaveProperty("contextualNuance");
    expect(data).toHaveProperty("dictionaryEntry");
    expect(data.dictionaryEntry).toEqual({
      word: "ataraxia",
      lemma: "ataraxia",
      definition: "Estado de imperturbabilidad y serenidad del ánimo.",
    });
  });

  // Caso 2: Test de Preservación de Diccionario
  it("2. Test de Preservación de Diccionario: no descarta ni pisa los datos de lookupWord", async () => {
    const localDef = "Tranquilidad y total ausencia de deseos o temores.";
    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: "ataraxia",
          lemma: "ataraxia",
          localDefinition: localDef,
          passage: "Alcanzó la ataraxia en su retiro solitario.",
        }),
      },
      fakeEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ExplainInPassageResponse;

    // El resultado local de lookupWord se preserva estructuradamente
    expect(data.dictionaryEntry).toBeDefined();
    expect(data.dictionaryEntry?.definition).toBe(localDef);
    expect(data.dictionary?.definition).toBe(localDef);
    // Y convive con el matiz contextual de la IA sin pisarse
    expect(data.contextualNuance).toContain("serenidad");
  });

  // Caso 3: Test de No-Duplicación y Acortamiento Radical (max_tokens: 80)
  it("3. Test de No-Duplicación: usa prompt ultra-compacto, max_tokens=80 y restringe repetición", async () => {
    const word = "efímero";
    const localDefinition = "Que dura poco tiempo o es pasajero.";
    const passage = "La gloria es un destello efímero entre las sombras.";

    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word,
          lemma: "efímero",
          localDefinition,
          passage,
        }),
      },
      fakeEnv,
    );

    expect(res.status).toBe(200);
    expect(capturedFetchCalls.length).toBe(1);

    const deepseekCall = capturedFetchCalls[0];
    // max_tokens acotado a 80 para baja latencia (<600 ms)
    expect(deepseekCall.max_tokens).toBe(80);
    expect(EXPLAIN_PASSAGE_COMPACT_CALL_OPTIONS.maxTokens).toBe(80);

    // Prompt ultra-compacto con restricción estricta anti-duplicación
    const systemPrompt = deepseekCall.messages.find((m) => m.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("El lector ya ve la definición de diccionario");
    expect(systemPrompt).toContain("Prohibido repetir la definición literal o resumir todo el pasaje");
    expect(systemPrompt).toContain("En máximo 25 palabras y 1 sola oración");

    // Respuesta estructura por separado dictionary y contextualNuance
    const data = (await res.json()) as ExplainInPassageResponse;
    expect(data.dictionary).toBeDefined();
    expect(data.dictionary?.definition).toBe(localDefinition);
    expect(data.contextualNuance).toBeDefined();
    expect(data.contextualNuance).not.toBe(localDefinition);
  });

  // Caso 4: Test de Cache Hit con Normalización de Whitespace
  it("4. Test de Cache Hit: dos llamadas con diferente whitespace dan cache hit sin llamar a la IA de nuevo", async () => {
    const payload1 = {
      word: "ataraxia",
      passage: "   Buscaba    la ataraxia \n  del alma.   ",
    };

    const payload2 = {
      word: "ataraxia",
      passage: "Buscaba la ataraxia del alma.",
    };

    // Primera llamada
    const res1 = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload1),
      },
      fakeEnv,
    );
    expect(res1.status).toBe(200);
    expect(capturedFetchCalls.length).toBe(1);
    const data1 = (await res1.json()) as ExplainInPassageResponse;
    expect(data1.cached).toBeUndefined();

    // Segunda llamada con whitespace diferente pero mismo contenido normalizado
    const res2 = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload2),
      },
      fakeEnv,
    );
    expect(res2.status).toBe(200);
    // No debe haber llamado a fetch otra vez: cache hit
    expect(capturedFetchCalls.length).toBe(1);
    const data2 = (await res2.json()) as ExplainInPassageResponse;
    expect(data2.cached).toBe(true);
    expect(data2.contextualMeaning).toBe(data1.contextualMeaning);
  });

  // Caso 5: Validación de Payloads y Errores HTTP
  it("5. Test de Validación de Payload: rechaza pasaje ausente o excesivo con HTTP 400", async () => {
    const resNoPassage = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: "hola" }),
      },
      fakeEnv,
    );
    expect(resNoPassage.status).toBe(400);
    const jsonNoPassage = (await resNoPassage.json()) as { error: string };
    expect(jsonNoPassage.error).toContain("Falta el pasaje");

    const resLongPassage = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passage: "a".repeat(801) }),
      },
      fakeEnv,
    );
    expect(resLongPassage.status).toBe(400);
    const jsonLong = (await resLongPassage.json()) as { error: string };
    expect(jsonLong.error).toContain("no puede superar 800 caracteres");
  });

  it("6. Test de Autenticación: rechaza petición no autenticada con HTTP 401", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passage: "Un pasaje cualquiera." }),
      },
      fakeEnv,
    );
    expect(res.status).toBe(401);
  });

  it("7. Test de Cuota (014_ai_quota.sql): devuelve HTTP 429 al superar el límite horario", async () => {
    // Simulamos que el UPSERT atómico en lecta_ai_quota devuelve 0 filas (límite superado)
    vi.spyOn(dbModule, "withClient").mockImplementationOnce(async (_env, callback) => {
      return callback({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Parameters<typeof callback>[0]);
    });

    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passage: "Un pasaje cuando la cuota está agotada." }),
      },
      fakeEnv,
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("límite de explicaciones por hora");
  });

  it("8. Test de Resiliencia del Proveedor: maneja timeouts o fallos de red con 502/503 controlado", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Provider Network Timeout"));

    const res = await app.request(
      "/api/ai/explain-in-passage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passage: "Un pasaje durante un corte del proveedor." }),
      },
      fakeEnv,
    );
    expect([502, 503]).toContain(res.status);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBeDefined();
    expect(json.error).not.toContain("Provider Network Timeout"); // No filtra stacktraces
  });
});

describe("normalizePassage & buildCompactExplainPrompt", () => {
  it("normalizePassage limpia espacios repetidos, saltos de línea y convierte a minúsculas", () => {
    const raw = "   En   un \n  lugar  de   la   Mancha...   ";
    expect(normalizePassage(raw)).toBe("en un lugar de la mancha...");
  });

  it("buildCompactExplainPrompt formula el prompt según los requisitos de latencia", () => {
    const prompt = buildCompactExplainPrompt({
      word: "resiliencia",
      localDefinition: "Capacidad de adaptación frente a un agente perturbador.",
      passage: "Mostró una asombrosa resiliencia.",
    });

    expect(prompt).toContain("El lector ya ve la definición de diccionario de 'resiliencia'");
    expect(prompt).toContain("Capacidad de adaptación");
    expect(prompt).toContain("En máximo 25 palabras y 1 sola oración");
    expect(prompt).toContain("Prohibido repetir la definición literal o resumir todo el pasaje");
  });
});
