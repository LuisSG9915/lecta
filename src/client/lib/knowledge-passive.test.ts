import { describe, expect, it } from "vitest";
import {
  predictSection,
  MIN_PAGE_DWELL_MS,
  MIN_MS_PER_WORD,
  MAX_REQUIRED_DWELL_MS,
  computeRequiredDwellMs,
} from "./knowledge";
import type { LexiconEntry } from "./lexicon";

describe("Inferencia Implícita por Exposición Pasiva (Fase 4.1)", () => {
  it("predictSection no trata la exposición pasiva ('familiar', >= 3 pasadas) como conocimiento", () => {
    const entry: LexiconEntry = {
      entryId: null,
      freqRank: null,
      lemma: "perenne",
      pos: "adjetivo",
      zipf: 2.1,
      senses: [{ definition: "Que dura siempre o mucho tiempo.", example: null, senseOrder: null }],
    };
    const entriesByForm: Record<string, LexiconEntry[]> = {
      perenne: [entry],
    };

    // Caso 1: Sin familiaridad, con zipf bajo (2.1 < 3.0), se predice
    const emptyKnowledge = new Map();
    const pred1 = predictSection(["perenne"], entriesByForm, new Set(), emptyKnowledge, 3.0);
    expect(pred1.predicted.length).toBe(1);
    expect(pred1.predicted[0].form).toBe("perenne");

    // Caso 2: «familiar» por exposición no es evidencia: se sigue prediciendo
    const familiarKnowledge = new Map([
      ["perenne", { lemma: "perenne", known: false, status: "familiar" as const, passiveSeenCount: 3 }],
    ]);
    const pred2 = predictSection(["perenne"], entriesByForm, new Set(), familiarKnowledge, 3.0);
    expect(pred2.predicted.map((p) => p.form)).toEqual(["perenne"]);
    expect(pred2.knownCount).toBe(0);

    // Caso 3: passiveSeenCount >= 3 tampoco
    const countKnowledge = new Map([
      ["perenne", { lemma: "perenne", known: false, passiveSeenCount: 4 }],
    ]);
    const pred3 = predictSection(["perenne"], entriesByForm, new Set(), countKnowledge, 3.0);
    expect(pred3.predicted.map((p) => p.form)).toEqual(["perenne"]);

    // Caso 4: lo declarado sí manda
    const declared = new Map([["perenne", { lemma: "perenne", known: true }]]);
    const pred4 = predictSection(["perenne"], entriesByForm, new Set(), declared, 3.0);
    expect(pred4.predicted.length).toBe(0);
    expect(pred4.knownCount).toBe(1);
  });
});

describe("Umbral de Lectura Pasiva Proporcional (Track 1 Zero-Friction)", () => {
  it("constantes de umbral proporcionales correctas", () => {
    expect(MIN_PAGE_DWELL_MS).toBe(3000);
    expect(MIN_MS_PER_WORD).toBe(160);
    expect(MAX_REQUIRED_DWELL_MS).toBe(12000);
  });

  it("calcula dwell requerido proporcionalmente con clamp mínimo y máximo", () => {
    // 0 palabras o negativo -> MIN_PAGE_DWELL_MS (3000)
    expect(computeRequiredDwellMs(0)).toBe(3000);
    expect(computeRequiredDwellMs(-5)).toBe(3000);

    // 10 palabras: 10 * 160 = 1600 < 3000 -> 3000
    expect(computeRequiredDwellMs(10)).toBe(3000);

    // 50 palabras: 50 * 160 = 8000
    expect(computeRequiredDwellMs(50)).toBe(8000);

    // 100 palabras: 100 * 160 = 16000 > 12000 -> 12000
    expect(computeRequiredDwellMs(100)).toBe(12000);
  });


});
