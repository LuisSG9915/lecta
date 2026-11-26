// Predicción de fluidez (Lecta+, F17). Cálculo puro: lo usa el worker con datos
// de la base y las pruebas sin red. Sin IA. Nunca inventa una fecha: sin ritmo
// medido devuelve «no-data».

export const FLUENCY_TARGET_COVERAGE = 0.95;
/** Más allá de esto no se promete fecha: «más de 5 años». */
export const FLUENCY_MAX_WEEKS = 52 * 5;
/** Semanas que se miran hacia atrás para medir el ritmo. */
export const FLUENCY_WINDOW_WEEKS = 8;
/** Mínimos para hablar de ritmo: palabras en total y en las últimas 4 semanas. */
export const FLUENCY_MIN_TOTAL = 30;
export const FLUENCY_MIN_RECENT = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cobertura aproximada del texto corrido según lemas conocidos (cifras de
 * orden de magnitud de la literatura de cobertura léxica, Nation y otros; es
 * un modelo, no una medición del libro concreto). Interpolación lineal en ln(n).
 */
const COVERAGE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [100, 0.5],
  [500, 0.72],
  [1000, 0.8],
  [2000, 0.87],
  [3000, 0.91],
  [4500, 0.95],
  [6500, 0.97],
  [9000, 0.98],
  [20000, 0.995],
];

export function coverageForVocab(words: number): number {
  const first = COVERAGE_CURVE[0];
  const last = COVERAGE_CURVE[COVERAGE_CURVE.length - 1];
  if (!Number.isFinite(words) || words <= 0) return 0;
  if (words <= first[0]) return first[1] * (words / first[0]);
  if (words >= last[0]) return last[1];
  for (let i = 1; i < COVERAGE_CURVE.length; i++) {
    const [n1, c1] = COVERAGE_CURVE[i];
    if (words <= n1) {
      const [n0, c0] = COVERAGE_CURVE[i - 1];
      const t = (Math.log(words) - Math.log(n0)) / (Math.log(n1) - Math.log(n0));
      return c0 + t * (c1 - c0);
    }
  }
  return last[1];
}

/** Lemas necesarios para alcanzar `coverage` (inversa de `coverageForVocab`). */
export function vocabForCoverage(coverage: number): number {
  const first = COVERAGE_CURVE[0];
  const last = COVERAGE_CURVE[COVERAGE_CURVE.length - 1];
  if (coverage <= first[1]) return Math.round((coverage / first[1]) * first[0]);
  if (coverage >= last[1]) return last[0];
  for (let i = 1; i < COVERAGE_CURVE.length; i++) {
    const [n1, c1] = COVERAGE_CURVE[i];
    if (coverage <= c1) {
      const [n0, c0] = COVERAGE_CURVE[i - 1];
      const t = (coverage - c0) / (c1 - c0);
      return Math.round(Math.exp(Math.log(n0) + t * (Math.log(n1) - Math.log(n0))));
    }
  }
  return last[0];
}

export interface FluencyForecastInput {
  now: number;
  /** Instante (ms) en que cada palabra del idioma quedó consolidada. */
  consolidatedAt: number[];
  targetCoverage?: number;
}

export type FluencyForecast =
  | { status: "no-data"; consolidated: number; note: string }
  | {
      status: "reached" | "projection" | "far";
      consolidated: number;
      currentCoverage: number;
      targetCoverage: number;
      targetWords: number;
      /** Palabras consolidadas por semana (media de las últimas semanas activas). */
      weeklyRate: number;
      /** Fechas en ms; `null` = más de 5 años (o ritmo pesimista sin avance). */
      at: number | null;
      earliestAt: number | null;
      latestAt: number | null;
      note: string;
    };

export const FLUENCY_NOTE = "Con tu ritmo actual";

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stampAfter(now: number, weeks: number): number | null {
  if (!Number.isFinite(weeks) || weeks > FLUENCY_MAX_WEEKS) return null;
  return now + Math.ceil(weeks * WEEK_MS);
}

export function buildFluencyForecast(input: FluencyForecastInput): FluencyForecast {
  const { now } = input;
  const target = input.targetCoverage ?? FLUENCY_TARGET_COVERAGE;
  const stamps = input.consolidatedAt.filter((t) => Number.isFinite(t) && t <= now);
  const consolidated = stamps.length;
  const noData: FluencyForecast = {
    status: "no-data",
    consolidated,
    note: "Aún sin datos: guarda y repasa palabras unas semanas y aquí aparece tu proyección.",
  };

  // Ritmo: cubetas de 7 días hacia atrás desde ahora.
  const buckets = new Array<number>(FLUENCY_WINDOW_WEEKS).fill(0);
  for (const t of stamps) {
    const idx = Math.floor((now - t) / WEEK_MS);
    if (idx >= 0 && idx < FLUENCY_WINDOW_WEEKS) buckets[idx] += 1;
  }
  const recent = buckets.slice(0, 4).reduce((a, b) => a + b, 0);
  const activeWeeks = buckets.filter((n) => n > 0).length;
  if (consolidated < FLUENCY_MIN_TOTAL || recent < FLUENCY_MIN_RECENT || activeWeeks < 2) return noData;

  // La serie arranca en la semana activa más antigua: las semanas previas al
  // primer uso no cuentan como ritmo cero.
  const oldestActive = buckets.reduce((acc, n, i) => (n > 0 ? i : acc), 0);
  const series = buckets.slice(0, oldestActive + 1);
  const weeklyRate = mean(series);
  const sorted = [...series].sort((a, b) => a - b);
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const lowRate = mean(sorted.slice(0, half));
  const highRate = Math.max(weeklyRate, mean(sorted.slice(sorted.length - half)));

  const targetWords = vocabForCoverage(target);
  const currentCoverage = coverageForVocab(consolidated);
  const base = { consolidated, currentCoverage, targetCoverage: target, targetWords, weeklyRate, note: FLUENCY_NOTE };
  const remaining = targetWords - consolidated;
  if (remaining <= 0) {
    return { status: "reached", ...base, at: now, earliestAt: now, latestAt: now };
  }
  const weeksAt = (rate: number) => (rate > 0 ? remaining / rate : Infinity);
  const at = stampAfter(now, weeksAt(weeklyRate));
  return {
    status: at === null ? "far" : "projection",
    ...base,
    at,
    earliestAt: stampAfter(now, weeksAt(highRate)),
    latestAt: stampAfter(now, weeksAt(lowRate)),
  };
}
