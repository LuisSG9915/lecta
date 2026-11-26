import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

    // Todos los DELETE y el sello llevan user_123 como primer parámetro
    // (SAVEPOINT/ROLLBACK TO SAVEPOINT no llevan parámetros).
    for (const q of executedQueries.slice(1, -1)) {
      if (q.params) expect(q.params[0]).toBe("user_123");
    }
  });

  it("deja el sello del reinicio en lecta_account_state dentro de la misma transacción", async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const fakeClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        return { rows: [] };
      }),
    };

    const resetAt = await resetAccountDataDb(fakeClient as never, "user_123");

    const marker = executedQueries.find((q) =>
      q.sql.includes("INSERT INTO lecta_account_state"),
    );
    expect(marker).toBeDefined();
    expect(marker!.sql).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(marker!.params).toEqual(["user_123", resetAt]);
    // El sello va antes del COMMIT: un PUT posterior al commit ya lo ve.
    const markerIndex = executedQueries.indexOf(marker!);
    expect(executedQueries[executedQueries.length - 1].sql).toBe("COMMIT");
    expect(markerIndex).toBeLessThan(executedQueries.length - 1);
    expect(Number.isFinite(resetAt) && resetAt > 0).toBe(true);
  });

  it("tolera que lecta_account_state aún no exista (despliegue antes que la migración)", async () => {
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("lecta_account_state")) {
          const err = new Error("relation does not exist") as Error & { code?: string };
          err.code = "42P01";
          throw err;
        }
        return { rows: [] };
      }),
    };

    await expect(resetAccountDataDb(fakeClient as never, "user_123")).resolves.toBeGreaterThan(0);
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
    const resetSpy = vi.spyOn(dbModule, "resetAccountDataDb").mockResolvedValue(1_700_000_000_000);

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

describe("GET /api/account/state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 401 si no hay sesión activa", async () => {
    const res = await app.request("/api/account/state");
    expect(res.status).toBe(401);
  });

  it("devuelve el sello guardado en lecta_account_state", async () => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_state", email: "state@test.com" } as never,
      session: {} as never,
    });
    const dbModule = await import("./db");
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("lecta_account_state")) {
            return { rows: [{ reset_at: "4200" }] };
          }
          return { rows: [] };
        }),
      } as never),
    );

    const res = await app.request(
      "/api/account/state",
      {},
      { DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; resetAt: number };
    expect(body.ok).toBe(true);
    expect(body.resetAt).toBe(4200);
  });

  it("devuelve 0 cuando la cuenta nunca se reinició", async () => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_fresh", email: "fresh@test.com" } as never,
      session: {} as never,
    });
    const dbModule = await import("./db");
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({
        query: vi.fn(async () => ({ rows: [] })),
      } as never),
    );

    const res = await app.request(
      "/api/account/state",
      {},
      { DATABASE_URL: "postgres://mock" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resetAt: number };
    expect(body.resetAt).toBe(0);
  });
});

describe("plan en GET /api/account/state y PUT /api/account/starter-coat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockSession = async (id = "u_plan") => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id, email: `${id}@test.com` } as never,
      session: {} as never,
    });
  };

  const mockDb = async (handler: (sql: string, params?: unknown[]) => unknown) => {
    const dbModule = await import("./db");
    const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({ query } as never),
    );
    return query;
  };

  const env = { DATABASE_URL: "postgres://mock" };

  it("account/state incluye plan, pelaje y vencimiento", async () => {
    await mockSession();
    await mockDb((sql) => {
      if (sql.includes("lecta_user_plan")) {
        return {
          rows: [{ plan: "founder_lifetime", starter_coat: "mist", plan_expires_at: null }],
        };
      }
      return { rows: [] };
    });
    const res = await app.request("/api/account/state", {}, env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      plan: "founder_lifetime",
      starterCoat: "mist",
      planExpiresAt: null,
    });
  });

  it("account/state sin fila de plan responde free", async () => {
    await mockSession();
    await mockDb(() => ({ rows: [] }));
    const res = await app.request("/api/account/state", {}, env);
    expect(((await res.json()) as { plan: string }).plan).toBe("free");
  });

  it("account/state free: freeAiRemaining = 3 menos lo usado hoy, sin prueba", async () => {
    await mockSession();
    await mockDb((sql, params) => {
      if (sql.includes("lecta_ai_quota")) {
        expect(params?.[1]).toBe("free-courtesy");
        return { rows: [{ units_used: "2" }] };
      }
      return { rows: [] };
    });
    const body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ plan: "free", freeAiRemaining: 1, trialEndsAt: null });
    expect(body).not.toHaveProperty("trialEligible");
  });

  it("account/state free sin tabla de cuota: 0 restantes (cerrada)", async () => {
    await mockSession();
    await mockDb((sql) => {
      if (sql.includes("lecta_ai_quota")) throw Object.assign(new Error("x"), { code: "42P01" });
      return { rows: [] };
    });
    const body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body.freeAiRemaining).toBe(0);
  });

  it("account/state en prueba inversa: lecta_plus con trialEndsAt y sin cortesía", async () => {
    await mockSession();
    const created = Date.now() - 86_400_000;
    const query = await mockDb((sql) =>
      sql.includes("lecta_user_plan") ? { rows: [{ plan: null, user_created_at: created }] } : { rows: [] },
    );
    const body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ plan: "lecta_plus", freeAiRemaining: null });
    expect(typeof body.trialEndsAt).toBe("number");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("lecta_ai_quota"))).toBe(false);
  });

  it("account/state Lecta+/fundador: freeAiRemaining null, sin consultar la cuota", async () => {
    await mockSession();
    const query = await mockDb((sql) =>
      sql.includes("lecta_user_plan")
        ? { rows: [{ plan: "founder_lifetime" }] }
        : { rows: [] },
    );
    const body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ freeAiRemaining: null, trialEndsAt: null });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("lecta_ai_quota"))).toBe(false);
  });

  it("account/state omite plan ante un error distinto de 42P01", async () => {
    await mockSession();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDb((sql) => {
      if (sql.includes("lecta_user_plan")) throw new Error("pg roto");
      return { rows: [{ reset_at: "7" }] };
    });
    const res = await app.request("/api/account/state", {}, env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resetAt).toBe(7);
    expect("plan" in body).toBe(false);
  });

  const putCoat = (coat: unknown, envArg: WorkerEnv = env) =>
    app.request(
      "/api/account/starter-coat",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coat }),
      },
      envArg,
    );

  it("starter-coat sin sesión responde 401", async () => {
    const res = await putCoat("mist");
    expect(res.status).toBe(401);
  });

  it("starter-coat con pelaje inválido responde 400", async () => {
    await mockSession();
    const res = await putCoat("pelaje-mist");
    expect(res.status).toBe(400);
  });

  it("starter-coat escribe una vez y luego devuelve el guardado", async () => {
    await mockSession();
    await mockDb((sql) => {
      if (sql.includes("INSERT INTO lecta_user_plan")) return { rows: [{ starter_coat: "calico" }] };
      return { rows: [] };
    });
    const first = await putCoat("calico");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ starterCoat: "calico" });

    vi.restoreAllMocks();
    await mockSession();
    await mockDb((sql) => {
      if (sql.includes("INSERT INTO lecta_user_plan")) return { rows: [] };
      return { rows: [{ plan: "free", starter_coat: "calico" }] };
    });
    const second = await putCoat("ginger");
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ starterCoat: "calico" });
  });

  const putCoatFrom = (coat: string, src: string) =>
    app.request(
      "/api/account/starter-coat",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coat, src }),
      },
      env,
    );
  const landingWrites = (query: ReturnType<typeof vi.fn>) =>
    query.mock.calls.filter(([sql]) => String(sql).includes("lecta_landing_daily"));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("starter-coat con src cuenta signup de la landing solo la primera vez", async () => {
    await mockSession();
    const query = await mockDb((sql) => {
      if (sql.includes("INSERT INTO lecta_user_plan")) return { rows: [{ starter_coat: "calico" }] };
      return { rows: [] };
    });
    expect((await putCoatFrom("calico", "Instagram.com")).status).toBe(200);
    await settle();
    const writes = landingWrites(query);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]).toEqual([expect.any(String), "signup", "instagram.com"]);

    vi.restoreAllMocks();
    await mockSession();
    const again = await mockDb((sql) => {
      if (sql.includes("INSERT INTO lecta_user_plan")) return { rows: [] };
      return { rows: [{ plan: "free", starter_coat: "calico" }] };
    });
    expect((await putCoatFrom("ginger", "instagram.com")).status).toBe(200);
    await settle();
    expect(landingWrites(again)).toHaveLength(0);
  });

  it("starter-coat sin src no cuenta signup", async () => {
    await mockSession();
    const query = await mockDb((sql) => {
      if (sql.includes("INSERT INTO lecta_user_plan")) return { rows: [{ starter_coat: "mist" }] };
      return { rows: [] };
    });
    expect((await putCoat("mist")).status).toBe(200);
    await settle();
    expect(landingWrites(query)).toHaveLength(0);
  });

  it("starter-coat sin tabla (42P01) responde 503", async () => {
    await mockSession();
    await mockDb(() => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    const res = await putCoat("mist");
    expect(res.status).toBe(503);
  });
});

describe("guardia de reinicio en escrituras (x-lecta-reset)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const putAnnotations = (headers: Record<string, string>, env: WorkerEnv) =>
    app.request(
      "/api/annotations",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          annotations: [
            {
              bookHash: "book-1",
              id: "ann-1",
              kind: "passage",
              sectionIndex: 2,
              text: "Texto",
              createdAt: 1000,
              updatedAt: 2000,
            },
          ],
        }),
      },
      env,
    );

  const envWithDb = { DATABASE_URL: "postgres://mock" } as WorkerEnv;

  const stubSessionAndResetAt = async (resetAt: number | null) => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_stale", email: "stale@test.com" } as never,
      session: {} as never,
    });
    const dbModule = await import("./db");
    const queries: string[] = [];
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({
        query: vi.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes("lecta_account_state")) {
            return { rows: resetAt === null ? [] : [{ reset_at: String(resetAt) }] };
          }
          return { rows: [], rowCount: 1 };
        }),
      } as never),
    );
    return queries;
  };

  it("rechaza con 409 un PUT cuya marca local es más vieja que el sello — sin tocar filas", async () => {
    const queries = await stubSessionAndResetAt(9000);

    const res = await putAnnotations({ "x-lecta-reset": "1000" }, envWithDb);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; resetAt: number };
    expect(body.error).toBe("account_reset");
    expect(body.resetAt).toBe(9000);
    // La escritura jamás llegó: solo corrió la lectura del sello.
    expect(queries.some((sql) => sql.includes("INSERT INTO lecta_user_annotations"))).toBe(false);
  });

  it("acepta cuando la marca del cliente ya cubre el reinicio", async () => {
    await stubSessionAndResetAt(9000);

    const res = await putAnnotations({ "x-lecta-reset": "9000" }, envWithDb);

    expect(res.status).toBe(200);
  });

  it("sin sello en servidor (cuenta jamás reiniciada) el PUT corre normal", async () => {
    await stubSessionAndResetAt(null);

    const res = await putAnnotations({}, envWithDb);

    expect(res.status).toBe(200);
  });
});

describe("trialEndedAt y GET /api/account/trial-summary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // La prueba inversa arranca el 2026-11-25: hay que viajar al futuro para vencerla.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const env = { DATABASE_URL: "postgres://mock" };
  const DAY = 86_400_000;
  const setup = async (createdAtMs: number, onSummary?: (params: unknown[] | undefined) => void) => {
    const sessionModule = await import("./session");
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: { id: "u_trial", email: "t@test.com" } as never,
      session: {} as never,
    });
    const dbModule = await import("./db");
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes("lecta_user_plan")) {
            return { rows: [{ plan: null, user_created_at: String(createdAtMs) }] };
          }
          if (sql.includes("lecta_ai_quota") && sql.includes("ai_uses")) {
            onSummary?.(params);
            return { rows: [{ ai_uses: "7", words_saved: "3", cloud_books: "2", kindle_linked: true }] };
          }
          return { rows: [] };
        }),
      } as never),
    );
  };

  it("en prueba: trialEndedAt null; vencida: el número", async () => {
    await setup(Date.now());
    let body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body.trialEndedAt).toBeNull();
    const created = Date.now() - 30 * DAY;
    vi.restoreAllMocks();
    await setup(created);
    body = (await (await app.request("/api/account/state", {}, env)).json()) as Record<string, unknown>;
    expect(body.plan).toBe("free");
    expect(typeof body.trialEndedAt).toBe("number");
  });

  it("trial-summary: kindleLinked sale de lecta_kindle_prefs cuando el código ya se consumió", async () => {
    await setup(Date.now() - 30 * DAY);
    const dbModule = await import("./db");
    vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) =>
      run({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("lecta_user_plan")) return { rows: [{ plan: null, user_created_at: String(Date.now() - 30 * DAY) }] };
          if (sql.includes("ai_uses")) return { rows: [{ ai_uses: "0", words_saved: "0", cloud_books: "0", kindle_linked: false }] };
          if (sql.includes("lecta_kindle_prefs")) return { rows: [{ "?column?": 1 }] };
          return { rows: [] };
        }),
      } as never),
    );
    const body = (await (await app.request("/api/account/trial-summary", {}, env)).json()) as Record<string, unknown>;
    expect(body.kindleLinked).toBe(true);
  });

  it("trial-summary: sin prueba 404", async () => {
    await setup(Number.NaN);
    const res = await app.request("/api/account/trial-summary", {}, env);
    expect(res.status).toBe(404);
  });

  it("trial-summary: cuenta vencida, scopes sin free-courtesy y ventana en horas", async () => {
    let params: unknown[] | undefined;
    await setup(Date.now() - 30 * DAY, (p) => (params = p));
    const res = await app.request("/api/account/trial-summary", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ aiUses: 7, wordsSaved: 3, cloudBooks: 2, kindleLinked: true });
    expect(params?.[1]).toEqual(["explain", "page-recap", "translate", "evaluate", "story", "companion-note"]);
    expect(params?.[1]).not.toContain("free-courtesy");
    const end = body.trialEndsAt as number;
    expect(params?.[3]).toBe(Math.floor(end / 3_600_000));
    expect(params?.[4]).toBe(end - 14 * DAY);
  });
});
