import { describe, expect, it } from "vitest";
import {
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
} from "./journey";
import type { Card } from "./fsrs";
import type { SavedReview, SavedWord } from "./idb";
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
