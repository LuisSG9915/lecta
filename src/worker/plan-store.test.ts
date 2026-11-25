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
});
