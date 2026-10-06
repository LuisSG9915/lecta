import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { diagnose, DIAGNOSE_WORDS_SQL } = await import("./diagnose-words.mjs");

// Cliente pg falso: graba las consultas en orden y responde el control
// (current_database + information_schema) según las tablas simuladas.
const TABLES = [
  "lecta.lecta_user_words",
  "lecta_dev.lexicon_forms",
  "lecta_dev.lexicon_senses",
];
const makeClient = ({ db = "lecta_dev", tables = TABLES, rows = [] } = {}) => {
  const queries = [];
  const query = vi.fn(async (sql) => {
    queries.push(sql);
    if (sql.includes("current_database"))
      return { rows: [{ db, schema: "public" }] };
    const probe = sql.match(/^SELECT 1 FROM (\S+) LIMIT 0$/);
    if (probe) {
      if (!tables.includes(probe[1])) throw new Error("no existe");
      return { rows: [] };
    }
    if (sql === DIAGNOSE_WORDS_SQL || sql.includes("GROUP BY user_id, book_hash"))
      return { rows };
    return { rows: [] };
  });
  return { queries, query };
};

const PARAMS = { user: "u1", book: "h1" };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnose-words", () => {
  it("corre dentro de una transacción READ ONLY y siempre hace ROLLBACK", async () => {
    const client = makeClient();
    await diagnose(client, PARAMS);
    expect(client.queries[0]).toBe("BEGIN READ ONLY");
    expect(client.queries[1]).toContain("statement_timeout");
    expect(client.queries.at(-1)).toBe("ROLLBACK");
  });

  it("la consulta del snapshot no contiene escrituras", () => {
    expect(DIAGNOSE_WORDS_SQL.trim()).toMatch(/^SELECT\b/i);
    expect(DIAGNOSE_WORDS_SQL).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i,
    );
  });

  it("se detiene sin consultar si falta una tabla esperada", async () => {
    const client = makeClient({ tables: [TABLES[0]] });
    await expect(diagnose(client, PARAMS)).rejects.toThrow("lexicon_forms");
    expect(client.queries).not.toContain(DIAGNOSE_WORDS_SQL);
    expect(client.queries.at(-1)).toBe("ROLLBACK");
  });

  it("--lista solo agrega conteos por cuenta/libro, sin contenido", async () => {
    const client = makeClient({
      rows: [{ user_id: "u1", book_hash: "h1", pending: "12" }],
    });
    const snapshot = await diagnose(client, { list: true });
    const call = client.query.mock.calls.find(
      ([sql]) => sql.includes("GROUP BY user_id, book_hash"),
    );
    expect(call).toBeTruthy();
    expect(snapshot.targets).toEqual([{ user: "u1", book: "h1", pending: 12 }]);
    expect(snapshot).not.toHaveProperty("rows");
  });

  it("consulta con user/book como parámetros y mapea el snapshot", async () => {
    const rows = [
      {
        form: "perenne",
        lemma: "perenne",
        sense_entry_id: "e1",
        sense_order: 1,
        saved_at: "10",
        updated_at: "20",
        catalog_has_definition: true,
        saved_sense_exists: false,
      },
    ];
    const client = makeClient({ rows });
    const snapshot = await diagnose(client, PARAMS);
    const call = client.query.mock.calls.find(([sql]) => sql === DIAGNOSE_WORDS_SQL);
    expect(call[1]).toEqual(["u1", "h1"]);
    expect(snapshot.total).toBe(1);
    expect(snapshot.rows[0]).toEqual({
      form: "perenne",
      lemma: "perenne",
      senseEntryId: "e1",
      senseOrder: 1,
      savedAt: 10,
      updatedAt: 20,
      catalogHasDefinition: true,
      savedSenseExists: false,
    });
    expect(snapshot.database).toBe("lecta_dev");
  });
});
