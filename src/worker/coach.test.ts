import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import { coach, isoWeekKey } from "./coach";
import { buildCoachPrompt } from "./ai";

const getSessionMock = vi.hoisted(() => vi.fn());
const loadUserPlanMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const consumeMock = vi.hoisted(() => vi.fn());
const callMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a) }));
vi.mock("./plan-store", () => ({ loadUserPlan: (...a: unknown[]) => loadUserPlanMock(...a) }));
vi.mock("./rate-limit", () => ({
  consumeRateUnits: (...a: unknown[]) => consumeMock(...a),
  refundRateUnits: vi.fn(async () => undefined),
}));
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  callDeepSeek: (...a: unknown[]) => callMock(...a),
  logAiCall: vi.fn(),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: async (_env: unknown, run: (c: { query: typeof queryMock }) => Promise<unknown>) =>
    run({ query: queryMock }),
}));

function makeEnv() {
  const store = new Map<string, string>();
  const BOOKS = {
    get: vi.fn(async (k: string) => (store.has(k) ? { json: async () => JSON.parse(store.get(k)!) } : null)),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
  return { BOOKS } as unknown as WorkerEnv;
}

const app = () => {
  const a = new Hono<{ Bindings: WorkerEnv }>();
  a.route("/", coach);
  return a;
};

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  loadUserPlanMock.mockReset().mockResolvedValue({ plan: "lecta_plus", degraded: false });
  queryMock.mockReset().mockResolvedValue({ rows: [{ days: "3", ms: "1800000", n: "4" }] });
  consumeMock.mockReset().mockResolvedValue(true);
  callMock.mockReset().mockResolvedValue({
    ok: true,
    content: JSON.stringify({ coach: "Leíste tres días esta semana; sigue con diez minutos diarios." }),
    finishReason: "stop",
  });
});

describe("GET /api/coach/weekly", () => {
  it("free: 402 y no llama a la IA", async () => {
    loadUserPlanMock.mockResolvedValue({ plan: "free", degraded: false });
    const res = await app().request("/api/coach/weekly", {}, makeEnv());
    expect(res.status).toBe(402);
    expect(callMock).not.toHaveBeenCalled();
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("plus: una llamada IA por semana; la segunda va a caché", async () => {
    const env = makeEnv();
    const first = await app().request("/api/coach/weekly", {}, env);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { source: string }).source).toBe("ai");
    const second = await app().request("/api/coach/weekly", {}, env);
    expect(((await second.json()) as { text: string }).text).toContain("tres días");
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(consumeMock).toHaveBeenCalledWith(env, "u1", 1, 1, "coach", expect.any(Number));
  });

  it("IA falla: respaldo determinista, sin guardar", async () => {
    callMock.mockResolvedValue({ ok: false, reason: "api-error", status: 500, attempts: 1 });
    const env = makeEnv();
    const res = await app().request("/api/coach/weekly", {}, env);
    expect(((await res.json()) as { source: string }).source).toBe("fallback");
    expect(env.BOOKS!.put).not.toHaveBeenCalled();
  });

  it("cuota semanal gastada sin caché: 429", async () => {
    consumeMock.mockResolvedValue(false);
    const res = await app().request("/api/coach/weekly", {}, makeEnv());
    expect(res.status).toBe(429);
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe("prompt del coach", () => {
  it("solo cifras y título: sin texto de pasaje", () => {
    const p = buildCoachPrompt({ daysRead: 3, minutes: 30, newWords: 4, reviews: 9, overdue: 2, currentBook: "Marianela" });
    expect(p).toContain("Días con lectura (de 7): 3");
    expect(p).toContain("Libro actual: Marianela");
    expect(p).not.toMatch(/pasaje|passage/i);
  });
  it("semana ISO", () => {
    expect(isoWeekKey(Date.UTC(2026, 10, 25))).toBe("2026-W48");
  });
});
