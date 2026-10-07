// Consejo diario de lectura en la estantería: la única llamada IA
// proactiva del producto. Las reglas vienen de
// docs/concentracion-y-lectura.md §4 y están pensadas para proteger
// el canal: cadencia de 1 llamada por día y dispositivo, mínimo de
// datos para no pedir consejos genéricos, y silencio como resultado
// válido del servidor.

import { accountFetch } from "./account-fetch";
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
import { parseReadingGoal, READING_GOAL_KEY } from "./reading-goal";
import { loadUseAi } from "./ai-pref";
import { loadReaderSettings } from "./settings";
import type { TipContext, TipDayStats, TipResponse } from "../../shared/tip";

// Clave de cadencia (session store, por cuenta): día local de la
// última llamada completada. Se consume haya o no tip.
export const TIP_LAST_DAY_KEY = "tipLastDay";

// Ventana de agregados enviada al servidor.
export const TIP_WINDOW_DAYS = 14;
// Mínimo de historial para pedir consejo: sin datos recientes la IA
// solo podría devolver generalidades, y un tip genérico diario
// degrada la señal del canal entero.
export const TIP_MIN_ACTIVE_DAYS = 2;
export const TIP_MIN_DAY_MS = 5 * 60_000;
// El consejo no puede tardar más que entrar a la estantería; pasado
// el plazo se descarta en silencio.
export const TIP_REQUEST_TIMEOUT_MS = 8_000;

// Un día «leído» pide al menos un minuto en pantalla — mismo criterio
// que la meta de días de reading-activity.
const READ_DAY_MIN_MS = 60_000;

// Diferencia en días naturales entre dos «AAAA-MM-DD» (mediodía UTC
// para no tropezar con cambios de horario).
function dayDiff(later: string, earlier: string): number {
  const at = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 12);
  };
  return Math.max(0, Math.round((at(later) - at(earlier)) / 86_400_000));
}

// Agrega los eventos del trayecto en el contexto que viaja a la IA.
// Pura: los eventos ya vienen leídos (listReadingEvents sin filtro —
// el consejo es de hábito, no de un libro).
export function buildTipContext(
  events: ReadingEvent[],
  opts: { focusMode: string; weeklyGoalDays: number | null },
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): TipContext {
  const today = dayKeyOf(now, timeZone);
  const byDay = focusByDay(events, timeZone).filter(
    (d) => d.dwellMs > 0 && d.dayKey <= today,
  );
  // El último día leído se busca sobre el dwell crudo: redondear a
  // minutos movería un día de 59 s al lado de «leído».
  const lastRead = byDay.filter((d) => d.dwellMs >= READ_DAY_MIN_MS).at(-1);
  const days: TipDayStats[] = byDay
    .map((d) => ({
      dayKey: d.dayKey,
      // Minutos truncados: 4.9 min leídos son 4 — redondear inflaría
      // tanto el mínimo de datos como el contexto que ve la IA.
      minutes: Math.floor(d.dwellMs / 60_000),
      regressions: d.regressions,
      consults: d.consults,
      fatigue: d.fatigue,
      wpm: dayWpm(d),
    }))
    .reverse()
    .slice(0, TIP_WINDOW_DAYS);
  return {
    dayKey: today,
    localHour: new Date(now).getHours(),
    daysSinceLastRead: lastRead ? dayDiff(today, lastRead.dayKey) : 0,
    days,
    focusMode: opts.focusMode,
    weeklyGoalDays: opts.weeklyGoalDays,
  };
}

// ¿Hay suficiente historial para que un consejo sea personal? Menos
// de TIP_MIN_ACTIVE_DAYS días con ≥5 min en la ventana → no se llama.
export function hasTipData(ctx: TipContext): boolean {
  return (
    ctx.days.filter((d) => d.minutes * 60_000 >= TIP_MIN_DAY_MS).length >=
    TIP_MIN_ACTIVE_DAYS
  );
}

// Puertas del canal (todas antes de llamar): sesión, «Usar IA»,
// datos mínimos y cadencia diaria. Pura — la IO la hace
// maybeRequestTip.
export function tipEligible(input: {
  userId: string | null | undefined;
  useAi: boolean;
  lastTipDay: string | null;
  ctx: TipContext;
}): boolean {
  if (!input.userId || !input.useAi) return false;
  if (input.lastTipDay === input.ctx.dayKey) return false;
  return hasTipData(input.ctx);
}

export type TipOutcome = TipResponse & { tipDay: string };

// Orquesta el consejo del día: lee preferencias e historial, aplica
// las puertas y consume la cadencia al completar la llamada (con o
// sin tip). Devuelve null ante cualquier no — la estantería se queda
// igual, que es la respuesta correcta a un canal opcional.
export async function maybeRequestTip(
  scope?: DbScope,
): Promise<TipOutcome | null> {
  const bound = scope ?? captureDbScope();
  try {
    if (!bound.userId) return null;
    if (!(await loadUseAi(bound))) return null;
    const [events, lastTipDay, rawGoal] = await Promise.all([
      listReadingEvents(undefined, bound),
      loadSessionValue(TIP_LAST_DAY_KEY, bound),
      loadSessionValue(READING_GOAL_KEY, bound),
    ]);
    const ctx = buildTipContext(events, {
      focusMode: loadReaderSettings().focusMode,
      weeklyGoalDays: parseReadingGoal(rawGoal)?.daysPerWeek ?? null,
    });
    if (!tipEligible({ userId: bound.userId, useAi: true, lastTipDay, ctx }))
      return null;
    const response = await accountFetch(
      "/api/lexicon/tip",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ctx),
        signal: AbortSignal.timeout(TIP_REQUEST_TIMEOUT_MS),
      },
      bound,
    );
    // La llamada terminó: el día queda consumido sea cual sea la
    // respuesta. Un fallo de red (antes de esta línea) no consume.
    await saveSessionValue(TIP_LAST_DAY_KEY, ctx.dayKey, bound).catch(
      () => undefined,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<TipResponse>;
    if (typeof data.tip !== "string" || !data.tip) return null;
    return {
      tip: data.tip,
      action: data.action ?? "none",
      version: typeof data.version === "string" ? data.version : "tip-v1",
      tipDay: ctx.dayKey,
    };
  } catch {
    return null;
  }
}
