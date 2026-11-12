import { describe, expect, it } from "vitest";
import {
  PLAN_GRACE_MS,
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
