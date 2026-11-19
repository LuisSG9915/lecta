import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUserPlanCache, loadUserPlan, setStarterCoat, upsertPlanFromStripe } from "./plan-store";

const withClientMock = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: (...args: unknown[]) => withClientMock(...args),
}));

const missingTable = Object.assign(new Error("no table"), { code: "42P01" });
let row: Record<string, unknown> | null;
let queryError: unknown;
const query = vi.fn(async () => {
  if (queryError) throw queryError;
  return { rows: row ? [row] : [] };
});

beforeEach(() => {
  vi.useRealTimers();
  clearUserPlanCache();
  query.mockClear();
  row = null;
  queryError = undefined;
  withClientMock.mockReset();
  withClientMock.mockImplementation(async (_env, run) => run({ query }));
});

describe("caché de loadUserPlan (30 s, solo positivos)", () => {
  it("Lecta+ y fundador se cachean: la segunda lectura no toca la base", async () => {
    row = { plan: "founder_lifetime" };
    expect((await loadUserPlan({}, "u1"))?.plan).toBe("founder_lifetime");
    expect((await loadUserPlan({}, "u1"))?.plan).toBe("founder_lifetime");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("free nunca se cachea (quien paga lo ve de inmediato)", async () => {
    row = null;
    expect((await loadUserPlan({}, "u1"))?.plan).toBe("free");
    row = { plan: "lecta_plus", plan_expires_at: Date.now() + 100_000 };
    expect((await loadUserPlan({}, "u1"))?.plan).toBe("lecta_plus");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("degraded (42P01) nunca se cachea", async () => {
    queryError = missingTable;
    expect((await loadUserPlan({}, "u1"))?.degraded).toBe(true);
    expect((await loadUserPlan({}, "u1"))?.degraded).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("caduca a los 30 s", async () => {
    vi.useFakeTimers();
    row = { plan: "founder_lifetime" };
    await loadUserPlan({}, "u1");
    vi.advanceTimersByTime(29_000);
    await loadUserPlan({}, "u1");
    expect(query).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await loadUserPlan({}, "u1");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("devuelve copias: mutar el resultado no ensucia la caché", async () => {
    row = { plan: "founder_lifetime" };
    const first = await loadUserPlan({}, "u1");
    first!.plan = "free";
    expect((await loadUserPlan({}, "u1"))?.plan).toBe("founder_lifetime");
  });

  it("upsertPlanFromStripe invalida", async () => {
    row = { plan: "lecta_plus", plan_expires_at: Date.now() + 100_000 };
    await loadUserPlan({}, "u1");
    await upsertPlanFromStripe({ query: vi.fn(async () => ({ rows: [] })) }, "u1", {
      planExpiresAt: 1,
    });
    await loadUserPlan({}, "u1");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("setStarterCoat invalida", async () => {
    row = { plan: "founder_lifetime" };
    await loadUserPlan({}, "u1");
    await setStarterCoat({ query: vi.fn(async () => ({ rows: [{ starter_coat: "mist" }] })) }, "u1", "mist");
    await loadUserPlan({}, "u1");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
