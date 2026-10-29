import { afterEach, describe, expect, it, vi } from "vitest";
import { chunks, getConnectionString, logPostgresError, withClient, SYNC_CHUNK_ROWS } from "./db";

const mockClientInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  query: vi.fn(),
};

vi.mock("pg", () => {
  return {
    default: {
      Client: class {
        connect = mockClientInstance.connect;
        end = mockClientInstance.end;
        on = mockClientInstance.on;
        query = mockClientInstance.query;
      },
    },
  };
});

describe("chunks", () => {
  it("devuelve un solo trozo cuando la lista cabe en el lote", () => {
    const rows = Array.from({ length: 5 }, (_, i) => i);
    expect(chunks(rows)).toEqual([[0, 1, 2, 3, 4]]);
  });

  it("parte la lista en tandas de SYNC_CHUNK_ROWS", () => {
    const rows = Array.from({ length: SYNC_CHUNK_ROWS * 2 + 7 }, (_, i) => i);
    const parts = chunks(rows);
    expect(parts.map((part) => part.length)).toEqual([
      SYNC_CHUNK_ROWS,
      SYNC_CHUNK_ROWS,
      7,
    ]);
    expect(parts.flat()).toEqual(rows);
  });

  it("lista vacía no produce consultas", () => {
    expect(chunks([])).toEqual([]);
  });

  it("respeta un tamaño de trozo explícito", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("getConnectionString", () => {
  it("prefiere hyperdrive cuando empieza con postgres", () => {
    const env = {
      HYPERDRIVE: { connectionString: "postgres://user:pass@host/db" },
      DATABASE_URL: "postgres://local/db",
    };
    expect(getConnectionString(env)).toBe("postgres://user:pass@host/db");
  });

  it("usa DATABASE_URL si hyperdrive no está presente o no es postgres", () => {
    expect(getConnectionString({ DATABASE_URL: "postgres://local/db" })).toBe(
      "postgres://local/db",
    );
    expect(
      getConnectionString({
        HYPERDRIVE: { connectionString: "http://invalid" },
        DATABASE_URL: "postgres://local/db",
      }),
    ).toBe("postgres://local/db");
  });

  it("retorna undefined si no hay variables de entorno", () => {
    expect(getConnectionString(undefined)).toBeUndefined();
    expect(getConnectionString({})).toBeUndefined();
  });
});

describe("withClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retorna undefined si no hay cadena de conexión", async () => {
    const run = vi.fn();
    const result = await withClient({}, run);
    expect(result).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("conecta, ejecuta el callback y cierra el cliente en finally", async () => {
    const result = await withClient(
      { DATABASE_URL: "postgres://user:pass@host/db" },
      async () => {
        expect(mockClientInstance.connect).toHaveBeenCalled();
        return "query-result";
      },
    );

    expect(result).toBe("query-result");
    expect(mockClientInstance.end).toHaveBeenCalled();
    expect(mockClientInstance.on).toHaveBeenCalledWith("error", expect.any(Function));

    const errorHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === "error")?.[1];
    expect(typeof errorHandler).toBe("function");
    expect(() => errorHandler(new Error("socket closed"))).not.toThrow();
  });
});

describe("logPostgresError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignora cierres esperados del ciclo de vida", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logPostgresError("client", new Error("This socket has been closed"));
    logPostgresError("pool", new Error("Connection terminated unexpectedly"));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("registra solo el mensaje de un error real, sin el objeto crudo", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("timeout expired"), {
      detail: "Key (email)=(user@test.com) already exists",
    });

    logPostgresError("client", error);

    expect(errorSpy).toHaveBeenCalledWith(
      "Postgres client error:",
      "timeout expired",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("user@test.com");
  });
});
