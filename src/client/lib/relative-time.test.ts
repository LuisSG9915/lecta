import { describe, expect, it } from "vitest";
import { relativeDay } from "./relative-time";

const NOW = new Date("2026-10-04T15:00:00").getTime();
const DAY = 86_400_000;

describe("relativeDay", () => {
  it("hoy y ayer tienen nombre propio", () => {
    expect(relativeDay(NOW - 2 * 3_600_000, NOW)).toBe("hoy");
    expect(relativeDay(NOW - DAY, NOW)).toBe("ayer");
    expect(relativeDay(NOW - DAY - 3_600_000, NOW)).toBe("ayer");
  });

  it("cuenta días hasta una semana", () => {
    expect(relativeDay(NOW - 3 * DAY, NOW)).toBe("hace 3 días");
    expect(relativeDay(NOW - 6 * DAY, NOW)).toBe("hace 6 días");
  });

  it("después pasa a semanas y meses", () => {
    expect(relativeDay(NOW - 9 * DAY, NOW)).toBe("la semana pasada");
    expect(relativeDay(NOW - 15 * DAY, NOW)).toBe("hace 2 semanas");
    expect(relativeDay(NOW - 40 * DAY, NOW)).toBe("el mes pasado");
    expect(relativeDay(NOW - 400 * DAY, NOW)).toBe("el año pasado");
  });
});
