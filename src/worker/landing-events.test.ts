import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "./db";
import * as sessionModule from "./session";
import type { WorkerEnv } from "./db";
import { app } from "./app";
import {
  LANDING_EVENT_LIMIT_PER_MINUTE,
  LANDING_SOURCE_MAX,
  allowLandingEvent,
  normalizeLandingSource,
  parseLandingEvent,
  purgeLandingEvents,
  purgePlanEvents,
  recordLandingEvent,
  recordPlanEvent,
  resetLandingLimiter,
} from "./landing-events";

type FakeClient = { query: ReturnType<typeof vi.fn> };

function withFakeClient(client: FakeClient | undefined) {
  return vi.spyOn(dbModule, "withClient").mockImplementation(async (_env, run) => {
    if (!client) return undefined;
    return run(client as unknown as Parameters<typeof run>[0]);
  });
}

const env = {} as WorkerEnv;

beforeEach(() => {
  vi.restoreAllMocks();
  resetLandingLimiter();
});

describe("normalizeLandingSource", () => {
  it("baja a minúsculas y quita www.", () => {
    expect(normalizeLandingSource("WWW.Google.com")).toBe("google.com");
  });

  it("vacío, no-texto, largo o con caracteres raros ⇒ direct", () => {
    expect(normalizeLandingSource("")).toBe("direct");
    expect(normalizeLandingSource(undefined)).toBe("direct");
    expect(normalizeLandingSource(42)).toBe("direct");
    expect(normalizeLandingSource("a".repeat(LANDING_SOURCE_MAX + 1))).toBe("direct");
    expect(normalizeLandingSource("<script>")).toBe("direct");
    expect(normalizeLandingSource("mi correo@x.com")).toBe("direct");
  });
});

describe("parseLandingEvent", () => {
  it("acepta eventos de la lista y normaliza la fuente", () => {
    expect(parseLandingEvent({ event: "cta:hero", source: "Instagram.com" })).toEqual({
      event: "cta:hero",
      source: "instagram.com",
    });
    expect(parseLandingEvent({ event: "view" })).toEqual({ event: "view", source: "direct" });
  });

  it("descarta eventos fuera de la lista, signup y campos extra", () => {
    expect(parseLandingEvent({ event: "cta:otro" })).toBeNull();
    expect(parseLandingEvent({ event: "signup", source: "x" })).toBeNull();
    expect(parseLandingEvent({ event: "view", userId: "u1" })).toBeNull();
    expect(parseLandingEvent(["view"])).toBeNull();
    expect(parseLandingEvent(null)).toBeNull();
  });
});

describe("eventos de plan (app:)", () => {
  it("acepta plannote con feature de la lista cerrada y rechaza inventadas", () => {
    expect(parseLandingEvent({ event: "app:plannote:wordpanel", source: "trial" })).toEqual({
      event: "app:plannote:wordpanel",
      source: "trial",
    });
    expect(parseLandingEvent({ event: "app:plannote:inventado" })).toBeNull();
    expect(parseLandingEvent({ event: "app:plannote:" })).toBeNull();
  });

  it("app:* solo acepta fuentes de plan; lo demás es unknown", () => {
    expect(parseLandingEvent({ event: "app:paywall:coach", source: "free" })?.event).toBe("app:paywall:coach");
    expect(parseLandingEvent({ event: "app:paywall:inventado", source: "free" })).toBeNull();
    expect(parseLandingEvent({ event: "app:paywall", source: "plus" })?.source).toBe("plus");
    expect(parseLandingEvent({ event: "app:paywall", source: "instagram.com" })?.source).toBe("unknown");
    expect(parseLandingEvent({ event: "app:paywall" })?.source).toBe("unknown");
    expect(parseLandingEvent({ event: "view" })?.source).toBe("direct");
  });

  it("acepta los eventos fijos y los días de aviso permitidos", () => {
    for (const event of ["app:paywall", "app:carne-open", "app:trial-end-view", "app:trial-end-cta", "app:recap-locked", "app:trial-warning:3", "app:trial-warning:2", "app:trial-warning:1"]) {
      expect(parseLandingEvent({ event })?.event).toBe(event);
    }
    expect(parseLandingEvent({ event: "app:trial-warning:99" })).toBeNull();
    expect(parseLandingEvent({ event: "app:trial-warning:7" })).toBeNull();
  });

  it("checkout-start/complete no entran por el endpoint público", () => {
    expect(parseLandingEvent({ event: "app:checkout-start:monthly" })).toBeNull();
    expect(parseLandingEvent({ event: "app:checkout-complete:yearly" })).toBeNull();
  });
});

describe("allowLandingEvent", () => {
  it("corta al pasar el tope por minuto y se reinicia en la ventana siguiente", () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < LANDING_EVENT_LIMIT_PER_MINUTE; i++) {
      expect(allowLandingEvent("1.1.1.1", now)).toBe(true);
    }
    expect(allowLandingEvent("1.1.1.1", now)).toBe(false);
    expect(allowLandingEvent("2.2.2.2", now)).toBe(true);
    expect(allowLandingEvent("1.1.1.1", now + 60_000)).toBe(true);
  });
});

describe("recordLandingEvent / purgeLandingEvents", () => {
  it("hace UPSERT sobre la fila del día", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    withFakeClient(client);
    const ok = await recordLandingEvent(
      env,
      { event: "view", source: "direct" },
      new Date("2026-11-15T10:00:00Z"),
    );
    expect(ok).toBe(true);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (bucket_day, event, source)");
    expect(params).toEqual(["2026-11-15", "view", "direct"]);
  });

  it("sin base devuelve false", async () => {
    withFakeClient(undefined);
    expect(await recordLandingEvent(env, { event: "view", source: "direct" })).toBe(false);
  });

  it("purga lo anterior a 90 días", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 3 }) };
    withFakeClient(client);
    expect(await purgeLandingEvents(env)).toBe(3);
    expect(client.query.mock.calls[0]?.[1]).toEqual([90]);
  });
});

describe("recordPlanEvent / purgePlanEvents (F19)", () => {
  it("hace UPSERT por cuenta, día y evento", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    withFakeClient(client);
    expect(await recordPlanEvent(env, "u1", "app:paywall:ai", new Date("2026-11-25T10:00:00Z"))).toBe(true);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (user_id, day, event)");
    expect(params).toEqual(["u1", "2026-11-25", "app:paywall:ai"]);
  });

  it("tabla ausente (42P01) o fallo ⇒ false sin lanzar", async () => {
    withFakeClient({
      query: vi.fn().mockRejectedValue(Object.assign(new Error("no table"), { code: "42P01" })),
    });
    expect(await recordPlanEvent(env, "u1", "app:paywall:ai")).toBe(false);
  });

  it("no escribe sin usuario ni para eventos que no son app:*", async () => {
    const client = { query: vi.fn() };
    withFakeClient(client);
    expect(await recordPlanEvent(env, "", "app:paywall:ai")).toBe(false);
    expect(await recordPlanEvent(env, "u1", "view")).toBe(false);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("purga lo anterior a 180 días", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 2 }) };
    withFakeClient(client);
    expect(await purgePlanEvents(env)).toBe(2);
    expect(client.query.mock.calls[0]?.[1]).toEqual([180]);
  });
});

describe("POST /api/landing-events", () => {
  const post = (body: string) =>
    app.request(
      "/api/landing-events",
      {
        method: "POST",
        headers: { "content-type": "text/plain", "cf-connecting-ip": "9.9.9.9" },
        body,
      },
      { DATABASE_URL: "postgres://mock" },
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("registra un evento válido y responde 204 sin sesión", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    withFakeClient(client);
    const res = await post(JSON.stringify({ event: "demo_save", source: "google.com" }));
    expect(res.status).toBe(204);
    await settle();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[1]).toEqual([expect.any(String), "demo_save", "google.com"]);
  });

  it("cuerpo inválido, evento desconocido o grande ⇒ 204 sin escribir", async () => {
    const client = { query: vi.fn() };
    withFakeClient(client);
    for (const body of ["no-json", JSON.stringify({ event: "signup" }), "x".repeat(600)]) {
      expect((await post(body)).status).toBe(204);
    }
    await settle();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("app:* sin sesión solo escribe el contador anónimo", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    withFakeClient(client);
    const res = await post(JSON.stringify({ event: "app:paywall", source: "free" }));
    expect(res.status).toBe(204);
    await settle();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0]?.[0])).toContain("lecta_landing_daily");
  });

  it("app:* con sesión escribe también por cuenta", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    withFakeClient(client);
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await post(JSON.stringify({ event: "app:paywall", source: "free" }));
    expect(res.status).toBe(204);
    await settle();
    await settle();
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes("lecta_plan_events"))).toBe(true);
    expect(client.query.mock.calls.find((c) => String(c[0]).includes("lecta_plan_events"))?.[1]?.[0]).toBe("u1");
  });

  it("si la tabla no existe sigue respondiendo 204", async () => {
    withFakeClient({
      query: vi.fn().mockRejectedValue(Object.assign(new Error("no table"), { code: "42P01" })),
    });
    const res = await post(JSON.stringify({ event: "view" }));
    expect(res.status).toBe(204);
    await settle();
  });
});
