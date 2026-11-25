import { describe, expect, it } from "vitest";
import {
  FREE_AI_COURTESY_LIMIT,
  PLAN_GRACE_MS,
  REVERSE_TRIAL_MS,
  REVERSE_TRIAL_START,
  reverseTrialEndsAt,
  courtesyBucketHour,
  freeAiRemaining,
  effectivePlan,
  hasLectaPlus,
  isStarterCoat,
  normalizePlan,
} from "./plan";

describe("plan", () => {
  it("hasLectaPlus: solo lecta_plus y founder_lifetime", () => {
    expect(hasLectaPlus("lecta_plus")).toBe(true);
    expect(hasLectaPlus("founder_lifetime")).toBe(true);
    expect(hasLectaPlus("free")).toBe(false);
    expect(hasLectaPlus(null)).toBe(false);
    expect(hasLectaPlus(undefined)).toBe(false);
  });

  it("normalizePlan: valores desconocidos caen a free", () => {
    expect(normalizePlan("lecta_plus")).toBe("lecta_plus");
    expect(normalizePlan("founder_lifetime")).toBe("founder_lifetime");
    expect(normalizePlan("free")).toBe("free");
    expect(normalizePlan("premium")).toBe("free");
    expect(normalizePlan(null)).toBe("free");
    expect(normalizePlan(42)).toBe("free");
  });

  it("isStarterCoat: solo los 5 pelajes", () => {
    for (const coat of ["tuxedo", "latte", "ginger", "mist", "calico"]) {
      expect(isStarterCoat(coat)).toBe(true);
    }
    expect(isStarterCoat("pelaje-calico")).toBe(false);
    expect(isStarterCoat("")).toBe(false);
    expect(isStarterCoat(undefined)).toBe(false);
  });

  it("effectivePlan: lecta_plus vence tras la gracia", () => {
    const now = 1_000_000_000_000;
    expect(effectivePlan("lecta_plus", null, now)).toBe("lecta_plus");
    expect(effectivePlan("lecta_plus", now + 1, now)).toBe("lecta_plus");
    expect(effectivePlan("lecta_plus", now - PLAN_GRACE_MS + 1, now)).toBe("lecta_plus");
    expect(effectivePlan("lecta_plus", now - PLAN_GRACE_MS - 1, now)).toBe("free");
    expect(effectivePlan("founder_lifetime", 0, now)).toBe("founder_lifetime");
    expect(effectivePlan("free", now + 1, now)).toBe("free");
  });
});

describe("prueba inversa", () => {
  it("dura 14 días desde el alta, o desde el lanzamiento si la cuenta es anterior", () => {
    expect(REVERSE_TRIAL_MS).toBe(14 * 86_400_000);
    expect(REVERSE_TRIAL_START).toBe(Date.UTC(2026, 10, 25));
    const late = Date.UTC(2026, 11, 3, 10);
    expect(reverseTrialEndsAt(late)).toBe(late + REVERSE_TRIAL_MS);
    expect(reverseTrialEndsAt(Date.UTC(2026, 10, 20))).toBe(REVERSE_TRIAL_START + REVERSE_TRIAL_MS);
  });

  it("sin fecha de alta válida no hay prueba", () => {
    expect(reverseTrialEndsAt(null)).toBeNull();
    expect(reverseTrialEndsAt(Number.NaN)).toBeNull();
  });
});

describe("cortesía de IA free", () => {
  it("el tope es 3 al día", () => {
    expect(FREE_AI_COURTESY_LIMIT).toBe(3);
  });

  it("courtesyBucketHour es fijo en el día UTC y cambia a las 00:00 UTC", () => {
    const dayStart = Date.UTC(2026, 10, 17);
    const hours = dayStart / 3_600_000;
    expect(courtesyBucketHour(dayStart)).toBe(hours);
    expect(courtesyBucketHour(Date.UTC(2026, 10, 17, 13, 5))).toBe(hours);
    expect(courtesyBucketHour(Date.UTC(2026, 10, 17, 23, 59, 59))).toBe(hours);
    expect(courtesyBucketHour(Date.UTC(2026, 10, 18))).toBe(hours + 24);
    expect(courtesyBucketHour(dayStart - 1)).toBe(hours - 24);
  });

  it("freeAiRemaining nunca es negativo y trata basura como agotada", () => {
    expect(freeAiRemaining(0)).toBe(3);
    expect(freeAiRemaining(2)).toBe(1);
    expect(freeAiRemaining(3)).toBe(0);
    expect(freeAiRemaining(9)).toBe(0);
    expect(freeAiRemaining(-3)).toBe(3);
    expect(freeAiRemaining(Number.NaN)).toBe(0);
  });
});
