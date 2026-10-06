import { beforeEach, describe, expect, it, vi } from "vitest";

// Sesión válida fija y SQL capturado: lo que importa es qué llega a
// la base y qué no. Un cliente pg falso registra cada query con sus
// parámetros sin tocar ninguna base real.
const queryMock = vi.hoisted(() =>
  vi.fn(async () => ({ rowCount: 1, rows: [] })),
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

  it("card ausente o null no pisa la almacenada", async () => {
    // El upsert conserva la tarjeta previa con COALESCE: una
    // actualización de otro campo jamás borra el repaso del lector.
    const response = await putWords([word(), word({ card: null })]);
    expect(response.status).toBe(200);

    const [sql, params] = queryMock.mock.calls[0] as unknown as [
      string,
      [string, string],
    ];
    expect(sql).toContain(
      "card = COALESCE(excluded.card, lecta_user_words.card)",
    );
    const rows = JSON.parse(params[1]) as { card: unknown }[];
    expect(rows[0].card).toBeNull();
    expect(rows[1].card).toBeNull();
  });
});
