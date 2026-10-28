// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCompanionNotification,
  setLastNotificationSentAt,
  getLastNotificationSentAt,
  setOptInDailyReminders,
  validateZeroGuilt,
  DEFAULT_RATE_LIMIT_MS,
  type ActiveBookContext,
} from "./companionNotification";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("Generador de Mensajes Cero Culpa y Rate Limiter (companionNotification.ts - Fase 4)", () => {
  let storage: Storage;
  const now = 1_700_000_000_000;
  const twoDaysMs = 2 * 24 * 3600 * 1000;

  const activeBook: ActiveBookContext = {
    bookHash: "book-cero-culpa-1",
    title: "El Quijote",
    lastOpenedTimestampMs: now - twoDaysMs - 1000, // 2 días y un segundo de inactividad
    textBeforeCursor: "En un lugar de la Mancha de cuyo nombre no quiero acordarme...",
  };

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("CRITERIO DE ACEPTACIÓN: bloquea cualquier segundo intento dentro de la ventana de 7 días sin opt-in", () => {
    // 1. Primera notificación: debe ser elegible
    const firstCheck = buildCompanionNotification(activeBook, {}, { nowMs: now, storage });
    expect(firstCheck.eligible).toBe(true);

    // Registramos que se envió la notificación
    setLastNotificationSentAt(now, storage);
    expect(getLastNotificationSentAt(storage)).toBe(now);

    // 2. Intento al día siguiente (a las 24 horas): DEBE BLOQUEARSE
    const oneDayLater = now + 24 * 3600 * 1000;
    const blockedCheck1 = buildCompanionNotification(
      activeBook,
      {},
      { nowMs: oneDayLater, storage, optInDaily: false },
    );
    expect(blockedCheck1.eligible).toBe(false);
    expect(blockedCheck1.reason).toBe("rate_limited");

    // 3. Intento a los 6 días: DEBE BLOQUEARSE
    const sixDaysLater = now + 6 * 24 * 3600 * 1000;
    const blockedCheck2 = buildCompanionNotification(
      activeBook,
      {},
      { nowMs: sixDaysLater, storage, optInDaily: false },
    );
    expect(blockedCheck2.eligible).toBe(false);
    expect(blockedCheck2.reason).toBe("rate_limited");

    // 4. Intento cumplidos los 7 días (DEFAULT_RATE_LIMIT_MS + 1ms): VUELVE A SER ELEGIBLE
    const sevenDaysLater = now + DEFAULT_RATE_LIMIT_MS + 1000;
    const allowedCheck = buildCompanionNotification(
      activeBook,
      {},
      { nowMs: sevenDaysLater, storage, optInDaily: false },
    );
    expect(allowedCheck.eligible).toBe(true);
    expect(allowedCheck.reason).toBe("ok");
  });

  it("permite notificaciones diarias si el usuario hizo opt-in explícito a recordatorios diarios", () => {
    setOptInDailyReminders(true, storage);
    setLastNotificationSentAt(now, storage);

    // 12 horas después sigue bloqueado (menos de 24h)
    const twelveHoursLater = now + 12 * 3600 * 1000;
    const res12h = buildCompanionNotification(
      activeBook,
      {},
      { nowMs: twelveHoursLater, storage, optInDaily: true },
    );
    expect(res12h.eligible).toBe(false);
    expect(res12h.reason).toBe("rate_limited");

    // 25 horas después ya está permitido con opt-in diario
    const twentyFiveHoursLater = now + 25 * 3600 * 1000;
    const res25h = buildCompanionNotification(
      activeBook,
      {},
      { nowMs: twentyFiveHoursLater, storage, optInDaily: true },
    );
    expect(res25h.eligible).toBe(true);
  });

  it("no envía notificación si no han pasado al menos 2 días de inactividad", () => {
    const bookRecent: ActiveBookContext = {
      ...activeBook,
      lastOpenedTimestampMs: now - 24 * 3600 * 1000, // Solo 1 día de inactividad
    };

    const res = buildCompanionNotification(bookRecent, {}, { nowMs: now, storage });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("not_enough_inactivity");
  });

  it("genera el título y cuerpo cero culpa combinando el recap y la propuesta de 3 minutos", () => {
    const res = buildCompanionNotification(activeBook, {}, { nowMs: now, storage });
    expect(res.eligible).toBe(true);
    if (res.eligible) {
      expect(res.payload.title).toBe("El gato se quedó pensando en tu libro... 🐾");
      expect(res.payload.body).toContain("¿Leemos 3 minutos?");
      expect(res.payload.subtitle).toBeUndefined();
    }
  });

  it("añade el subtítulo del escudo de racha cuando estuvo activo para disipar estrés", () => {
    const res = buildCompanionNotification(
      activeBook,
      { streakShieldUsedRecently: true },
      { nowMs: now, storage },
    );
    expect(res.eligible).toBe(true);
    if (res.eligible) {
      expect(res.payload.subtitle).toBe("Tu escudo cuidó tu progreso, cero estrés.");
    }
  });

  it("prohíbe y rechaza estrictamente palabras de castigo o pérdida de racha", () => {
    expect(validateZeroGuilt("Tu escudo cuidó tu progreso")).toBe(true);
    expect(validateZeroGuilt("Perdiste tu racha de lectura")).toBe(false);
    expect(validateZeroGuilt("Rompiste el hábito diario")).toBe(false);
    expect(validateZeroGuilt("Aviso de racha rota hoy")).toBe(false);
  });
});
