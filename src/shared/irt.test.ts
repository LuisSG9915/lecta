import { describe, expect, it } from "vitest";
import { itemFisherInformation, itemResponseProbability } from "./irt";

describe("itemResponseProbability (IRT 2PL)", () => {
  it("devuelve exactamente 0.5 cuando theta === difficulty", () => {
    for (const b of [-3.0, -1.5, 0.0, 1.2, 3.5]) {
      expect(itemResponseProbability(b, b)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.0)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.35)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.8)).toBe(0.5);
    }
  });

  it("es monótona creciente respecto a theta", () => {
    const diff = 0.5;
    const p1 = itemResponseProbability(-1.0, diff);
    const p2 = itemResponseProbability(0.0, diff);
    const p3 = itemResponseProbability(1.0, diff);
    const p4 = itemResponseProbability(2.0, diff);

    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
    expect(p3).toBeLessThan(p4);
  });

  it("acota el rango entre 0 y 1", () => {
    expect(itemResponseProbability(-100, 0)).toBeGreaterThanOrEqual(0);
    expect(itemResponseProbability(-100, 0)).toBeLessThan(0.0001);
    expect(itemResponseProbability(100, 0)).toBeLessThanOrEqual(1);
    expect(itemResponseProbability(100, 0)).toBeGreaterThan(0.9999);
  });
});

describe("itemFisherInformation (IRT 2PL)", () => {
  it("alcanza su máximo cuando theta === difficulty", () => {
    for (const b of [-2.0, 0.0, 1.5]) {
      const alpha = 1.35;
      const maxInfo = itemFisherInformation(b, b, alpha);
      // Con P=0.5: alpha^2 * 0.25
      expect(maxInfo).toBeCloseTo(alpha * alpha * 0.25, 6);

      for (const delta of [-1.5, -0.5, 0.5, 1.5]) {
        const theta = b + delta;
        const info = itemFisherInformation(theta, b, alpha);
        expect(info).toBeLessThan(maxInfo);
      }
    }
  });

  it("es no negativa en cualquier punto", () => {
    expect(itemFisherInformation(-10, 0)).toBeGreaterThanOrEqual(0);
    expect(itemFisherInformation(10, 0)).toBeGreaterThanOrEqual(0);
  });
});
