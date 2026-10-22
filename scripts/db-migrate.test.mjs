import { readFileSync, readdirSync } from "node:fs";
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

const { assertTableUnlocked, extractDdlTable, migrate } = await import(
  "./db-migrate.mjs"
);

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

  it("un objetivo explícito solo corre si coincide con la base real", async () => {
    // «lecta» nombrada a propósito sí migra — la barrera no se quita,
    // exige declarar el destino.
    const prod = makeClient("lecta", ["001_first.sql"]);
    await migrate(prod, undefined, "lecta");
    expect(
      prod.queries.some((q) => q.includes("CREATE TABLE mig_a")),
    ).toBe(true);

    // Objetivo declarado ≠ base real: no escribe nada.
    const dev = makeClient("lecta_dev");
    await expect(migrate(dev, undefined, "lecta")).rejects.toThrow("lecta");
    expect(dev.queries).toEqual(["SELECT current_database() AS db"]);
  });
});

describe("db-migrate · tablas con schema_locked", () => {
  it("extrae la tabla de CREATE INDEX, ALTER TABLE y DROP TABLE", () => {
    expect(
      extractDdlTable(
        "CREATE INDEX IF NOT EXISTS idx_test ON lecta_user_words (user_id)",
      ),
    ).toBe("lecta_user_words");
    expect(
      extractDdlTable(
        'CREATE UNIQUE INDEX idx_test ON public."lecta_user_words" (user_id)',
      ),
    ).toBe("lecta_user_words");
    expect(
      extractDdlTable(
        'ALTER TABLE IF EXISTS "lecta_user_words" ADD COLUMN x INT8',
      ),
    ).toBe("lecta_user_words");
    expect(extractDdlTable("DROP TABLE IF EXISTS lecta_user_words")).toBe(
      "lecta_user_words",
    );
  });

  it("ignora CREATE TABLE y las sentencias que gestionan el lock", () => {
    expect(extractDdlTable("CREATE TABLE nueva (id INT8)")).toBeNull();
    expect(
      extractDdlTable(
        "ALTER TABLE lecta_user_words SET (schema_locked = false)",
      ),
    ).toBeNull();
  });

  it("falla rápido si la tabla está bloqueada", async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [{ ddl: "CREATE TABLE t (...) WITH (schema_locked = true)" }],
      })),
    };

    await expect(
      assertTableUnlocked(
        client,
        "CREATE INDEX idx_test ON lecta_user_words (user_id)",
      ),
    ).rejects.toThrow(/schema_locked=true/);
    expect(client.query).toHaveBeenCalledWith(
      "SHOW CREATE TABLE lecta_user_words",
    );
  });

  it("permite tablas desbloqueadas o inexistentes", async () => {
    const unlocked = {
      query: vi.fn(async () => ({
        rows: [{ ddl: "CREATE TABLE t (...) WITH (schema_locked = false)" }],
      })),
    };
    await expect(
      assertTableUnlocked(
        unlocked,
        "CREATE INDEX idx_test ON lecta_user_words (user_id)",
      ),
    ).resolves.toBeUndefined();

    const missing = {
      query: vi.fn(async () => {
        throw new Error("relation does not exist");
      }),
    };
    await expect(
      assertTableUnlocked(
        missing,
        "CREATE INDEX idx_test ON tabla_inexistente (id)",
      ),
    ).resolves.toBeUndefined();
  });

  it("no consulta la tabla cuando la sentencia gestiona el lock", async () => {
    const client = { query: vi.fn() };
    await expect(
      assertTableUnlocked(
        client,
        "ALTER TABLE lecta_user_words SET (schema_locked = false)",
      ),
    ).resolves.toBeUndefined();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("no ejecuta el DDL ni registra la migración si la tabla está bloqueada", async () => {
    vi.mocked(readdirSync).mockReturnValueOnce(["003_locked.sql"]);
    vi.mocked(readFileSync).mockReturnValueOnce(
      "CREATE INDEX IF NOT EXISTS idx_test ON lecta_user_words (user_id);",
    );

    const client = makeClient("lecta_dev");
    client.query.mockImplementation(async (sql) => {
      client.queries.push(sql);
      if (sql.includes("current_database")) return { rows: [{ db: "lecta_dev" }] };
      if (sql.includes("FROM lecta_schema_migrations")) return { rows: [] };
      if (sql.includes("SHOW CREATE TABLE lecta_user_words"))
        return {
          rows: [{ ddl: "CREATE TABLE t (...) WITH (schema_locked = true)" }],
        };
      return { rows: [], rowCount: 1 };
    });

    await expect(migrate(client)).rejects.toThrow(/schema_locked=true/);
    expect(client.queries.some((q) => q.includes("CREATE INDEX"))).toBe(false);
    expect(
      client.queries.some((q) => q.includes("INSERT INTO lecta_schema_migrations")),
    ).toBe(false);
  });

  it("traduce un timeout del DDL a un mensaje claro", async () => {
    vi.mocked(readdirSync).mockReturnValueOnce(["003_timeout.sql"]);
    vi.mocked(readFileSync).mockReturnValueOnce(
      "CREATE TABLE mig_timeout (id INT8);",
    );

    const client = makeClient("lecta_dev");
    client.query.mockImplementation(async (sql) => {
      client.queries.push(sql);
      if (sql.includes("current_database")) return { rows: [{ db: "lecta_dev" }] };
      if (sql.includes("FROM lecta_schema_migrations")) return { rows: [] };
      if (sql.includes("CREATE TABLE mig_timeout")) {
        throw Object.assign(
          new Error("canceling statement due to statement timeout"),
          { code: "57014" },
        );
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(migrate(client)).rejects.toThrow(/excedió el tiempo límite/);
    expect(
      client.queries.some((q) => q.includes("INSERT INTO lecta_schema_migrations")),
    ).toBe(false);
  });
});
