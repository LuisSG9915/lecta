// Meta semanal de días con lectura: preferencia local por cuenta
// (almacén de sesión, clave «readingGoal:v1»). Migra anónimo→cuenta y
// sale en el respaldo como el resto de claves de sesión; no viaja al
// servidor — es una preferencia de este dispositivo.

import { dayKeyOf, timeByDay, type TimeInterval } from "./reading-activity";

export const READING_GOAL_KEY = "readingGoal:v1";

// Un día «leído» para la meta acumula al menos un minuto; el intervalo
// mínimo de registro (5 s) sigue siendo cosa de reading-activity.
export const DAY_GOAL_MS = 60_000;

/** Metas de micro-sesiones configurables para retención y anti-abandono (Fase 1) */
export const MICRO_SESSION_GOALS_MS = {
  MICRO_3_MIN: 180_000,
  MICRO_5_MIN: 300_000,
  MICRO_10_MIN: 600_000,
} as const;

export const ALLOWED_DAILY_GOAL_MS = [
  60_000,
  180_000,
  300_000,
  600_000,
] as const;

export function getEffectiveDailyGoalMs(goal?: ReadingGoal | null | number): number {
  if (typeof goal === "number" && goal > 0) return goal;
  if (typeof goal === "object" && goal !== null && typeof goal.dailyGoalMs === "number" && goal.dailyGoalMs > 0) {
    return goal.dailyGoalMs;
  }
  return DAY_GOAL_MS;
}

export const MAX_STREAK_SHIELDS = 2;

export type ReadingGoal = {
  version: 1;
  /** Días con lectura por semana (1–7); null = meta desactivada. */
  daysPerWeek: number | null;
  updatedAt: number;
  /** Escudos de ronroneo disponibles para proteger la racha (máximo 2). */
  streakShields?: number;
  /** Clave del último día protegido por un escudo (ej. «2026-03-10»). */
  lastShieldUsedDay?: string | null;
  /** Meta de lectura diaria configurable en ms (por ej. 180000 ms, 300000 ms, 600000 ms). Default: 60000 ms */
  dailyGoalMs?: number;
};

export function parseReadingGoal(raw: string | null | undefined): ReadingGoal | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as {
      version?: unknown;
      daysPerWeek?: unknown;
      updatedAt?: unknown;
      streakShields?: unknown;
      lastShieldUsedDay?: unknown;
      dailyGoalMs?: unknown;
    };
    if (v?.version !== 1) return null;
    const days = v.daysPerWeek;
    const valid =
      days === null ||
      (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 7);
    if (!valid) return null;

    const streakShields =
      typeof v.streakShields === "number" && Number.isInteger(v.streakShields)
        ? Math.min(MAX_STREAK_SHIELDS, Math.max(0, v.streakShields))
        : 0;

    const lastShieldUsedDay =
      typeof v.lastShieldUsedDay === "string" ? v.lastShieldUsedDay : null;

    const dailyGoalMs =
      typeof v.dailyGoalMs === "number" && v.dailyGoalMs > 0
        ? v.dailyGoalMs
        : DAY_GOAL_MS;

    return {
      version: 1,
      daysPerWeek: days,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
      streakShields,
      lastShieldUsedDay,
      dailyGoalMs,
    };
  } catch {
    return null;
  }
}

export function serializeReadingGoal(
  daysPerWeek: number | null,
  now = Date.now(),
  streakShields = 0,
  lastShieldUsedDay: string | null = null,
  dailyGoalMs: number = DAY_GOAL_MS,
): string {
  return JSON.stringify({
    version: 1,
    daysPerWeek,
    updatedAt: now,
    streakShields: Math.min(MAX_STREAK_SHIELDS, Math.max(0, streakShields)),
    lastShieldUsedDay,
    dailyGoalMs,
  });
}

/**
 * Añade escudos de ronroneo (máximo MAX_STREAK_SHIELDS = 2).
 */
export function grantStreakShield(
  goal: ReadingGoal | null,
  count = 1,
  now = Date.now(),
): ReadingGoal {
  const current = goal ?? {
    version: 1,
    daysPerWeek: null,
    updatedAt: now,
    streakShields: 0,
    lastShieldUsedDay: null,
    dailyGoalMs: DAY_GOAL_MS,
  };
  const streakShields = Math.min(
    MAX_STREAK_SHIELDS,
    (current.streakShields ?? 0) + count,
  );
  return {
    ...current,
    streakShields,
    updatedAt: now,
  };
}

/**
 * Consume 1 escudo de ronroneo para proteger un día no leído.
 */
export function consumeStreakShield(
  goal: ReadingGoal | null,
  dayKey: string,
  now = Date.now(),
): { goal: ReadingGoal; consumed: boolean } {
  if (!goal || !goal.streakShields || goal.streakShields <= 0) {
    return {
      goal: goal ?? {
        version: 1,
        daysPerWeek: null,
        updatedAt: now,
        streakShields: 0,
        lastShieldUsedDay: null,
        dailyGoalMs: DAY_GOAL_MS,
      },
      consumed: false,
    };
  }
  return {
    goal: {
      ...goal,
      streakShields: goal.streakShields - 1,
      lastShieldUsedDay: dayKey,
      updatedAt: now,
    },
    consumed: true,
  };
}

/**
 * Evalúa si ayer quedó sin lectura y aplica el Escudo de Ronroneo automáticamente.
 */
export function evaluateStreakProtection(
  goal: ReadingGoal | null,
  readDaysSet: Set<string>,
  _todayKey: string,
  yesterdayKey: string,
  now = Date.now(),
): {
  updatedGoal: ReadingGoal | null;
  protectedYesterday: boolean;
  catMessage: string | null;
} {
  if (!goal) return { updatedGoal: null, protectedYesterday: false, catMessage: null };
  const readYesterday = readDaysSet.has(yesterdayKey);

  // Si ayer ya fue protegido por un escudo previamente registrado
  if (goal.lastShieldUsedDay === yesterdayKey) {
    return {
      updatedGoal: goal,
      protectedYesterday: true,
      catMessage: "¡Cuidé tu racha ayer mientras descansabas!",
    };
  }

  // Si ayer no hubo lectura pero hay escudos disponibles, consumir uno
  if (!readYesterday && (goal.streakShields ?? 0) > 0) {
    const { goal: updatedGoal, consumed } = consumeStreakShield(goal, yesterdayKey, now);
    if (consumed) {
      return {
        updatedGoal,
        protectedYesterday: true,
        catMessage: "¡Cuidé tu racha ayer mientras descansabas!",
      };
    }
  }

  return { updatedGoal: goal, protectedYesterday: false, catMessage: null };
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
  dailyGoalMs: number = DAY_GOAL_MS,
): WeeklyGoalProgress {
  const startKey = weekStartKey(now, timeZone);
  const todayKey = dayKeyOf(now, timeZone);
  const [y, m, d] = startKey.split("-").map(Number);
  const endKey = dayKeyFromUtc(Date.UTC(y, m - 1, d, 12) + 6 * 86_400_000);
  const counted = new Set<string>();
  const threshold = dailyGoalMs > 0 ? dailyGoalMs : DAY_GOAL_MS;
  for (const { dayKey, ms } of timeByDay(intervals, timeZone)) {
    if (ms < threshold) continue;
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
