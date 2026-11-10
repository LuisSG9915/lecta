import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import {
  RESET_ACK_HEADER,
  RESET_STALE_ERROR,
  readResetAck,
  isResetBlocked,
  resetBlockedResponse,
  StaleResetError,
  lockResetMarker,
} from "./reset-guard";

function makeContext(headers: Record<string, string> = {}) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Context;
}

describe("readResetAck", () => {
  it("devuelve 0 si falta el encabezado o es inválido", () => {
    expect(readResetAck(makeContext())).toBe(0);
    expect(readResetAck(makeContext({ [RESET_ACK_HEADER]: "abc" }))).toBe(0);
    expect(readResetAck(makeContext({ [RESET_ACK_HEADER]: "0" }))).toBe(0);
    expect(readResetAck(makeContext({ [RESET_ACK_HEADER]: "-5" }))).toBe(0);
  });

  it("devuelve el sello cuando es un número positivo", () => {
    expect(readResetAck(makeContext({ [RESET_ACK_HEADER]: "42" }))).toBe(42);
  });
});

describe("isResetBlocked", () => {
  it("reconoce el centinela bloqueado", () => {
    expect(isResetBlocked({ blockedAt: 7 })).toBe(true);
  });
  it("rechaza otros valores", () => {
    expect(isResetBlocked(null)).toBe(false);
    expect(isResetBlocked(undefined)).toBe(false);
    expect(isResetBlocked({})).toBe(false);
    expect(isResetBlocked({ blockedAt: "x" })).toBe(false);
    expect(isResetBlocked(5)).toBe(false);
  });
});

describe("resetBlockedResponse", () => {
  it("responde 409 con el sello y el error", async () => {
    const ctx = makeContext();
    const res = resetBlockedResponse(ctx, 99);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; resetAt: number };
    expect(body.error).toBe(RESET_STALE_ERROR);
    expect(body.resetAt).toBe(99);
  });
});

describe("StaleResetError", () => {
  it("guarda el sello y el nombre", () => {
    const err = new StaleResetError(123);
    expect(err.name).toBe("StaleResetError");
    expect(err.resetAt).toBe(123);
    expect(err.message).toContain("123");
  });
});

describe("lockResetMarker", () => {
  it("sin la tabla del marcador devuelve 0 aunque falle el ROLLBACK TO SAVEPOINT", async () => {
    const seen: string[] = [];
    const client = {
      query: async (sql: string) => {
        seen.push(sql);
        if (sql.includes("INSERT INTO lecta_account_state")) {
          throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
        }
        if (sql.startsWith("ROLLBACK TO SAVEPOINT")) throw new Error("conexión caída");
        return { rows: [] };
      },
    };
    expect(await lockResetMarker(client, "u1")).toBe(0);
    expect(seen.at(-1)).toBe("ROLLBACK TO SAVEPOINT lecta_reset_marker");
  });

  it("propaga errores que no son de tabla inexistente", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO")) throw new Error("timeout");
        return { rows: [] };
      },
    };
    await expect(lockResetMarker(client, "u1")).rejects.toThrow("timeout");
  });
});
