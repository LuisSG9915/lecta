// Telemetría de foco del lector: cuenta avances y retrocesos de
// navegación en una ventana deslizante para detectar la fatiga —
// cuando lleva un buen tramo leyendo y la tasa de regresiones sube,
// la lectura ya está costando seguir el hilo. Los agregados por día
// (dwell, regresiones, consultas) alimentan el panel de actividad.

import { dayKeyOf } from "./reading-activity";
import type { ReadingEvent } from "./idb";

// Tramo de lectura mínimo antes de medir fatiga.
export const FATIGUE_AFTER_MS = 25 * 60_000;
// Ventana deslizante sobre la que se tasa la regresión.
export const FATIGUE_WINDOW_MS = 5 * 60_000;
// Enfriamiento entre avisos de fatiga.
export const FATIGUE_COOLDOWN_MS = 10 * 60_000;
// Muestra mínima de movimientos en la ventana.
export const FATIGUE_MIN_MOVES = 8;
// Tasa de retrocesos que ya cuenta como lectura que cuesta seguir.
export const FATIGUE_REGRESSION_SHARE = 0.35;
// Un hueco sin navegar reinicia el tramo medido.
export const TRACK_GAP_MS = 5 * 60_000;

export type FocusTracker = {
  // Inicio del tramo continuo medido (una pausa larga lo reinicia).
  startedAt: number;
  lastMoveAt: number;
  // Sello del último aviso emitido; enfriamiento entre bostezos.
  flaggedAt: number;
  // Movimientos dentro de la ventana: página/sección atrás o adelante.
  moves: { at: number; back: boolean }[];
};

export function newFocusTracker(now: number): FocusTracker {
  return { startedAt: now, lastMoveAt: now, flaggedAt: 0, moves: [] };
}

// Anota un avance (back=false) o retroceso (back=true) y mantiene la
// ventana podada. Un hueco largo reinicia tramo y muestra: la fatiga
// se mide sobre lectura continua.
export function recordMove(t: FocusTracker, at: number, back: boolean) {
  if (at - t.lastMoveAt > TRACK_GAP_MS) {
    t.startedAt = at;
    t.moves = [];
    t.flaggedAt = 0;
  }
  t.moves.push({ at, back });
  t.lastMoveAt = at;
  const cutoff = at - FATIGUE_WINDOW_MS;
  while (t.moves.length && t.moves[0].at < cutoff) t.moves.shift();
}

// ¿El lector muestra fatiga? Requiere tramo largo, muestra suficiente
// y una tasa de retrocesos alta; devuelve la muestra para el evento
// diagnóstico y deja sellado el aviso (enfriamiento).
export function detectFatigue(
  t: FocusTracker,
  at: number,
): { backs: number; moves: number } | null {
  if (at - t.startedAt < FATIGUE_AFTER_MS) return null;
  if (t.flaggedAt && at - t.flaggedAt < FATIGUE_COOLDOWN_MS) return null;
  const moves = t.moves.length;
  const backs = t.moves.reduce((n, m) => n + (m.back ? 1 : 0), 0);
  if (moves < FATIGUE_MIN_MOVES || backs / moves < FATIGUE_REGRESSION_SHARE)
    return null;
  t.flaggedAt = at;
  return { backs, moves };
}

// ---------- Agregado por día para el panel de actividad ----------

export type DayFocus = {
  dayKey: string;
  // Tiempo con la sección en pantalla (eventos section_dwell).
  dwellMs: number;
  // Palabras recorridas durante ese dwell: base del ritmo estimado.
  words: number;
  regressions: number;
  consults: number;
  // Avisos de fatiga disparados ese día.
  fatigue: number;
};

// Palabras por minuto observadas ese día (0 sin muestra suficiente).
export function dayWpm(day: Pick<DayFocus, "dwellMs" | "words">): number {
  if (day.dwellMs < 15_000 || day.words < 40) return 0;
  return Math.round(day.words / (day.dwellMs / 60_000));
}

export function focusByDay(
  events: ReadingEvent[],
  timeZone: string,
): DayFocus[] {
  const byDay = new Map<string, DayFocus>();
  const slot = (dayKey: string) => {
    let day = byDay.get(dayKey);
    if (!day) {
      day = {
        dayKey,
        dwellMs: 0,
        words: 0,
        regressions: 0,
        consults: 0,
        fatigue: 0,
      };
      byDay.set(dayKey, day);
    }
    return day;
  };
  for (const event of events) {
    const day = slot(dayKeyOf(event.createdAt, timeZone));
    switch (event.kind) {
      case "section_dwell":
        day.dwellMs += event.ms;
        day.words += event.words;
        break;
      case "page_regressed":
        day.regressions += 1;
        break;
      case "word_consulted":
        day.consults += 1;
        break;
      case "fatigue_flag":
        day.fatigue += 1;
        break;
    }
  }
  return [...byDay.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}
