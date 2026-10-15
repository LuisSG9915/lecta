import { describe, expect, it } from "vitest";
import {
  ENGLISH_CALIBRATION_BANK,
  calibrationSampleContext,
  calibrationFallbackDefinition,
  calibrationBankZipf,
} from "./calibration-bank";

describe("ENGLISH_CALIBRATION_BANK", () => {
  it("contiene 24 palabras graduadas de B1 a C2", () => {
    expect(ENGLISH_CALIBRATION_BANK.length).toBe(24);
  });

  it("cubre equitativamente los niveles B1, B2, C1 y C2 con 6 palabras cada uno", () => {
    const levels = ENGLISH_CALIBRATION_BANK.map((item) => item.level);
    const b1 = levels.filter((l) => l === "B1");
    const b2 = levels.filter((l) => l === "B2");
    const c1 = levels.filter((l) => l === "C1");
    const c2 = levels.filter((l) => l === "C2");

    expect(b1.length).toBe(6);
    expect(b2.length).toBe(6);
    expect(c1.length).toBe(6);
    expect(c2.length).toBe(6);
  });

  it("cada palabra tiene contexto en inglés y definición clara de apoyo", () => {
    for (const item of ENGLISH_CALIBRATION_BANK) {
      expect(item.lemma.length).toBeGreaterThan(0);
      expect(item.word.length).toBeGreaterThan(0);
      expect(item.meaning.length).toBeGreaterThan(5);
      expect(item.context.length).toBeGreaterThan(10);
      // El contexto incluye la palabra o lema
      expect(item.context.toLowerCase()).toContain(item.lemma.toLowerCase());

      // calibrationSampleContext y calibrationFallbackDefinition devuelven datos válidos
      expect(calibrationSampleContext(item.lemma, "en")).toBe(item.context);
      expect(calibrationFallbackDefinition(item.lemma, "en")).toBe(item.meaning);
    }
  });

  it("la dificultad crece progresivamente desde B1 hacia C2", () => {
    const b1Diff = ENGLISH_CALIBRATION_BANK.filter((i) => i.level === "B1").map((i) => i.difficulty);
    const c2Diff = ENGLISH_CALIBRATION_BANK.filter((i) => i.level === "C2").map((i) => i.difficulty);

    const avgB1 = b1Diff.reduce((a, b) => a + b, 0) / b1Diff.length;
    const avgC2 = c2Diff.reduce((a, b) => a + b, 0) / c2Diff.length;

    expect(avgC2).toBeGreaterThan(avgB1);
  });

  it("resuelve estimación zipf para palabras en inglés", () => {
    const zipf = calibrationBankZipf("whisper", "en");
    expect(zipf).not.toBeNull();
    expect(zipf).toBeGreaterThan(2.0);
  });
});
