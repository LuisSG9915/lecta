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
// Inactividad de más de 60 segundos sin interacción tras la cual el gato duerme.
export const IDLE_SLEEPY_MS = 60_000;

export function isReaderIdleSleepy(
  tracker: FocusTracker | null,
  at: number,
  thresholdMs: number = IDLE_SLEEPY_MS,
): boolean {
  if (!tracker) return false;
  return at - tracker.lastMoveAt >= thresholdMs;
}

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

// ---------- Velocidad de lectura base (Calibración) ----------

export const BASELINE_WPM_KEY = "lecta:baseline_wpm:v1";

export function loadBaselineWpm(): number {
  if (typeof window === "undefined" || !window.localStorage) return 200;
  try {
    const raw = window.localStorage.getItem(BASELINE_WPM_KEY);
    if (raw) {
      const val = parseInt(raw, 10);
      if (Number.isFinite(val) && val > 0) return val;
    }
  } catch {
    // fallback
  }
  return 200;
}

export function saveBaselineWpm(wpm: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(BASELINE_WPM_KEY, Math.round(wpm).toString());
  } catch {
    // ignorar error de quota
  }
}

// ---------- Detección de pasaje denso (bloqueo / stall) ----------

export const DENSE_STALL_MULTIPLIER = 2.2;
export const DENSE_STALL_COOLDOWN_MS = 60_000;
export const DENSE_STALL_MAX_IDLE_MS = 30_000;
export const DENSE_STALL_MIN_PAGE_WORDS = 30;

export interface DenseStallDetector {
  pageEnteredAt: number;
  lastFlaggedAt: number;
}

export function newDenseStallDetector(now: number): DenseStallDetector {
  return { pageEnteredAt: now, lastFlaggedAt: 0 };
}

export function resetDenseStallPage(
  detector: DenseStallDetector,
  now: number,
): void {
  detector.pageEnteredAt = now;
}

export function detectDensePassageStall(
  detector: DenseStallDetector,
  at: number,
  pageWords: number,
  baselineWpm: number,
  lastActivityAt: number,
): boolean {
  if (pageWords < DENSE_STALL_MIN_PAGE_WORDS) return false;
  const effectiveWpm = baselineWpm > 0 ? baselineWpm : 200;

  const dwellMs = at - detector.pageEnteredAt;
  const expectedMs = (pageWords / effectiveWpm) * 60_000;
  const thresholdMs = expectedMs * DENSE_STALL_MULTIPLIER;

  if (dwellMs < thresholdMs) return false;

  // Si no hubo actividad reciente (cursor/scroll), el usuario dejó la pestaña abandonada
  if (at - lastActivityAt > DENSE_STALL_MAX_IDLE_MS) return false;

  // Enfriamiento entre avisos
  if (
    detector.lastFlaggedAt &&
    at - detector.lastFlaggedAt < DENSE_STALL_COOLDOWN_MS
  ) {
    return false;
  }

  detector.lastFlaggedAt = at;
  return true;
}

// ---------- Telemetría Adaptativa de Fatiga y Aprendizaje de Foco ----------

export type FocusAidType = "paragraph-focus" | "syntactic-lines" | "focus-ruler";

export interface LanguagePaceBaseline {
  /** Segundos promedio por cada 100 palabras en este idioma */
  meanSecPer100Words: number;
  /** Desviación media en segundos por cada 100 palabras */
  madSecPer100Words: number;
  samples: number;
}

export interface UserFocusTelemetryProfile {
  /** Si es false, el usuario desactivó las sugerencias de neuro-foco (Cero Fricción) */
  autoSuggestEnabled: boolean;
  /** IDs de libros donde el usuario silenció las sugerencias */
  mutedBookIds: string[];
  /** Ritmo base aprendido por idioma (ej. 'es' vs 'en') */
  paceByLang: Record<string, LanguagePaceBaseline>;
  /** Pesos de eficacia aprendidos para cada herramienta según la respuesta del usuario */
  aidEfficacyWeights: Record<FocusAidType, number>;
}

export interface PageTurnTelemetryInput {
  bookId?: string;
  lang: string;
  wordCountOnPage: number;
  dwellTimeMs: number;
  direction: "forward" | "backward";
  sessionMinutesElapsed: number;
  recentBackwardCountInWindow: number;
}

export interface FatigueEvaluationResult {
  fatigueIndex: number; // 0.0 a 1.0
  isFatigued: boolean;
  reason: "none" | "stall" | "regressions" | "sustained-load";
  recommendedAid: FocusAidType;
  updatedProfile: UserFocusTelemetryProfile;
}

export const DEFAULT_FOCUS_TELEMETRY_PROFILE: UserFocusTelemetryProfile = {
  autoSuggestEnabled: true,
  mutedBookIds: [],
  paceByLang: {},
  aidEfficacyWeights: {
    "paragraph-focus": 1.0,
    "syntactic-lines": 1.0,
    "focus-ruler": 0.9,
  },
};

export function logistic(x: number): number {
  const clamped = Math.max(-10, Math.min(10, x));
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Evalúa la telemetría al cambiar de página, actualiza la línea base personal en ese idioma
 * y determina si el lector presenta fatiga o pérdida de concentración.
 */
export function evaluateReadingFatigue(
  profile: UserFocusTelemetryProfile,
  input: PageTurnTelemetryInput,
  isForeignLanguage = false,
): FatigueEvaluationResult {
  const langKey = (input.lang || "es").slice(0, 2).toLowerCase();
  const defaultMean = isForeignLanguage ? 34.0 : 22.0; // ~175 WPM en L2 vs ~270 WPM en L1
  const currentBaseline: LanguagePaceBaseline = profile.paceByLang[langKey] ?? {
    meanSecPer100Words: defaultMean,
    madSecPer100Words: 6.5,
    samples: 0,
  };

  const words = Math.max(15, input.wordCountOnPage);
  const dwellSec = Math.max(1, input.dwellTimeMs / 1000);
  const secPer100Words = (dwellSec / words) * 100;

  // 1. Calcular anomalía de estancamiento (Z_stall) respecto al ritmo del propio lector
  const spread = Math.max(4.0, currentBaseline.madSecPer100Words);
  const zStall =
    input.direction === "forward" &&
    secPer100Words > currentBaseline.meanSecPer100Words
      ? Math.min(
          4.0,
          (secPer100Words - currentBaseline.meanSecPer100Words) / spread,
        )
      : 0;

  // 2. Detectar "Zoning Out" (paso ultrarrápido seguido de retroceso)
  const regressionsSignal =
    input.direction === "backward"
      ? input.recentBackwardCountInWindow + 0.6
      : input.recentBackwardCountInWindow;

  // 3. Factor de duración de sesión
  const sessionLoad = Math.log(
    1 + Math.max(0, input.sessionMinutesElapsed) / 25,
  );

  // 4. Índice de Fatiga Cognitiva F_t
  const rawLogit =
    -2.2 + 0.85 * zStall + 1.15 * regressionsSignal + 0.45 * sessionLoad;
  const fatigueIndex = Number(logistic(rawLogit).toFixed(4));

  // 5. Actualizar la línea base personal SOLO en lecturas fluidas normales (sin atasco extremo ni salto vacío)
  let nextBaseline = currentBaseline;
  if (
    input.direction === "forward" &&
    secPer100Words >= 8 &&
    secPer100Words <= 90 &&
    zStall < 2.2
  ) {
    const alpha = currentBaseline.samples < 10 ? 0.25 : 0.08;
    const nextMean =
      (1 - alpha) * currentBaseline.meanSecPer100Words +
      alpha * secPer100Words;
    const absDiff = Math.abs(
      secPer100Words - currentBaseline.meanSecPer100Words,
    );
    const nextMad =
      (1 - alpha) * currentBaseline.madSecPer100Words + alpha * absDiff;

    nextBaseline = {
      meanSecPer100Words: Number(nextMean.toFixed(2)),
      madSecPer100Words: Number(Math.max(3.0, nextMad).toFixed(2)),
      samples: currentBaseline.samples + 1,
    };
  }

  // 6. Seleccionar la mejor herramienta aprendida del usuario (con preferencia contextual L2)
  const weights = { ...profile.aidEfficacyWeights };
  if (isForeignLanguage) {
    weights["syntactic-lines"] += 0.25; // En otros idiomas, la cadencia sintáctica ayuda más
  }

  const recommendedAid = (
    Object.entries(weights) as Array<[FocusAidType, number]>
  ).sort((a, b) => b[1] - a[1])[0][0];

  const isMutedForBook = Boolean(
    input.bookId && profile.mutedBookIds.includes(input.bookId),
  );
  const isFatigued =
    profile.autoSuggestEnabled && !isMutedForBook && fatigueIndex >= 0.68;

  let reason: FatigueEvaluationResult["reason"] = "none";
  if (isFatigued) {
    if (regressionsSignal >= 1.5) reason = "regressions";
    else if (zStall >= 1.6) reason = "stall";
    else reason = "sustained-load";
  }

  return {
    fatigueIndex,
    isFatigued,
    reason,
    recommendedAid,
    updatedProfile: {
      ...profile,
      paceByLang: {
        ...profile.paceByLang,
        [langKey]: nextBaseline,
      },
    },
  };
}

/**
 * Actualiza los pesos del modelo cuando el usuario utiliza una herramienta de foco:
 * - Si recuperó su fluidez (recoveredFlow = true), premia esa herramienta.
 * - Si la desactivó enseguida (recoveredFlow = false), reduce su prioridad para no insistir.
 */
export function recordFocusAidOutcome(
  profile: UserFocusTelemetryProfile,
  aid: FocusAidType,
  recoveredFlow: boolean,
): UserFocusTelemetryProfile {
  const currentWeight = profile.aidEfficacyWeights[aid] ?? 1.0;
  const reward = recoveredFlow ? 1.5 : 0.4;
  const nextWeight = Math.max(
    0.2,
    Math.min(2.5, 0.8 * currentWeight + 0.2 * reward),
  );

  return {
    ...profile,
    aidEfficacyWeights: {
      ...profile.aidEfficacyWeights,
      [aid]: Number(nextWeight.toFixed(3)),
    },
  };
}

/**
 * Silencia las sugerencias de foco para un libro específico.
 */
export function muteBookFocusSuggestions(
  profile: UserFocusTelemetryProfile,
  bookId: string,
): UserFocusTelemetryProfile {
  if (profile.mutedBookIds.includes(bookId)) return profile;
  return {
    ...profile,
    mutedBookIds: [...profile.mutedBookIds, bookId],
  };
}

/**
 * Reactiva las sugerencias de foco para un libro específico.
 */
export function unmuteBookFocusSuggestions(
  profile: UserFocusTelemetryProfile,
  bookId: string,
): UserFocusTelemetryProfile {
  if (!profile.mutedBookIds.includes(bookId)) return profile;
  return {
    ...profile,
    mutedBookIds: profile.mutedBookIds.filter((id) => id !== bookId),
  };
}

/**
 * Comprueba si las sugerencias de foco están silenciadas globalmente o para el libro indicado.
 */
export function isFocusSuggestionMuted(
  profile: UserFocusTelemetryProfile,
  bookId?: string,
): boolean {
  if (!profile.autoSuggestEnabled) return true;
  if (bookId && profile.mutedBookIds.includes(bookId)) return true;
  return false;
}

/**
 * Activa o desactiva globalmente las sugerencias automáticas de neuro-foco.
 */
export function setFocusAutoSuggestEnabled(
  profile: UserFocusTelemetryProfile,
  enabled: boolean,
): UserFocusTelemetryProfile {
  return {
    ...profile,
    autoSuggestEnabled: enabled,
  };
}

// ---------- Persistencia local del perfil de neuro-foco ----------

export const FOCUS_TELEMETRY_PROFILE_KEY = "lecta:focus_telemetry_profile:v1";

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && (globalThis as { localStorage?: Storage }).localStorage) {
    return (globalThis as { localStorage: Storage }).localStorage;
  }
  return null;
}

export function loadFocusTelemetryProfile(): UserFocusTelemetryProfile {
  const storage = getStorage();
  if (!storage) {
    return { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
  }
  try {
    const raw = storage.getItem(FOCUS_TELEMETRY_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        autoSuggestEnabled:
          typeof parsed.autoSuggestEnabled === "boolean"
            ? parsed.autoSuggestEnabled
            : true,
        mutedBookIds: Array.isArray(parsed.mutedBookIds)
          ? parsed.mutedBookIds
          : [],
        paceByLang:
          parsed.paceByLang && typeof parsed.paceByLang === "object"
            ? parsed.paceByLang
            : {},
        aidEfficacyWeights: {
          ...DEFAULT_FOCUS_TELEMETRY_PROFILE.aidEfficacyWeights,
          ...(parsed.aidEfficacyWeights || {}),
        },
      };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
}

export function saveFocusTelemetryProfile(
  profile: UserFocusTelemetryProfile,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      FOCUS_TELEMETRY_PROFILE_KEY,
      JSON.stringify(profile),
    );
  } catch {
    // ignorar quota error
  }
}

export class FocusTelemetry {
  private pageTurns = 0;
  private lastTurnAt = Date.now();
  private regressions = 0;

  recordPageTurn(isBack = false): boolean {
    const now = Date.now();
    const dt = now - this.lastTurnAt;
    this.lastTurnAt = now;
    this.pageTurns++;
    if (isBack) {
      this.regressions++;
    }
    if (this.pageTurns >= 3 && (dt > 40_000 || this.regressions >= 2)) {
      this.regressions = 0;
      return true;
    }
    return false;
  }
}

