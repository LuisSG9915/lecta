import { describe, expect, it } from "vitest";
import {
  GAMMA_PASSIVE,
  FAMILIAR_PASSIVE_THRESHOLD,
  updatePassiveExposureState,
  predictSection,
} from "./knowledge";
import type { LexiconEntry } from "./lexicon";

describe("Inferencia Implícita por Exposición Pasiva (Fase 4.1)", () => {
  it("constantes matemáticas correctas", () => {
    expect(GAMMA_PASSIVE).toBe(0.82);
    expect(FAMILIAR_PASSIVE_THRESHOLD).toBe(3);
  });

  it("actualiza probabilidad de conocimiento estimada con recurrencia gamma", () => {
    // Primera exposición pasiva: P_0 = 0 -> P_1 = 1 - (1 - 0) * 0.82 = 0.18
    const s1 = updatePassiveExposureState({});
    expect(s1.passiveSeenCount).toBe(1);
    expect(s1.estimatedKnownProb).toBeCloseTo(0.18, 5);
    expect(s1.status).toBe("unknown");

    // Segunda exposición pasiva: P_2 = 1 - (1 - 0.18) * 0.82 = 1 - 0.82^2 = 0.3276
    const s2 = updatePassiveExposureState(s1);
    expect(s2.passiveSeenCount).toBe(2);
    expect(s2.estimatedKnownProb).toBeCloseTo(0.3276, 5);
    expect(s2.status).toBe("unknown");

    // Tercera exposición pasiva: P_3 = 1 - 0.82^3 = 0.448632 -> promocionada a familiar
    const s3 = updatePassiveExposureState(s2);
    expect(s3.passiveSeenCount).toBe(3);
    expect(s3.estimatedKnownProb).toBeCloseTo(0.448632, 5);
    expect(s3.status).toBe("familiar");
  });

  it("preserva estado known si ya estaba marcada como conocida", () => {
    const s = updatePassiveExposureState({ known: true, passiveSeenCount: 1 });
    expect(s.status).toBe("known");
    expect(s.passiveSeenCount).toBe(2);
  });

  it("predictSection omite sugerir palabras promovidas a 'familiar' o con >= 3 exposiciones pasivas", () => {
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

    // Caso 2: Con status familiar por 3 exposiciones pasivas, no se predice
    const familiarKnowledge = new Map([
      ["perenne", { lemma: "perenne", known: false, status: "familiar" as const, passiveSeenCount: 3 }],
    ]);
    const pred2 = predictSection(["perenne"], entriesByForm, new Set(), familiarKnowledge, 3.0);
    expect(pred2.predicted.length).toBe(0);
    expect(pred2.knownCount).toBe(1);

    // Caso 3: Con passiveSeenCount >= 3 sin status explícito
    const countKnowledge = new Map([
      ["perenne", { lemma: "perenne", known: false, passiveSeenCount: 4 }],
    ]);
    const pred3 = predictSection(["perenne"], entriesByForm, new Set(), countKnowledge, 3.0);
    expect(pred3.predicted.length).toBe(0);
    expect(pred3.knownCount).toBe(1);
  });
});
