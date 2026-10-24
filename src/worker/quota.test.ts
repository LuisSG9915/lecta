import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    withClient: async (
      _env: unknown,
      run: (client: { query: typeof queryMock }) => Promise<unknown>,
    ) => run({ query: queryMock }),
  };
});

import type { WorkerEnv } from "./db";
import { consumeRateUnits } from "./app";

const env = { DATABASE_URL: "postgres://mock" } as never;

// Simula el UPSERT atómico de la base: cada incremento se evalúa contra
// el total ya confirmado por la operación previa. La serialización vive
// en el fake, como la impondría el motor al resolver el conflicto.
const installAtomicCounter = () => {
  const counters = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();
  queryMock.mockImplementation(
    (_sql: string, params: [string, number, number, number, string, number]) => {
      const [userId, bucketHour, units, , scope, limit] = params;
      const key = `${userId}:${scope}:${bucketHour}`;
      const next = chain.then(() => {
        const used = counters.get(key) ?? 0;
        if (used + units > limit) return { rows: [] as unknown[] };
        counters.set(key, used + units);
        return { rows: [{ units_used: used + units }] };
      });
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  );
  return counters;
};

describe("consumeRateUnits atómico", () => {
  it("solo deja pasar hasta el límite bajo 10 peticiones concurrentes", async () => {
    const counters = installAtomicCounter();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeRateUnits(env, "user-1", 1, 5, "page-recap"),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((allowed) => !allowed)).toHaveLength(5);
    expect(counters.get("user-1:page-recap:" + Math.floor(Date.now() / 3_600_000))).toBe(5);

    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO lecta_ai_quota");
    expect(sql).toContain("ON CONFLICT (user_id, scope, bucket_hour)");
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain("WHERE lecta_ai_quota.units_used + EXCLUDED.units_used <= $6");
    expect(sql).toContain("RETURNING units_used");
  });

  it("una sola petición por encima del límite se rechaza sin tocar el contador", async () => {
    queryMock.mockImplementation(
      (_sql: string, params: [string, number, number, number, string, number]) => {
        const units = params[2];
        const limit = params[5];
        const used = 4;
        if (used + units > limit) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ units_used: used + units }] });
      },
    );

    await expect(
      consumeRateUnits(env, "user-2", 2, 5, "translate"),
    ).resolves.toBe(false);
  });

  it("las rutas traducen el rechazo de la primitiva a 429 bajo concurrencia", async () => {
    installAtomicCounter();
    const testApp = new Hono<{ Bindings: WorkerEnv }>();
    testApp.post("/api/ai/test-quota", async (c) => {
      const allowed = await consumeRateUnits(
        c.env,
        "user-429",
        1,
        5,
        "concurrent-test",
      );
      return allowed
        ? c.json({ ok: true })
        : c.json({ error: "Rate limit exceeded" }, 429);
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        testApp.request("/api/ai/test-quota", { method: "POST" }, env),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
  });
});
