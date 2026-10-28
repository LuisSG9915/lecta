import {
  buildCompanionNotification,
  setLastNotificationSentAt,
  type ActiveBookContext,
  type CompanionNotificationContext,
  type NotificationPayload,
} from "./companionNotification";
import { calculateHabitWindow, type SessionInput } from "./habitWindow";

export interface ScheduleHabitOptions {
  sessions?: SessionInput[];
  companion?: CompanionNotificationContext;
  optInDaily?: boolean;
  timeZone?: string;
  nowMs?: number;
  storage?: Storage;
}

export async function updateAppBadge(isEligible: boolean): Promise<void> {
  if (typeof navigator === "undefined") return;
  try {
    if (isEligible) {
      if ("setAppBadge" in navigator && typeof navigator.setAppBadge === "function") {
        await navigator.setAppBadge(1);
      }
    } else {
      if ("clearAppBadge" in navigator && typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
      }
    }
  } catch {
    // Ignore badge API errors across browsers
  }
}

export function evaluateHabitReminder(
  activeBook: ActiveBookContext | null = null,
  options: ScheduleHabitOptions = {},
): {
  eligible: boolean;
  habitTimeFormatted: string;
  payload?: NotificationPayload;
} {
  const habit = calculateHabitWindow(options.sessions ?? [], options.timeZone);
  const check = buildCompanionNotification(
    activeBook,
    options.companion ?? {},
    {
      nowMs: options.nowMs,
      optInDaily: options.optInDaily,
      storage: options.storage,
    },
  );

  return {
    eligible: check.eligible,
    habitTimeFormatted: habit.formattedTime,
    payload: check.payload,
  };
}

export async function scheduleHabitReminder(
  activeBook: ActiveBookContext | null = null,
  options: ScheduleHabitOptions = {},
): Promise<{ scheduled: boolean; habitTimeFormatted: string; payload?: NotificationPayload }> {
  const evaluated = evaluateHabitReminder(activeBook, options);

  // 1. Manejo silencioso de App Badge (Fase 4)
  await updateAppBadge(evaluated.eligible);

  if (!evaluated.eligible || !evaluated.payload) {
    return { scheduled: false, habitTimeFormatted: evaluated.habitTimeFormatted };
  }

  // 2. Registrar periodicSync si el navegador lo soporta
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ("periodicSync" in reg) {
        const periodic = (
          reg as unknown as {
            periodicSync: {
              register: (tag: string, opts: { minInterval: number }) => Promise<void>;
            };
          }
        ).periodicSync;
        await periodic.register("lecta-habit-reminder", {
          minInterval: 24 * 3600 * 1000,
        });
      }
    } catch {
      // Periodic sync no disponible o sin permiso
    }
  }

  return {
    scheduled: true,
    habitTimeFormatted: evaluated.habitTimeFormatted,
    payload: evaluated.payload,
  };
}

export async function triggerHabitNotificationIfEligible(
  activeBook: ActiveBookContext | null = null,
  options: ScheduleHabitOptions = {},
): Promise<boolean> {
  const evaluated = evaluateHabitReminder(activeBook, options);
  await updateAppBadge(evaluated.eligible);

  if (!evaluated.eligible || !evaluated.payload) {
    return false;
  }

  // Delegar la presentación de notificación al Service Worker para respetar
  // la arquitectura offline-first y M4-sin-push en el cliente principal.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage({
          type: "POST_HABIT_NOTIFICATION",
          payload: evaluated.payload,
        });
        setLastNotificationSentAt(options.nowMs ?? Date.now(), options.storage);
        return true;
      }
    } catch {
      // Fallback
    }
  }

  return false;
}
