import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() =>
  vi.fn<
    (...args: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>
  >(async () => ({ rowCount: 0, rows: [] })),
);
const getSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: "u1" } })),
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
  }));

const thousandKnowledge = () =>
  Array.from({ length: 1000 }, (_, i) => ({
    language: "es",
    lemma: `l${i}`,
    known: true,
    source: "calibration",
    updatedAt: 1000,
    deleted: false,
  }));

describe("GET /api/annotations — cursor compuesto", () => {
  it("combina updated_at e id y expone nextAfterId", async () => {
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
      "(updated_at > $2 OR (updated_at = $2 AND id > $3))",
    );
    expect(sql).toContain("ORDER BY updated_at ASC, id ASC");
    expect(params).toEqual(["u1", 1000, "a0"]);
  });
});

describe("GET /api/positions — cursor compuesto", () => {
  it("combina updated_at y book_hash y expone nextAfterBookHash", async () => {
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
      "(updated_at > $2 OR (updated_at = $2 AND book_hash > $3))",
    );
    expect(sql).toContain("ORDER BY updated_at ASC, book_hash ASC");
    expect(params).toEqual(["u1", 1000, "h0"]);
  });
});

describe("GET /api/activity — cursor compuesto", () => {
  it("combina ended_at e id para no repetir el borde", async () => {
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
      "(ended_at > $2 OR (ended_at = $2 AND id > $3))",
    );
    expect(params).toEqual(["u1", 1000, "act_9"]);
  });
});

describe("GET /api/reviews — cursor compuesto", () => {
  it("combina created_at e id para no repetir el borde", async () => {
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
      "(created_at > $2 OR (created_at = $2 AND id > $3))",
    );
    expect(params).toEqual(["u1", 1000, "rev_9"]);
  });
});

describe("GET /api/knowledge — cursor compuesto", () => {
  it("combina updated_at, language y lemma y expone ambos cursores", async () => {
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
      "(updated_at > $3 OR (updated_at = $3 AND (language > $4 OR (language = $4 AND lemma > $5))))",
    );
    expect(sql).toContain("ORDER BY updated_at ASC, language ASC, lemma ASC");
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
      "(updated_at > $2 OR (updated_at = $2 AND (language > $3 OR (language = $3 AND lemma > $4))))",
    );
    expect(sql).toContain("ORDER BY updated_at ASC, language ASC, lemma ASC");
    expect(params).toEqual(["u1", 1000, "es", "l0"]);
  });
});
