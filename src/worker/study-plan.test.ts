import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import { studyPlan } from "./study-plan";

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
  a.route("/", studyPlan);
  return a;
}

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  loadUserPlanMock.mockReset();
  queryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe("GET /api/study-plan", () => {
  it("free: 402 LECTA_PLUS_REQUIRED sin tocar la base", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "free", degraded: false });
    const res = await app().request("/api/study-plan", {}, {} as WorkerEnv);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("LECTA_PLUS_REQUIRED");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("plus: 200 con el plan; sin datos, vacío honesto", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "lecta_plus", degraded: false });
    const res = await app().request("/api/study-plan", {}, {} as WorkerEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.empty).toBe(true);
    expect(body.days).toHaveLength(7);
  });

  it("plus: reparte las vencidas y tolera tabla ausente", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "lecta_plus", degraded: false });
    const past = Date.now() - 1000;
    queryMock
      .mockResolvedValueOnce({ rows: Array.from({ length: 30 }, () => ({ due: String(past) })) })
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: "42P01" }))
      .mockResolvedValueOnce({ rows: [{ book_hash: "h", section_index: "2", progress: 0.5 }] });
    const res = await app().request("/api/study-plan", {}, {} as WorkerEnv);
    const body = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.days[0].reviews).toBe(25);
    expect(body.days[1].reviews).toBe(5);
    expect(body.next).toEqual({ bookHash: "h", sectionIndex: 3 });
  });
});
