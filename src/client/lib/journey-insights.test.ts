// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  booksInProgress,
  localHourOf,
  readingHabits,
  recallByWeek,
  upcomingReviews,
  yearSummary,
} from "./journey-insights";
import type {
  SavedBookPosition,
  SavedInterval,
  SavedReview,
  SavedWord,
} from "./idb";

const H = 3_600_000;
const MIN = 60_000;

const interval = (
  startMs: number,
  endMs: number,
  bookHash = "b1",
): SavedInterval => ({
  id: `i-${startMs}-${bookHash}`,
  bookHash,
  startedAt: startMs,
  endedAt: endMs,
});

const review = (
  createdAt: number,
  kind: SavedReview["kind"],
  rating: SavedReview["rating"],
): SavedReview => ({
  id: `r-${createdAt}-${kind}-${rating}`,
  language: "en",
  form: "word",
  kind,
  rating,
  hints: 0,
  createdAt,
});

const word = (dueMs: number, deleted = false): SavedWord => ({
  key: `w-${dueMs}`,
  form: "word",
  language: "en",
  savedAt: dueMs - 1000,
  deleted: deleted || undefined,
  card: { due: new Date(dueMs) } as SavedWord["card"],
});

describe("localHourOf", () => {
  it("devuelve la hora local en la zona indicada", () => {
    const noon = Date.UTC(2026, 9, 20, 12, 0);
    expect(localHourOf(noon, "UTC")).toBe(12);
    // Katmandú UTC+5:45 → 17:45 local.
    expect(localHourOf(noon, "Asia/Kathmandu")).toBe(17);
    // Ciudad de México UTC-6 → 6:00 local.
    expect(localHourOf(noon, "America/Mexico_City")).toBe(6);
  });
});

describe("readingHabits", () => {
  it("reparte los minutos por hora local", () => {
    const start = Date.UTC(2026, 9, 20, 9, 0);
    const intervals = [interval(start, start + 90 * MIN)];
    const habits = readingHabits(intervals, "UTC");
    expect(habits.byHour[9]).toBe(60);
    expect(habits.byHour[10]).toBe(30);
    expect(habits.totalMin).toBe(90);
    expect(habits.topHours[0]).toBe(9);
  });

  it("respeta zonas de 45 minutos (cada trozo cae en su hora local)", () => {
    // 12:00–12:30 UTC = 17:45–18:15 en Katmandú: 15 min a las 17 y 15 a las 18.
    const start = Date.UTC(2026, 9, 20, 12, 0);
    const habits = readingHabits(
      [interval(start, start + 30 * MIN)],
      "Asia/Kathmandu",
    );
    expect(habits.byHour[17]).toBe(15);
    expect(habits.byHour[18]).toBe(15);
  });

  it("une intervalos empalados en vez de contarlos dos veces", () => {
    const start = Date.UTC(2026, 9, 20, 9, 0);
    const intervals = [
      interval(start, start + 60 * MIN),
      interval(start + 30 * MIN, start + 90 * MIN),
    ];
    const habits = readingHabits(intervals, "UTC");
    expect(habits.totalMin).toBe(90);
  });
});

describe("booksInProgress", () => {
  const positions: SavedBookPosition[] = [
    {
      bookHash: "b1",
      sectionIndex: 0,
      scrollTop: 0,
      progress: 0.5,
      updatedAt: 1000,
    },
    { bookHash: "b2", sectionIndex: 0, scrollTop: 0, progress: 0.995, updatedAt: 900 },
    { bookHash: "b3", sectionIndex: 0, scrollTop: 0, progress: 0.005, updatedAt: 800 },
  ];
  const books = [
    { hash: "b1", name: "", title: "El libro", author: "Autora" },
    { hash: "b2", name: "", title: "Terminado", author: undefined },
  ];

  it("lista solo libros a medio leer, con minutos y restante estimado", () => {
    const intervals = [
      interval(0, 30 * MIN, "b1"),
      interval(10 * H, 10 * H + 30 * MIN, "b1"),
      interval(0, 60 * MIN, "b2"),
    ];
    const result = booksInProgress(intervals, positions, books);
    expect(result).toHaveLength(1);
    const b = result[0]!;
    expect(b.title).toBe("El libro");
    expect(b.minutes).toBe(60);
    // 60 min al 50% → ~60 min restantes (estimado al ritmo propio).
    expect(b.remainingMin).toBe(60);
    expect(b.lastReadAt).toBe(10 * H + 30 * MIN);
  });

  it("no estima restante sin minutos medidos", () => {
    const result = booksInProgress([], positions, books);
    expect(result[0]?.remainingMin).toBeNull();
  });
});

describe("recallByWeek", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0);

  it("agrupa por semana móvil y aplica la misma regla de aciertos", () => {
    const reviews = [
      review(now - 1 * H, "meaning", "good"),
      review(now - 2 * H, "meaning", "again"),
      review(now - 8 * 24 * H, "write", "easy"),
      // 'declared' es autoinforme: no cuenta como repaso verificado.
      review(now - 3 * H, "declared", "correct"),
    ];
    const weeks = recallByWeek(reviews, 8, now);
    const thisWeek = weeks[7]!;
    const lastWeek = weeks[6]!;
    expect(thisWeek.verified).toBe(2);
    expect(thisWeek.hits).toBe(1);
    expect(thisWeek.pct).toBe(50);
    expect(lastWeek.verified).toBe(1);
    expect(lastWeek.pct).toBe(100);
    expect(weeks[0]?.pct).toBeNull();
  });
});

describe("upcomingReviews", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0);

  it("junta vencidas y de hoy en la columna de hoy", () => {
    const words = [
      word(now - 2 * H), // vencida
      word(now + 2 * H), // hoy
      word(now + 3 * 24 * H), // en 3 días
      word(now + 30 * 24 * H), // fuera del horizonte
      word(now + 1 * H, true), // borrada
    ];
    const up = upcomingReviews(words, 14, "UTC", now);
    expect(up.dueNow).toBe(2);
    expect(up.byDay).toHaveLength(14);
    expect(up.byDay[0]?.count).toBe(2);
    expect(up.byDay[3]?.count).toBe(1);
    expect(up.totalAhead).toBe(2);
  });

  it("sin tarjetas devuelve ceros", () => {
    const up = upcomingReviews([{ key: "w", form: "x", language: "en", savedAt: 0 }], 14, "UTC", now);
    expect(up.dueNow).toBe(0);
    expect(up.byDay.every((d) => d.count === 0)).toBe(true);
  });
});

describe("yearSummary", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0);

  it("agrupa minutos y días por mes natural", () => {
    const intervals = [
      // Este mes: 60 min en un día.
      interval(Date.UTC(2026, 9, 5, 9), Date.UTC(2026, 9, 5, 10)),
      // Agosto: dos días de 30 min.
      interval(Date.UTC(2026, 7, 3, 9), Date.UTC(2026, 7, 3, 9, 30)),
      interval(Date.UTC(2026, 7, 4, 9), Date.UTC(2026, 7, 4, 9, 30)),
    ];
    const year = yearSummary(intervals, "UTC", now);
    expect(year.months).toHaveLength(12);
    const oct = year.months.find((m) => m.monthKey === "2026-10")!;
    const aug = year.months.find((m) => m.monthKey === "2026-08")!;
    expect(oct.minutes).toBe(60);
    expect(oct.daysActive).toBe(1);
    expect(aug.minutes).toBe(60);
    expect(aug.daysActive).toBe(2);
    expect(year.totalMinutes).toBe(120);
    expect(year.daysActive).toBe(3);
    // Cruza el cambio de año sin romper la llave.
    expect(year.months[0]?.monthKey).toBe("2025-11");
  });
});
