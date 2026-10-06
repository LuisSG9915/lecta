import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Solo se sustituyen las dos funciones de fs que el migrador usa; el
// resto del módulo queda intacto para que vitest siga funcionando.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readdirSync: vi.fn(() => ["001_first.sql", "002_second.sql"]),
    readFileSync: vi.fn((path) =>
      String(path).includes("002_second")
        ? "CREATE TABLE mig_a (id INT8);\nCREATE TABLE mig_b (id INT8);"
        : "CREATE TABLE mig_c (id INT8);",
    ),
  };
});

const { migrate } = await import("./db-migrate.mjs");

// Cliente pg falso: responde las consultas de control y graba todo lo
// que se le pide para poder afirmar qué se ejecutó y en qué orden.
const makeClient = (db, applied = []) => {
  const queries = [];
  const query = vi.fn(async (sql) => {
    queries.push(sql);
    if (sql.includes("current_database")) return { rows: [{ db }] };
    if (sql.includes("FROM lecta_schema_migrations"))
      return { rows: applied.map((name) => ({ name })) };
    return { rows: [], rowCount: 1 };
  });
  return { queries, query };
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("db-migrate", () => {
  it("rechaza cualquier base que no sea lecta_dev sin ejecutar DDL", async () => {
    for (const db of ["lecta", "defaultdb"]) {
      const client = makeClient(db);
      await expect(migrate(client)).rejects.toThrow("lecta_dev");
      expect(client.queries).toEqual(["SELECT current_database() AS db"]);
    }
  });

  it("en lecta_dev aplica los archivos en orden y omite los ya registrados", async () => {
    const client = makeClient("lecta_dev", ["001_first.sql"]);
    await migrate(client);

    // 001 ya estaba registrada: solo corren las dos sentencias de 002,
    // en el orden del archivo, seguidas del registro.
    const writes = client.queries.filter((q) => !q.includes("current_database"));
    expect(writes).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS lecta_schema_migrations"),
      expect.stringContaining("FROM lecta_schema_migrations"),
      "CREATE TABLE mig_a (id INT8)",
      "CREATE TABLE mig_b (id INT8);",
      expect.stringContaining("INSERT INTO lecta_schema_migrations"),
    ]);
    const insertCall = client.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO lecta_schema_migrations"),
    );
    expect(insertCall[1][0]).toBe("002_second.sql");
  });

  it("con todas aplicadas no ejecuta sentencias de migración", async () => {
    const client = makeClient("lecta_dev", ["001_first.sql", "002_second.sql"]);
    await migrate(client);
    const writes = client.queries.filter((q) => !q.includes("current_database"));
    expect(writes).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS lecta_schema_migrations"),
      expect.stringContaining("FROM lecta_schema_migrations"),
    ]);
  });
});
