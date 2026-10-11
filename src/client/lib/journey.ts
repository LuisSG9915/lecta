// Tu recorrido: funciones puras para derivar el progreso global,
// etapas FSRS de vocabulario, récords personales e historial de lectura
// a partir de datos reales del dispositivo (sin tablas nuevas).

import type { SavedReview, SavedWord } from "./idb";
import { markLevel } from "./word-level";
import {
  dayKeyOf,
  mergeIntervals,
  timeByDay,
  totalMs,
  type TimeInterval,
} from "./reading-activity";

export interface WordStages {
  newCount: number;
  learningCount: number;
  settledCount: number;
  masteredCount: number;
  total: number;
}

export function wordStages(words: SavedWord[]): WordStages {
  let newCount = 0;
  let learningCount = 0;
  let settledCount = 0;
  let masteredCount = 0;

  const active = words.filter((w) => !w.deleted);
  for (const w of active) {
    const lvl = markLevel(w.card);
    if (lvl === "new") {
      newCount++;
    } else if (lvl === "learning") {
      learningCount++;
    } else if (lvl === "settled") {
      settledCount++;
    } else {
      // markLevel devuelve null cuando stability >= 90 y reps > 0
      masteredCount++;
    }
  }

  return {
    newCount,
    learningCount,
    settledCount,
    masteredCount,
    total: active.length,
  };
}

export function totalReadingMs(intervals: TimeInterval[]): number {
  return totalMs(intervals);
}

export interface ReadingRecords {
  bestReadingDay: { dayKey: string; minutes: number } | null;
  longestSessionMinutes: number;
  bestWordsDay: { dayKey: string; count: number } | null;
  bestReviewsDay: { dayKey: string; count: number } | null;
}

export function readingRecords(
  intervals: TimeInterval[],
  words: SavedWord[],
  reviews: SavedReview[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReadingRecords {
  // 1. Día más lector (en minutos)
  const days = timeByDay(intervals, timeZone);
  let bestReadingDay: { dayKey: string; minutes: number } | null = null;
  for (const d of days) {
    const minutes = Math.round(d.ms / 60_000);
    if (!bestReadingDay || minutes > bestReadingDay.minutes) {
      bestReadingDay = { dayKey: d.dayKey, minutes };
    }
  }

  // 2. Sesión más larga (en minutos)
  const merged = mergeIntervals(intervals);
  let longestSessionMs = 0;
  for (const item of merged) {
    const dur = item.endedAt - item.startedAt;
    if (dur > longestSessionMs) longestSessionMs = dur;
  }
  const longestSessionMinutes = Math.round(longestSessionMs / 60_000);

  // 3. Día con más palabras guardadas
  const wordsByDay = new Map<string, number>();
  for (const w of words) {
    if (w.deleted || !w.savedAt) continue;
    const key = dayKeyOf(w.savedAt, timeZone);
    wordsByDay.set(key, (wordsByDay.get(key) ?? 0) + 1);
  }
  let bestWordsDay: { dayKey: string; count: number } | null = null;
  for (const [dayKey, count] of wordsByDay) {
    if (!bestWordsDay || count > bestWordsDay.count) {
      bestWordsDay = { dayKey, count };
    }
  }

  // 4. Día con más repasos
  const reviewsByDay = new Map<string, number>();
  for (const r of reviews) {
    if (!r.createdAt) continue;
    const key = dayKeyOf(r.createdAt, timeZone);
    reviewsByDay.set(key, (reviewsByDay.get(key) ?? 0) + 1);
  }
  let bestReviewsDay: { dayKey: string; count: number } | null = null;
  for (const [dayKey, count] of reviewsByDay) {
    if (!bestReviewsDay || count > bestReviewsDay.count) {
      bestReviewsDay = { dayKey, count };
    }
  }

  return {
    bestReadingDay,
    longestSessionMinutes,
    bestWordsDay,
    bestReviewsDay,
  };
}

export function finishedBookHashes(
  positions: { bookHash: string; progress?: number; ratio?: number }[],
  finishedBooks: string[] = [],
): string[] {
  const result = new Set<string>(finishedBooks);
  for (const pos of positions) {
    if ((pos.progress ?? 0) >= 0.99 || (pos.ratio ?? 0) >= 0.99) {
      result.add(pos.bookHash);
    }
  }
  return [...result];
}

export interface WeekHistoryItem {
  weekIndex: number; // 0 = hace 7 semanas, 7 = esta semana
  label: string;
  minutes: number;
}

export function weeksHistory(
  intervals: TimeInterval[],
  weeksCount: number = 8,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  nowMs: number = Date.now(),
): WeekHistoryItem[] {
  const days = timeByDay(intervals, timeZone);
  const msByDay = new Map(days.map((d) => [d.dayKey, d.ms]));

  const ONE_DAY_MS = 86_400_000;
  const result: WeekHistoryItem[] = [];

  // Construimos las últimas `weeksCount` semanas (de la más vieja a la actual)
  for (let w = weeksCount - 1; w >= 0; w--) {
    let weekMs = 0;
    // Cada semana comprende 7 días terminando en `nowMs - w * 7 días`
    const weekEndMs = nowMs - w * 7 * ONE_DAY_MS;
    for (let d = 6; d >= 0; d--) {
      const dayMs = weekEndMs - d * ONE_DAY_MS;
      const key = dayKeyOf(dayMs, timeZone);
      weekMs += msByDay.get(key) ?? 0;
    }
    const weekIndex = weeksCount - 1 - w;
    const label = w === 0 ? "Esta sem." : w === 1 ? "Sem. ant." : `Sem. -${w}`;
    result.push({
      weekIndex,
      label,
      minutes: Math.round(weekMs / 60_000),
    });
  }

  return result;
}

export function bookLabel(book?: {
  title?: string;
  name?: string;
  author?: string;
}): { title: string; author: string } {
  return {
    title: book?.title || book?.name || "Libro terminado",
    author: book?.author || "",
  };
}
