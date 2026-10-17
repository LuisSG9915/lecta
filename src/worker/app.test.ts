import { describe, expect, it } from "vitest";
import { app, computeAiCacheKey, getCachedAiText, setCachedAiText } from "./app";

describe("GET /api/health", () => {
  it("returns the API status", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
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

  it("POST /api/ai/translate devuelve respuesta en caché sin consumir tokens (cached: true)", async () => {
    const text = "A gentle breeze rustled the leaves.";
    const key = await computeAiCacheKey("paragraph_translate", "en:es:" + text);
    setCachedAiText(key, "Una suave brisa susurró las hojas.");

    const res = await app.request("/api/ai/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, from: "en", to: "es" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { translation: string; cached?: boolean };
    expect(data.translation).toBe("Una suave brisa susurró las hojas.");
    expect(data.cached).toBe(true);
  });

  it("POST /api/ai/page-recap devuelve respuesta en caché sin consumir tokens (cached: true)", async () => {
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

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      bullets: string[];
      hookQuestion: string;
      cached?: boolean;
    };
    expect(data.bullets).toEqual(sampleRecap.bullets);
    expect(data.hookQuestion).toBe(sampleRecap.hookQuestion);
    expect(data.cached).toBe(true);
  });
});



