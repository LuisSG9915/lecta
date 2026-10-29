import { useCallback, useEffect, useRef } from "react";
import {
  captureDbScope,
  listIntervals,
  loadBookPosition,
  saveBookPosition,
  saveReadingInterval,
  type DbScope,
  type SavedBookPosition,
  type SavedInterval,
} from "../lib/idb";
import {
  dayKeyOf,
  IDLE_MS,
  MIN_INTERVAL_MS,
  ROLL_MS,
  timeByDay,
} from "../lib/reading-activity";
import { DAY_GOAL_MS } from "../lib/reading-goal";
import { pushActivityToServer } from "../lib/reading-sync";
import { eligibleDelta } from "../lib/reader-presence";
import type { CompanionSignal } from "../lib/companion-state";

export interface ActivitySegment {
  startedAt: number;
  lastActiveAt: number;
}

export interface DayGoalTracker {
  dayKey: string;
  done: boolean;
}

export interface UseReaderPersistenceOptions {
  bookHash: string;
  isReady: boolean;
  capturePosition: () => SavedBookPosition | null;
  signalCompanion?: (sig: Omit<CompanionSignal, "at"> & { at?: number }) => void;
  awardReading?: (
    input: { kind: "read"; ms: number },
    scope: DbScope,
    receipt: {
      id: string;
      at: number;
      dayKey: string;
      interval: { startedAt: number; endedAt: number };
    },
  ) => void;
  presenceActivity?: (delta: number) => void;
  presenceIdle?: (idle: boolean) => void;
  setCatSleepy?: (sleepy: boolean) => void;
  onGoalAchieved?: () => void;
  dailyGoalMs?: number;
  paused?: boolean;
}

export function useReaderPersistence({
  bookHash,
  isReady,
  capturePosition,
  signalCompanion,
  awardReading,
  presenceActivity,
  presenceIdle,
  setCatSleepy,
  onGoalAchieved,
  dailyGoalMs,
  paused = false,
}: UseReaderPersistenceOptions) {
  const latestPositionRef = useRef<SavedBookPosition | null>(null);
  // El cierre ya guardó: a partir de ahí el scroll del documento puede
  // caer a 0 (la estantería ocupa el alto que deja el libro al salir) y
  // esa lectura no es progreso de lectura. Sin la bandera, el guardado del
  // desmontaje escribía el principio del capítulo encima del punto real.
  const closedRef = useRef(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const activityRef = useRef<ActivitySegment | null>(null);
  const dayGoalRef = useRef<DayGoalTracker | null>(null);
  const pausedRef = useRef(paused);

  // Señal de actividad de lectura
  const noteActivity = useCallback((force = false) => {
    if (pausedRef.current || (!force && typeof document !== "undefined" && document.hidden)) return;
    const now = Date.now();
    const seg = activityRef.current;
    const delta = eligibleDelta(seg, now, IDLE_MS);
    if (!seg) activityRef.current = { startedAt: now, lastActiveAt: now };
    else seg.lastActiveAt = now;
    if (presenceActivity) presenceActivity(delta);
    if (setCatSleepy) setCatSleepy(false);
    if (signalCompanion) signalCompanion({ kind: "reading_activity", at: now });
  }, [signalCompanion, presenceActivity, setCatSleepy]);

  // Cierre de segmento de actividad
  const closeActivity = useCallback(() => {
    const seg = activityRef.current;
    activityRef.current = null;
    if (presenceIdle) presenceIdle(true);
    if (!seg) return;
    const endedAt = Math.min(seg.lastActiveAt, Date.now());
    if (endedAt - seg.startedAt < MIN_INTERVAL_MS) return;
    const interval: SavedInterval = {
      id: crypto.randomUUID(),
      bookHash,
      startedAt: seg.startedAt,
      endedAt,
    };
    const scope = captureDbScope();
    void saveReadingInterval(interval, scope).then(() =>
      pushActivityToServer([interval], scope),
    );

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayKey = dayKeyOf(endedAt, tz);
    if (awardReading) {
      awardReading({ kind: "read", ms: endedAt - seg.startedAt }, scope, {
        id: `read:${interval.id}`,
        at: endedAt,
        dayKey,
        interval: { startedAt: seg.startedAt, endedAt },
      });
    }

    if (onGoalAchieved || signalCompanion) {
      void listIntervals(scope).then((list) => {
        if (dayGoalRef.current?.dayKey !== dayKey)
          dayGoalRef.current = { dayKey, done: false };
        if (dayGoalRef.current.done) return;
        const saved =
          timeByDay(
            list.filter((it) => it.id !== interval.id),
            tz,
          ).find((d) => d.dayKey === dayKey)?.ms ?? 0;
        const total = saved + (endedAt - seg.startedAt);
        const targetGoalMs = dailyGoalMs && dailyGoalMs > 0 ? dailyGoalMs : DAY_GOAL_MS;
        if (total >= targetGoalMs) {
          dayGoalRef.current.done = true;
          if (signalCompanion) signalCompanion({ kind: "goal_completed", at: endedAt });
          if (onGoalAchieved) onGoalAchieved();
        }
      });
    }
  }, [bookHash, presenceIdle, awardReading, onGoalAchieved, signalCompanion, dailyGoalMs]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) closeActivity();
  }, [paused, closeActivity]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      const seg = activityRef.current;
      if (!seg) return;
      const now = Date.now();
      if (now - seg.lastActiveAt > IDLE_MS) {
        closeActivity();
        return;
      }
      if (now - seg.startedAt >= ROLL_MS) {
        const restartAt = seg.lastActiveAt;
        closeActivity();
        if (!pausedRef.current && typeof document !== "undefined" && !document.hidden) {
          activityRef.current = { startedAt: restartAt, lastActiveAt: restartAt };
          if (presenceIdle) presenceIdle(false);
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [closeActivity, presenceIdle]);

  // Guardado debounced de posición
  const saveSoon = useCallback(() => {
    if (closedRef.current) return;
    const pos = capturePosition();
    if (pos) {
      latestPositionRef.current = pos;
    }
    const scope = captureDbScope();
    if (typeof window !== "undefined") {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = window.setTimeout(() => {
        if (closedRef.current) return;
        const p = capturePosition() ?? pos;
        if (p) {
          latestPositionRef.current = p;
          void saveBookPosition(p, scope);
        }
      }, 400);
    }
  }, [capturePosition]);

  // Guardado inmediato de posición
  const saveImmediate = useCallback(
    async (overrideScope?: DbScope) => {
      const scope = overrideScope ?? captureDbScope();
      const pos = capturePosition();
      if (pos) {
        latestPositionRef.current = pos;
        await saveBookPosition(pos, scope);
      }
    },
    [capturePosition],
  );

  // Carga de posición guardada desde IndexedDB
  const loadSavedPosition = useCallback(
    async (scope?: DbScope): Promise<SavedBookPosition | null> => {
      const targetScope = scope ?? captureDbScope();
      return loadBookPosition(bookHash, targetScope);
    },
    [bookHash],
  );

  // Guardado de la última posición conocida, sin volver a medir el DOM.
  //
  // Al cerrar el libro con «atrás» del navegador, el historial restaura el
  // scroll de la estantería (0) antes de que corra el cierre: medir en ese
  // instante guardaba el principio del capítulo encima del punto leído. La
  // ref ya trae lo último que se capturó con el libro a la vista.
  const saveLatest = useCallback(
    async (overrideScope?: DbScope) => {
      // El cierre manda: se descarta el guardado perezoso que estuviera en
      // cola para que no escriba una medición posterior (scroll a 0 del
      // documento cuando el libro sale de la pantalla).
      if (typeof window !== "undefined") {
        window.clearTimeout(scrollTimer.current);
      }
      const pos = latestPositionRef.current ?? capturePosition();
      if (!pos) return;
      closedRef.current = true;
      await saveBookPosition({ ...pos, updatedAt: Date.now() }, overrideScope ?? captureDbScope());
    },
    [capturePosition],
  );

  // Guardado al desmontar o cambiar de libro.
  //
  // Las dependencias de este efecto son sólo `bookHash`: con las funciones
  // dentro (que cambian de identidad en cada render del lector) la limpieza
  // se reprogramaba en cada render y escribía la posición en IndexedDB
  // cientos de veces por segundo. Verificado en el arnés e2e.
  const latestReady = useRef({ ready: isReady });
  useEffect(() => {
    latestReady.current = { ready: isReady };
  });
  useEffect(() => {
    closedRef.current = false;
  }, [bookHash]);

  const saveLatestRef = useRef(saveLatest);
  useEffect(() => {
    saveLatestRef.current = saveLatest;
  });
  const closeActivityRef = useRef(closeActivity);
  useEffect(() => {
    closeActivityRef.current = closeActivity;
  });

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.clearTimeout(scrollTimer.current);
      }
      closeActivityRef.current();
      if (!latestReady.current.ready || closedRef.current) return;
      void saveLatestRef.current();
    };
  }, [bookHash]);

  return {
    latestPositionRef,
    latestPosition: latestPositionRef,
    activityRef,
    noteActivity,
    closeActivity,
    saveSoon,
    saveImmediate,
    saveLatest,
    loadSavedPosition,
  };
}
