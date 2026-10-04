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
