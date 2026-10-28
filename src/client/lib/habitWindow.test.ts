import { describe, it, expect } from "vitest";
import { calculateHabitWindow } from "./habitWindow";

describe("Detector de Ventana de Hábito Real (habitWindow.ts - Fase 4)", () => {
  const tz = "UTC";

  // Helper para generar timestamps UTC en una hora y minuto específicos
  function createUtcDate(year: number, month: number, day: number, hour: number, minute: number): number {
    return Date.UTC(year, month - 1, day, hour, minute);
  }

  it("devuelve la hora por defecto si no hay sesiones reales", () => {
    const result = calculateHabitWindow([], tz);
    expect(result.hasRealData).toBe(false);
    expect(result.formattedTime).toBe("21:00");
    expect(result.hour).toBe(21);
    expect(result.minute).toBe(0);
    expect(result.sampleCount).toBe(0);
  });

  it("calcula la hora mediana exacta para sesiones vespertinas/nocturnas (ej. 21:30)", () => {
    // 5 sesiones a las 21:15, 21:30, 21:30, 21:45, 22:00
    const sessions = [
      createUtcDate(2026, 10, 10, 21, 15),
      createUtcDate(2026, 10, 11, 21, 30),
      createUtcDate(2026, 10, 12, 21, 30),
      createUtcDate(2026, 10, 13, 21, 45),
      createUtcDate(2026, 10, 14, 22, 0),
    ];

    const result = calculateHabitWindow(sessions, tz);
    expect(result.hasRealData).toBe(true);
    expect(result.sampleCount).toBe(5);
    expect(result.formattedTime).toBe("21:30");
    expect(result.hour).toBe(21);
    expect(result.minute).toBe(30);
  });

  it("resuelve adecuadamente lecturas que cruzan la medianoche sin promediar al mediodía", () => {
    // Sesiones alrededor de medianoche: 23:45, 23:50, 00:10, 00:15
    const sessions = [
      createUtcDate(2026, 10, 10, 23, 45),
      createUtcDate(2026, 10, 11, 23, 50),
      createUtcDate(2026, 10, 12, 0, 10),
      createUtcDate(2026, 10, 13, 0, 15),
    ];

    const result = calculateHabitWindow(sessions, tz);
    expect(result.hasRealData).toBe(true);
    // Mediana centrada en torno a las 00:00 (medianoche)
    expect(result.hour).toBe(0);
    expect(result.minute).toBeLessThanOrEqual(5);
  });

  it("limita el análisis a un máximo de las últimas 14 sesiones", () => {
    // 10 sesiones viejas a las 08:00 de la mañana
    const oldSessions = Array.from({ length: 10 }, (_, i) =>
      createUtcDate(2026, 9, i + 1, 8, 0)
    );

    // 14 sesiones recientes a las 22:00 de la noche
    const recentSessions = Array.from({ length: 14 }, (_, i) =>
      createUtcDate(2026, 10, i + 1, 22, 0)
    );

    const allSessions = [...oldSessions, ...recentSessions];
    const result = calculateHabitWindow(allSessions, tz);

    expect(result.sampleCount).toBe(14);
    expect(result.formattedTime).toBe("22:00");
  });

  it("acepta objetos con startedAt o timestamp además de números puros", () => {
    const sessions = [
      { startedAt: createUtcDate(2026, 10, 1, 20, 0) },
      { timestamp: createUtcDate(2026, 10, 2, 20, 30) },
      createUtcDate(2026, 10, 3, 21, 0),
    ];

    const result = calculateHabitWindow(sessions, tz);
    expect(result.hasRealData).toBe(true);
    expect(result.sampleCount).toBe(3);
    expect(result.formattedTime).toBe("20:30");
  });
});
