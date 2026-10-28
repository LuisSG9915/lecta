// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  updateAppBadge,
  evaluateHabitReminder,
  scheduleHabitReminder,
} from "./localNotificationScheduler";
import type { ActiveBookContext } from "./companionNotification";

describe("Scheduler Local Offline-First (localNotificationScheduler.ts - Fase 4)", () => {
  const now = 1_700_000_000_000;
  const threeDaysAgo = now - 3 * 24 * 3600 * 1000;

  const activeBook: ActiveBookContext = {
    bookHash: "book-pwa-badge",
    title: "La Galatea",
    lastOpenedTimestampMs: threeDaysAgo,
    textBeforeCursor: "Cerca de las riberas del Tajo...",
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("activa y limpia el app badge silencioso (1) con navigator.setAppBadge / clearAppBadge", async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "setAppBadge", {
      value: setAppBadge,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "clearAppBadge", {
      value: clearAppBadge,
      configurable: true,
      writable: true,
    });

    await updateAppBadge(true);
    expect(setAppBadge).toHaveBeenCalledWith(1);

    await updateAppBadge(false);
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("evalúa y programa el recordatorio en la ventana de hábito calculada", async () => {
    // 3 sesiones a las 21:00 UTC
    const sessions = [
      Date.UTC(2026, 9, 1, 21, 0),
      Date.UTC(2026, 9, 2, 21, 0),
      Date.UTC(2026, 9, 3, 21, 0),
    ];

    const result = await scheduleHabitReminder(activeBook, {
      sessions,
      nowMs: now,
      timeZone: "UTC",
    });

    expect(result.scheduled).toBe(true);
    expect(result.habitTimeFormatted).toBe("21:00");
    expect(result.payload?.title).toBe("El gato se quedó pensando en tu libro... 🐾");
    expect(result.payload?.body).toContain("¿Leemos 3 minutos?");
  });

  it("no programa notificación si no se cumplen los días de inactividad", async () => {
    const bookRecent: ActiveBookContext = {
      ...activeBook,
      lastOpenedTimestampMs: now - 12 * 3600 * 1000, // 12 horas
    };

    const evaluated = evaluateHabitReminder(bookRecent, { nowMs: now });
    expect(evaluated.eligible).toBe(false);
    expect(evaluated.payload).toBeUndefined();
  });
});
