// Plan de estudio adaptativo (Lecta+, F16). Cálculo puro: lo usa el worker
// con datos de la base y las pruebas sin red. Sin IA y sin texto de libros.

export const STUDY_PLAN_DAYS = 7;
/** Tope diario de repasos propuestos: lo que sobra pasa al día siguiente. */
export const STUDY_PLAN_DAILY_CAP = 25;
/** Segundos estimados por tarjeta al repasar. */
const SECONDS_PER_REVIEW = 20;
const DEFAULT_READING_MINUTES = 15;
const MIN_READING_MINUTES = 10;
const MAX_READING_MINUTES = 60;
/** Con menos sesiones que esto no se habla de «hábito». */
export const STUDY_PLAN_MIN_HABIT_SESSIONS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const HABIT_LOOKBACK_DAYS = 14;
const MAX_HABIT_SAMPLES = 14;

export interface StudyPlanInput {
  now: number;
  /** Vencimiento (ms) de cada tarjeta ya vista del Cuaderno. */
  dueAt: number[];
  /** Intervalos de lectura (ms) de las últimas semanas. */
  intervals: { startedAt: number; endedAt: number }[];
  /** Última posición de lectura, si hay. `progress` en 0–1 o en porcentaje. */
  lastPosition?: { bookHash: string; sectionIndex: number; progress: number | null } | null;
}

export interface StudyPlanDay {
  /** 0 = hoy (las próximas 24 h), 1 = mañana… */
  offset: number;
  reviews: number;
}

export interface StudyPlan {
  /** Sin tarjetas ni lectura reciente: no hay plan que proponer. */
  empty: boolean;
  days: StudyPlanDay[];
  /** Repasos que no caben en la semana con el tope diario. */
  backlog: number;
  /** Lectura sugerida por día, a partir del ritmo real (o 15 min sin datos). */
  readingMinutes: number;
  /** Lectura + repasos de hoy. */
  minutesToday: number;
  /** «observed» con ≥3 sesiones recientes; si no, el cliente usa la ventana por defecto. */
  habit: "observed" | "default";
  /** Inicios de las últimas sesiones: el cliente calcula la hora en su zona. */
  habitSamples: number[];
  /** Siguiente capítulo del libro en curso (sin leer texto del libro). */
  next: { bookHash: string; sectionIndex: number } | null;
}

function normalizedProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value > 1 ? value / 100 : value;
}

export function buildStudyPlan(input: StudyPlanInput): StudyPlan {
  const { now } = input;
  const demand = new Array<number>(STUDY_PLAN_DAYS).fill(0);
  for (const due of input.dueAt) {
    if (!Number.isFinite(due)) continue;
    const bucket = Math.max(0, Math.floor((due - now) / DAY_MS));
    if (bucket < STUDY_PLAN_DAYS) demand[bucket] += 1;
  }

  const days: StudyPlanDay[] = [];
  let carry = 0;
  for (let offset = 0; offset < STUDY_PLAN_DAYS; offset++) {
    const available = demand[offset] + carry;
    const reviews = Math.min(available, STUDY_PLAN_DAILY_CAP);
    carry = available - reviews;
    days.push({ offset, reviews });
  }

  const since = now - HABIT_LOOKBACK_DAYS * DAY_MS;
  const recent = input.intervals
    .filter((i) => Number.isFinite(i.startedAt) && Number.isFinite(i.endedAt) && i.startedAt >= since && i.endedAt >= i.startedAt)
    .sort((a, b) => a.startedAt - b.startedAt);
  const perDay = new Map<number, number>();
  for (const i of recent) {
    const day = Math.floor(i.startedAt / DAY_MS);
    perDay.set(day, (perDay.get(day) ?? 0) + (i.endedAt - i.startedAt));
  }
  let readingMinutes = DEFAULT_READING_MINUTES;
  if (perDay.size > 0) {
    const total = [...perDay.values()].reduce((a, b) => a + b, 0);
    const avg = Math.round(total / perDay.size / 60000);
    readingMinutes = Math.min(MAX_READING_MINUTES, Math.max(MIN_READING_MINUTES, avg));
  }

  const habitSamples = recent.slice(-MAX_HABIT_SAMPLES).map((i) => i.startedAt);
  const habit = recent.length >= STUDY_PLAN_MIN_HABIT_SESSIONS ? "observed" : "default";

  const pos = input.lastPosition;
  const progress = normalizedProgress(pos?.progress);
  const next =
    pos && pos.bookHash && (progress === null || progress < 0.98)
      ? { bookHash: pos.bookHash, sectionIndex: Math.max(0, Math.floor(pos.sectionIndex)) + 1 }
      : null;

  const hasCards = input.dueAt.length > 0;
  const empty = !hasCards && recent.length === 0 && !next;
  const minutesToday = readingMinutes + Math.ceil((days[0].reviews * SECONDS_PER_REVIEW) / 60);

  return {
    empty,
    days,
    backlog: carry,
    readingMinutes,
    minutesToday: empty ? 0 : minutesToday,
    habit,
    habitSamples: habit === "observed" ? habitSamples : [],
    next,
  };
}
