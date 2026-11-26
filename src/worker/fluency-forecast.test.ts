import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import { fluencyForecast } from "./fluency-forecast";

const getSessionMock = vi.hoisted(() => vi.fn());
const loadUserPlanMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a) }));
vi.mock("./plan-store", () => ({ loadUserPlan: (...a: unknown[]) => loadUserPlanMock(...a) }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: async (_env: unknown, run: (c: { query: typeof queryMock }) => Promise<unknown>) =>
    run({ query: queryMock }),
}));

function app() {
  const a = new Hono<{ Bindings: WorkerEnv }>();
  a.route("/", fluencyForecast);
  return a;
}

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  loadUserPlanMock.mockReset();
  queryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe("GET /api/fluency-forecast", () => {
  it("free: 402 LECTA_PLUS_REQUIRED sin tocar la base", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "free", degraded: false });
    const res = await app().request("/api/fluency-forecast", {}, {} as WorkerEnv);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("LECTA_PLUS_REQUIRED");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("plus sin datos: 200 no-data y no-store", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "lecta_plus", degraded: false });
    const res = await app().request("/api/fluency-forecast", {}, {} as WorkerEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { lang: string; forecast: { status: string } };
    expect(body.forecast.status).toBe("no-data");
  });

  it("plus con ritmo: proyección del idioma pedido", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "lecta_plus", degraded: false });
    const week = 7 * 86_400_000;
    const rows: Record<string, unknown>[] = [];
    for (let w = 0; w < 4; w++) for (let k = 0; k < 20; k++) rows.push({ language: "en", saved_at: Date.now() - w * week - 5000 - k });
    for (let k = 0; k < 500; k++) rows.push({ language: "en", saved_at: Date.now() - 30 * week });
    for (let k = 0; k < 900; k++) rows.push({ language: "es", saved_at: Date.now() - 30 * week });
    queryMock.mockResolvedValue({ rows });
    const res = await app().request("/api/fluency-forecast?lang=en", {}, {} as WorkerEnv);
    const body = (await res.json()) as { lang: string; forecast: { status: string; at: number } };
    expect(body.lang).toBe("en");
    expect(body.forecast.status).toBe("projection");
    expect(body.forecast.at).toBeGreaterThan(Date.now());
  });

  it("tabla ausente: no-data, no error", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "lecta_plus", degraded: false });
    queryMock.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const res = await app().request("/api/fluency-forecast", {}, {} as WorkerEnv);
    expect(res.status).toBe(200);
  });
});
