// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  adjustThetaOnKnown,
  adjustThetaOnEasyPin,
  defaultTheta,
  probUnknown,
  sigmoid,
  thetaFromThreshold,
  wordDifficulty,
  loadUserTheta,
  saveUserTheta,
  loadThetaByLang,
  saveThetaForLang,
} from "./profile-models";

describe("Recalibración en Vivo y Modelo de Nivel de Usuario Theta (Fase 4.3)", () => {
  it("función sigmoide", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(2)).toBeGreaterThan(0.8);
    expect(sigmoid(-2)).toBeLessThan(0.2);
  });

  it("calcula dificultad bw y conversión de umbral a theta", () => {
    // zipf 2.0 (rara) -> bw = 5.0 (difícil)
    expect(wordDifficulty(2.0)).toBe(5.0);
    // zipf 5.0 (común) -> bw = 2.0 (fácil)
    expect(wordDifficulty(5.0)).toBe(2.0);
    // threshold base 3.0 -> theta = 4.0
    expect(thetaFromThreshold(3.0)).toBe(4.0);
    expect(defaultTheta()).toBe(4.0);
  });

  it("probabilidad logística de desconocimiento", () => {
    // Si usuario tiene nivel mayor que la dificultad (theta > bw), pUnknown < 0.5
    expect(probUnknown(5.0, 4.0)).toBeLessThan(0.5);
    // Si la palabra es más difícil que el nivel del usuario (bw > theta), pUnknown > 0.5
    expect(probUnknown(3.0, 5.0)).toBeGreaterThan(0.5);
  });

  it("adjustThetaOnKnown incrementa theta con micro-ajuste cuando bw > theta", () => {
    const theta = 4.0;
    const bw = 5.0; // Palabra más difícil que el nivel del usuario
    const res = adjustThetaOnKnown(theta, bw, 0.04);
    expect(res.adjusted).toBe(true);
    expect(res.newTheta).toBeGreaterThan(theta);
    // delta = 0.04 * sigma(1.0) = 0.04 * 0.731058 = ~0.02924
    expect(res.delta).toBeCloseTo(0.02924, 4);
    expect(res.newTheta).toBeCloseTo(4.02924, 4);
  });

  it("adjustThetaOnKnown no altera theta cuando la palabra es más fácil que el nivel del usuario (bw <= theta)", () => {
    const theta = 4.0;
    const bw = 3.0; // Palabra más fácil
    const res = adjustThetaOnKnown(theta, bw, 0.04);
    expect(res.adjusted).toBe(false);
    expect(res.newTheta).toBe(theta);
    expect(res.delta).toBe(0);
  });

  it("adjustThetaOnEasyPin decrementa theta cuando se fija una palabra fácil (bw < theta - 0.5)", () => {
    const theta = 4.0;
    const bw = 2.5; // Fácil: bw < 3.5
    const res = adjustThetaOnEasyPin(theta, bw, 0.04);
    expect(res.adjusted).toBe(true);
    expect(res.newTheta).toBeLessThan(theta);
    // delta = 0.04 * sigma(3.5 - 2.5) = 0.04 * sigma(1.0) = ~0.02924
    expect(res.delta).toBeCloseTo(0.02924, 4);
    expect(res.newTheta).toBeCloseTo(4.0 - 0.02924, 4);
  });

  it("adjustThetaOnEasyPin no altera theta si la palabra no es fácil (bw >= theta - 0.5)", () => {
    const theta = 4.0;
    const bw = 3.8; // bw >= 3.5
    const res = adjustThetaOnEasyPin(theta, bw, 0.04);
    expect(res.adjusted).toBe(false);
    expect(res.newTheta).toBe(theta);
  });

  it("persiste y recupera theta por idioma de forma independiente", () => {
    saveUserTheta(4.15, "es");
    saveUserTheta(3.40, "en");

    expect(loadUserTheta(3.0, "es")).toBeCloseTo(4.15, 2);
    expect(loadUserTheta(3.0, "en")).toBeCloseTo(3.40, 2);

    const thetaByLang = loadThetaByLang(3.0);
    expect(thetaByLang.es).toBeCloseTo(4.15, 2);
    expect(thetaByLang.en).toBeCloseTo(3.40, 2);

    saveThetaForLang("en", 4.25);
    expect(loadUserTheta(3.0, "en")).toBeCloseTo(4.25, 2);
    // Español no debe verse afectado por el cambio en inglés
    expect(loadUserTheta(3.0, "es")).toBeCloseTo(4.15, 2);
  });
});
