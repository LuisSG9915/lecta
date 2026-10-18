import { describe, expect, it } from "vitest";
import {
  nextChapterUtility,
  buildSuggestionRows,
  selectOptimalChapterPrimingWords,
  computeZpdWeight,
  cleanContextSentence,
  buildChapterPrimingCandidates,
  type ChapterPrimingCandidate,
  computePreChapterWordUtility,
  extractChapterContextSnippet,
  getSemanticPosWeight,
  computeZpdZoneWeight,
  MAX_PREVIEW_WORDS,
  MAX_CONTEXT_SNIPPET_CHARS,
} from "./section-words";
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

describe("Selector Científico de Palabras Pre-Capítulo (ZPD + Cowan) (Track 6)", () => {
  it("cleanContextSentence trunca a 140 caracteres sin cortar palabras a la mitad", () => {
    const shortSentence = "Esta es una oración corta.";
    expect(cleanContextSentence(shortSentence)).toBe(shortSentence);

    const longSentence =
      "El viento soplaba furiosamente a través de las colinas heladas mientras los viajeros buscaban un refugio seguro antes de que la noche cubriera todo el valle de misterio y frío.";
    const cleaned = cleanContextSentence(longSentence, 80);
    expect(cleaned.length).toBeLessThanOrEqual(81);
    expect(cleaned.endsWith("…")).toBe(true);
    // No debe haber espacios antes de los puntos suspensivos
    expect(cleaned.endsWith(" …")).toBe(false);
  });

  it("computeZpdWeight aplica campana gaussiana centrada en el desafío óptimo", () => {
    const theta = 0.0;
    // En L1, desafío óptimo es theta + 0.65
    const optimalL1 = computeZpdWeight(theta, 0.65, false);
    const tooEasy = computeZpdWeight(theta, -1.5, false);
    const tooHard = computeZpdWeight(theta, 3.5, false);

    expect(optimalL1).toBeCloseTo(1.0, 4);
    expect(optimalL1).toBeGreaterThan(tooEasy);
    expect(optimalL1).toBeGreaterThan(tooHard);

    // En L2, desafío óptimo es theta + 0.35
    const optimalL2 = computeZpdWeight(theta, 0.35, true);
    expect(optimalL2).toBeCloseTo(1.0, 4);
  });

  it("selectOptimalChapterPrimingWords selecciona entre 3 y 5 palabras maximizando utilidad", () => {
    const candidates: ChapterPrimingCandidate[] = [
      {
        lemma: "casa",
        surfaceForm: "casa",
        lang: "es",
        beta: -2.0, // Muy fácil (dominada)
        chapterFrequency: 10,
        partOfSpeech: "noun",
        shortGloss: "Edificio para habitar.",
        contextSentence: "La casa era blanca.",
      },
      {
        lemma: "vislumbrar",
        surfaceForm: "vislumbró",
        lang: "es",
        beta: 0.7, // En ZPD óptima para theta = 0.0
        chapterFrequency: 3,
        partOfSpeech: "verb",
        shortGloss: "Ver un objeto tenuemente.",
        contextSentence: "A lo lejos vislumbró una luz.",
      },
      {
        lemma: "efímero",
        surfaceForm: "efímero",
        lang: "es",
        beta: 0.8, // En ZPD óptima
        chapterFrequency: 2,
        partOfSpeech: "adj",
        shortGloss: "Que dura poco tiempo.",
        contextSentence: "Un instante efímero de paz.",
      },
      {
        lemma: "dar en el clavo",
        surfaceForm: "dio en el clavo",
        lang: "es",
        beta: 0.6,
        chapterFrequency: 2,
        partOfSpeech: "phrase",
        shortGloss: "Acertar con exactitud.",
        contextSentence: "Con su respuesta dio en el clavo.",
      },
      {
        lemma: "inmarcesible",
        surfaceForm: "inmarcesible",
        lang: "es",
        beta: 3.5, // Demasiado difícil / fuera de ZPD
        chapterFrequency: 1,
        partOfSpeech: "adj",
        shortGloss: "Que no se puede marchitar.",
        contextSentence: "Una belleza inmarcesible.",
      },
    ];

    const selected = selectOptimalChapterPrimingWords(candidates, 0.0, {
      maxWords: 3,
      isForeignLanguage: false,
    });

    // Debe respetar el límite Cowan (máximo 3)
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.length).toBeGreaterThan(0);

    // "casa" debe ser descartada por ser demasiado fácil (unknownProb < 0.25)
    expect(selected.some((w) => w.lemma === "casa")).toBe(false);

    // Las candidatas en ZPD ("vislumbrar", "efímero", "dar en el clavo") deben ser seleccionadas
    expect(selected.some((w) => w.lemma === "vislumbrar")).toBe(true);
  });

  it("buildChapterPrimingCandidates procesa texto del capítulo y genera candidatas enriquecidas", () => {
    const entries: Record<string, LexiconEntry[]> = {
      deslumbro: [
        {
          entryId: null,
          freqRank: null,
          lemma: "deslumbrar",
          pos: "verbo",
          zipf: 3.2,
          senses: [{ definition: "Ofuscar la vista.", example: null, senseOrder: 1 }],
        },
      ],
      aurora: [
        {
          entryId: null,
          freqRank: null,
          lemma: "aurora",
          pos: "sustantivo",
          zipf: 3.5,
          senses: [{ definition: "Claridad antes del amanecer.", example: null, senseOrder: 1 }],
        },
      ],
    };

    const text =
      "La hermosa aurora comenzó a surgir en el horizonte oriental. Su brillo deslumbro a todos los caminantes que cruzaban el bosque temprano en la mañana.";

    const result = buildChapterPrimingCandidates({
      forms: ["aurora", "aurora", "deslumbro"],
      entries,
      text,
      lang: "es",
      userTheta: 0.0,
      maxWords: 4,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].contextSentence).toBeTruthy();
    expect(result[0].contextSentence.length).toBeLessThanOrEqual(140);
  });
});

describe("computePreChapterWordUtility y extractChapterContextSnippet (Paso 2)", () => {
  it("exporta las constantes de memoria de Cowan y snippet contextual", () => {
    expect(MAX_PREVIEW_WORDS).toBe(5);
    expect(MAX_CONTEXT_SNIPPET_CHARS).toBe(140);
  });

  it("calcula getSemanticPosWeight dando prioridad a frases, verbos, adjetivos y sustantivos", () => {
    expect(getSemanticPosWeight("phrase")).toBe(1.3);
    expect(getSemanticPosWeight("locucion")).toBe(1.3);
    expect(getSemanticPosWeight("verb")).toBe(1.25);
    expect(getSemanticPosWeight("verbo")).toBe(1.25);
    expect(getSemanticPosWeight("adj")).toBe(1.2);
    expect(getSemanticPosWeight("adjetivo")).toBe(1.2);
    expect(getSemanticPosWeight("noun")).toBe(1.15);
    expect(getSemanticPosWeight("sustantivo")).toBe(1.15);
    expect(getSemanticPosWeight("adv")).toBe(0.9);
    expect(getSemanticPosWeight("adverbio")).toBe(0.9);
    expect(getSemanticPosWeight("other")).toBe(1.0);
  });

  it("calcula computeZpdZoneWeight con campana gaussiana centrada en theta + 0.35", () => {
    const theta = 0.5;
    const optimalBeta = theta + 0.35; // 0.85
    const peak = computeZpdZoneWeight(theta, optimalBeta);
    expect(peak).toBeCloseTo(1.0, 5);

    const easy = computeZpdZoneWeight(theta, -1.0);
    const hard = computeZpdZoneWeight(theta, 3.0);
    expect(easy).toBeLessThan(peak);
    expect(hard).toBeLessThan(peak);
  });

  it("computePreChapterWordUtility combina probabilidad desconocida, frecuencia, ZPD y POS", () => {
    const res = computePreChapterWordUtility({
      thetaUL: 0.0,
      betaW: 0.35,
      freqInChapter: 3,
      pos: "verb",
    });

    // theta = 0, beta = 0.35 -> pKnow = 1 / (1 + exp(0.35)) = 0.41338
    // unknownProb = 1 - 0.41338 = 0.5866
    // freqImpact = ln(1 + 3) = 1.38629
    // zoneWeight = 1.0 (en el pico theta + 0.35)
    // posWeight = 1.25 (verbo)
    // utility = 0.5866 * 1.38629 * 1.0 * 1.25 = 1.0166
    expect(res.pKnow).toBeCloseTo(0.413, 2);
    expect(res.unknownProb).toBeCloseTo(0.587, 2);
    expect(res.freqImpact).toBeCloseTo(1.386, 2);
    expect(res.zoneWeight).toBeCloseTo(1.0, 4);
    expect(res.posWeight).toBe(1.25);
    expect(res.utility).toBeCloseTo(1.016, 2);
  });

  it("extractChapterContextSnippet extrae la oración exacta cuando es <= 140 chars", () => {
    const text = "En un lugar de la Mancha, de cuyo nombre no quiero acordarme. Vivía un hidalgo de los de lanza en astillero.";
    const snippet = extractChapterContextSnippet(text, "hidalgo");
    expect(snippet).toBe("Vivía un hidalgo de los de lanza en astillero.");
    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet).toContain("hidalgo");
  });

  it("extractChapterContextSnippet trunca oraciones largas a <= 140 caracteres centrando la palabra sin cortar sílabas", () => {
    const text =
      "El ilustre caballero andante don Quijote de la Mancha cabalgaba bajo el inclemente sol castellano pensando intensamente en su amada Dulcinea del Toboso mientras su fiel escudero Sancho Panza divisaba a lo lejos una misteriosa silueta que parecía un gigante amenazante en el horizonte.";
    const snippet = extractChapterContextSnippet(text, "Dulcinea", 140);
    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet).toContain("Dulcinea");
    expect(snippet.startsWith("…") || !snippet.startsWith(" ")).toBe(true);
    expect(snippet.endsWith("…") || !snippet.endsWith(" ")).toBe(true);
  });

  it("extractChapterContextSnippet maneja entradas vacías o cuando no encuentra la palabra", () => {
    expect(extractChapterContextSnippet("", "test")).toBe("");
    expect(extractChapterContextSnippet("Hola mundo.", "")).toBe("");
    expect(extractChapterContextSnippet("Hola mundo cruel.", "desaparecido")).toBe("Hola mundo cruel.");
  });
});

