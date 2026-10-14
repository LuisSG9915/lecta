export type DeepReadingDuration = 15 | 20 | 30 | 45 | 0;

export interface DeepReadingConfig {
  durationMinutes: DeepReadingDuration;
  fullscreen: boolean;
  keepScreenAwake: boolean;
}

export interface DeepReadingState {
  active: boolean;
  targetMinutes: DeepReadingDuration;
  startedAt: number;
  targetEndedAt: number | null; // null si es libre (0 min)
  elapsedMs: number;
  initialSectionIndex: number;
  sectionsRead: number;
  wordsRead: number;
}

export interface DeepReadingSummary {
  durationMinutes: number;
  targetMinutes: DeepReadingDuration;
  sectionsRead: number;
  completedNaturally: boolean;
  wordsAssimilated?: number;
  coverageDeltaPercent?: number;
  bookCoveragePercent?: number;
}

/**
 * Solicita mantener la pantalla encendida (Screen Wake Lock API).
 */
export async function requestScreenWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

/**
 * Libera el bloqueo de pantalla si estaba activo.
 */
export async function releaseScreenWakeLock(
  sentinel: WakeLockSentinel | null,
): Promise<void> {
  if (!sentinel) return;
  try {
    await sentinel.release();
  } catch {
    // Ignorar si ya fue liberado
  }
}

export { toggleFullscreen } from "./fullscreen";

/**
 * Formatea el tiempo restante para sesiones con meta (ej. "14:25").
 */
export function formatRemainingTime(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Formatea el tiempo transcurrido para sesiones libres o resúmenes (ej. "12 min").
 */
export function formatElapsedMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

export type HapticType = "selection" | "light" | "success" | "warning";

/**
 * Emite una vibración háptica sutil si el dispositivo lo soporta.
 */
export function triggerHaptic(type: HapticType = "light"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) {
    return;
  }
  try {
    if (type === "success") {
      navigator.vibrate([15, 60, 15]);
    } else if (type === "warning") {
      navigator.vibrate([30, 40, 30]);
    } else if (type === "selection") {
      navigator.vibrate(8);
    } else {
      navigator.vibrate(12);
    }
  } catch {
    // Ignorar si el navegador bloquea la vibración
  }
}

