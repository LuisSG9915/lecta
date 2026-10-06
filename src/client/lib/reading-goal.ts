// Meta semanal de días con lectura: preferencia local por cuenta
// (almacén de sesión, clave «readingGoal:v1»). Migra anónimo→cuenta y
// sale en el respaldo como el resto de claves de sesión; no viaja al
// servidor — es una preferencia de este dispositivo.

import { dayKeyOf, timeByDay, type TimeInterval } from "./reading-activity";

export const READING_GOAL_KEY = "readingGoal:v1";

// Un día «leído» para la meta acumula al menos un minuto; el intervalo
// mínimo de registro (5 s) sigue siendo cosa de reading-activity.
export const DAY_GOAL_MS = 60_000;

export type ReadingGoal = {
  version: 1;
  /** Días con lectura por semana (1–7); null = meta desactivada. */
  daysPerWeek: number | null;
  updatedAt: number;
};

export function parseReadingGoal(raw: string | null | undefined): ReadingGoal | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as {
      version?: unknown;
      daysPerWeek?: unknown;
      updatedAt?: unknown;
    };
    if (v?.version !== 1) return null;
    const days = v.daysPerWeek;
    const valid =
      days === null ||
      (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 7);
    if (!valid) return null;
    return {
      version: 1,
      daysPerWeek: days,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function serializeReadingGoal(daysPerWeek: number | null, now = Date.now()): string {
  return JSON.stringify({ version: 1, daysPerWeek, updatedAt: now });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const dayKeyFromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

// La clave de día es una fecha de calendario local («2025-03-10»); el
// lunes se calcula en UTC mediodía — la fecha es la misma en cualquier
// zona — para que DST ni medio día de desfase muevan el resultado.
export function weekStartKey(now: number, timeZone: string): string {
  const today = dayKeyOf(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const weekday = new Date(noon).getUTCDay(); // 0=domingo … 6=sábado
  const back = (weekday + 6) % 7; // días desde el lunes
  return dayKeyFromUtc(noon - back * 86_400_000);
}

export type WeeklyGoalProgress = {
  /** Lunes y domingo de la semana en curso, claves de día local. */
  startKey: string;
  endKey: string;
  /** Días de esta semana con al menos 60 s acumulados (hasta hoy). */
  readDays: number;
  target: number;
  met: boolean;
  /** Los siete días lunes→domingo con su marca de ≥60 s; futuro incluido. */
  days: { dayKey: string; read: boolean }[];
};

// La fuente de verdad son los intervalos guardados (locales + los que
// llegaron por sync), no el registro histórico «readingDays». La semana
// corre de lunes a domingo en la zona local; los días futuros no cuentan.
export function weeklyGoalProgress(
  intervals: TimeInterval[],
  now: number,
  timeZone: string,
  daysPerWeek: number,
): WeeklyGoalProgress {
  const startKey = weekStartKey(now, timeZone);
  const todayKey = dayKeyOf(now, timeZone);
  const [y, m, d] = startKey.split("-").map(Number);
  const endKey = dayKeyFromUtc(Date.UTC(y, m - 1, d, 12) + 6 * 86_400_000);
  const counted = new Set<string>();
  for (const { dayKey, ms } of timeByDay(intervals, timeZone)) {
    if (ms < DAY_GOAL_MS) continue;
    // La comparación de claves ISO ordena fechas de calendario.
    if (dayKey < startKey || dayKey > todayKey) continue;
    counted.add(dayKey);
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayKey = dayKeyFromUtc(Date.UTC(y, m - 1, d, 12) + i * 86_400_000);
    return { dayKey, read: counted.has(dayKey) };
  });
  return {
    startKey,
    endKey,
    readDays: counted.size,
    target: daysPerWeek,
    met: counted.size >= daysPerWeek,
    days,
  };
}
