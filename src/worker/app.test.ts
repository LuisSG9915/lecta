import { describe, expect, it } from "vitest";
import { app } from "./app";

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
