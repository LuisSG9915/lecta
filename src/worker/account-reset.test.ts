import { describe, expect, it, vi, beforeEach } from "vitest";
import { resetAccountDataDb } from "./db";
import { app } from "./app";
import type { WorkerEnv } from "./db";

describe("resetAccountDataDb", () => {
  it("ejecuta la limpieza dentro de una transacción con BEGIN y COMMIT en todas las tablas de usuario", async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const fakeClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        return { rows: [] };
      }),
    };

    await resetAccountDataDb(fakeClient as never, "user_123");

    expect(executedQueries[0].sql).toBe("BEGIN");
    expect(executedQueries[executedQueries.length - 1].sql).toBe("COMMIT");

    const sqlStatements = executedQueries.map((q) => q.sql);
    expect(sqlStatements).toContain("DELETE FROM lecta_user_reviews WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_knowledge WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_annotations WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_positions WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_activity WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_companion_baselines WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_companion_events WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_companion_fields WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_companion_receipts WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM lecta_user_words WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM user_books WHERE user_id = $1");
    expect(sqlStatements).toContain("DELETE FROM kindle_link_codes WHERE user_id = $1");

    // ai_quota y user no deben eliminarse
    expect(sqlStatements.some((sql) => sql.includes("lecta_ai_quota"))).toBe(false);
    expect(sqlStatements.some((sql) => sql.includes("FROM \"user\""))).toBe(false);

    // Todos los DELETE reciben user_123
    for (const q of executedQueries.slice(1, -1)) {
      expect(q.params).toEqual(["user_123"]);
    }
  });

  it("hace ROLLBACK y propaga el error si una consulta falla", async () => {
    const executedQueries: string[] = [];
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("lecta_user_knowledge")) {
          throw new Error("DB Error simulado");
        }
        return { rows: [] };
      }),
    };

    await expect(resetAccountDataDb(fakeClient as never, "user_123")).rejects.toThrow("DB Error simulado");
    expect(executedQueries).toContain("BEGIN");
    expect(executedQueries).toContain("ROLLBACK");
    expect(executedQueries).not.toContain("COMMIT");
  });
});

describe("POST /api/account/reset", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 401 si no hay sesión activa", async () => {
    const res = await app.request("/api/account/reset", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("limpia la base de datos remota y purga R2 para la cuenta autenticada", async () => {
    const mockList = vi.fn(async ({ prefix }: { prefix: string }) => {
      if (prefix.includes("books/u_reset/")) {
        return { objects: [{ key: "books/u_reset/book1.epub" }], truncated: false };
      }
      if (prefix.includes("covers/u_reset/")) {
        return { objects: [{ key: "covers/u_reset/book1.jpg" }], truncated: false };
      }
      return { objects: [], truncated: false };
    });
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockBucket = { list: mockList, delete: mockDelete };

    const env: WorkerEnv = {
      DATABASE_URL: "postgres://mock",
      BOOKS: mockBucket as unknown as R2Bucket,
    };

    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_reset", email: "reset@test.com" } as never,
      session: {} as never,
    });

    const dbModule = await import("./db");
    const resetSpy = vi.spyOn(dbModule, "resetAccountDataDb").mockResolvedValue(undefined);

    const res = await app.request(
      "/api/account/reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; resetAt: string };
    expect(body.ok).toBe(true);
    expect(typeof body.resetAt).toBe("string");

    expect(resetSpy).toHaveBeenCalledWith(env, "u_reset");

    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ prefix: "books/u_reset/" }));
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ prefix: "covers/u_reset/" }));
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ prefix: "user-books/u_reset/" }));
    expect(mockDelete).toHaveBeenCalledWith(["books/u_reset/book1.epub"]);
    expect(mockDelete).toHaveBeenCalledWith(["covers/u_reset/book1.jpg"]);
  });

  it("responde 500 si el reseteo falla", async () => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_fail", email: "fail@test.com" } as never,
      session: {} as never,
    });

    const dbModule = await import("./db");
    vi.spyOn(dbModule, "resetAccountDataDb").mockRejectedValue(new Error("DB Fatal"));

    const res = await app.request(
      "/api/account/reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {},
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("No se pudo completar el reinicio");
  });
});
