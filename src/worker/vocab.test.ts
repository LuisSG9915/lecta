import { beforeEach, describe, expect, it, vi } from "vitest";

// Sesión válida fija y SQL capturado: lo que importa es qué llega a
// la base y qué no. Un cliente pg falso registra cada query con sus
// parámetros sin tocar ninguna base real.
const queryMock = vi.hoisted(() =>
  vi.fn<
    (...args: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>
  >(async () => ({ rowCount: 1, rows: [] })),
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

vi.mock("./session", () => ({
  getSession: () => getSessionMock(),
}));

import { app } from "./app";

const putWords = (words: unknown[]) =>
  app.request(
    "/api/vocab",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ words }),
    },
    {},
  );

const validCard = {
  due: "2025-01-02T00:00:00.000Z",
  stability: 3.5,
  difficulty: 5.1,
  elapsed_days: 2,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 4,
  lapses: 1,
  state: 2,
  last_review: "2025-01-01T00:00:00.000Z",
};

const word = (over: Record<string, unknown> = {}) => ({
  form: "perenne",
  language: "es",
  updatedAt: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  queryMock.mockClear();
});

describe("PUT /api/vocab — tarjeta FSRS", () => {
  it("una card malformada rechaza la petición antes de tocar la base", async () => {
    const malformed = [
      { ...validCard, state: 9 },
      { ...validCard, due: "no-es-fecha" },
      { ...validCard, reps: -2 },
      { ...validCard, stability: "alta" },
      "una tarjeta cualquiera",
    ];
    for (const card of malformed) {
      const response = await putWords([word({ card })]);
      expect(response.status).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
    }
  });

  it("una card válida viaja intacta en el upsert, con sus extras", async () => {
    const card = { ...validCard, campo_extra: { nota: 1 } };
    const response = await putWords([word({ card })]);
    expect(response.status).toBe(200);

    const [, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    const rows = JSON.parse(params[1]) as { card: unknown }[];
    expect(rows[0].card).toEqual(card);
  });

  it("card ausente o null no pisa la almacenada y envuelve con NULLIF y CASE", async () => {
    // El upsert conserva la tarjeta previa con COALESCE(NULLIF(excluded.card, 'null'::jsonb), ...):
    // una actualización de otro campo o dispositivo con card null jamás borra el repaso del lector.
    const response = await putWords([word(), word({ card: null })]);
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    expect(sql).toContain(
      "NULLIF(j.value -> 'card', 'null'::jsonb) AS card",
    );
    expect(sql).toContain(
      "card = CASE",
    );
    expect(sql).toContain(
      "COALESCE(NULLIF(excluded.card, 'null'::jsonb), lecta_user_words.card)",
    );
    const rows = JSON.parse(params[1]) as { card: unknown }[];
    expect(rows[0].card).toBeNull();
    expect(rows[1].card).toBeNull();
  });

  it("acota un updatedAt proveniente de un reloj de cliente adelantado 10 minutos al Date.now() del servidor", async () => {
    const futureTime = Date.now() + 600_000; // +10 minutos en el futuro
    const response = await putWords([word({ updatedAt: futureTime, savedAt: futureTime })]);
    expect(response.status).toBe(200);

    const [, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    const rows = JSON.parse(params[1]) as { updatedAt: number; savedAt: number }[];
    expect(rows[0].updatedAt).toBeLessThanOrEqual(Date.now());
    expect(rows[0].updatedAt).toBeLessThan(futureTime);
    expect(rows[0].savedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("GET /api/vocab — sincronización incremental", () => {
  it("sin parámetro since devuelve todas las palabras y serverTime", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          language: "es",
          form: "perenne",
          lemma: "perenne",
          pos: "adj",
          meaning: "continuo",
          context: "un árbol perenne",
          bookHash: "h1",
          senseEntryId: "123",
          senseOrder: 1,
          card: null,
          savedAt: 1700000000000,
          updatedAt: 1700000000000,
          deleted: false,
        },
      ],
    });

    const response = await app.request("/api/vocab?lang=es", {}, {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { words: unknown[]; serverTime: number };
    expect(body.words).toHaveLength(1);
    expect(body.serverTime).toBeGreaterThan(0);
    const [sql, params] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain("synced_at >");
    expect(params).toEqual(["u1", "es"]);
  });

  it("con parámetro since filtra por synced_at > since", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const response = await app.request("/api/vocab?lang=es&since=1700000050000", {}, {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { words: unknown[]; serverTime: number };
    expect(body.words).toHaveLength(0);
    expect(body.serverTime).toBeGreaterThan(0);
    const [sql, params] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("synced_at > $3");
    expect(params).toEqual(["u1", "es", 1700000050000]);
  });

  it("dispositivo A con reloj atrasado 60 s sube una palabra y dispositivo B con cursor en serverTime - 5 s la recibe gracias a synced_at", async () => {
    const serverNow = 1_700_000_100_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(serverNow);

    // 1. Dispositivo A (reloj atrasado 60s) envía palabra con updatedAt = serverNow - 60_000
    const delayedUpdatedAt = serverNow - 60_000;
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const putResponse = await putWords([word({ form: "atrasada", updatedAt: delayedUpdatedAt, savedAt: delayedUpdatedAt })]);
    expect(putResponse.status).toBe(200);

    // Servidor fijó synced_at = serverNow como parámetro $3
    const [putSql, putParams] = queryMock.mock.calls[0] as unknown as [string, [string, string, number]];
    expect(putSql).toContain("synced_at");
    expect(putParams[2]).toBe(serverNow);

    // 2. Dispositivo B hace pull con cursor = serverNow - 5_000
    const cursorDeviceB = serverNow - 5_000;
    queryMock.mockClear();
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          language: "es",
          form: "atrasada",
          lemma: "atrasada",
          pos: "adj",
          meaning: "tardía",
          context: null,
          bookHash: "h1",
          senseEntryId: null,
          senseOrder: null,
          card: null,
          savedAt: delayedUpdatedAt,
          updatedAt: delayedUpdatedAt,
          syncedAt: serverNow,
          deleted: false,
        },
      ],
    });

    const getResponse = await app.request(`/api/vocab?lang=es&since=${cursorDeviceB}`, {}, {});
    expect(getResponse.status).toBe(200);
    const body = (await getResponse.json()) as { words: { form: string; syncedAt: number; updatedAt: number }[] };

    // Dispositivo B recibe la palabra porque la query filtra por synced_at > cursorDeviceB
    // (serverNow > serverNow - 5_000 es true, aunque updatedAt = serverNow - 60_000 hubiera quedado por debajo)
    const [getSql, getParams] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(getSql).toContain("synced_at > $3");
    expect(getSql).not.toContain("updated_at > $3");
    expect(getParams).toEqual(["u1", "es", cursorDeviceB]);
    expect(body.words).toHaveLength(1);
    expect(body.words[0].form).toBe("atrasada");
    expect(body.words[0].syncedAt).toBeGreaterThan(cursorDeviceB);
    expect(body.words[0].updatedAt).toBeLessThan(cursorDeviceB);

    nowSpy.mockRestore();
  });

  it("calcula correctamente nextCursor y hasMore cuando devuelve 1000 filas vs menos de 1000 filas", async () => {
    // 1. Caso 1000 filas (paginación activa)
    const thousandRows = Array.from({ length: 1000 }, (_, i) => ({
      language: "es",
      form: `palabra${i}`,
      lemma: `palabra${i}`,
      pos: "noun",
      meaning: "def",
      context: "ctx",
      bookHash: "h1",
      senseEntryId: "1",
      senseOrder: 1,
      card: null,
      savedAt: 1700000000000 + i,
      updatedAt: 1700000000000 + i,
      syncedAt: 1700000000000 + i,
      deleted: false,
    }));

    queryMock.mockResolvedValueOnce({
      rowCount: 1000,
      rows: thousandRows,
    });

    const responseThousand = await app.request("/api/vocab?lang=es", {}, {});
    expect(responseThousand.status).toBe(200);
    const bodyThousand = (await responseThousand.json()) as {
      words: unknown[];
      hasMore: boolean;
      nextCursor: number;
      nextAfterWord: string | null;
    };
    expect(bodyThousand.words).toHaveLength(1000);
    expect(bodyThousand.hasMore).toBe(true);
    expect(bodyThousand.nextCursor).toBe(1700000000000 + 999);
    expect(bodyThousand.nextAfterWord).toBe("palabra999");

    // 2. Caso menos de 1000 filas (fin de paginación)
    queryMock.mockClear();
    queryMock.mockResolvedValueOnce({
      rowCount: 50,
      rows: thousandRows.slice(0, 50),
    });

    const beforeQuery = Date.now();
    const responseLess = await app.request("/api/vocab?lang=es&since=1700000000999", {}, {});
    expect(responseLess.status).toBe(200);
    const bodyLess = (await responseLess.json()) as {
      words: unknown[];
      hasMore: boolean;
      nextCursor: number;
    };
    expect(bodyLess.words).toHaveLength(50);
    expect(bodyLess.hasMore).toBe(false);
    expect(bodyLess.nextCursor).toBeGreaterThanOrEqual(beforeQuery - 5_000);
    expect(bodyLess.nextCursor).toBeLessThanOrEqual(Date.now());
  });

  it("omite el DISTINCT de idiomas en páginas intermedias", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const response = await app.request(
      "/api/vocab?lang=es&includeLanguages=0",
      {},
      {},
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      availableLanguages?: string[];
    };
    expect(body.availableLanguages).toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("usa afterWord para no perder filas con el mismo synced_at", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const response = await app.request(
      "/api/vocab?lang=es&since=1700000000000&afterWord=perenne",
      {},
      {},
    );
    expect(response.status).toBe(200);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "(synced_at > $3 OR (synced_at = $3 AND form > $4))",
    );
    expect(sql).toContain("ORDER BY synced_at ASC, form ASC");
    expect(params).toEqual(["u1", "es", 1700000000000, "perenne"]);
  });
});

describe("PUT /api/vocab — sello de primera exposición", () => {
  it("guarda presented_at y no borra el sello previo si el cliente no lo manda", async () => {
    const response = await putWords([word({ presentedAt: 1_700_000_000_500 })]);
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    expect(sql).toContain("presented_at");
    expect(sql).toContain("COALESCE(excluded.presented_at, lecta_user_words.presented_at)");
    const rows = JSON.parse(params[1]) as { presentedAt: number | null }[];
    expect(rows[0].presentedAt).toBe(1_700_000_000_500);

    const sinSello = await putWords([word()]);
    expect(sinSello.status).toBe(200);
    const [, params2] = queryMock.mock.calls[1] as unknown as [string, [string, string]];
    expect((JSON.parse(params2[1]) as { presentedAt: number | null }[])[0].presentedAt).toBeNull();
  });

  it("acota un presentedAt del futuro al reloj del servidor", async () => {
    const future = Date.now() + 600_000;
    const response = await putWords([word({ presentedAt: future })]);
    expect(response.status).toBe(200);

    const [, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    const rows = JSON.parse(params[1]) as { presentedAt: number }[];
    expect(rows[0].presentedAt).toBeLessThanOrEqual(Date.now());
    expect(rows[0].presentedAt).toBeLessThan(future);
  });

  it("el pull devuelve presentedAt como número", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          language: "es",
          form: "perenne",
          lemma: "perenne",
          pos: "adj",
          meaning: "continuo",
          context: null,
          bookHash: null,
          senseEntryId: null,
          senseOrder: null,
          card: null,
          presentedAt: "1700000000500",
          savedAt: 1700000000000,
          updatedAt: 1700000000000,
          syncedAt: 1700000000000,
          deleted: false,
        },
      ],
    });

    const response = await app.request("/api/vocab?lang=es", {}, {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { words: { presentedAt: unknown }[] };
    expect(body.words[0].presentedAt).toBe(1_700_000_000_500);
    const [sql] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('presented_at AS "presentedAt"');
  });
});
