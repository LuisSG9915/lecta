import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, computeAiCacheKey, getCachedAiText, setCachedAiText } from "./app";
import type { WorkerEnv } from "./db";
import * as dbModule from "./db";
import { resetClientErrorLimiters } from "./client-errors";

describe("GET /api/health", () => {
  it("devuelve 503 con db unreachable si la base de datos no está disponible", async () => {
    vi.spyOn(dbModule, "withClient").mockResolvedValueOnce(undefined);
    const response = await app.request("/api/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, db: "unreachable" });
  });

  it("devuelve 200 con db connected si la base de datos responde SELECT 1", async () => {
    vi.spyOn(dbModule, "withClient").mockImplementationOnce(async (_env, callback) => {
      return callback({
        query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      } as unknown as Parameters<typeof callback>[0]);
    });
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: "connected", status: "ok" });
  });

  it("devuelve 503 si la consulta supera el timeout de 2000 ms", async () => {
    vi.spyOn(dbModule, "withClient").mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 3000)),
    );
    vi.useFakeTimers();
    try {
      const promise = app.request("/api/health");
      await vi.advanceTimersByTimeAsync(2100);
      const response = await promise;
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, db: "unreachable" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /api/lexicon/lookup", () => {
  it("rejects requests without a form", async () => {
    const response = await app.request("/api/lexicon/lookup");
    expect(response.status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await app.request("/api/lexicon/lookup?form=perenne", {}, {});
    expect(response.status).toBe(503);
  });
});

describe("GET /api/lexicon/sample", () => {
  it("rejects languages without a sample", async () => {
    const response = await app.request("/api/lexicon/sample?language=fr");
    expect(response.status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const responseEs = await app.request("/api/lexicon/sample?language=es", {}, {});
    expect(responseEs.status).toBe(503);
    const responseEn = await app.request("/api/lexicon/sample?language=en", {}, {});
    expect(responseEn.status).toBe(503);
  });
});

describe("POST /api/lexicon/batch", () => {
  it("rejects requests without forms", async () => {
    const response = await app.request("/api/lexicon/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "es" }),
    });
    expect(response.status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await app.request(
      "/api/lexicon/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forms: ["perenne", "estrecha"] }),
      },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("/api/annotations", () => {
  it("GET reports a missing storage configuration", async () => {
    const response = await app.request("/api/annotations", {}, {});
    expect(response.status).toBe(503);
  });

  it("PUT reports a missing storage configuration", async () => {
    const response = await app.request(
      "/api/annotations",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotations: [] }),
      },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("/api/activity", () => {
  it("GET reports a missing storage configuration", async () => {
    const response = await app.request("/api/activity", {}, {});
    expect(response.status).toBe(503);
  });

  it("PUT reports a missing storage configuration", async () => {
    const response = await app.request(
      "/api/activity",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervals: [] }),
      },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("/api/positions", () => {
  it("GET reports a missing storage configuration", async () => {
    const response = await app.request("/api/positions", {}, {});
    expect(response.status).toBe(503);
  });

  it("PUT reports a missing storage configuration", async () => {
    const response = await app.request(
      "/api/positions",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positions: [] }),
      },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("POST /api/lexicon/enrich", () => {
  it("rejects requests without a form", async () => {
    const response = await app.request("/api/lexicon/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "es" }),
    });
    expect(response.status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await app.request(
      "/api/lexicon/enrich",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form: "perenne" }),
      },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("POST /api/lexicon/items", () => {
  const post = (body: unknown, env?: object) =>
    app.request(
      "/api/lexicon/items",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("rejects requests without refs", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ refs: [] })).status).toBe(400);
  });

  it("rejects refs that are not valid senses", async () => {
    const response = await post({ refs: [{ entryId: "x", senseOrder: 1 }] });
    expect(response.status).toBe(400);
  });

  // Los entry_id son int8 > 2^53 y viajan como string de dígitos:
  // el validador del cuerpo los acepta (el 503 es por falta de
  // configuración, no por el formato del ref).
  it("accepts entryId as a digit string", async () => {
    const response = await post({ refs: [{ entryId: "1234567890123456789", senseOrder: 1 }] }, {});
    expect(response.status).toBe(503);
  });

  it("rejects a numeric entryId above the safe integer range", async () => {
    // 2^60 como number ya perdió dígitos al serializarse: aceptarlo
    // ligaría otra acepción; se rechaza en la frontera.
    const response = await post({ refs: [{ entryId: 2 ** 60, senseOrder: 1 }] });
    expect(response.status).toBe(400);
  });

  it("rejects ids outside the int8 range and non-positive ids", async () => {
    expect(
      (await post({ refs: [{ entryId: "9223372036854775808", senseOrder: 1 }] })).status,
    ).toBe(400);
    expect((await post({ refs: [{ entryId: "0", senseOrder: 1 }] })).status).toBe(400);
    expect((await post({ refs: [{ entryId: 0, senseOrder: 1 }] })).status).toBe(400);
  });

  it("rejects a senseOrder outside the int4 range", async () => {
    const response = await post({
      refs: [{ entryId: "1234567890123456789", senseOrder: "2147483648" }],
    });
    expect(response.status).toBe(400);
  });

  it("canonicalizes digit strings with leading zeros", async () => {
    const response = await post({ refs: [{ entryId: "007", senseOrder: "01" }] }, {});
    expect(response.status).toBe(503);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await post({ refs: [{ entryId: 1, senseOrder: 1 }] }, {});
    expect(response.status).toBe(503);
  });
});

describe("POST /api/lexicon/items/answer", () => {
  const post = (body: unknown, env?: object) =>
    app.request(
      "/api/lexicon/items/answer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("rejects requests without a valid answer", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ id: "abc", correct: "sí" })).status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await post({ id: "abc", correct: true }, {});
    expect(response.status).toBe(503);
  });
});

describe("POST /api/lexicon/verify-sentence", () => {
  const post = (body: unknown, env?: object) =>
    app.request(
      "/api/lexicon/verify-sentence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("rejects requests without the pieces", async () => {
    expect((await post({})).status).toBe(400);
    expect(
      (await post({ form: "perenne", meaning: "que dura", sentence: "" })).status,
    ).toBe(400);
  });

  it("rejects sentences over 300 characters", async () => {
    const response = await post({
      form: "perenne",
      meaning: "que dura mucho",
      sentence: "x".repeat(301),
    });
    expect(response.status).toBe(400);
  });

  it("reports a missing catalog configuration", async () => {
    const response = await post(
      { form: "perenne", meaning: "que dura mucho", sentence: "La sierra es perenne." },
      {},
    );
    expect(response.status).toBe(503);
  });
});

describe("POST /api/ai/evaluate-sentence", () => {
  const post = (body: unknown, env?: object) =>
    app.request(
      "/api/ai/evaluate-sentence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("rejects requests without word, targetSense, or userSentence", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ word: "efímero" })).status).toBe(400);
    expect((await post({ word: "efímero", targetSense: "Pasajero" })).status).toBe(400);
    expect((await post({ word: "efímero", targetSense: "Pasajero", userSentence: "" })).status).toBe(400);
  });

  it("rejects userSentence over 400 characters", async () => {
    const response = await post({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "x".repeat(401),
    });
    expect(response.status).toBe(400);
  });

  it("requires authenticated session", async () => {
    const response = await post({
      word: "efímero",
      targetSense: "Pasajero",
      userSentence: "El atardecer fue efímero pero hermoso.",
    });
    expect(response.status).toBe(401);
  });
});

describe("POST /api/ai/micro-story", () => {
  const post = (body: unknown, env?: object) =>
    app.request(
      "/api/ai/micro-story",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("rejects requests without valid words", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ words: [] })).status).toBe(400);
    expect((await post({ words: [{ word: "" }] })).status).toBe(400);
  });

  it("requires authenticated session", async () => {
    const response = await post({
      words: [{ word: "tinta", meaning: "Líquido para escribir" }],
    });
    expect(response.status).toBe(401);
  });
});

describe("Kindle HTML routes anti-cache headers", () => {
  it("includes no-store, no-cache, must-revalidate in HTML responses", async () => {
    const response = await app.request("/k/login");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
  });
});

describe("Blindaje de rutas IA (Tarea 1.1)", () => {
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("page-recap responde 401 sin sesión", async () => {
    const res = await post("/api/ai/page-recap", {
      text: "Una página cualquiera.",
      bookTitle: "Libro",
      chapterTitle: "Capítulo 1",
    });
    expect(res.status).toBe(401);
  });

  it("translate responde 401 sin sesión", async () => {
    const res = await post("/api/ai/translate", {
      text: "The wind was rising.",
      from: "en",
      to: "es",
    });
    expect(res.status).toBe(401);
  });

  it("companion-note responde 401 sin sesión", async () => {
    const res = await post("/api/ai/companion-note", { catName: "Michi" });
    expect(res.status).toBe(401);
  });

  it("corta cuerpos de más de 64 KB con 413 antes de parsear el JSON", async () => {
    const res = await post("/api/ai/page-recap", "x".repeat(65 * 1024));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Payload too large" });
  });
});

describe("Fase 3: Caché por Hash SHA-256 en Worker", () => {
  it("computeAiCacheKey genera llaves deterministas por tarea y hash de 12 bytes hex", async () => {
    const key1 = await computeAiCacheKey("paragraph_translate", "Hello world");
    const key2 = await computeAiCacheKey("paragraph_translate", "  hello   world  ");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^ai:paragraph_translate:[0-9a-f]{24}$/);

    const diffTask = await computeAiCacheKey("word_context", "Hello world");
    expect(diffTask).not.toBe(key1);
    expect(diffTask).toMatch(/^ai:word_context:[0-9a-f]{24}$/);
  });

  it("setCachedAiText y getCachedAiText almacenan y recuperan valores", async () => {
    const key = await computeAiCacheKey("test_task", "sample payload");
    expect(getCachedAiText(key)).toBeNull();

    setCachedAiText(key, "Traducción almacenada");
    expect(getCachedAiText(key)).toBe("Traducción almacenada");
  });

  it("limita el caché a 300 entradas desalojando la más antigua (LRU)", () => {
    for (let i = 0; i < 305; i++) {
      setCachedAiText(`test_key_${i}`, `val_${i}`);
    }
    // Las primeras 5 claves deberían haber sido desalojadas
    expect(getCachedAiText("test_key_0")).toBeNull();
    expect(getCachedAiText("test_key_4")).toBeNull();
    // Las más recientes deben seguir en memoria
    expect(getCachedAiText("test_key_304")).toBe("val_304");
  });

  it("POST /api/ai/translate exige sesión incluso si la respuesta está en caché", async () => {
    const text = "A gentle breeze rustled the leaves.";
    const key = await computeAiCacheKey("paragraph_translate", "en:es:" + text);
    setCachedAiText(key, "Una suave brisa susurró las hojas.");

    const res = await app.request("/api/ai/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, from: "en", to: "es" }),
    });

    // La caché no es una puerta trasera: sin sesión válida no se sirve.
    expect(res.status).toBe(401);
  });

  it("POST /api/ai/page-recap exige sesión incluso si la respuesta está en caché", async () => {
    const text = "Página descriptiva para resumen.";
    const key = await computeAiCacheKey("page_recap", "Libro A::Capítulo 1::" + text);
    const sampleRecap = {
      bullets: ["Acontecimiento 1.", "Acontecimiento 2."],
      hookQuestion: "¿Qué sucederá luego?",
    };
    setCachedAiText(key, JSON.stringify(sampleRecap));

    const res = await app.request("/api/ai/page-recap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        bookTitle: "Libro A",
        chapterTitle: "Capítulo 1",
      }),
    });

    // La caché no es una puerta trasera: sin sesión válida no se sirve.
    expect(res.status).toBe(401);
  });
});

describe("GET y HEAD /models/:filename", () => {
  it("rejects path traversal in filename with 400", async () => {
    const res = await app.request("/models/..%2Fsecret.txt");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid model filename" });
  });

  it("retorna 404 cuando el modelo no existe o no hay bucket", async () => {
    const res = await app.request("/models/inexistente.onnx");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Model not found");
  });

  it("serves binary stream with immutable cache headers and ETag when present in BOOKS binding", async () => {
    const fakeData = new Uint8Array([1, 2, 3, 4, 5]);
    const mockBucket = {
      get: async (key: string) => {
        if (key === "models/kitten-tts-nano-0.8-int8-v1.onnx") {
          return {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(fakeData);
                controller.close();
              },
            }),
            size: fakeData.byteLength,
            httpEtag: '"mock-etag-123"',
          };
        }
        return null;
      },
    };

    const res = await app.request(
      "/models/kitten-tts-nano-0.8-int8-v1.onnx",
      {},
      { BOOKS: mockBucket as unknown as R2Bucket },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-length")).toBe(String(fakeData.byteLength));
    expect(res.headers.get("etag")).toBe('"mock-etag-123"');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(fakeData);
  });

  it("responde a HEAD con 200, Content-Length y body vacío usando head() sin abrir el cuerpo", async () => {
    const fakeData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const headMock = vi.fn(async (key: string) =>
      key === "models/kitten-tts-nano-0.8-int8-v1.onnx"
        ? { size: fakeData.byteLength, httpEtag: '"mock-etag-head"' }
        : null,
    );
    const getMock = vi.fn(async () => {
      throw new Error("HEAD no debe descargar el cuerpo del modelo");
    });

    const res = await app.request(
      "/models/kitten-tts-nano-0.8-int8-v1.onnx",
      { method: "HEAD" },
      { BOOKS: { head: headMock, get: getMock } as unknown as R2Bucket },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-length")).toBe(String(fakeData.byteLength));
    expect(res.headers.get("etag")).toBe('"mock-etag-head"');
    expect(headMock).toHaveBeenCalledWith("models/kitten-tts-nano-0.8-int8-v1.onnx");
    expect(getMock).not.toHaveBeenCalled();
    expect(await res.text()).toBe("");
  });
});

describe("app.onError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registra solo metadatos seguros y no el detalle de Postgres", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        name: "PostgresError",
        code: "23505",
        detail: "Key (email)=(user@test.com) already exists",
      },
    );
    const env = {
      BOOKS: {
        get: () => {
          throw error;
        },
      },
    } as unknown as WorkerEnv;

    const res = await app.request("/models/fallo.onnx", {}, env);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[worker-error] GET /models/fallo.onnx:",
      {
        name: "PostgresError",
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("user@test.com");
  });
});

describe("Infraestructura de sesión (503 vs 401)", () => {
  it("responde 503 con DB_UNAVAILABLE cuando la base de datos no está disponible", async () => {
    const res = await app.request(
      "/api/annotations",
      {
        headers: {
          cookie: "better-auth.session_token=token-invalido-de-prueba",
        },
      },
      {
        DATABASE_URL: "postgres://usuario:pass@unreachable.invalid:5432/db",
      },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("DB_UNAVAILABLE");
    expect(body.error).toContain("Base de datos temporalmente no disponible");
  });
});





describe("POST /api/client-errors", () => {
  const valid = {
    name: "TypeError",
    code: "window.error",
    route: "/reader?book=abc#x",
    version: "prod",
  };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClientErrorLimiters();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const logged = (): Record<string, unknown>[] =>
    (errorSpy.mock.calls as unknown[][])
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && entry.event === "client_error",
      );

  it("acepta un reporte válido, responde 204 y sanea la ruta", async () => {
    const response = await post(valid);
    expect(response.status).toBe(204);
    expect(logged()).toEqual([
      {
        event: "client_error",
        name: "TypeError",
        code: "window.error",
        route: "/reader",
        version: "prod",
      },
    ]);
  });

  it("no toca la base: responde 204 incluso sin DATABASE_URL", async () => {
    const response = await app.request(
      "/api/client-errors",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid),
      },
      {} as WorkerEnv,
    );
    expect(response.status).toBe(204);
  });

  it("descarta en silencio un campo extra", async () => {
    const response = await post({ ...valid, stack: "at foo()" });
    expect(response.status).toBe(204);
    expect(logged()).toHaveLength(0);
  });

  it("descarta en silencio un mensaje enorme", async () => {
    const response = await post({ ...valid, message: "x".repeat(10_000) });
    expect(response.status).toBe(204);
    expect(logged()).toHaveLength(0);
  });

  it("descarta JSON inválido", async () => {
    const response = await post("{no-es-json");
    expect(response.status).toBe(204);
    expect(logged()).toHaveLength(0);
  });

  it("limita a 30 registros por minuto y por IP", async () => {
    for (let i = 0; i < 40; i += 1) {
      // Cambia el nombre para no chocar con el dedupe del cliente (que aquí no aplica).
      const response = await post({ ...valid, name: `Error${i}` });
      expect(response.status).toBe(204);
    }
    expect(logged()).toHaveLength(30);
  });
});
