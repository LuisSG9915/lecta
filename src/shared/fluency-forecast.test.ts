import { describe, expect, it } from "vitest";
import {
  buildFluencyForecast,
  coverageForVocab,
  FLUENCY_MAX_WEEKS,
  vocabForCoverage,
} from "./fluency-forecast";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 25);

/** `perWeek[i]` palabras consolidadas hace i semanas (i = 0 la más reciente), más `old` antiguas. */
function stamps(perWeek: number[], old = 0): number[] {
  const out: number[] = [];
  perWeek.forEach((n, i) => {
    for (let k = 0; k < n; k++) out.push(NOW - i * WEEK - 1000 - k);
  });
  for (let k = 0; k < old; k++) out.push(NOW - 40 * WEEK - k);
  return out;
}

describe("curva de cobertura", () => {
  it("es monótona e invertible", () => {
    expect(coverageForVocab(1000)).toBeLessThan(coverageForVocab(3000));
    expect(coverageForVocab(vocabForCoverage(0.95))).toBeCloseTo(0.95, 2);
  });
});

describe("buildFluencyForecast", () => {
  it("sin progreso: no-data, nunca una fecha", () => {
    const f = buildFluencyForecast({ now: NOW, consolidatedAt: [] });
    expect(f.status).toBe("no-data");
    expect(f).not.toHaveProperty("at");
  });

  it("pocas palabras o sin actividad reciente: no-data", () => {
    expect(buildFluencyForecast({ now: NOW, consolidatedAt: stamps([5, 5]) }).status).toBe("no-data");
    expect(buildFluencyForecast({ now: NOW, consolidatedAt: stamps([0, 0, 0, 0, 0, 0, 40, 40]) }).status).toBe("no-data");
  });

  it("ritmo estable: fecha con intervalo ordenado", () => {
    const f = buildFluencyForecast({ now: NOW, consolidatedAt: stamps([60, 60, 60, 60], 2000) });
    if (f.status !== "projection") throw new Error(f.status);
    expect(f.weeklyRate).toBeCloseTo(60, 5);
    expect(f.at).toBeGreaterThan(NOW);
    // quedan 4500 - 2240 = 2260 palabras a 60/semana ≈ 38 semanas
    expect(Math.round((f.at! - NOW) / WEEK)).toBe(38);
    expect(f.earliestAt).toBe(f.at);
    expect(f.latestAt).toBe(f.at);
    expect(f.note).toBe("Con tu ritmo actual");
  });

  it("ritmo irregular: intervalo optimista < central < pesimista", () => {
    const f = buildFluencyForecast({ now: NOW, consolidatedAt: stamps([100, 10, 90, 20, 80, 30], 500) });
    if (f.status !== "projection") throw new Error(f.status);
    expect(f.earliestAt!).toBeLessThan(f.at!);
    expect(f.latestAt === null || f.latestAt > f.at!).toBe(true);
  });

  it("tope: más de 5 años = far, sin fecha", () => {
    const f = buildFluencyForecast({ now: NOW, consolidatedAt: stamps([3, 3, 3, 3, 3, 3], 40) });
    expect(f.status).toBe("far");
    if (f.status === "far") expect(f.at).toBeNull();
    expect((4500 - 58) / 3).toBeGreaterThan(FLUENCY_MAX_WEEKS);
  });

  it("meta ya alcanzada", () => {
    const f = buildFluencyForecast({ now: NOW, consolidatedAt: stamps([50, 50, 50, 50], 5000) });
    expect(f.status).toBe("reached");
  });
});
