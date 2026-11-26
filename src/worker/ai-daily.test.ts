import { beforeEach, describe, expect, it, vi } from "vitest";
import { courtesyBucketHour } from "../shared/plan";
import { DAILY_AI_LIMIT_MESSAGE, guardDailyAi } from "./ai-daily";

const withClientMock = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: (...args: unknown[]) => withClientMock(...args),
}));


/** Simula la fila por (scope, bucket) con el tope del UPSERT atómico. */
function fakeQuota() {
  const rows = new Map<string, number>();
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith("INSERT")) {
      const [, bucket, units, , scope, limit] = params as [string, number, number, number, string, number];
      const key = `${scope}:${bucket}`;
      const next = (rows.get(key) ?? 0) + units;
      if (next > limit) return { rows: [] };
      rows.set(key, next);
      return { rows: [{ units_used: next }] };
    }
    const [, scope, bucket, units] = params as [string, string, number, number];
    const key = `${scope}:${bucket}`;
    rows.set(key, Math.max((rows.get(key) ?? 0) - units, 0));
    return { rows: [] };
  });
  withClientMock.mockImplementation(async (_env, run) => run({ query }));
  return rows;
}

beforeEach(() => {
  withClientMock.mockReset();
});

describe("guardDailyAi", () => {
  const NOW = Date.UTC(2026, 10, 18, 12);

  it("free (limit null) no toca la base", async () => {
    const g = await guardDailyAi({} as never, "u", null, "explain", { now: NOW });
    expect(g.deny).toBeUndefined();
    expect(withClientMock).not.toHaveBeenCalled();
  });

  it("la unidad 300 pasa y la 301 da deny con texto propio del tope diario", async () => {
    const rows = fakeQuota();
    for (let i = 0; i < 300; i += 1) {
      expect((await guardDailyAi({} as never, "u", 300, "explain", { now: NOW })).deny).toBeUndefined();
    }
    rows.set(`explain:${Math.floor(NOW / 3_600_000)}`, 5);
    const g = await guardDailyAi({} as never, "u", 300, "explain", { now: NOW });
    expect(g.deny).toEqual({ error: DAILY_AI_LIMIT_MESSAGE });
    // devolvió la unidad por hora y no sumó al día
    expect(rows.get(`ai-daily:${courtesyBucketHour(NOW)}`)).toBe(300);
    expect(rows.get(`explain:${Math.floor(NOW / 3_600_000)}`)).toBe(4);
  });

  it("reintegro vuelve al bucket del consumo aunque cruce la medianoche de CDMX", async () => {
    const rows = fakeQuota();
    const before = Date.UTC(2026, 10, 18, 5, 59, 59);
    const g = await guardDailyAi({} as never, "u", 300, "explain", { now: before });
    expect(rows.get(`ai-daily:${courtesyBucketHour(before)}`)).toBe(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 18, 6, 0, 30));
    await g.refund();
    vi.useRealTimers();
    expect(rows.get(`ai-daily:${courtesyBucketHour(before)}`)).toBe(0);
  });

  it("el reintegro por hora usa el bucket del consumo, no el de now", async () => {
    const rows = fakeQuota();
    const consumed = Math.floor(NOW / 3_600_000) - 1; // el consumo ocurrió una hora antes
    rows.set(`explain:${consumed}`, 5);
    rows.set("ai-daily:" + courtesyBucketHour(NOW), 300);
    const g = await guardDailyAi({} as never, "u", 300, "explain", { now: NOW, hourlyBucket: consumed });
    expect(g.deny).toBeDefined();
    expect(rows.get(`explain:${consumed}`)).toBe(4);
  });

  it("sin tabla falla abierta", async () => {
    withClientMock.mockRejectedValue(Object.assign(new Error("x"), { code: "42P01" }));
    const g = await guardDailyAi({} as never, "u", 300, "explain", { now: NOW });
    expect(g.deny).toBeUndefined();
  });
});
