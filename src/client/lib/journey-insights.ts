// Análisis personal de «Tu recorrido» (sección «Tu análisis»).
//
// Reglas puras: el componente JourneyInsights solo las pinta. Los
// minutos se cuentan como en el resto de la app (intervalos unidos) y
// la regla de aciertos es la misma que usa el panel del dueño
// (shared/admin-insights) y el resumen del recorrido, para que las
// tres vistas digan el mismo número.
//
// Las estimaciones (tiempo restante por libro) se calculan con el
// ritmo propio de lectura de cada libro y siempre salen etiquetadas
// como estimadas en la interfaz.

import {
  dayKeyOf,
  mergeIntervals,
  msByBook,
  timeByDay,
  type TimeInterval,
} from "./reading-activity";
import {
  isRecallHit,
  isVerifiedReview,
  recallPct,
} from "../../shared/admin-insights";
import type {
  SavedBookPosition,
  SavedInterval,
  SavedReview,
  SavedWord,
} from "./idb";
import type { StoredBook } from "./idb";

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

// ---------- Horarios habituales ----------

// Se corta cada intervalo en los límites de cuarto de hora UTC: todas
// las zonas horarias actuales caen en múltiplos de 15 minutos (incluido
// Nepal +5:45 o Chatham +12:45), así que cada trozo pertenece por
// completo a una sola hora local y se puede acumular sin aproximar.
const QUARTER_MS = 15 * MIN_MS;

function* hourSlices(
  interval: TimeInterval,
): Generator<{ start: number; ms: number }> {
  let cursor = interval.startedAt;
  while (cursor < interval.endedAt) {
    const boundary =
      Math.floor(cursor / QUARTER_MS) * QUARTER_MS + QUARTER_MS;
    const next = Math.min(interval.endedAt, boundary);
    yield { start: cursor, ms: next - cursor };
    cursor = next;
  }
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** Hora del día local (0–23) de un sello en la zona indicada. */
export function localHourOf(ts: number, timeZone: string): number {
  let fmt = hourFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    });
    hourFormatters.set(timeZone, fmt);
  }
  const h = Number(fmt.format(new Date(ts)));
  if (Number.isFinite(h)) return ((h % 24) + 24) % 24;
  return new Date(ts).getUTCHours();
}

export interface ReadingHabits {
  /** Minutos leídos por hora del día (índice = hora local). */
  byHour: number[];
  /** Las 1–3 horas con más lectura, de mayor a menor. */
  topHours: number[];
  totalMin: number;
}

export function readingHabits(
  intervals: TimeInterval[],
  timeZone: string,
): ReadingHabits {
  const msByHour = new Array<number>(24).fill(0);
  for (const interval of mergeIntervals(intervals)) {
    for (const slice of hourSlices(interval)) {
      msByHour[localHourOf(slice.start, timeZone)]! += slice.ms;
    }
  }
  const byHour = msByHour.map((ms) => Math.round(ms / MIN_MS));
  const topHours = byHour
    .map((min, hour) => ({ hour, min }))
    .filter((h) => h.min > 0)
    .sort((a, b) => b.min - a.min)
    .slice(0, 3)
    .map((h) => h.hour);
  return {
    byHour,
    topHours,
    totalMin: byHour.reduce((a, b) => a + b, 0),
  };
}

// ---------- Libros en curso ----------

export interface BookInProgress {
  bookHash: string;
  title: string;
  author: string | null;
  /** Fracción leída del libro (0–1), la misma que muestra la hebra. */
  progress: number;
  minutes: number;
  lastReadAt: number;
  /**
   * Minutos estimados que faltan al ritmo propio de este libro
   * (minutos leídos ÷ progreso × restante). null sin base suficiente.
   */
  remainingMin: number | null;
}

export function booksInProgress(
  intervals: SavedInterval[],
  positions: SavedBookPosition[],
  books: Pick<StoredBook, "hash" | "name" | "title" | "author">[],
  limit = 6,
): BookInProgress[] {
  const ms = msByBook(intervals);
  const meta = new Map(books.map((b) => [b.hash, b]));
  const lastIntervalEnd = new Map<string, number>();
  for (const i of intervals) {
    const prev = lastIntervalEnd.get(i.bookHash) ?? 0;
    if (i.endedAt > prev) lastIntervalEnd.set(i.bookHash, i.endedAt);
  }

  const result: BookInProgress[] = [];
  for (const pos of positions) {
    const progress = pos.progress ?? pos.ratio ?? 0;
    // Fuera del rango está el libro sin empezar o ya concluido.
    if (progress < 0.02 || progress >= 0.99) continue;
    const book = meta.get(pos.bookHash);
    const minutes = Math.round((ms.get(pos.bookHash) ?? 0) / MIN_MS);
    const lastReadAt = Math.max(
      pos.updatedAt ?? 0,
      lastIntervalEnd.get(pos.bookHash) ?? 0,
    );
    const remainingMin =
      minutes > 0 && progress >= 0.05
        ? Math.max(1, Math.round((minutes * (1 - progress)) / progress))
        : null;
    result.push({
      bookHash: pos.bookHash,
      title: book?.title?.trim() || book?.name?.trim() || "Sin título",
      author: book?.author ?? null,
      progress,
      minutes,
      lastReadAt,
      remainingMin,
    });
  }
  result.sort((a, b) => b.lastReadAt - a.lastReadAt);
  return result.slice(0, limit);
}

// ---------- Aciertos por semana ----------

export interface RecallWeek {
  /** Índice 0 = la semana más vieja mostrada. */
  weekIndex: number;
  label: string;
  verified: number;
  hits: number;
  pct: number | null;
}

// Mismas ventanas móviles de 7 días que `weeksHistory` («Sem. ant.»…):
// la persona ve la semana como "los últimos 7 días", no como lunes–domingo.
export function recallByWeek(
  reviews: SavedReview[],
  weeksCount = 8,
  nowMs = Date.now(),
): RecallWeek[] {
  const result: RecallWeek[] = [];
  for (let w = weeksCount - 1; w >= 0; w--) {
    const weekEnd = nowMs - w * 7 * DAY_MS;
    const weekStart = weekEnd - 7 * DAY_MS;
    let verified = 0;
    let hits = 0;
    for (const r of reviews) {
      if (r.createdAt <= weekStart || r.createdAt > weekEnd) continue;
      if (!isVerifiedReview(r.kind)) continue;
      verified += 1;
      if (isRecallHit(r.rating)) hits += 1;
    }
    const label =
      w === 0 ? "Esta sem." : w === 1 ? "Sem. ant." : `Sem. -${w}`;
    result.push({
      weekIndex: weeksCount - 1 - w,
      label,
      verified,
      hits,
      pct: recallPct(verified, hits),
    });
  }
  return result;
}

// ---------- Próximos repasos ----------

export interface ReviewDueDay {
  dayKey: string;
  label: string;
  count: number;
}

export interface UpcomingReviews {
  /** Repasos vencidos o que vencen hoy (los que ya tocan). */
  dueNow: number;
  /** Los próximos `days` días, incluido hoy. */
  byDay: ReviewDueDay[];
  /** Repasos que caen dentro del horizonte (sin contar las de hoy). */
  totalAhead: number;
}

const dueDayLabel = (offset: number, dayKey: string) => {
  if (offset === 0) return "Hoy";
  if (offset === 1) return "Mañana";
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

export function upcomingReviews(
  words: SavedWord[],
  days = 14,
  timeZone: string,
  nowMs = Date.now(),
): UpcomingReviews {
  // Hoy (hora local) cierra el horizonte que «ya toca».
  const todayKey = dayKeyOf(nowMs, timeZone);
  const byDayCount = new Map<string, number>();
  let dueNow = 0;
  let totalAhead = 0;

  for (const w of words) {
    if (w.deleted || !w.card?.due) continue;
    const dueMs = new Date(w.card.due).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const dueDay = dayKeyOf(dueMs, timeZone);
    if (dueDay <= todayKey) {
      dueNow += 1;
      continue;
    }
    byDayCount.set(dueDay, (byDayCount.get(dueDay) ?? 0) + 1);
    totalAhead += 1;
  }

  const byDay: ReviewDueDay[] = [];
  for (let d = 0; d < days; d++) {
    const key = dayKeyOf(nowMs + d * DAY_MS, timeZone);
    byDay.push({
      dayKey: key,
      label: dueDayLabel(d, key),
      // Las vencidas y las de hoy «ya tocan»: todas caen en la
      // columna de hoy para que la gráfica cuadre con dueNow.
      count: d === 0 ? dueNow : (byDayCount.get(key) ?? 0),
    });
  }
  return { dueNow, byDay, totalAhead };
}

// ---------- Resumen anual ----------

export interface MonthReading {
  /** "YYYY-MM" en la zona elegida. */
  monthKey: string;
  label: string;
  minutes: number;
  daysActive: number;
}

export interface YearSummary {
  /** Los últimos 12 meses naturales, del más viejo al actual. */
  months: MonthReading[];
  totalMinutes: number;
  daysActive: number;
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

function monthKeyOf(ts: number, timeZone: string): string {
  let fmt = monthFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    });
    monthFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ts));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, 15));
  return date.toLocaleDateString("es-MX", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/** Mes natural anterior a `YYYY-MM`. */
function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const year = y ?? 1970;
  const month = m ?? 1;
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function yearSummary(
  intervals: TimeInterval[],
  timeZone: string,
  nowMs = Date.now(),
): YearSummary {
  const days = timeByDay(mergeIntervals(intervals), timeZone);
  const msByMonth = new Map<string, number>();
  const daysByMonth = new Map<string, number>();
  for (const d of days) {
    const monthKey = d.dayKey.slice(0, 7);
    msByMonth.set(monthKey, (msByMonth.get(monthKey) ?? 0) + d.ms);
    daysByMonth.set(monthKey, (daysByMonth.get(monthKey) ?? 0) + 1);
  }

  const months: MonthReading[] = [];
  let cursor = monthKeyOf(nowMs, timeZone);
  for (let i = 0; i < 12; i++) {
    months.unshift({
      monthKey: cursor,
      label: monthLabel(cursor),
      minutes: Math.round((msByMonth.get(cursor) ?? 0) / MIN_MS),
      daysActive: daysByMonth.get(cursor) ?? 0,
    });
    cursor = prevMonthKey(cursor);
  }
  return {
    months,
    totalMinutes: months.reduce((a, m) => a + m.minutes, 0),
    daysActive: months.reduce((a, m) => a + m.daysActive, 0),
  };
}
