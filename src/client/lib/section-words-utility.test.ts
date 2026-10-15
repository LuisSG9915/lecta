import { describe, expect, it } from "vitest";
import { nextChapterUtility, buildSuggestionRows } from "./section-words";
import type { LexiconEntry } from "./lexicon";

describe("Algoritmo Next-Chapter Utility (Fase 4.2)", () => {
  it("calcula probabilidad logística y utilidad básica", () => {
    // Para zipf = 2.0 -> bw = 5.0. Con userTheta = 4.0:
    // bw - theta = 1.0 (en ZDP [0, 1.2] -> W_zona = 1.25)
    // theta - bw = -1.0 -> pUnknown = 1 / (1 + exp(-1)) = 0.731058
    // fCap = 1, fBook = 1 -> freqReward = 1 + 2.0 * ln(2) = 2.386294
    // bLocucion = 1.0
    // U = 0.731058 * 2.386294 * 1.25 * 1.0 = 2.18066
    const u = nextChapterUtility({
      zipf: 2.0,
      userTheta: 4.0,
      chapterFreq: 1,
      bookFreq: 1,
    });
    expect(u).toBeCloseTo(2.18, 1);
  });

  it("aplica multiplicador 1.25x en Zona de Desarrollo Próximo (i+1)", () => {
    // Delta = bw - theta = 0.8 (entre 0 y 1.2)
    const inZone = nextChapterUtility({
      zipf: 2.2, // bw = 4.8
      userTheta: 4.0,
      chapterFreq: 1,
      bookFreq: 1,
    });
    // Delta = bw - theta = 1.8 (fuera de zona, pero <= 2.5 -> W_zona = 1.0)
    const outZone = nextChapterUtility({
      zipf: 1.2, // bw = 5.8
      userTheta: 4.0,
      chapterFreq: 1,
      bookFreq: 1,
    });
    // La palabra en zona tiene boost de 1.25 relativo a su base
    expect(inZone).toBeGreaterThan(0);
    expect(outZone).toBeGreaterThan(0);
  });

  it("penaliza con 0.6x palabras excesivamente avanzadas (bw - theta > 2.5)", () => {
    // zipf = 0.4 -> bw = 6.6. theta = 3.5 -> delta = 3.1 > 2.5
    const tooHard = nextChapterUtility({
      zipf: 0.4,
      userTheta: 3.5,
      chapterFreq: 1,
      bookFreq: 1,
    });
    // zipf = 2.5 -> bw = 4.5. theta = 3.5 -> delta = 1.0 (en ZDP)
    const inZdp = nextChapterUtility({
      zipf: 2.5,
      userTheta: 3.5,
      chapterFreq: 1,
      bookFreq: 1,
    });
    // La palabra en ZDP tiene mayor utilidad que el término hiper-raro que frustra al lector
    expect(inZdp).toBeGreaterThan(tooHard);
  });

  it("aplica bonificación de 1.3x a locuciones o modismos", () => {
    const singleWordU = nextChapterUtility({
      zipf: 3.0,
      userTheta: 4.0,
      isPhrase: false,
    });
    const phraseU = nextChapterUtility({
      zipf: 3.0,
      userTheta: 4.0,
      isPhrase: true,
    });
    expect(phraseU / singleWordU).toBeCloseTo(1.3, 5);
  });

  it("recompensa frecuencia dentro del capítulo y la obra", () => {
    const onceU = nextChapterUtility({
      zipf: 2.5,
      userTheta: 4.0,
      chapterFreq: 1,
      bookFreq: 1,
    });
    const repeatedU = nextChapterUtility({
      zipf: 2.5,
      userTheta: 4.0,
      chapterFreq: 5,
      bookFreq: 12,
    });
    // Una palabra que se repite varias veces en el capítulo tiene mayor ROI
    expect(repeatedU).toBeGreaterThan(onceU);
  });

  it("buildSuggestionRows ordena las palabras por utilidad Next-Chapter", () => {
    const entries: Record<string, LexiconEntry[]> = {
      efimero: [
        {
          entryId: null,
          freqRank: null,
          lemma: "efimero",
          pos: "adjetivo",
          zipf: 2.5,
          senses: [{ definition: "Pasajero, de corta duración.", example: null, senseOrder: null }],
        },
      ],
      obsolescente: [
        {
          entryId: null,
          freqRank: null,
          lemma: "obsolescente",
          pos: "adjetivo",
          zipf: 0.5, // hiper-raro, castigado por delta > 2.5
          senses: [{ definition: "Que está cayendo en desuso.", example: null, senseOrder: null }],
        },
      ],
    };

    // 'efimero' aparece 4 veces en el capítulo (frecuencia alta + en ZDP)
    // 'obsolescente' aparece 1 vez y es hiper-rara
    const rows = buildSuggestionRows({
      language: "es",
      forms: ["efimero", "efimero", "efimero", "efimero", "obsolescente"],
      entries,
      capitalOnly: new Set(),
      text: "El tiempo efimero fue un destello. Otro momento efimero. Todo es efimero. Este amor efimero. Era un objeto obsolescente.",
      saved: new Map(),
      knowledge: new Map(),
      threshold: 3.0,
      userTheta: 4.0,
    });

    expect(rows.rows.length).toBe(2);
    // 'efimero' debe preceder a 'obsolescente' por mayor retorno de inversión de lectura
    expect(rows.rows[0].form).toBe("efimero");
    expect(rows.rows[1].form).toBe("obsolescente");
  });

  it("en modo L2 prioriza palabras narrativas de alta utilidad (repeticiones >= 2, B1-C1) sobre hapax legomena oscuras", () => {
    // Palabra útil recurrente en la narración (ej. 'whisper', B1-C1, repite 3 veces)
    const repeatedB1 = nextChapterUtility({
      zipf: 3.5, // bw = 3.5 (sweet spot B1-C1)
      userTheta: 3.4,
      chapterFreq: 3,
      bookFreq: 8,
      isSecondLanguage: true,
    });

    // Palabra hapax legomena oscura que solo sale 1 vez (bw = 4.8 / zipf = 2.2)
    const obscureHapax = nextChapterUtility({
      zipf: 2.2,
      userTheta: 3.4,
      chapterFreq: 1,
      bookFreq: 1,
      isSecondLanguage: true,
    });

    expect(repeatedB1).toBeGreaterThan(obscureHapax);
  });

  it("buildSuggestionRows en modo L2 ordena palabras en inglés considerando utilidad L2 y filtrando stopwords en inglés", () => {
    const entries: Record<string, LexiconEntry[]> = {
      whisper: [
        {
          entryId: null,
          freqRank: null,
          lemma: "whisper",
          pos: "verb",
          zipf: 3.5,
          senses: [{ definition: "To speak very softly.", example: null, senseOrder: null }],
        },
      ],
      surreptitious: [
        {
          entryId: null,
          freqRank: null,
          lemma: "surreptitious",
          pos: "adjective",
          zipf: 2.0,
          senses: [{ definition: "Kept secret.", example: null, senseOrder: null }],
        },
      ],
    };

    const rows = buildSuggestionRows({
      language: "en",
      // Incluye stopwords de inglés como 'the', 'and' que deben ser filtradas
      forms: ["the", "whisper", "whisper", "and", "surreptitious"],
      entries,
      capitalOnly: new Set(),
      text: "The whisper was heard in the dark. Another whisper followed. A surreptitious glance.",
      saved: new Map(),
      knowledge: new Map(),
      threshold: 4.0,
      userTheta: 3.4,
      isSecondLanguage: true,
    });

    // 'the' y 'and' deben haber sido filtradas
    expect(rows.rows.some((r) => r.form === "the" || r.form === "and")).toBe(false);
    expect(rows.rows.length).toBe(2);
    // 'whisper' (repetida + sweet spot) precede a 'surreptitious' (hapax C2)
    expect(rows.rows[0].form).toBe("whisper");
    expect(rows.rows[1].form).toBe("surreptitious");
  });
});
