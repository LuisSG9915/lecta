import { describe, expect, it, vi } from "vitest";
import { PLAN_GRACE_MS, REVERSE_TRIAL_MS } from "../shared/plan";
import { getUserPlan, loadUserPlan, setStarterCoat, upsertPlanFromStripe } from "./plan-store";

const missingTable = Object.assign(new Error("relation does not exist"), { code: "42P01" });

function clientWith(impl: (sql: string, params?: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => impl(sql, params));
  return { query };
}

describe("getUserPlan", () => {
  const now = 2_000_000_000_000;

  it("sin fila devuelve free", async () => {
    const client = clientWith(() => ({ rows: [] }));
    const snap = await getUserPlan(client, "u1", { now });
    expect(snap).toMatchObject({ plan: "free", starterCoat: null, degraded: false });
  });

  it("lecta_plus vigente y dentro de la gracia se respeta", async () => {
    const vigente = clientWith(() => ({ rows: [{ plan: "lecta_plus", plan_expires_at: now + 1000 }] }));
    expect((await getUserPlan(vigente, "u1", { now })).plan).toBe("lecta_plus");
    const enGracia = clientWith(() => ({
      rows: [{ plan: "lecta_plus", plan_expires_at: String(now - PLAN_GRACE_MS + 1000) }],
    }));
    expect((await getUserPlan(enGracia, "u1", { now })).plan).toBe("lecta_plus");
  });

  describe("prueba inversa", () => {
    const created = Date.UTC(2026, 11, 3);
    const ends = created + REVERSE_TRIAL_MS;

    it("una cuenta free dentro de sus 14 días tiene lecta_plus con trialEndsAt, en una sola consulta", async () => {
      const client = clientWith(() => ({ rows: [{ plan: null, user_created_at: String(created) }] }));
      const snap = await getUserPlan(client, "u1", { now: created + 1000 });
      expect(snap).toMatchObject({ plan: "lecta_plus", trialEndsAt: ends, expiresAt: null });
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(client.query.mock.calls[0][0]).toContain('"createdAt"');
    });

    it("el día 15 vuelve a free sin gracia", async () => {
      const client = clientWith(() => ({ rows: [{ plan: "free", user_created_at: created }] }));
      const snap = await getUserPlan(client, "u1", { now: ends + 1 });
      expect(snap).toMatchObject({ plan: "free", trialEndsAt: null });
    });

    it("trialEndedAt solo para quien nunca pagó y dentro de 30 días", async () => {
      const at = (row: Record<string, unknown>, now: number) =>
        getUserPlan(clientWith(() => ({ rows: [{ plan: "free", user_created_at: created, ...row }] })), "u1", { now });
      expect((await at({}, ends + 86_400_000)).trialEndedAt).toBe(ends);
      expect((await at({}, ends + 31 * 86_400_000)).trialEndedAt).toBeUndefined();
      const exSub = await at({ stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" }, ends + 86_400_000);
      expect(exSub.trialEndedAt).toBeUndefined();
    });

    it("un fundador o un suscriptor vigente no está en prueba", async () => {
      const founder = clientWith(() => ({ rows: [{ plan: "founder_lifetime", user_created_at: created }] }));
      expect(await getUserPlan(founder, "u1", { now: created + 1 })).toMatchObject({
        plan: "founder_lifetime",
        trialEndsAt: null,
      });
      const paid = clientWith(() => ({
        rows: [{ plan: "lecta_plus", plan_expires_at: ends + 30 * 86_400_000, user_created_at: created }],
      }));
      expect((await getUserPlan(paid, "u1", { now: created + 1 })).trialEndsAt).toBeNull();
    });
  });

  it("lecta_plus vencido más allá de la gracia devuelve free", async () => {
    const client = clientWith(() => ({
      rows: [{ plan: "lecta_plus", plan_expires_at: now - PLAN_GRACE_MS - 1 }],
    }));
    expect((await getUserPlan(client, "u1", { now })).plan).toBe("free");
  });

  it("fundador con pelaje y datos de Stripe", async () => {
    const client = clientWith(() => ({
      rows: [
        {
          plan: "founder_lifetime",
          starter_coat: "calico",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
          plan_expires_at: null,
        },
      ],
    }));
    expect(await getUserPlan(client, "u1", { now })).toEqual({
      plan: "founder_lifetime",
      starterCoat: "calico",
      expiresAt: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      trialEndsAt: null,
      degraded: false,
    });
  });

  it("42P01 devuelve founder_lifetime degradado", async () => {
    const client = clientWith(() => {
      throw missingTable;
    });
    expect(await getUserPlan(client, "u1")).toMatchObject({
      plan: "founder_lifetime",
      degraded: true,
    });
  });

  it("otro error se propaga", async () => {
    const client = clientWith(() => {
      throw new Error("boom");
    });
    await expect(getUserPlan(client, "u1")).rejects.toThrow("boom");
  });

  it("inTransaction envuelve en SAVEPOINT y revierte ante 42P01", async () => {
    const client = clientWith((sql) => {
      if (sql.startsWith("SELECT")) throw missingTable;
      return { rows: [] };
    });
    const snap = await getUserPlan(client, "u1", { inTransaction: true });
    expect(snap.degraded).toBe(true);
    const sqls = client.query.mock.calls.map((call) => call[0]);
    expect(sqls[0]).toBe("SAVEPOINT lecta_plan_read");
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT lecta_plan_read");
  });
});

describe("loadUserPlan", () => {
  it("sin cadena de conexión devuelve undefined", async () => {
    expect(await loadUserPlan({}, "u1")).toBeUndefined();
  });
});

describe("setStarterCoat", () => {
  it("escribe una sola vez", async () => {
    const written = clientWith(() => ({ rows: [{ starter_coat: "mist" }] }));
    expect(await setStarterCoat(written, "u1", "mist")).toBe("written");
    const exists = clientWith(() => ({ rows: [] }));
    expect(await setStarterCoat(exists, "u1", "mist")).toBe("exists");
    expect(String(exists.query.mock.calls[0][0])).toContain("starter_coat IS NULL");
  });

  it("sin tabla responde unavailable", async () => {
    const client = clientWith(() => {
      throw missingTable;
    });
    expect(await setStarterCoat(client, "u1", "mist")).toBe("unavailable");
  });
});

describe("upsertPlanFromStripe", () => {
  it("nunca rebaja a un fundador", async () => {
    const client = clientWith(() => ({ rows: [] }));
    await upsertPlanFromStripe(client, "u1", { stripeCustomerId: "cus_1", planExpiresAt: 5 }, 9);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("WHEN lecta_user_plan.plan = 'founder_lifetime'");
    expect(params).toEqual(["u1", "cus_1", null, 5, 9]);
  });

  it("con eventCreated solo pisa si el evento no es más viejo", async () => {
    const client = clientWith(() => ({ rows: [] }));
    await upsertPlanFromStripe(client, "u1", { planExpiresAt: 5, eventCreated: 3000 }, 9);
    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe("SAVEPOINT stripe_order");
    const [sql, params] = calls[1];
    expect(sql).toContain("stripe_event_created <= EXCLUDED.stripe_event_created");
    expect(params).toEqual(["u1", null, null, 5, 9, 3000]);
  });

  it("devuelve false si el WHERE de orden descartó el evento (sin RETURNING)", async () => {
    const dropped = clientWith(() => ({ rows: [] }));
    expect(await upsertPlanFromStripe(dropped, "u1", { planExpiresAt: 5, eventCreated: 3000 }, 9)).toBe(false);
    expect(String(dropped.query.mock.calls[1][0])).toContain("RETURNING user_id");
    const ok = clientWith(() => ({ rows: [{ user_id: "u1" }] }));
    expect(await upsertPlanFromStripe(ok, "u1", { planExpiresAt: 5, eventCreated: 3000 }, 9)).toBe(true);
  });

  it("sin la columna 034 (42703) vuelve a la escritura de siempre", async () => {
    const client = clientWith((sql) => {
      if (sql.includes("stripe_event_created")) {
        throw Object.assign(new Error('column "stripe_event_created" does not exist'), { code: "42703" });
      }
      return { rows: [] };
    });
    await upsertPlanFromStripe(client, "u1", { planExpiresAt: 5, eventCreated: 3000 }, 9);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT stripe_order");
    expect(String(sqls[sqls.length - 1])).not.toContain("stripe_event_created");
  });
});
