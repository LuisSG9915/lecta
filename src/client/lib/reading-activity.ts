import type { ReadingEvent, SavedInterval } from "./idb";
import {
  loadBaselineWpm,
  loadFocusTelemetryProfile,
  type UserFocusTelemetryProfile,
} from "./focus-telemetry";

export type TimeInterval = { startedAt: number; endedAt: number };

// Actividad menor a esto no cuenta como lectura (un toque accidental
// o abrir-cerrar no son «tiempo de lectura»).
export const MIN_INTERVAL_MS = 5_000;
// Sin señales por este rato el segmento se cierra donde quedó la
// última señal: la inactividad nunca suma.
export const IDLE_MS = 90_000;
// El segmento abierto se «rueda» cada tanto para que una caída de la
// pestaña pierda pocos minutos y no toda la sesión.
export const ROLL_MS = 5 * 60_000;

// Une intervalos que se tocan o se solapan: el mismo rato contado en
// dos dispositivos (o duplicado al sincronizar) suma una sola vez.
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = [...intervals]
    .filter((item) => item.endedAt > item.startedAt)
    .sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt);
  const merged: TimeInterval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.startedAt <= last.endedAt) {
      last.endedAt = Math.max(last.endedAt, item.endedAt);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

export function totalMs(intervals: TimeInterval[]): number {
  return mergeIntervals(intervals).reduce(
    (sum, item) => sum + (item.endedAt - item.startedAt),
    0,
  );
}

// ---------- Cortes a medianoche en la zona horaria del usuario ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

type LocalParts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function partsOf(ts: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(ts)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    y: parts.year,
    m: parts.month,
    d: parts.day,
    h: parts.hour % 24,
    mi: parts.minute,
    s: parts.second,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// «2025-03-09» según el reloj del usuario, no UTC.
export function dayKeyOf(ts: number, timeZone: string): string {
  const p = partsOf(ts, timeZone);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

// Cuánto se adelanta la hora local respecto a UTC en este instante.
function tzOffsetMs(ts: number, timeZone: string): number {
  const p = partsOf(ts, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ts;
}

// El instante UTC en que empieza el día local y/m/d en la zona. Dos
// iteraciones bastan incluso en la frontera de un cambio de horario.
function localMidnight(y: number, m: number, d: number, timeZone: string): number {
  const utcGuess = Date.UTC(y, m - 1, d);
  let guess = utcGuess - tzOffsetMs(utcGuess, timeZone);
  const refined = utcGuess - tzOffsetMs(guess, timeZone);
  if (refined !== guess) guess = utcGuess - tzOffsetMs(refined, timeZone);
  return guess;
}

function nextCalendarDay(y: number, m: number, d: number) {
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    y: next.getUTCFullYear(),
    m: next.getUTCMonth() + 1,
    d: next.getUTCDate(),
  };
}

export type DayTime = { dayKey: string; ms: number };

// Reparte cada intervalo por día local, recortando a medianoche.
// Devuelve los días con lectura, ordenados, en milisegundos.
export function timeByDay(intervals: TimeInterval[], timeZone: string): DayTime[] {
  const byDay = new Map<string, number>();
  for (const { startedAt, endedAt } of mergeIntervals(intervals)) {
    let cursor = startedAt;
    let guard = 0;
    while (cursor < endedAt && guard < 400) {
      guard += 1;
      const p = partsOf(cursor, timeZone);
      const next = nextCalendarDay(p.y, p.m, p.d);
      const boundary = localMidnight(next.y, next.m, next.d, timeZone);
      const clip = Math.min(endedAt, boundary);
      const key = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      byDay.set(key, (byDay.get(key) ?? 0) + Math.max(0, clip - cursor));
      if (clip <= cursor) break;
      cursor = clip;
    }
  }
  return [...byDay.entries()]
    .map(([dayKey, ms]) => ({ dayKey, ms }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

// Minutos por libro: los intervalos se unen por libro antes de sumar,
// así dos pestañas abiertas en el mismo rato no cuentan doble.
export function msByBook(intervals: SavedInterval[]): Map<string, number> {
  const byBook = new Map<string, TimeInterval[]>();
  for (const item of intervals) {
    const list = byBook.get(item.bookHash);
    if (list) list.push(item);
    else byBook.set(item.bookHash, [item]);
  }
  const totals = new Map<string, number>();
  for (const [bookHash, list] of byBook) totals.set(bookHash, totalMs(list));
  return totals;
}

// «2 h 15 min», «40 min», «1 h». Se redondea hacia abajo: un toque
// de 30 s es «menos de 1 min», no un minuto inflado.
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Fecha corta para encabezados de día: «vie 21» (es-MX).
export function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// Inactividad mayor a 6 horas activa el resumen de bienvenida del gato
export const INACTIVITY_RECAP_THRESHOLD_MS = 6 * 60 * 60_000;

export function checkHasInactivityGap(
  intervals: SavedInterval[],
  bookHash: string,
  now = Date.now(),
  thresholdMs = INACTIVITY_RECAP_THRESHOLD_MS,
): boolean {
  const bookIntervals = intervals.filter((i) => i.bookHash === bookHash);
  if (bookIntervals.length === 0) return false;
  const lastEndedAt = Math.max(...bookIntervals.map((i) => i.endedAt));
  return now - lastEndedAt >= thresholdMs;
}

// ---------- Capítulos y Páginas en Estado de Flujo ----------

export interface FlowStateSummary {
  flowChaptersCount: number;       // Capítulos o sesiones completadas en estado de flujo
  uninterruptedPagesStreak: number; // Mayor racha (o total reciente) de páginas leídas de corrido sin tropiezos
  totalFlowPages: number;          // Total de páginas leídas en ritmo fluido
  comfortablePaceLabel: string;    // Ej: '~1.6 min por página' o '~195 palabras/min'
  paceDescriptor: string;          // Ej: 'Ritmo sereno y constante' | 'Inmersión profunda' | 'Descubriendo tu ritmo'
  hasEnoughData: boolean;          // true cuando hay suficientes muestras de telemetría
}

export interface FlowStateCalculationInput {
  events?: ReadingEvent[] | null;
  intervals?: TimeInterval[] | null;
  focusProfile?: UserFocusTelemetryProfile | null;
  baselineWpm?: number | null;
  chaptersCompleted?: number | Record<string, number> | null;
  lang?: string;
}

export function computeFlowStateSummary(
  inputOrEvents?: FlowStateCalculationInput | ReadingEvent[] | null,
  maybeIntervals?: TimeInterval[] | null,
  maybeFocusProfile?: UserFocusTelemetryProfile | null,
  maybeBaselineWpm?: number | null,
): FlowStateSummary {
  let events: ReadingEvent[] = [];
  let intervals: TimeInterval[] = [];
  let focusProfile: UserFocusTelemetryProfile | null = null;
  let baselineWpm: number | null = null;
  let chaptersCompleted: number | Record<string, number> | null = null;
  let lang = "es";

  if (Array.isArray(inputOrEvents)) {
    events = inputOrEvents;
    intervals = maybeIntervals ?? [];
    focusProfile = maybeFocusProfile ?? null;
    baselineWpm = maybeBaselineWpm ?? null;
  } else if (inputOrEvents && typeof inputOrEvents === "object") {
    events = inputOrEvents.events ?? [];
    intervals = inputOrEvents.intervals ?? [];
    focusProfile = inputOrEvents.focusProfile ?? null;
    baselineWpm = inputOrEvents.baselineWpm ?? null;
    chaptersCompleted = inputOrEvents.chaptersCompleted ?? null;
    lang = inputOrEvents.lang ?? "es";
  }

  if (!focusProfile) {
    focusProfile = loadFocusTelemetryProfile();
  }
  if (baselineWpm == null) {
    baselineWpm = loadBaselineWpm();
  }

  let eventDwellMs = 0;
  let eventWords = 0;
  let flowPages = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  const sectionsVisited = new Set<string>();
  const sectionsFatigued = new Set<string>();

  const sortedEvents = [...events].sort((a, b) => a.createdAt - b.createdAt);

  for (const ev of sortedEvents) {
    if (ev.kind === "section_dwell") {
      eventDwellMs += ev.ms;
      eventWords += ev.words;
      if (ev.ms >= 5_000) {
        flowPages += 1;
        currentStreak += 1;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
        const key = `${ev.bookHash ?? "b"}:${ev.visitId ?? ev.sectionIndex}`;
        sectionsVisited.add(key);
      }
    } else if (ev.kind === "page_regressed") {
      currentStreak = 0;
    } else if (ev.kind === "fatigue_flag") {
      currentStreak = 0;
      const key = `${ev.bookHash ?? "b"}:${ev.visitId ?? ev.sectionIndex}`;
      sectionsFatigued.add(key);
    }
  }

  const normLang = lang.slice(0, 2).toLowerCase();
  const langBaseline =
    focusProfile?.paceByLang?.[normLang] ?? focusProfile?.paceByLang?.["es"];
  const telemetrySamples = Object.values(focusProfile?.paceByLang ?? {}).reduce(
    (acc, b) => acc + (b?.samples ?? 0),
    0,
  );

  const totalFlowPages = Math.max(flowPages, telemetrySamples);
  const uninterruptedPagesStreak =
    maxStreak > 0
      ? maxStreak
      : telemetrySamples > 0
        ? Math.min(telemetrySamples, 12)
        : 0;

  const eventChapters = Math.max(0, sectionsVisited.size - sectionsFatigued.size);
  const sessionChapters = intervals.filter(
    (i) => i.endedAt - i.startedAt >= 8 * 60_000,
  ).length;
  let chaptersFromProfile = 0;
  if (typeof chaptersCompleted === "number") {
    chaptersFromProfile = chaptersCompleted;
  } else if (chaptersCompleted && typeof chaptersCompleted === "object") {
    chaptersFromProfile = Object.values(chaptersCompleted).reduce(
      (a, b) => a + b,
      0,
    );
  }
  const flowChaptersCount = Math.max(
    eventChapters,
    sessionChapters,
    chaptersFromProfile,
    Math.floor(totalFlowPages / 6),
  );

  const hasEnoughEventData =
    (eventDwellMs >= 30_000 && eventWords >= 60) || flowPages >= 3;
  const hasEnoughTelemetryData =
    (langBaseline?.samples ?? 0) >= 3 || telemetrySamples >= 3;
  const hasEnoughData = hasEnoughEventData || hasEnoughTelemetryData;

  if (!hasEnoughData) {
    return {
      flowChaptersCount,
      uninterruptedPagesStreak,
      totalFlowPages,
      comfortablePaceLabel: "Calibrando con tu lectura",
      paceDescriptor: "Leyendo a tu propio paso",
      hasEnoughData: false,
    };
  }

  let effectiveWpm: number;
  if (eventDwellMs >= 15_000 && eventWords >= 40) {
    effectiveWpm = Math.round(eventWords / (eventDwellMs / 60_000));
  } else if (langBaseline && langBaseline.meanSecPer100Words > 0) {
    effectiveWpm = Math.round((100 / langBaseline.meanSecPer100Words) * 60);
  } else if (typeof baselineWpm === "number" && baselineWpm > 0) {
    effectiveWpm = Math.round(baselineWpm);
  } else {
    effectiveWpm = 200;
  }

  const comfortablePaceLabel = `~${effectiveWpm} palabras/min`;

  let paceDescriptor: string;
  if (effectiveWpm >= 260) {
    paceDescriptor = "Inmersión profunda";
  } else if (effectiveWpm >= 180) {
    paceDescriptor = "Ritmo sereno y constante";
  } else {
    paceDescriptor = "Descubriendo tu ritmo";
  }

  return {
    flowChaptersCount,
    uninterruptedPagesStreak,
    totalFlowPages,
    comfortablePaceLabel,
    paceDescriptor,
    hasEnoughData: true,
  };
}

export const flowStateSummary = computeFlowStateSummary;


