import { describe, expect, it } from "vitest";
import {
  GAMMA_PASSIVE,
  FAMILIAR_PASSIVE_THRESHOLD,
  updatePassiveExposureState,
  predictSection,
  applyChapterCompletionPassiveLoop,
  type ChapterCandidateFeedbackItem,
  MIN_PAGE_DWELL_MS,
  MIN_MS_PER_WORD,
  MAX_REQUIRED_DWELL_MS,
  computeRequiredDwellMs,
  processPageTurnForPassiveKnowledge,
} from "./knowledge";
import type { LexiconEntry } from "./lexicon";
import type { UserLanguageProfile } from "./profile-models";

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

describe("applyChapterCompletionPassiveLoop (Canal C - Track 6)", () => {
  const baseProfile: UserLanguageProfile = {
    theta: 0.0,
    thetaByLang: { es: 0.0, en: 0.0 },
    uncertaintyByLang: { es: 1.0, en: 1.0 },
    chaptersCompletedByLang: { es: 0, en: 0 },
    preferredPreviewCount: 4,
    consecutivePreviewSkips: 0,
  };

  it("aplica passive_frontier a palabras no consultadas en la frontera de dificultad con lectura fluida", () => {
    const candidates: ChapterCandidateFeedbackItem[] = [
      { lemma: "vislumbrar", beta: 0.5, wasConsultedInWordPanel: false }, // En frontera (|0 - 0.5| = 0.5 <= 1.1)
      { lemma: "inmarcesible", beta: 3.5, wasConsultedInWordPanel: false }, // Lejos de frontera
      { lemma: "efimero", beta: 0.6, wasConsultedInWordPanel: true }, // Consultada en WordPanel (no pasiva)
    ];

    const result = applyChapterCompletionPassiveLoop({
      profile: baseProfile,
      lang: "es",
      candidates,
      isFluidReadingPace: true,
    });

    // vislumbrar debe haber impulsado theta hacia arriba
    expect(result.thetaByLang.es).toBeGreaterThan(baseProfile.thetaByLang.es);
    expect(result.theta).toBe(result.thetaByLang.es);
    expect(result.chaptersCompletedByLang.es).toBe(1);
  });

  it("omite señales pasivas si la velocidad de lectura no fue fluida", () => {
    const candidates: ChapterCandidateFeedbackItem[] = [
      { lemma: "vislumbrar", beta: 0.5, wasConsultedInWordPanel: false },
    ];

    const result = applyChapterCompletionPassiveLoop({
      profile: baseProfile,
      lang: "es",
      candidates,
      isFluidReadingPace: false,
    });

    // Theta no cambia porque el lector no leyó con fluidez normal
    expect(result.thetaByLang.es).toBe(baseProfile.thetaByLang.es);
    // Pero el conteo de capítulos sí se incrementa
    expect(result.chaptersCompletedByLang.es).toBe(1);
  });

  it("actualiza el perfil del idioma del libro de forma independiente (ej. en)", () => {
    const candidates: ChapterCandidateFeedbackItem[] = [
      { lemma: "whisper", beta: 0.2, wasConsultedInWordPanel: false },
    ];

    const result = applyChapterCompletionPassiveLoop({
      profile: baseProfile,
      lang: "en",
      candidates,
      isFluidReadingPace: true,
    });

    expect(result.thetaByLang.en).toBeGreaterThan(baseProfile.thetaByLang.en);
    expect(result.thetaByLang.es).toBe(0.0);
    expect(result.theta).toBe(0.0);
    expect(result.chaptersCompletedByLang.en).toBe(1);
    expect(result.chaptersCompletedByLang.es).toBe(0);
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

  it("processPageTurnForPassiveKnowledge ignora giros rápidos que no cumplen el dwell requerido", async () => {
    const pageWords = ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5", "palabra6", "palabra7", "palabra8", "palabra9", "palabra10", "palabra11", "palabra12", "palabra13", "palabra14", "palabra15", "palabra16", "palabra17", "palabra18", "palabra19", "palabra20", "palabra21", "palabra22", "palabra23", "palabra24", "palabra25"];
    // 25 palabras * 160ms = 4000ms dwell mínimo
    const tapped = new Set<string>();

    // dwell = 2500ms (< 4000ms) -> debe descartar (0 procesadas)
    const processed = await processPageTurnForPassiveKnowledge(pageWords, tapped, 2500);
    expect(processed).toBe(0);
  });
});

