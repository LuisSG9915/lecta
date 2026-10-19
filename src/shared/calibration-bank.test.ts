import { describe, expect, it } from "vitest";
import {
  ENGLISH_CALIBRATION_BANK,
  calibrationSampleContext,
  calibrationFallbackDefinition,
  calibrationBankZipf,
  CALIBRATION_BANK_ITEMS_ES,
  CALIBRATION_BANK_ITEMS_EN,
  CALIBRATION_BANK_ITEMS,
  getCalibrationBankByLang,
  itemResponseProbability,
  itemFisherInformation,
  type CalibrationBankItem,
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

describe("Banco Calibrado IRT Multilingüe", () => {
  it("exporta bancos de ítems no vacíos y el conjunto combinado", () => {
    expect(CALIBRATION_BANK_ITEMS_ES.length).toBe(30);
    expect(CALIBRATION_BANK_ITEMS_EN.length).toBe(30);
    expect(CALIBRATION_BANK_ITEMS.length).toBe(60);
  });

  it("normaliza códigos de idioma en getCalibrationBankByLang ('en-US' -> 'en', 'es-MX' -> 'es')", () => {
    const esFromMx = getCalibrationBankByLang("es-MX");
    const esFromEs = getCalibrationBankByLang("es-ES");
    const esDirect = getCalibrationBankByLang("es");
    const enFromUs = getCalibrationBankByLang("en-US");
    const enFromGb = getCalibrationBankByLang("en-GB");
    const enDirect = getCalibrationBankByLang("en");

    expect(esFromMx).toEqual(esDirect);
    expect(esFromEs).toEqual(esDirect);
    expect(enFromUs).toEqual(enDirect);
    expect(enFromGb).toEqual(enDirect);

    expect(esFromMx[0].lang).toBe("es");
    expect(enFromUs[0].lang).toBe("en");
  });

  it("tanto 'es' como 'en' cuentan con entre 24 y 32 palabras bien escalonadas con saltos <= 0.20 logits", () => {
    for (const lang of ["es", "en"] as const) {
      const bank = getCalibrationBankByLang(lang);
      expect(bank.length).toBeGreaterThanOrEqual(24);
      expect(bank.length).toBeLessThanOrEqual(32);

      // Verificamos que cubren el espectro de dificultad entre -2.0 y +2.2
      const minDiff = Math.min(...bank.map((i) => i.difficulty));
      const maxDiff = Math.max(...bank.map((i) => i.difficulty));
      expect(minDiff).toBeLessThanOrEqual(-2.0);
      expect(maxDiff).toBeGreaterThanOrEqual(2.2);

      // Verificamos saltos no mayores a 0.20 logits entre palabras vecinas ordenadas por dificultad
      const sorted = [...bank].sort((a, b) => a.difficulty - b.difficulty);
      for (let i = 0; i < sorted.length - 1; i++) {
        const step = Number((sorted[i + 1].difficulty - sorted[i].difficulty).toFixed(4));
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it("tanto 'es' como 'en' tienen ítems en las 4 bandas cubriendo desde b_i <= -1.2 hasta b_i >= +1.5", () => {
    const expectedBands: CalibrationBankItem["band"][] = [
      "cotidiano",
      "intermedio",
      "avanzado",
      "literario",
    ];

    for (const lang of ["es", "en"] as const) {
      const bank = getCalibrationBankByLang(lang);
      const bandsFound = new Set(bank.map((i) => i.band));

      for (const expectedBand of expectedBands) {
        expect(bandsFound.has(expectedBand)).toBe(true);
      }

      // Cubre dificultades negativas b_i <= -1.2
      const hasLowDiff = bank.some((i) => i.difficulty <= -1.2);
      expect(hasLowDiff).toBe(true);

      // Cubre dificultades altas b_i >= +1.5
      const hasHighDiff = bank.some((i) => i.difficulty >= 1.5);
      expect(hasHighDiff).toBe(true);

      // Cada ítem tiene id, word, lang, difficulty, band y posHint definidos
      for (const item of bank) {
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.word.length).toBeGreaterThan(0);
        expect(item.lang).toBe(lang);
        expect(Number.isFinite(item.difficulty)).toBe(true);
        expect(item.difficulty).toBeGreaterThanOrEqual(-2.5);
        expect(item.difficulty).toBeLessThanOrEqual(2.5);
        expect(expectedBands).toContain(item.band);
        expect(item.posHint).toBeDefined();
        expect(item.posHint!.length).toBeGreaterThan(0);
      }
    }
  });

  it("itemResponseProbability(theta, b) devuelve exactamente 0.5 cuando theta === b", () => {
    const testDifficulties = [-2.1, -1.05, 0.0, 0.75, 1.5, 2.25];
    for (const b of testDifficulties) {
      expect(itemResponseProbability(b, b)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.0)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.35)).toBe(0.5);
      expect(itemResponseProbability(b, b, 1.8)).toBe(0.5);
    }
  });

  it("itemFisherInformation(theta, b) alcanza su máximo cuando theta === b", () => {
    const testPoints = [-1.5, 0.0, 1.5];
    for (const b of testPoints) {
      const alpha = 1.35;
      const maxInfo = itemFisherInformation(b, b, alpha);

      // Verificamos analíticamente: I_max = alpha^2 * 0.25
      expect(maxInfo).toBeCloseTo(alpha * alpha * 0.25, 8);

      // Evaluamos en un entorno alrededor de b: b - 1.5 a b + 1.5
      for (let offset = -1.5; offset <= 1.5; offset += 0.15) {
        if (Math.abs(offset) < 1e-6) continue;
        const theta = b + offset;
        const info = itemFisherInformation(theta, b, alpha);
        expect(info).toBeLessThan(maxInfo);
      }
    }
  });
});

