import { describe, expect, it } from "vitest";
import {
  dayKeyOf,
  formatDuration,
  mergeIntervals,
  msByBook,
  timeByDay,
  totalMs,
} from "./reading-activity";
import type { SavedInterval } from "./idb";

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

