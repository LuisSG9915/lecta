import { describe, expect, it } from "vitest";
import { buildCohorts, isTestEmail, summarizeActive } from "./retention-stats.mjs";

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
