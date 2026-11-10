// Consejo diario de lectura en la estantería, calculado en el
// dispositivo con reglas y plantillas (sin IA). Base del diseño:
// docs/concentracion-y-lectura.md §4. Compara el último día leído
// contra la mediana de los días anteriores de la ventana, nombra el
// dato que dispara el consejo y calla en cualquier otro caso.

import {
  captureDbScope,
  listReadingEvents,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
  type ReadingEvent,
} from "./idb";
import { dayWpm, focusByDay } from "./focus-telemetry";
import { dayKeyOf } from "./reading-activity";
import { loadReaderSettings } from "./settings";

// Acciones que la tarjeta ejecuta de verdad; «none» es solo informativo.
export type TipAction = "none" | "focus_ruler" | "syntactic";

// Un día de lectura agregado, reducido a lo que las reglas miran.
export type TipDayStats = {
  // Día local «AAAA-MM-DD» del lector.
  dayKey: string;
  // Minutos con la sección en pantalla (dwell), truncados.
  minutes: number;
  // Retrocesos de página o sección.
  regressions: number;
  // Ritmo estimado en palabras por minuto; 0 = muestra insuficiente.
  wpm: number;
};

export type TipContext = {
  // Día local en que se calcula; también es la clave de cadencia.
  dayKey: string;
  // Más reciente primero.
  days: TipDayStats[];
  focusMode: string;
};

export type TipOutcome = {
  tip: string;
  action: TipAction;
  version: string;
  tipDay: string;
};

// Versión de las plantillas: viaja en tip_shown como promptVersion.
export const TIP_TEMPLATE_VERSION = "tip-local-v1";

// Clave de cadencia (session store, por cuenta): día local del último
// consejo mostrado. Un día sin señal no la consume.
export const TIP_LAST_DAY_KEY = "tipLastDay";

export const TIP_WINDOW_DAYS = 14;
// Un día cuenta para comparar si tuvo ≥5 min de lectura.
export const TIP_MIN_DAY_MS = 5 * 60_000;
// Días de referencia (además del comparado) para que la mediana
// signifique algo.
export const TIP_MIN_BASELINE_DAYS = 2;

// Umbrales: heurística propia (docs/concentracion-y-lectura.md §4).
const REGRESSION_MIN_COUNT = 8;
const REGRESSION_RATE_RATIO = 1.5;
const PACE_DROP_RATIO = 0.75;

// Agrega los eventos del trayecto por día local. Pura: los eventos ya
// vienen leídos (sin filtro de libro — el consejo es de hábito).
export function buildTipContext(
  events: ReadingEvent[],
  opts: { focusMode: string },
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): TipContext {
  const today = dayKeyOf(now, timeZone);
  const days: TipDayStats[] = focusByDay(events, timeZone)
    .filter((d) => d.dwellMs > 0 && d.dayKey <= today)
    .map((d) => ({
      dayKey: d.dayKey,
      // Truncados: 4.9 min leídos son 4 — redondear inflaría el mínimo.
      minutes: Math.floor(d.dwellMs / 60_000),
      regressions: d.regressions,
      wpm: dayWpm(d),
    }))
    .reverse()
    .slice(0, TIP_WINDOW_DAYS);
  return { dayKey: today, days, focusMode: opts.focusMode };
}

function countedDays(ctx: TipContext): TipDayStats[] {
  return ctx.days.filter((d) => d.minutes * 60_000 >= TIP_MIN_DAY_MS);
}

// ¿Hay un día que comparar y referencia suficiente detrás?
export function hasTipData(ctx: TipContext): boolean {
  return countedDays(ctx).length >= 1 + TIP_MIN_BASELINE_DAYS;
}

export function tipEligible(input: {
  lastTipDay: string | null;
  ctx: TipContext;
}): boolean {
  if (input.lastTipDay === input.ctx.dayKey) return false;
  return hasTipData(input.ctx);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Elige a lo más un consejo. Retrocesos antes que ritmo: es la señal
// más directa y su ayuda (la regla) es la menos invasiva.
export function composeTip(
  ctx: TipContext,
): { tip: string; action: TipAction } | null {
  const [day, ...baseline] = countedDays(ctx);
  if (!day || baseline.length < TIP_MIN_BASELINE_DAYS) return null;
  const when = day.dayKey === ctx.dayKey ? "Hoy" : "La última vez que leíste";

  const usualRate = median(baseline.map((d) => d.regressions / d.minutes));
  const rate = day.regressions / day.minutes;
  if (
    ctx.focusMode !== "ruler" &&
    day.regressions >= REGRESSION_MIN_COUNT &&
    rate >= usualRate * REGRESSION_RATE_RATIO
  ) {
    return {
      action: "focus_ruler",
      tip: `${when} volviste atrás ${day.regressions} veces en ${day.minutes} min, más que en tus días habituales. Eso puede ser buena relectura; si te cuesta seguir el renglón, la regla de foco lo marca.`,
    };
  }

  const paced = baseline.filter((d) => d.wpm > 0);
  if (
    ctx.focusMode !== "syntactic" &&
    day.wpm > 0 &&
    paced.length >= TIP_MIN_BASELINE_DAYS
  ) {
    const usualWpm = Math.round(median(paced.map((d) => d.wpm)));
    if (day.wpm <= usualWpm * PACE_DROP_RATIO) {
      return {
        action: "syntactic",
        tip: `${when} leíste a unas ${day.wpm} palabras por minuto; tus días habituales rondan las ${usualWpm}. Un día lento también puede ser un buen día. Si quieres, las líneas sintácticas parten el texto en grupos de sentido.`,
      };
    }
  }
  return null;
}

// Orquesta el consejo del día: lee historial y cadencia, aplica las
// reglas y consume el día solo si hay consejo. Devuelve null ante
// cualquier no — la estantería se queda igual.
export async function loadDailyTip(
  scope?: DbScope,
): Promise<TipOutcome | null> {
  const bound = scope ?? captureDbScope();
  try {
    const [events, lastTipDay] = await Promise.all([
      listReadingEvents(undefined, bound),
      loadSessionValue(TIP_LAST_DAY_KEY, bound),
    ]);
    const ctx = buildTipContext(events, {
      focusMode: loadReaderSettings().focusMode,
    });
    if (!tipEligible({ lastTipDay, ctx })) return null;
    const composed = composeTip(ctx);
    if (!composed) return null;
    await saveSessionValue(TIP_LAST_DAY_KEY, ctx.dayKey, bound).catch(
      () => undefined,
    );
    return { ...composed, version: TIP_TEMPLATE_VERSION, tipDay: ctx.dayKey };
  } catch {
    return null;
  }
}
