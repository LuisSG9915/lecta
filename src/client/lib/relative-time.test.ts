import { describe, expect, it } from "vitest";
import {
  daysAgo,
  formatInterval,
  futureRelativeDay,
  relativeDay,
  timeAgo,
} from "./relative-time";

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

describe("futureRelativeDay", () => {
  it("hoy, mañana y pasado mañana tienen nombre propio", () => {
    expect(futureRelativeDay(NOW + 2 * 3_600_000, NOW)).toBe("hoy");
    expect(futureRelativeDay(NOW + DAY, NOW)).toBe("mañana");
    expect(futureRelativeDay(NOW + 2 * DAY, NOW)).toBe("pasado mañana");
  });

  it("cuenta días hasta una semana", () => {
    expect(futureRelativeDay(NOW + 3 * DAY, NOW)).toBe("dentro de 3 días");
    expect(futureRelativeDay(NOW + 6 * DAY, NOW)).toBe("dentro de 6 días");
  });

  it("después pasa a semanas y meses", () => {
    expect(futureRelativeDay(NOW + 9 * DAY, NOW)).toBe("la semana próxima");
    expect(futureRelativeDay(NOW + 15 * DAY, NOW)).toBe("dentro de 2 semanas");
    expect(futureRelativeDay(NOW + 40 * DAY, NOW)).toBe("el mes próximo");
    expect(futureRelativeDay(NOW + 400 * DAY, NOW)).toBe("el año próximo");
  });
});

describe("daysAgo", () => {
  it("cuenta días naturales completos sin negativos", () => {
    expect(daysAgo(NOW - 2 * 3_600_000, NOW)).toBe(0);
    expect(daysAgo(NOW - DAY, NOW)).toBe(1);
    expect(daysAgo(NOW - 3 * DAY, NOW)).toBe(3);
    expect(daysAgo(NOW + DAY, NOW)).toBe(0);
  });
});

describe("timeAgo", () => {
  it("minutos y horas del mismo día", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("hace un momento");
    expect(timeAgo(NOW - 3 * 60_000, NOW)).toBe("hace 3 min");
    expect(timeAgo(NOW - 2 * 3_600_000, NOW)).toBe("hace 2 h");
  });

  it("cruza la medianoche con relativeDay", () => {
    const dawn = new Date("2026-10-04T01:00:00").getTime();
    const beforeMidnight = new Date("2026-10-03T23:00:00").getTime();
    expect(timeAgo(beforeMidnight, dawn)).toBe("ayer");
  });
});

describe("formatInterval", () => {
  it("minutos, horas y días", () => {
    expect(formatInterval(10 * 60_000)).toBe("10 min");
    expect(formatInterval(6 * 3_600_000)).toBe("6 h");
    expect(formatInterval(4 * DAY)).toBe("4 d");
  });

  it("bordes", () => {
    expect(formatInterval(0)).toBe("ahora");
    expect(formatInterval(30 * 60_000)).toBe("30 min");
    expect(formatInterval(60 * 60_000)).toBe("1 h");
    expect(formatInterval(35 * DAY)).toBe("1 mes");
  });
});
