import { generateZeroSpoilerSceneRecap } from "./page-recap";
import { formatSceneRecapOneLine } from "../components/ResumeSessionOverlay";

export interface ActiveBookContext {
  bookHash: string;
  title?: string;
  lastOpenedTimestampMs: number;
  textBeforeCursor?: string;
}

export interface CompanionNotificationContext {
  streakShieldUsedRecently?: boolean;
}

export interface NotificationPayload {
  title: string;
  body: string;
  subtitle?: string;
  recapLine: string;
  bookHash: string;
  tag?: string;
}

export interface BuildNotificationOptions {
  nowMs?: number;
  daysThreshold?: number; // Por defecto 2 días
  optInDaily?: boolean; // false = máximo 1 cada 7 días; true = 1 al día
  storage?: Storage;
}

export type NotificationEligibilityResult =
  | { eligible: true; reason: "ok"; payload: NotificationPayload }
  | {
      eligible: false;
      reason: "not_enough_inactivity" | "rate_limited" | "no_active_book";
      payload?: undefined;
    };

export const LAST_NOTIFICATION_SENT_KEY = "lecta_last_notification_sent_at";
export const NOTIFICATION_OPT_IN_KEY = "lecta_notification_opt_in_daily";

export const DEFAULT_INACTIVITY_DAYS = 2;
export const DEFAULT_RATE_LIMIT_MS = 7 * 24 * 3600 * 1000; // 7 días
export const DAILY_RATE_LIMIT_MS = 24 * 3600 * 1000; // 1 día

const FORBIDDEN_WORDS_REGEX = /\b(perdiste|rompiste|racha\s+rota)\b/i;

function getStorage(customStorage?: Storage): Storage | null {
  if (customStorage) return customStorage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getLastNotificationSentAt(storage?: Storage): number {
  try {
    const s = getStorage(storage);
    if (!s) return 0;
    return Number(s.getItem(LAST_NOTIFICATION_SENT_KEY) || 0);
  } catch {
    return 0;
  }
}

export function setLastNotificationSentAt(timestampMs: number, storage?: Storage): void {
  try {
    const s = getStorage(storage);
    if (!s) return;
    s.setItem(LAST_NOTIFICATION_SENT_KEY, String(timestampMs));
  } catch {
    // Ignore storage errors in private/sandboxed modes
  }
}

export function isOptInDailyReminders(storage?: Storage): boolean {
  try {
    const s = getStorage(storage);
    if (!s) return false;
    return s.getItem(NOTIFICATION_OPT_IN_KEY) === "true";
  } catch {
    return false;
  }
}

export function setOptInDailyReminders(enabled: boolean, storage?: Storage): void {
  try {
    const s = getStorage(storage);
    if (!s) return;
    s.setItem(NOTIFICATION_OPT_IN_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage errors
  }
}

/**
 * Valida estrictamente que ningún texto contenga palabras de culpa o castigo
 * como "perdiste", "rompiste" o "racha rota".
 */
export function validateZeroGuilt(text: string): boolean {
  return !FORBIDDEN_WORDS_REGEX.test(text);
}

/**
 * Evalúa y construye el mensaje "Cero Culpa" para la notificación del compañero.
 *
 * Aplica:
 * - Inactividad de N días (por defecto 2).
 * - Rate limit estricto de 7 días (a menos que optInDaily sea true).
 * - Gancho narrativo respetuoso: "El gato se quedó pensando en tu libro... 🐾".
 * - Subtítulo de alivio si el escudo cuidó la racha: "Tu escudo cuidó tu progreso, cero estrés."
 */
export function buildCompanionNotification(
  activeBook: ActiveBookContext | null | undefined,
  companion: CompanionNotificationContext = {},
  options: BuildNotificationOptions = {},
): NotificationEligibilityResult {
  if (!activeBook || !activeBook.bookHash) {
    return { eligible: false, reason: "no_active_book" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const daysThreshold = options.daysThreshold ?? DEFAULT_INACTIVITY_DAYS;
  const storage = options.storage;

  // 1. Verificación de inactividad
  const msSinceLastRead = Math.max(0, nowMs - activeBook.lastOpenedTimestampMs);
  const daysSinceLastRead = msSinceLastRead / (24 * 3600 * 1000);

  if (daysSinceLastRead < daysThreshold) {
    return { eligible: false, reason: "not_enough_inactivity" };
  }

  // 2. Verificación de Rate Limit estricto (máximo 1 cada 7 días sin opt-in)
  const isOptIn = options.optInDaily ?? isOptInDailyReminders(storage);
  const rateLimitMs = isOptIn ? DAILY_RATE_LIMIT_MS : DEFAULT_RATE_LIMIT_MS;
  const lastSent = getLastNotificationSentAt(storage);

  if (lastSent > 0 && nowMs - lastSent < rateLimitMs) {
    return { eligible: false, reason: "rate_limited" };
  }

  // 3. Construcción del contenido narrativo sin spoilers
  let recapLine = "Retomando el hilo de la historia donde lo dejaste.";
  if (activeBook.textBeforeCursor && activeBook.textBeforeCursor.trim().length > 0) {
    const recap = generateZeroSpoilerSceneRecap(
      activeBook.textBeforeCursor,
      activeBook.lastOpenedTimestampMs,
      nowMs,
    );
    recapLine = formatSceneRecapOneLine(recap);
  }

  const title = "El gato se quedó pensando en tu libro... 🐾";
  const body = `${recapLine} ¿Leemos 3 minutos?`;

  let subtitle: string | undefined;
  if (companion.streakShieldUsedRecently) {
    subtitle = "Tu escudo cuidó tu progreso, cero estrés.";
  }

  // Salvaguarda Cero Culpa
  if (!validateZeroGuilt(title) || !validateZeroGuilt(body) || (subtitle && !validateZeroGuilt(subtitle))) {
    throw new Error("[Zero-Guilt Violation] Notificación contiene palabras prohibidas de culpa.");
  }

  return {
    eligible: true,
    reason: "ok",
    payload: {
      title,
      body,
      subtitle,
      recapLine,
      bookHash: activeBook.bookHash,
      tag: `lecta-habit-${activeBook.bookHash}`,
    },
  };
}
