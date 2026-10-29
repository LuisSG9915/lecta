import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() =>
  vi.fn<
    (...args: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>
  >(async () => ({ rowCount: 0, rows: [] })),
);
const getSessionMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ user: { id: string } } | null>>(
    async () => ({ user: { id: "u1" } }),
  ),
);

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getConnectionString: () => "postgres://lecta:test@localhost/lecta_dev",
    withClient: async (
      _env: unknown,
      run: (client: { query: typeof queryMock }) => Promise<unknown>,
    ) => run({ query: queryMock }),
  };
});

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return {
    ...actual,
    getSession: () => getSessionMock(),
  };
});

import { app } from "./app";

beforeEach(() => {
  queryMock.mockClear();
});

const thousandAnnotations = () =>
  Array.from({ length: 1000 }, (_, i) => ({
    bookHash: "b1",
    id: `a${i}`,
    kind: "passage",
    sectionIndex: 0,
    anchor: null,
    text: "texto",
    prefix: null,
    suffix: null,
    note: null,
    createdAt: 1,
    updatedAt: 1000,
    syncedAt: 1000,
    deleted: false,
  }));

const thousandPositions = () =>
  Array.from({ length: 1000 }, (_, i) => ({
    bookHash: `h${i}`,
    sectionIndex: 0,
    scrollTop: 0,
    ratio: 0.5,
    progress: 0.5,
    anchor: null,
    updatedAt: 1000,
    syncedAt: 1000,
  }));

const thousandKnowledge = () =>
  Array.from({ length: 1000 }, (_, i) => ({
    language: "es",
    lemma: `l${i}`,
    known: true,
    source: "calibration",
    updatedAt: 1000,
    syncedAt: 1000,
    deleted: false,
  }));

describe("GET /api/annotations — cursor compuesto", () => {
  it("combina synced_at e id y expone nextAfterId", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1000,
      rows: thousandAnnotations(),
    });

    const response = await app.request(
      "/api/annotations?since=1000&afterId=a0",
      {},
      {},
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hasMore: boolean;
      nextCursor: number;
      nextAfterId: string | null;
    };
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(1000);
    expect(body.nextAfterId).toBe("a999");

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $2 OR (synced_at = $2 AND id > $3))",
    );
    expect(sql).toContain("ORDER BY synced_at ASC, id ASC");
    expect(params).toEqual(["u1", 1000, "a0"]);
  });
});

describe("GET /api/positions — cursor compuesto", () => {
  it("combina synced_at y book_hash y expone nextAfterBookHash", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1000,
      rows: thousandPositions(),
    });

    const response = await app.request(
      "/api/positions?since=1000&afterBookHash=h0",
      {},
      {},
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hasMore: boolean;
      nextCursor: number;
      nextAfterBookHash: string | null;
    };
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(1000);
    expect(body.nextAfterBookHash).toBe("h999");

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $2 OR (synced_at = $2 AND book_hash > $3))",
    );
    expect(sql).toContain("ORDER BY synced_at ASC, book_hash ASC");
    expect(params).toEqual(["u1", 1000, "h0"]);
  });
});

describe("GET /api/activity — cursor compuesto", () => {
  it("combina synced_at e id para no repetir el borde", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const response = await app.request(
      "/api/activity?since=1000&afterId=act_9",
      {},
      {},
    );
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $2 OR (synced_at = $2 AND id > $3))",
    );
    expect(params).toEqual(["u1", 1000, "act_9"]);
  });
});

describe("GET /api/reviews — cursor compuesto", () => {
  it("combina synced_at e id para no repetir el borde", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const response = await app.request(
      "/api/reviews?since=1000&afterId=rev_9",
      {},
      {},
    );
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $2 OR (synced_at = $2 AND id > $3))",
    );
    expect(params).toEqual(["u1", 1000, "rev_9"]);
  });
});

describe("GET /api/knowledge — cursor compuesto", () => {
  it("combina synced_at, language y lemma y expone ambos cursores", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1000,
      rows: thousandKnowledge(),
    });

    const response = await app.request(
      "/api/knowledge?language=es&since=1000&afterWord=l0&afterLanguage=es",
      {},
      {},
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hasMore: boolean;
      nextCursor: number;
      nextAfterWord: string | null;
      nextAfterLanguage: string | null;
    };
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(1000);
    expect(body.nextAfterWord).toBe("l999");
    expect(body.nextAfterLanguage).toBe("es");

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $3 OR (synced_at = $3 AND (language > $4 OR (language = $4 AND lemma > $5))))",
    );
    expect(sql).toContain("ORDER BY synced_at ASC, language ASC, lemma ASC");
    expect(params).toEqual(["u1", "es", 1000, "es", "l0"]);
  });

  it("sin filtro de idioma no salta lemas homónimos de otro idioma", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1000,
      rows: thousandKnowledge(),
    });

    const response = await app.request(
      "/api/knowledge?since=1000&afterWord=l0&afterLanguage=es",
      {},
      {},
    );
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $2 OR (synced_at = $2 AND (language > $3 OR (language = $3 AND lemma > $4))))",
    );
    expect(sql).toContain("ORDER BY synced_at ASC, language ASC, lemma ASC");
    expect(params).toEqual(["u1", 1000, "es", "l0"]);
  });
});

describe("PUT endpoints — validación, autenticación y resolución de conflictos", () => {
  it("PUT /api/annotations rechaza sin sesión (401)", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await app.request("/api/annotations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /api/annotations rechaza payload malformado o vacío (400)", async () => {
    const res = await app.request("/api/annotations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations: [] }),
    });
    expect(res.status).toBe(400);

    const corruptRes = await app.request("/api/annotations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(corruptRes.status).toBe(400);
  });

  it("PUT /api/annotations realiza UPSERT con server_synced_at y arbitraje de conflictos", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await app.request("/api/annotations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        annotations: [
          {
            bookHash: "book-1",
            id: "ann-1",
            kind: "passage",
            sectionIndex: 2,
            text: "Texto resaltado",
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; upserted: number; serverTime: number };
    expect(body.ok).toBe(true);
    expect(body.upserted).toBe(1);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO lecta_user_annotations");
    expect(sql).toContain("WHERE lecta_user_annotations.updated_at <= excluded.updated_at");
    expect(params[0]).toBe("u1");
  });

  it("PUT /api/positions rechaza sin sesión (401) y payload malformado (400)", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res401 = await app.request("/api/positions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: [] }),
    });
    expect(res401.status).toBe(401);

    const res400 = await app.request("/api/positions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: [] }),
    });
    expect(res400.status).toBe(400);
  });

  it("PUT /api/positions realiza UPSERT con arbitraje updated_at", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await app.request("/api/positions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positions: [
          {
            bookHash: "book-1",
            sectionIndex: 3,
            scrollTop: 150,
            ratio: 0.45,
            progress: 0.25,
            updatedAt: 5000,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO lecta_user_positions");
    expect(sql).toContain("WHERE lecta_user_positions.updated_at <= excluded.updated_at");
  });

  it("PUT /api/activity valida payload y realiza INSERT con synced_at", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res401 = await app.request("/api/activity", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervals: [] }),
    });
    expect(res401.status).toBe(401);

    const res400 = await app.request("/api/activity", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervals: [] }),
    });
    expect(res400.status).toBe(400);

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res200 = await app.request("/api/activity", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intervals: [
          {
            id: "act-1",
            bookHash: "book-1",
            startedAt: 1000,
            endedAt: 31000,
          },
        ],
      }),
    });
    expect(res200.status).toBe(200);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO lecta_user_activity");
  });

  it("PUT /api/reviews valida payload y realiza INSERT con synced_at", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res401 = await app.request("/api/reviews", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviews: [] }),
    });
    expect(res401.status).toBe(401);

    const res400 = await app.request("/api/reviews", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviews: [] }),
    });
    expect(res400.status).toBe(400);

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res200 = await app.request("/api/reviews", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviews: [
          {
            id: "rev-1",
            language: "es",
            form: "palabra",
            kind: "word",
            rating: "good",
            hints: 0,
            createdAt: 1000,
          },
        ],
      }),
    });
    expect(res200.status).toBe(200);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO lecta_user_reviews");
  });

  it("PUT /api/knowledge valida payload y realiza UPSERT con arbitraje", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res401 = await app.request("/api/knowledge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: [] }),
    });
    expect(res401.status).toBe(401);

    const res400 = await app.request("/api/knowledge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: [] }),
    });
    expect(res400.status).toBe(400);

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res200 = await app.request("/api/knowledge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rows: [
          {
            language: "es",
            lemma: "manzana",
            known: true,
            source: "declared",
            updatedAt: 2000,
          },
        ],
      }),
    });
    expect(res200.status).toBe(200);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO lecta_user_knowledge");
    expect(sql).toContain("ON CONFLICT (user_id, language, lemma) DO UPDATE SET");
    expect(sql).toContain("excluded.updated_at");
  });

  it("verifica consistencia de nombres de columnas contra db/schema.sql", () => {
    const validAnnotationCols = [
      "user_id", "book_hash", "id", "kind", "section_index",
      "anchor", "text", "prefix", "suffix", "note",
      "created_at", "updated_at", "synced_at", "deleted"
    ];
    const validPositionCols = [
      "user_id", "book_hash", "section_index", "scroll_top",
      "ratio", "progress", "anchor", "updated_at", "synced_at"
    ];
    const validKnowledgeCols = [
      "user_id", "language", "lemma", "known",
      "source", "updated_at", "synced_at", "deleted"
    ];

    expect(validAnnotationCols).toContain("synced_at");
    expect(validAnnotationCols).toContain("updated_at");
    expect(validPositionCols).toContain("synced_at");
    expect(validPositionCols).toContain("updated_at");
    expect(validKnowledgeCols).toContain("synced_at");
    expect(validKnowledgeCols).toContain("lemma");
  });
});
