import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PLAN_GRACE_MS,
  REVERSE_TRIAL_MS,
  REVERSE_TRIAL_START,
  buildCohorts,
  buildPlanEventCohorts,
  classifyPlan,
  isTestEmail,
  summarizeActive,
  trialEndsAt,
} from "./retention-stats.mjs";

const DAY = 86_400_000;
// Lunes 2026-11-02 00:00 UTC
const MON = Date.UTC(2026, 10, 2);
const NOW = MON + 40 * DAY;

describe("retention:stats", () => {
  it("excluye las cuentas de prueba", () => {
    expect(isTestEmail("a-1795362968983@smoke.test")).toBe(true);
    expect(isTestEmail("sync-smoke-1@example.com")).toBe(true);
    expect(isTestEmail("smoke-auth-a@example.com")).toBe(true);
    expect(isTestEmail("lector@gmail.com")).toBe(false);
  });

  it("agrupa por semana de alta y cuenta D1, S1 y D8–30 por días desde el alta", () => {
    const users = [
      // vuelve el día 1 y el día 10
      { created: MON + 3_600_000, plan: "free", days: [MON + 3_600_000, MON + 3_600_000 + DAY + 5, MON + 3_600_000 + 10 * DAY] },
      // solo el día del alta
      { created: MON + 2 * DAY, plan: "free", days: [MON + 2 * DAY + 60_000] },
      // nunca hizo nada
      { created: MON + 4 * DAY, plan: "founder_lifetime", days: [] },
    ];
    const [cohort] = buildCohorts(users, NOW);
    expect(cohort).toMatchObject({ week: "2026-11-02", signups: 3, activated: 2, d1: 1, w1: 1, d8to30: 1 });
    expect(cohort.d1Eligible).toBe(3);
  });

  it("una cohorte demasiado reciente no cuenta como abandono", () => {
    const recent = NOW - 3 * DAY;
    const [cohort] = buildCohorts([{ created: recent, plan: "free", days: [recent] }], NOW);
    expect(cohort.d1Eligible).toBe(1);
    expect(cohort.w1Eligible).toBe(0);
    expect(cohort.d8to30Eligible).toBe(0);
  });

  it("activos en 7 y 30 días por plan", () => {
    const users = [
      { created: MON, plan: "free", days: [NOW - 2 * DAY] },
      { created: MON, plan: "founder_lifetime", days: [NOW - 20 * DAY] },
      { created: MON, plan: "free", days: [] },
    ];
    expect(summarizeActive(users, NOW)).toEqual({
      total: 3,
      active7: 1,
      active30: 2,
      byPlan: {
        free: { total: 2, active7: 1, active30: 1 },
        founder_lifetime: { total: 1, active7: 0, active30: 1 },
      },
    });
  });
});

describe("retention:stats planes", () => {
  const T = Date.UTC(2026, 10, 30);
  const base = { expiresAt: null, hasSubscription: false };

  it("prueba activa", () => {
    expect(classifyPlan({ ...base, plan: "free", created: T - 2 * DAY }, T)).toBe("trial");
    // cuenta anterior al lanzamiento: la prueba cuenta desde 2026-11-25
    expect(classifyPlan({ ...base, plan: "free", created: Date.UTC(2026, 9, 1) }, T)).toBe("trial");
  });

  it("prueba vencida", () => {
    expect(classifyPlan({ ...base, plan: "free", created: T - 20 * DAY }, Date.UTC(2026, 11, 20))).toBe("free");
    expect(classifyPlan({ ...base, plan: "free", created: Date.UTC(2026, 9, 1) }, Date.UTC(2026, 11, 20))).toBe("free");
  });

  it("pagado y fundador", () => {
    const paid = { plan: "lecta_plus", hasSubscription: true, expiresAt: T + 10 * DAY, created: T - 40 * DAY };
    expect(classifyPlan(paid, T)).toBe("plus_paid");
    expect(classifyPlan({ ...paid, expiresAt: T - 10 * DAY }, T)).toBe("trial");
    expect(classifyPlan({ ...paid, hasSubscription: false }, T)).toBe("trial");
    expect(classifyPlan({ ...base, plan: "founder_lifetime", created: T - 90 * DAY }, T)).toBe("founder_lifetime");
  });

  it("columna prueba → pago por cohorte", () => {
    const created = MON + DAY;
    const end = trialEndsAt(created);
    const users = [
      { created, plan: "plus_paid", trialEnd: end, days: [] },
      { created, plan: "free", trialEnd: end, days: [] },
      { created, plan: "trial", trialEnd: NOW + DAY, days: [] },
      { created, plan: "founder_lifetime", days: [] },
    ];
    const [c] = buildCohorts(users, NOW);
    expect(c.trialEnded).toBe(2);
    expect(c.trialPaid).toBe(1);
  });

  it("constantes iguales a src/shared/plan.ts", () => {
    const src = readFileSync(new URL("../src/shared/plan.ts", import.meta.url), "utf8");
    const days = (name) => Number(new RegExp(`${name} = (\\d+) \\* 24 \\* 60 \\* 60 \\* 1000`).exec(src)?.[1]) * DAY;
    expect(REVERSE_TRIAL_MS).toBe(days("REVERSE_TRIAL_MS"));
    expect(PLAN_GRACE_MS).toBe(days("PLAN_GRACE_MS"));
    const m = /REVERSE_TRIAL_START = Date\.UTC\((\d+), (\d+), (\d+)\)/.exec(src);
    expect(REVERSE_TRIAL_START).toBe(Date.UTC(Number(m[1]), Number(m[2]), Number(m[3])));
  });
});

describe("retention:stats avisos (F19)", () => {
  it("cuenta cuentas que vieron cada aviso y cuántas son plus_paid, sin ids", () => {
    const created = MON + DAY;
    const users = [
      { id: "a", created, plan: "plus_paid" },
      { id: "b", created, plan: "free" },
      { id: "c", created, plan: "free" },
    ];
    const events = new Map([
      ["a", ["app:paywall:ai", "app:checkout-start:monthly"]],
      ["b", ["app:paywall", "app:trial-end-view"]],
    ]);
    const [c] = buildPlanEventCohorts(users, events);
    expect(c).toMatchObject({ signups: 3, paywall: 2, paywallPaid: 1, trialEnd: 1, trialEndPaid: 0, checkout: 1, checkoutPaid: 1 });
    expect(JSON.stringify(c)).not.toMatch(/"[abc]"/);
  });
});
