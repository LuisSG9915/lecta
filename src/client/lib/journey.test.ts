import { describe, expect, it } from "vitest";
import {
  DAY_GOAL_MS,
  MICRO_SESSION_GOALS_MS,
  ALLOWED_DAILY_GOAL_MS,
  getEffectiveDailyGoalMs,
  getWeeklyLearnedWordsCount,
  isLongestSessionThisMonth,
  setJourneySelectorCache,
  clearJourneySelectorCache,
  computeRetentionSummary,
  wordStages,
  totalReadingMs,
  readingRecords,
  finishedBookHashes,
  weeksHistory,
  bookLabel,
  calculateInkPoints,
  literaryRankFor,
  inkPathNodes,
  LITERARY_RANKS,
  computeLanguageLexicalGrowth,
  normalizeThetaScore,
  lexicalGrowthStage,
  type ReadingGoal,
} from "./journey";
import type { Card } from "./fsrs";
import type { KnownWord, SavedReview, SavedWord } from "./idb";
import type { TimeInterval } from "./reading-activity";

const card = (stability: number, reps = 1): Card => ({
  due: new Date(0),
  stability,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 0,
  reps,
  lapses: 0,
  state: 2,
  last_review: new Date(0),
  learning_steps: 0,
});

const word = (
  key: string,
  over: Partial<SavedWord> = {},
): SavedWord => ({
  key,
  form: key,
  language: "es",
  savedAt: 1_000,
  ...over,
});

describe("wordStages", () => {
  it("clasifica las palabras según su estabilidad FSRS", () => {
    const words: SavedWord[] = [
      word("nueva_sin_card"),
      word("nueva_reps_0", { card: card(0, 0) }),
      word("aprendiendo_corta", { card: card(1.5, 1) }),
      word("aprendiendo_media", { card: card(10, 2) }),
      word("asentada", { card: card(30, 3) }),
      word("asentada_alta", { card: card(80, 4) }),
      word("dominada", { card: card(95, 5) }),
      word("dominada_alta", { card: card(200, 6) }),
      word("borrada", { card: card(200, 6), deleted: true }),
    ];

    const stages = wordStages(words);
    expect(stages.total).toBe(8);
    expect(stages.newCount).toBe(2);
    expect(stages.learningCount).toBe(2);
    expect(stages.settledCount).toBe(2);
    expect(stages.masteredCount).toBe(2);
  });
});

describe("computeRetentionSummary", () => {
  it("mide aciertos reales e ignora los autoinformes 'declared'", () => {
    const reviews: SavedReview[] = [
      { id: "1", language: "es", form: "a", kind: "cloze", rating: "good", hints: 0, createdAt: 1 },
      { id: "2", language: "es", form: "b", kind: "word", rating: "easy", hints: 0, createdAt: 2 },
      { id: "3", language: "es", form: "c", kind: "choose", rating: "correct", hints: 0, createdAt: 3 },
      { id: "4", language: "es", form: "d", kind: "word", rating: "again", hints: 0, createdAt: 4 },
      { id: "5", language: "es", form: "e", kind: "declared", rating: "known", hints: 0, createdAt: 5 },
    ];
    const summary = computeRetentionSummary([], reviews);
    expect(summary.verifiedReviewsCount).toBe(4);
    expect(summary.recallRatePct).toBe(75);
  });

  it("cuenta palabras con memoria estimada de 7 y 30 días solo si hay repasos", () => {
    const words: SavedWord[] = [
      word("nueva", { card: card(0, 0) }),
      word("semana", { card: card(8, 2) }),
      word("mes", { card: card(30, 3) }),
      word("mes_alto", { card: card(120, 5) }),
      word("borrada", { card: card(120, 5), deleted: true }),
    ];
    const summary = computeRetentionSummary(words, []);
    expect(summary.recallRatePct).toBeNull();
    expect(summary.retained7dCount).toBe(3);
    expect(summary.retained30dCount).toBe(2);
  });
});

describe("totalReadingMs", () => {
  it("suma los intervalos de lectura fusionando solapes", () => {
    const intervals: TimeInterval[] = [
      { startedAt: 1_000, endedAt: 61_000 }, // 60s
      { startedAt: 30_000, endedAt: 90_000 }, // solapa, hasta 90s (89s total)
    ];
    expect(totalReadingMs(intervals)).toBe(89_000);
  });
});

describe("readingRecords", () => {
  it("calcula los récords personales a partir de intervalos, palabras y repasos reales", () => {
    const timeZone = "UTC";
    // 2025-06-10: 2 sesiones (30m y 40m = 70m)
    // 2025-06-11: 1 sesión (120m) -> sesión más larga y mejor día de lectura
    const t1 = Date.UTC(2025, 5, 10, 10, 0, 0);
    const t2 = Date.UTC(2025, 5, 10, 15, 0, 0);
    const t3 = Date.UTC(2025, 5, 11, 8, 0, 0);

    const intervals: TimeInterval[] = [
      { startedAt: t1, endedAt: t1 + 30 * 60_000 },
      { startedAt: t2, endedAt: t2 + 40 * 60_000 },
      { startedAt: t3, endedAt: t3 + 120 * 60_000 },
    ];

    const words: SavedWord[] = [
      word("w1", { savedAt: t1 }),
      word("w2", { savedAt: t1 + 100 }),
      word("w3", { savedAt: t1 + 200 }),
      word("w4", { savedAt: t3 }),
      word("w5", { savedAt: t1, deleted: true }), // borrada no cuenta
    ];

    const reviews: SavedReview[] = [
      { id: "r1", language: "es", form: "a", kind: "word", rating: "good", hints: 0, createdAt: t1 },
      { id: "r2", language: "es", form: "b", kind: "word", rating: "good", hints: 0, createdAt: t3 },
      { id: "r3", language: "es", form: "c", kind: "word", rating: "good", hints: 0, createdAt: t3 + 100 },
    ];

    const records = readingRecords(intervals, words, reviews, timeZone);

    expect(records.bestReadingDay).toEqual({
      dayKey: "2025-06-11",
      minutes: 120,
    });
    expect(records.longestSessionMinutes).toBe(120);
    expect(records.bestWordsDay).toEqual({
      dayKey: "2025-06-10",
      count: 3,
    });
    expect(records.bestReviewsDay).toEqual({
      dayKey: "2025-06-11",
      count: 2,
    });
  });

  it("devuelve valores por defecto cuando no hay datos", () => {
    const records = readingRecords([], [], []);
    expect(records.bestReadingDay).toBeNull();
    expect(records.longestSessionMinutes).toBe(0);
    expect(records.bestWordsDay).toBeNull();
    expect(records.bestReviewsDay).toBeNull();
  });
});

describe("finishedBookHashes", () => {
  it("incluye libros con progreso >= 0.99 o en la lista de terminados", () => {
    const positions = [
      { bookHash: "h1", progress: 0.995 },
      { bookHash: "h2", progress: 0.45 },
      { bookHash: "h3", ratio: 0.999 },
    ];
    const finished = ["h4", "h1"];

    const result = finishedBookHashes(positions, finished);
    expect(result).toContain("h1");
    expect(result).toContain("h3");
    expect(result).toContain("h4");
    expect(result).not.toContain("h2");
  });
});

describe("weeksHistory", () => {
  it("devuelve las 8 semanas históricas ordenadas cronológicamente", () => {
    const now = Date.UTC(2025, 5, 20, 12, 0, 0);
    const intervals: TimeInterval[] = [
      { startedAt: now - 60_000, endedAt: now }, // 1 min en la última semana
    ];

    const weeks = weeksHistory(intervals, 8, "UTC", now);
    expect(weeks).toHaveLength(8);
    expect(weeks[7].label).toBe("Esta sem.");
    expect(weeks[7].minutes).toBe(1);
    expect(weeks[6].label).toBe("Sem. ant.");
  });
});

describe("bookLabel", () => {
  it("devuelve el título y autor legibles con fallback", () => {
    expect(bookLabel({ title: "Don Quijote", author: "Cervantes" })).toEqual({
      title: "Don Quijote",
      author: "Cervantes",
    });
    expect(bookLabel({ name: "quijote.epub" })).toEqual({
      title: "quijote.epub",
      author: "",
    });
    expect(bookLabel()).toEqual({
      title: "Libro terminado",
      author: "",
    });
  });
});

describe("Rangos Literarios (Lecta v2.0)", () => {
  it("contiene los 6 rangos literarios progresivos definidos en la especificación", () => {
    expect(LITERARY_RANKS).toHaveLength(6);
    expect(LITERARY_RANKS[0].name).toBe("Caminante de Papel");
    expect(LITERARY_RANKS[1].name).toBe("Aprendiz de Tinta");
    expect(LITERARY_RANKS[2].name).toBe("Tejedor de Frases");
    expect(LITERARY_RANKS[3].name).toBe("Explorador de Sintaxis");
    expect(LITERARY_RANKS[4].name).toBe("Alquimista Léxico");
    expect(LITERARY_RANKS[5].name).toBe("Maestro de la Biblioteca");
  });

  it("calculateInkPoints combina minutos, palabras dominadas y estrategias", () => {
    // 30 min (60 pts) + 5 palabras (50 pts) + 1 estrategia (25 pts) = 135 pts
    const points = calculateInkPoints(30, 5, 1);
    expect(points).toBe(135);
  });

  it("literaryRankFor calcula el rango actual y el progreso hacia el siguiente", () => {
    // 0 puntos -> Caminante de Papel
    const r0 = literaryRankFor(0);
    expect(r0.currentRank.name).toBe("Caminante de Papel");
    expect(r0.nextRank?.name).toBe("Aprendiz de Tinta");
    expect(r0.progressPct).toBe(0);
    expect(r0.pointsToNext).toBe(100);

    // 50 puntos -> Caminante de Papel al 50%
    const r50 = literaryRankFor(50);
    expect(r50.currentRank.name).toBe("Caminante de Papel");
    expect(r50.progressPct).toBe(50);
    expect(r50.pointsToNext).toBe(50);

    // 1500 puntos -> Maestro de la Biblioteca (rango máximo)
    const rMax = literaryRankFor(1600);
    expect(rMax.currentRank.name).toBe("Maestro de la Biblioteca");
    expect(rMax.nextRank).toBeNull();
    expect(rMax.progressPct).toBe(100);
    expect(rMax.pointsToNext).toBe(0);
  });
});

describe("Sendero de Tinta (Ink Path Milestones)", () => {
  it("inkPathNodes clasifica los nodos en completados, actual y próximos", () => {
    const { nodes, currentNode, nextNode, remainingText } = inkPathNodes(75);
    expect(nodes.length).toBeGreaterThanOrEqual(7);

    // 75 pts: m1 (50) completado, m2 (100) es el siguiente objetivo
    expect(nodes[0].status).toBe("completed");
    expect(nodes[1].status).toBe("current");
    expect(currentNode.id).toBe("m1");
    expect(nextNode?.id).toBe("m2");

    // Texto con estimación de lectura o palabras faltantes
    expect(remainingText).toContain("Gafas de Lectura");
    expect(remainingText).toContain("min de lectura");
  });
});

describe("Evolución Léxica por Idioma (θ_{u,L}) - Espejo de Progreso Cognitivo (Fase 1)", () => {
  it("normaliza θ_{u,L} a escala 0..100 y asigna etiquetas editoriales sin jerga matemática", () => {
    // Normalización: ((theta + 2.5) / 5) * 100 con clamp [5, 100]
    expect(normalizeThetaScore(-3.0)).toBe(5);
    expect(normalizeThetaScore(-2.5)).toBe(5);
    expect(normalizeThetaScore(-0.6)).toBe(38);
    expect(normalizeThetaScore(0.0)).toBe(50);
    expect(normalizeThetaScore(1.5)).toBe(80);
    expect(normalizeThetaScore(2.5)).toBe(100);
    expect(normalizeThetaScore(3.5)).toBe(100);

    // Títulos y subtítulos cálidos
    const stageLow = lexicalGrowthStage(30);
    expect(stageLow.stageTitle).toBe("Base en construcción");
    expect(stageLow.stageSubtitle).toBeTruthy();

    const stageMid = lexicalGrowthStage(50);
    expect(stageMid.stageTitle).toBe("Lectura fluida");
    expect(stageMid.stageSubtitle).toBeTruthy();

    const stageHigh = lexicalGrowthStage(75);
    expect(stageHigh.stageTitle).toBe("Horizonte literario");
    expect(stageHigh.stageSubtitle).toBeTruthy();

    const stageMaster = lexicalGrowthStage(95);
    expect(stageMaster.stageTitle).toBe("Maestría léxica");
    expect(stageMaster.stageSubtitle).toBeTruthy();
  });

  it("mantiene la separación correcta entre español e inglés", () => {
    // Caso 1: Usuario solo con actividad en español (el inglés no se muestra si no tiene actividad)
    const growthSoloEs = computeLanguageLexicalGrowth({
      profile: {
        thetaByLang: { es: 1.2, en: -0.6 },
        chaptersCompletedByLang: { es: 2, en: 0 },
      },
      knownWords: [
        { language: "es", lemma: "vislumbrar", known: true, source: "passive_frontier" },
      ],
      books: [{ language: "es" }],
    });

    expect(growthSoloEs).toHaveLength(1);
    expect(growthSoloEs[0].lang).toBe("es");
    expect(growthSoloEs[0].langLabel).toBe("Español");
    expect(growthSoloEs[0].currentTheta).toBe(1.2);
    expect(growthSoloEs[0].normalizedLevel).toBe(normalizeThetaScore(1.2));
    expect(growthSoloEs[0].stageTitle).toBe("Horizonte literario");

    // Caso 2: Usuario con actividad en ambos idiomas
    const growthAmbos = computeLanguageLexicalGrowth({
      profile: {
        thetaByLang: { es: 1.5, en: -0.4 },
        chaptersCompletedByLang: { es: 3, en: 1 },
      },
      knownWords: [
        { language: "es", lemma: "vislumbrar", known: true, source: "passive_frontier" },
        { language: "en", lemma: "whisper", known: true, source: "passive" },
      ],
      books: [{ language: "es" }, { language: "en" }],
    });

    expect(growthAmbos).toHaveLength(2);
    expect(growthAmbos[0].lang).toBe("es");
    expect(growthAmbos[0].langLabel).toBe("Español");
    expect(growthAmbos[0].currentTheta).toBe(1.5);

    expect(growthAmbos[1].lang).toBe("en");
    expect(growthAmbos[1].langLabel).toBe("Inglés");
    expect(growthAmbos[1].currentTheta).toBe(-0.4);
    expect(growthAmbos[1].normalizedLevel).toBe(normalizeThetaScore(-0.4));
  });

  it("realiza un conteo preciso de palabras por dominio pasivo vs. consulta activa", () => {
    const knownWords: KnownWord[] = [
      // 1. Pasiva: consolidada por exposición sin consulta (passive_frontier)
      {
        key: "es:vislumbrar",
        language: "es",
        lemma: "vislumbrar",
        known: true,
        source: "passive_frontier",
        updatedAt: 1,
      },
      // 2. Pasiva: familiaridad por 3+ exposiciones pasivas sin consulta
      {
        key: "es:perenne",
        language: "es",
        lemma: "perenne",
        known: false,
        status: "familiar",
        passiveSeenCount: 3,
        source: "inferred",
        updatedAt: 1,
      },
      // 3. Pasiva: pre-lectura ("✓ Ya la sé" / preparation)
      {
        key: "es:alborada",
        language: "es",
        lemma: "alborada",
        known: true,
        source: "preparation",
        updatedAt: 1,
      },
      // 4. Activa: consulta explícita en el lector (toque / word_consulted)
      {
        key: "es:inmarcesible",
        language: "es",
        lemma: "inmarcesible",
        known: true,
        source: "in-chapter-lookup",
        updatedAt: 1,
      },
    ];

    // Palabra 5 (activa): guardada en el Cuaderno
    const savedWords: SavedWord[] = [
      word("uberrimo", { language: "es", lemma: "uberrimo" }),
    ];

    const [growth] = computeLanguageLexicalGrowth({
      profile: { thetaByLang: { es: 1.0 } },
      knownWords,
      savedWords,
    });

    // 3 pasivas (vislumbrar, perenne, alborada) y 2 activas (inmarcesible, uberrimo)
    expect(growth.passiveMasteredCount).toBe(3);
    expect(growth.activeQueriedCount).toBe(2);
    expect(growth.totalMasteredCount).toBe(5);
    // Ratio pasivo: 3 / 5 = 60%
    expect(growth.passiveRatioPercent).toBe(60);

    // Curva sparkline: mínimo 2 puntos válidos y normalizados
    expect(growth.curvePoints.length).toBeGreaterThanOrEqual(2);
    for (const pt of growth.curvePoints) {
      expect(pt.normalizedScore).toBeGreaterThanOrEqual(5);
      expect(pt.normalizedScore).toBeLessThanOrEqual(100);
      expect(typeof pt.index).toBe("number");
      expect(typeof pt.theta).toBe("number");
    }
  });

  it("ofrece un estado inicial seguro y tolerante ante datos vacíos", () => {
    const growth = computeLanguageLexicalGrowth({});
    expect(growth).toHaveLength(1);
    expect(growth[0].lang).toBe("es");
    expect(growth[0].langLabel).toBe("Español");
    expect(growth[0].passiveMasteredCount).toBe(0);
    expect(growth[0].activeQueriedCount).toBe(0);
    expect(growth[0].totalMasteredCount).toBe(0);
    expect(growth[0].passiveRatioPercent).toBe(0);
    expect(Number.isNaN(growth[0].passiveRatioPercent)).toBe(false);
    expect(Number.isFinite(growth[0].passiveRatioPercent)).toBe(true);
    expect(growth[0].normalizedLevel).toBeGreaterThanOrEqual(5);
    expect(Number.isNaN(growth[0].normalizedLevel)).toBe(false);
    expect(Number.isFinite(growth[0].normalizedLevel)).toBe(true);
    expect(growth[0].curvePoints.length).toBeGreaterThanOrEqual(2);
    expect(growth[0].stageTitle).toBe("Lectura fluida"); // default theta 0.0 -> score 50
  });

  it("normaliza theta de forma segura ante valores extremos o inválidos (NaN/Infinity)", () => {
    expect(normalizeThetaScore(0)).toBe(50);
    expect(normalizeThetaScore(-2.5)).toBe(5);
    expect(normalizeThetaScore(-10)).toBe(5); // clamped a 5 mínimo
    expect(normalizeThetaScore(2.5)).toBe(100);
    expect(normalizeThetaScore(10)).toBe(100); // clamped a 100 máximo
    expect(normalizeThetaScore(NaN)).toBe(50);
    // @ts-expect-error probando entrada no numérica
    expect(normalizeThetaScore(undefined)).toBe(50);
    // @ts-expect-error probando entrada no numérica
    expect(normalizeThetaScore(null)).toBe(50);
  });
});


describe("Anti-Abandono: Micro-Metas Diarias Configurables (Fase 1)", () => {
  it("expande DAY_GOAL_MS permitiendo micro-sesiones de 3 min, 5 min y 10 min", () => {
    expect(DAY_GOAL_MS).toBe(60_000);
    expect(MICRO_SESSION_GOALS_MS.MICRO_3_MIN).toBe(180_000);
    expect(MICRO_SESSION_GOALS_MS.MICRO_5_MIN).toBe(300_000);
    expect(MICRO_SESSION_GOALS_MS.MICRO_10_MIN).toBe(600_000);
    expect(ALLOWED_DAILY_GOAL_MS).toEqual([60_000, 180_000, 300_000, 600_000]);
  });

  it("resuelve la meta diaria efectiva con getEffectiveDailyGoalMs", () => {
    expect(getEffectiveDailyGoalMs(null)).toBe(60_000);
    expect(getEffectiveDailyGoalMs(undefined)).toBe(60_000);
    expect(getEffectiveDailyGoalMs(180_000)).toBe(180_000);
    expect(getEffectiveDailyGoalMs({ dailyGoalMs: 300_000 } as unknown as ReadingGoal)).toBe(300_000);
    expect(getEffectiveDailyGoalMs({ dailyGoalMs: 0 } as unknown as ReadingGoal)).toBe(60_000);
  });
});

describe("Anti-Abandono: getWeeklyLearnedWordsCount", () => {
  const now = 1_000_000_000;
  const ONE_DAY = 86_400_000;

  it("cuenta palabras aprendidas/dominadas en los últimos 7 días", () => {
    clearJourneySelectorCache();
    const words: SavedWord[] = [
      // Aprendida hace 2 días (dentro de los 7 días)
      word("es:reciente", {
        lemma: "reciente",
        updatedAt: now - 2 * ONE_DAY,
        card: card(5, 2),
      }),
      // Aprendida hace 10 días (fuera de los 7 días)
      word("es:antigua", {
        lemma: "antigua",
        updatedAt: now - 10 * ONE_DAY,
        card: card(10, 3),
      }),
      // Palabra sin repeticiones / nueva
      word("es:nueva", {
        lemma: "nueva",
        updatedAt: now - 1 * ONE_DAY,
        card: card(0, 0),
      }),
      // Borrada (debe ignorarse)
      word("es:borrada", {
        lemma: "borrada",
        deleted: true,
        updatedAt: now - 1 * ONE_DAY,
        card: card(5, 2),
      }),
    ];

    const count = getWeeklyLearnedWordsCount(words, [], [], now);
    expect(count).toBe(1);
  });

  it("incorpora KnownWords y reviews exitosos recientes evitando duplicados", () => {
    clearJourneySelectorCache();
    const words: SavedWord[] = [
      word("es:libro", {
        lemma: "libro",
        updatedAt: now - 1 * ONE_DAY,
        card: card(3, 1),
      }),
    ];

    const knownWords: KnownWord[] = [
      {
        key: "es:libro",
        language: "es",
        lemma: "libro",
        known: true,
        source: "lookup",
        updatedAt: now - 1 * ONE_DAY,
      },
      {
        key: "es:gato",
        language: "es",
        lemma: "gato",
        known: true,
        source: "passive",
        updatedAt: now - 3 * ONE_DAY,
      },
    ];

    const reviews: SavedReview[] = [
      {
        id: "r1",
        language: "es",
        form: "gato",
        kind: "word",
        rating: "good",
        hints: 0,
        createdAt: now - 2 * ONE_DAY,
      },
    ];

    // libro y gato son 2 palabras únicas
    const count = getWeeklyLearnedWordsCount(words, reviews, knownWords, now);
    expect(count).toBe(2);
  });

  it("utiliza el cache memorizado de selectores si no se pasan argumentos", () => {
    clearJourneySelectorCache();
    expect(getWeeklyLearnedWordsCount()).toBe(0);

    setJourneySelectorCache({
      words: [
        word("es:sol", {
          lemma: "sol",
          updatedAt: now - 1 * ONE_DAY,
          card: card(5, 2),
        }),
      ],
    });

    expect(getWeeklyLearnedWordsCount(undefined, undefined, undefined, now)).toBe(1);
    clearJourneySelectorCache();
  });
});

describe("Anti-Abandono: isLongestSessionThisMonth", () => {
  const now = 10_000_000;
  const ONE_DAY = 86_400_000;

  it("detecta si la sesión actual supera el récord de los últimos 30 días", () => {
    clearJourneySelectorCache();
    const intervals: TimeInterval[] = [
      // Sesión de 15 min hace 3 días
      {
        startedAt: now - 3 * ONE_DAY,
        endedAt: now - 3 * ONE_DAY + 15 * 60_000,
      },
      // Sesión de 25 min hace 10 días (el récord de este mes)
      {
        startedAt: now - 10 * ONE_DAY,
        endedAt: now - 10 * ONE_DAY + 25 * 60_000,
      },
      // Sesión de 60 min hace 45 días (fuera del mes)
      {
        startedAt: now - 45 * ONE_DAY,
        endedAt: now - 45 * ONE_DAY + 60 * 60_000,
      },
    ];

    // 20 min no supera los 25 min del mes
    expect(isLongestSessionThisMonth(20 * 60_000, intervals, now)).toBe(false);
    // 25 min exactos no lo supera
    expect(isLongestSessionThisMonth(25 * 60_000, intervals, now)).toBe(false);
    // 26 min sí supera el récord del mes
    expect(isLongestSessionThisMonth(26 * 60_000, intervals, now)).toBe(true);
  });

  it("devuelve true si no hay sesiones previas registradas", () => {
    clearJourneySelectorCache();
    expect(isLongestSessionThisMonth(10 * 60_000, [], now)).toBe(true);
    expect(isLongestSessionThisMonth(0, [], now)).toBe(false);
  });
});
