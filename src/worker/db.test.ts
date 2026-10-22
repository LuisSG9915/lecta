import { afterEach, describe, expect, it, vi } from "vitest";
import { chunks, logPostgresError, SYNC_CHUNK_ROWS } from "./db";

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
