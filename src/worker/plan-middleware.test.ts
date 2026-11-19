import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "./db";
import {
  LECTA_PLUS_REQUIRED,
  createRequireKindlePlan,
  requireLectaPlus,
  requireSessionWithPlan,
  type CourtesyVariables,
  type PlanVariables,
} from "./plan-middleware";

const getSessionMock = vi.hoisted(() => vi.fn());
const loadUserPlanMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));
vi.mock("./plan-store", () => ({
  loadUserPlan: (...args: unknown[]) => loadUserPlanMock(...args),
}));

const snapshot = (plan: string) => ({ plan, degraded: false });

function gatedApp() {
  const app = new Hono<{ Bindings: WorkerEnv; Variables: PlanVariables }>();
  app.get("/premium", requireLectaPlus, (c) => c.json({ user: c.get("session").user.id }));
  return app;
}

function kindleApp() {
  const app = new Hono<{ Bindings: WorkerEnv }>();
  app.use("*", createRequireKindlePlan(() => "<p>Es de Lecta+</p>"));
  app.get("*", (c) => c.text("ok"));
  return app;
}

beforeEach(() => {
  getSessionMock.mockReset();
  loadUserPlanMock.mockReset();
});

describe("requireLectaPlus", () => {
  it("sin sesión responde 401 sin consultar el plan", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await gatedApp().request("/premium");
    expect(res.status).toBe(401);
    expect(loadUserPlanMock).not.toHaveBeenCalled();
  });

  it("sin base configurada responde 503", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(undefined);
    const res = await gatedApp().request("/premium");
    expect(res.status).toBe(503);
  });

  it("error de base responde 503", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockRejectedValue(new Error("pg down"));
    const res = await gatedApp().request("/premium");
    expect(res.status).toBe(503);
  });

  it("free responde 402 con el código", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(snapshot("free"));
    const res = await gatedApp().request("/premium");
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Esta función es de Lecta+.",
      code: LECTA_PLUS_REQUIRED,
    });
  });

  it("fundador y lecta_plus pasan con la sesión en el contexto", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    for (const plan of ["founder_lifetime", "lecta_plus"]) {
      loadUserPlanMock.mockResolvedValue(snapshot(plan));
      const res = await gatedApp().request("/premium");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: "u1" });
    }
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });
});

describe("requireKindlePlan", () => {
  it("sin sesión deja pasar (los handlers redirigen)", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await kindleApp().request("/k/read/abc");
    expect(res.status).toBe(200);
    expect(loadUserPlanMock).not.toHaveBeenCalled();
  });

  it("las rutas exentas no consultan sesión ni plan", async () => {
    for (const path of ["/k/login", "/k/verify", "/k/api/kindle/link", "/k/api/kindle/status"]) {
      const res = await kindleApp().request(path);
      expect(res.status).toBe(200);
    }
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(loadUserPlanMock).not.toHaveBeenCalled();
  });

  it("free recibe la nota HTML con 402", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(snapshot("free"));
    const res = await kindleApp().request("/k/read/abc");
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Lecta+");
  });

  it("fundador entra", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(snapshot("founder_lifetime"));
    const res = await kindleApp().request("/k");
    expect(res.status).toBe(200);
  });
});

describe("requireSessionWithPlan", () => {
  function courtesyApp() {
    const app = new Hono<{ Bindings: WorkerEnv; Variables: CourtesyVariables }>();
    app.get("/ai", requireSessionWithPlan, (c) =>
      c.json({ user: c.get("session").user.id, lectaPlus: c.get("lectaPlus") }),
    );
    return app;
  }

  it("sin sesión 401; sin base 503; error de base 503", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await courtesyApp().request("/ai")).status).toBe(401);
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(undefined);
    expect((await courtesyApp().request("/ai")).status).toBe(503);
    loadUserPlanMock.mockRejectedValue(new Error("pg"));
    expect((await courtesyApp().request("/ai")).status).toBe(503);
  });

  it("free pasa (no 402) con lectaPlus=false; Lecta+ y fundador con true", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(snapshot("free"));
    let res = await courtesyApp().request("/ai");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "u1", lectaPlus: false });
    for (const plan of ["lecta_plus", "founder_lifetime"]) {
      loadUserPlanMock.mockResolvedValue(snapshot(plan));
      res = await courtesyApp().request("/ai");
      expect(await res.json()).toEqual({ user: "u1", lectaPlus: true });
    }
  });
});
