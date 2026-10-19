import { describe, expect, it } from "vitest";
import {
  dayKeyOf,
  formatDuration,
  mergeIntervals,
  msByBook,
  timeByDay,
  totalMs,
  computeFlowStateSummary,
  flowStateSummary,
} from "./reading-activity";
import type { ReadingEvent, SavedInterval } from "./idb";
import {
  DEFAULT_FOCUS_TELEMETRY_PROFILE,
  type UserFocusTelemetryProfile,
} from "./focus-telemetry";

const MIN = 60_000;
const HOUR = 3_600_000;
const UTC = "UTC";
const CDMX = "America/Mexico_City"; // UTC-6 fijo (sin horario de verano)

const interval = (start: number, end: number) => ({ startedAt: start, endedAt: end });

describe("mergeIntervals", () => {
  it("une solapados y pegados, conserva los aislados", () => {
    const merged = mergeIntervals([
      interval(100, 200),
      interval(150, 300), // solapa → 100–300
      interval(300, 350), // toca → 100–350
      interval(1000, 1100), // aislado
    ]);
    expect(merged).toEqual([interval(100, 350), interval(1000, 1100)]);
  });

  it("descarta intervalos vacíos o invertidos", () => {
    expect(mergeIntervals([interval(100, 100), interval(200, 100)])).toEqual([]);
  });

  it("el duplicado exacto suma una sola vez", () => {
    const merged = mergeIntervals([interval(0, 500), interval(0, 500)]);
    expect(merged).toEqual([interval(0, 500)]);
  });
});

describe("totalMs", () => {
  it("no cuenta dos veces el tiempo solapado", () => {
    // 0–10 min y 5–15 min unidos = 15 min, no 20.
    expect(totalMs([interval(0, 10 * MIN), interval(5 * MIN, 15 * MIN)])).toBe(15 * MIN);
  });
});

describe("dayKeyOf", () => {
  it("usa el reloj local de la zona, no UTC", () => {
    // 2025-06-10 05:30 UTC = 2025-06-09 23:30 en Ciudad de México.
    const ts = Date.UTC(2025, 5, 10, 5, 30);
    expect(dayKeyOf(ts, UTC)).toBe("2025-06-10");
    expect(dayKeyOf(ts, CDMX)).toBe("2025-06-09");
  });
});

describe("timeByDay", () => {
  it("reparte a medianoche UTC un intervalo que cruza días", () => {
    const start = Date.UTC(2025, 5, 21, 23, 30);
    const end = Date.UTC(2025, 5, 22, 0, 30);
    expect(timeByDay([interval(start, end)], UTC)).toEqual([
      { dayKey: "2025-06-21", ms: 30 * MIN },
      { dayKey: "2025-06-22", ms: 30 * MIN },
    ]);
  });

  it("reparte por medianoche local aunque en UTC sea el mismo día", () => {
    // 05:30–06:30 UTC del 10 jun = 23:30 jun 9 → 00:30 jun 10 en CDMX.
    const start = Date.UTC(2025, 5, 10, 5, 30);
    const end = Date.UTC(2025, 5, 10, 6, 30);
    expect(timeByDay([interval(start, end)], CDMX)).toEqual([
      { dayKey: "2025-06-09", ms: 30 * MIN },
      { dayKey: "2025-06-10", ms: 30 * MIN },
    ]);
  });

  it("un mismo día UTC cae entero en un solo día Kiritimati (UTC+14)", () => {
    // 10:00–11:00 UTC del 10 jun = 00:00–01:00 del 11 jun en Kiritimati.
    const start = Date.UTC(2025, 5, 10, 10, 0);
    const end = start + HOUR;
    expect(timeByDay([interval(start, end)], "Pacific/Kiritimati")).toEqual([
      { dayKey: "2025-06-11", ms: HOUR },
    ]);
  });

  it("solapados del mismo día no duplican minutos", () => {
    const base = Date.UTC(2025, 5, 15, 9, 0);
    const days = timeByDay(
      [interval(base, base + 60 * MIN), interval(base + 30 * MIN, base + 90 * MIN)],
      UTC,
    );
    expect(days).toEqual([{ dayKey: "2025-06-15", ms: 90 * MIN }]);
  });
});

const saved = (id: string, bookHash: string, start: number, end: number): SavedInterval => ({
  id,
  bookHash,
  startedAt: start,
  endedAt: end,
});

describe("msByBook", () => {
  it("suma por libro y une solapados dentro del mismo libro", () => {
    const totals = msByBook([
      saved("a", "libro-1", 0, 10 * MIN),
      saved("b", "libro-1", 5 * MIN, 15 * MIN), // solapa con a
      saved("c", "libro-2", 0, 60 * MIN),
    ]);
    expect(totals.get("libro-1")).toBe(15 * MIN);
    expect(totals.get("libro-2")).toBe(60 * MIN);
  });
});

describe("formatDuration", () => {
  it("formatea minutos, horas y horas con minutos", () => {
    expect(formatDuration(40 * MIN)).toBe("40 min");
    expect(formatDuration(HOUR)).toBe("1 h");
    expect(formatDuration(2 * HOUR + 15 * MIN)).toBe("2 h 15 min");
    expect(formatDuration(30_000)).toBe("menos de 1 min");
  });
});

describe("checkHasInactivityGap", () => {
  it("detecta inactividad mayor a 6 horas en el libro", async () => {
    const { checkHasInactivityGap } = await import("./reading-activity");
    const now = 100_000_000;
    const sevenHoursAgo = now - 7 * HOUR;
    const intervals = [
      saved("1", "book-a", sevenHoursAgo - 30 * MIN, sevenHoursAgo),
    ];

    expect(checkHasInactivityGap(intervals, "book-a", now)).toBe(true);
  });

  it("devuelve false si el usuario leyó hace poco", async () => {
    const { checkHasInactivityGap } = await import("./reading-activity");
    const now = 100_000_000;
    const twoHoursAgo = now - 2 * HOUR;
    const intervals = [
      saved("1", "book-a", twoHoursAgo - 30 * MIN, twoHoursAgo),
    ];

    expect(checkHasInactivityGap(intervals, "book-a", now)).toBe(false);
  });

  it("devuelve false si no hay registros previos del libro", async () => {
    const { checkHasInactivityGap } = await import("./reading-activity");
    expect(checkHasInactivityGap([], "book-nuevo", Date.now())).toBe(false);
  });
});

describe("Métrica de Capítulos y Páginas en Estado de Flujo (Fase 1)", () => {
  const readingEvent = (
    partial: Partial<ReadingEvent>,
  ): ReadingEvent =>
    ({
      id: "ev-1",
      version: 1,
      visitId: "v-1",
      bookHash: "book-1",
      kind: "section_dwell",
      sectionIndex: 0,
      createdAt: 1_000_000,
      ms: 30_000,
      words: 120,
      ...partial,
    }) as ReadingEvent;

  it("devuelve un estado vacío seguro y cálido para lectores nuevos sin datos", () => {
    // 1. Invocación vacía
    const empty1 = computeFlowStateSummary();
    expect(empty1.hasEnoughData).toBe(false);
    expect(empty1.flowChaptersCount).toBe(0);
    expect(empty1.uninterruptedPagesStreak).toBe(0);
    expect(empty1.totalFlowPages).toBe(0);
    expect(empty1.comfortablePaceLabel).toBe("Calibrando con tu lectura");
    expect(empty1.paceDescriptor).toBe("Leyendo a tu propio paso");

    // 2. Invocación con objeto vacío o arrays vacíos
    const empty2 = computeFlowStateSummary({ events: [], intervals: [] });
    expect(empty2.hasEnoughData).toBe(false);
    expect(empty2.comfortablePaceLabel).toBe("Calibrando con tu lectura");
    expect(empty2.paceDescriptor).toBe("Leyendo a tu propio paso");

    // 3. flowStateSummary es alias idéntico
    expect(flowStateSummary).toBe(computeFlowStateSummary);
  });

  it("calcula FlowStateSummary a partir del perfil de telemetría de foco", () => {
    const focusProfile: UserFocusTelemetryProfile = {
      ...DEFAULT_FOCUS_TELEMETRY_PROFILE,
      paceByLang: {
        es: {
          meanSecPer100Words: 25.0, // ~240 WPM
          madSecPer100Words: 4.5,
          samples: 18,
        },
      },
    };

    const summary = computeFlowStateSummary({ focusProfile });

    expect(summary.hasEnoughData).toBe(true);
    expect(summary.totalFlowPages).toBe(18);
    expect(summary.uninterruptedPagesStreak).toBeGreaterThanOrEqual(10);
    expect(summary.flowChaptersCount).toBeGreaterThanOrEqual(2);
    // 100 / 25 * 60 = 240 WPM
    expect(summary.comfortablePaceLabel).toBe("~240 palabras/min");
    expect(summary.paceDescriptor).toBe("Ritmo sereno y constante");
  });

  it("calcula la mayor racha de páginas ininterrumpidas a partir de eventos con regresión", () => {
    const t0 = 10_000_000;
    const events: ReadingEvent[] = [
      // 4 páginas seguidas en flujo (~240 WPM cada una)
      readingEvent({ id: "e1", createdAt: t0, ms: 30_000, words: 120 }),
      readingEvent({ id: "e2", createdAt: t0 + 35_000, ms: 30_000, words: 120 }),
      readingEvent({ id: "e3", createdAt: t0 + 70_000, ms: 30_000, words: 120 }),
      readingEvent({ id: "e4", createdAt: t0 + 105_000, ms: 30_000, words: 120 }),
      // Tropiezo / retroceso de página
      readingEvent({ id: "e5", createdAt: t0 + 140_000, kind: "page_regressed" }),
      // 2 páginas después del tropiezo
      readingEvent({ id: "e6", createdAt: t0 + 175_000, ms: 30_000, words: 120 }),
      readingEvent({ id: "e7", createdAt: t0 + 210_000, ms: 30_000, words: 120 }),
    ];

    const summary = computeFlowStateSummary({ events });

    expect(summary.hasEnoughData).toBe(true);
    // Total de páginas en flujo: 4 + 2 = 6
    expect(summary.totalFlowPages).toBe(6);
    // Mayor racha antes del tropiezo: 4
    expect(summary.uninterruptedPagesStreak).toBe(4);
    // 6 * 120 palabras / 3 min = 240 WPM
    expect(summary.comfortablePaceLabel).toBe("~240 palabras/min");
    expect(summary.paceDescriptor).toBe("Ritmo sereno y constante");
  });

  it("asigna descriptores editoriales según la velocidad de lectura y rachas", () => {
    // 1. Inmersión profunda (WPM >= 260)
    const fastProfile: UserFocusTelemetryProfile = {
      ...DEFAULT_FOCUS_TELEMETRY_PROFILE,
      paceByLang: {
        es: {
          meanSecPer100Words: 20.0, // 300 WPM
          madSecPer100Words: 3.0,
          samples: 10,
        },
      },
    };
    const fastSummary = computeFlowStateSummary({ focusProfile: fastProfile });
    expect(fastSummary.paceDescriptor).toBe("Inmersión profunda");
    expect(fastSummary.comfortablePaceLabel).toBe("~300 palabras/min");

    // 2. Descubriendo tu ritmo (WPM < 180)
    const slowProfile: UserFocusTelemetryProfile = {
      ...DEFAULT_FOCUS_TELEMETRY_PROFILE,
      paceByLang: {
        es: {
          meanSecPer100Words: 45.0, // ~133 WPM
          madSecPer100Words: 8.0,
          samples: 5,
        },
      },
    };
    const slowSummary = computeFlowStateSummary({ focusProfile: slowProfile });
    expect(slowSummary.paceDescriptor).toBe("Descubriendo tu ritmo");
    expect(slowSummary.comfortablePaceLabel).toBe("~133 palabras/min");
  });
});


