import { describe, expect, it } from "vitest";
import {
  DAY_GOAL_MS,
  MAX_STREAK_SHIELDS,
  consumeStreakShield,
  evaluateStreakProtection,
  grantStreakShield,
  parseReadingGoal,
  serializeReadingGoal,
  weekStartKey,
  weeklyGoalProgress,
} from "./reading-goal";

const NY = "America/New_York";
const UTC = "UTC";

const at = (iso: string) => new Date(iso).getTime();
const span = (startIso: string, endIso: string) => ({
  startedAt: at(startIso),
  endedAt: at(endIso),
});

describe("weekStartKey", () => {
  it("la semana arranca en lunes", () => {
    // Miércoles 2025-03-12 en Nueva York → lunes 2025-03-10.
    expect(weekStartKey(at("2025-03-12T15:00:00-04:00"), NY)).toBe("2025-03-10");
  });

  it("el domingo pertenece a la semana que abrió el lunes", () => {
    expect(weekStartKey(at("2025-03-16T20:00:00-04:00"), NY)).toBe("2025-03-10");
  });

  it("el lunes abre su propia semana", () => {
    expect(weekStartKey(at("2025-03-17T08:00:00-04:00"), NY)).toBe("2025-03-17");
  });

  it("una semana que cruza el año devuelve el lunes del año anterior", () => {
    // Jueves 2025-01-02 → lunes 2024-12-30.
    expect(weekStartKey(at("2025-01-02T12:00:00-05:00"), NY)).toBe("2024-12-30");
  });

  it("el mismo instante puede pertenecer a semanas distintas según la zona", () => {
    // Lunes 00:30 en UTC = domingo 19:30 del día anterior en Nueva York.
    const instant = at("2025-03-17T00:30:00Z");
    expect(weekStartKey(instant, UTC)).toBe("2025-03-17");
    expect(weekStartKey(instant, NY)).toBe("2025-03-10");
  });
});

describe("weeklyGoalProgress", () => {
  const now = at("2025-03-12T15:00:00-04:00"); // miércoles

  it("un día con 59 s no cuenta; con 60 s sí", () => {
    const intervals = [
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:00:59-04:00"),
      span("2025-03-11T10:00:00-04:00", "2025-03-11T10:01:00-04:00"),
    ];
    const progress = weeklyGoalProgress(intervals, now, NY, 2);
    expect(progress.readDays).toBe(1);
    expect(progress.met).toBe(false);
    expect(progress.days[0]).toEqual({ dayKey: "2025-03-10", read: false });
    expect(progress.days[1]).toEqual({ dayKey: "2025-03-11", read: true });
  });

  it("intervalos solapados o duplicados cuentan una sola vez", () => {
    const intervals = [
      // Dos bloques de 40 s solapados = 40 s reales, no 80.
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:00:40-04:00"),
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:00:40-04:00"),
    ];
    expect(weeklyGoalProgress(intervals, now, NY, 7).readDays).toBe(0);
  });

  it("dos libros en paralelo no duplican el tiempo del día", () => {
    const intervals = [
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:00:40-04:00"),
      // Otro libro, mismo rato: el tiempo de pared sigue siendo 40 s.
      span("2025-03-10T10:00:10-04:00", "2025-03-10T10:00:50-04:00"),
    ];
    expect(weeklyGoalProgress(intervals, now, NY, 7).readDays).toBe(0);
  });

  it("un intervalo que cruza medianoche reparte a ambos días", () => {
    const intervals = [
      // 60 s antes y 60 s después de la medianoche lunes→martes.
      span("2025-03-10T23:59:00-04:00", "2025-03-11T00:01:00-04:00"),
    ];
    const progress = weeklyGoalProgress(intervals, now, NY, 2);
    expect(progress.readDays).toBe(2);
    expect(progress.met).toBe(true);
  });

  it("el cambio de horario de verano no descuadra el lunes", () => {
    // En Nueva York el 2025-03-09 (domingo) saltó 02:00→03:00.
    const sunday = at("2025-03-09T20:00:00-04:00");
    expect(weekStartKey(sunday, NY)).toBe("2025-03-03");
    const intervals = [
      // 90 s el domingo del brinco, contados con el reloj movido.
      span("2025-03-09T01:30:00-05:00", "2025-03-09T03:00:30-04:00"),
    ];
    const progress = weeklyGoalProgress(intervals, sunday, NY, 1);
    expect(progress.readDays).toBe(1);
    expect(progress.days[6]).toEqual({ dayKey: "2025-03-09", read: true });
    expect(progress.met).toBe(true);
  });

  it("solo cuenta la semana en curso y sin días futuros", () => {
    const intervals = [
      // Lunes de la semana anterior: fuera.
      span("2025-03-03T10:00:00-05:00", "2025-03-03T10:02:00-05:00"),
      // Jueves (futuro respecto al miércoles actual): fuera.
      span("2025-03-13T10:00:00-04:00", "2025-03-13T10:02:00-04:00"),
      // Este lunes: dentro.
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:02:00-04:00"),
    ];
    const progress = weeklyGoalProgress(intervals, now, NY, 7);
    expect(progress.readDays).toBe(1);
  });

  it("los intervalos que llegaron por sync cuentan igual que los locales", () => {
    const intervals = [
      // «Remoto»: leído en otro dispositivo este martes.
      span("2025-03-11T09:00:00-04:00", "2025-03-11T09:05:00-04:00"),
      span("2025-03-12T09:00:00-04:00", "2025-03-12T09:05:00-04:00"),
    ];
    const progress = weeklyGoalProgress(intervals, now, NY, 2);
    expect(progress.readDays).toBe(2);
    expect(progress.met).toBe(true);
  });

  it("readDays nunca excede los días transcurridos de la semana", () => {
    const monday = at("2025-03-10T20:00:00-04:00");
    const intervals = [
      span("2025-03-10T10:00:00-04:00", "2025-03-10T10:02:00-04:00"),
      span("2025-03-11T10:00:00-04:00", "2025-03-11T10:02:00-04:00"),
      span("2025-03-16T10:00:00-04:00", "2025-03-16T10:02:00-04:00"), // futuro
    ];
    const progress = weeklyGoalProgress(intervals, monday, NY, 7);
    expect(progress.readDays).toBe(1);
    expect(progress.days).toHaveLength(7);
  });

  it("startKey/endKey devuelven lunes y domingo de la semana", () => {
    const progress = weeklyGoalProgress([], now, NY, 3);
    expect(progress.startKey).toBe("2025-03-10");
    expect(progress.endKey).toBe("2025-03-16");
    expect(progress.target).toBe(3);
  });

  it("el umbral de día es de 60 s aunque el registro mínimo sea 5 s", () => {
    expect(DAY_GOAL_MS).toBe(60_000);
  });
});

describe("parseReadingGoal / serializeReadingGoal", () => {
  it("acepta null, 1 y 7", () => {
    expect(parseReadingGoal(serializeReadingGoal(null))?.daysPerWeek).toBeNull();
    expect(parseReadingGoal(serializeReadingGoal(1))?.daysPerWeek).toBe(1);
    expect(parseReadingGoal(serializeReadingGoal(7))?.daysPerWeek).toBe(7);
  });

  it("rechaza metas fuera de rango o malformadas", () => {
    for (const bad of [
      '{"version":1,"daysPerWeek":0,"updatedAt":1}',
      '{"version":1,"daysPerWeek":8,"updatedAt":1}',
      '{"version":1,"daysPerWeek":1.5,"updatedAt":1}',
      '{"version":1,"daysPerWeek":"3","updatedAt":1}',
      '{"version":2,"daysPerWeek":3,"updatedAt":1}',
      "no-json",
      "",
      null,
      undefined,
    ]) {
      expect(parseReadingGoal(bad)).toBeNull();
    }
  });

  it("conserva updatedAt para el arbitraje de la migración", () => {
    const raw = serializeReadingGoal(4, 1_700_000_000_000);
    expect(parseReadingGoal(raw)?.updatedAt).toBe(1_700_000_000_000);
  });

  it("parsea y serializa streakShields correctamente y respeta MAX_STREAK_SHIELDS", () => {
    expect(MAX_STREAK_SHIELDS).toBe(2);
    const raw = serializeReadingGoal(3, 1000, 2, "2026-03-09");
    const parsed = parseReadingGoal(raw);
    expect(parsed?.streakShields).toBe(2);
    expect(parsed?.lastShieldUsedDay).toBe("2026-03-09");
  });
});

describe("Escudo de Ronroneo (Streak Shields)", () => {
  it("grantStreakShield añade escudos hasta el máximo de 2", () => {
    const goal = parseReadingGoal(serializeReadingGoal(3));
    const withOne = grantStreakShield(goal, 1);
    expect(withOne.streakShields).toBe(1);

    const withTwo = grantStreakShield(withOne, 1);
    expect(withTwo.streakShields).toBe(2);

    // No debe superar MAX_STREAK_SHIELDS (2)
    const withThree = grantStreakShield(withTwo, 1);
    expect(withThree.streakShields).toBe(2);
  });

  it("consumeStreakShield reduce los escudos y marca el día protegido", () => {
    const goal = grantStreakShield(null, 2);
    const { goal: afterUse, consumed } = consumeStreakShield(goal, "2026-03-09");
    expect(consumed).toBe(true);
    expect(afterUse.streakShields).toBe(1);
    expect(afterUse.lastShieldUsedDay).toBe("2026-03-09");

    const { goal: afterEmpty, consumed: secondConsumed } = consumeStreakShield(afterUse, "2026-03-10");
    expect(secondConsumed).toBe(true);
    expect(afterEmpty.streakShields).toBe(0);

    const { consumed: failConsumed } = consumeStreakShield(afterEmpty, "2026-03-11");
    expect(failConsumed).toBe(false);
  });

  it("evaluateStreakProtection protege automáticamente el día de ayer si no hubo lectura", () => {
    const goal = grantStreakShield(null, 1);
    const readDays = new Set(["2026-03-08"]); // No leyó el 2026-03-09 (ayer), hoy es 2026-03-10
    const res = evaluateStreakProtection(goal, readDays, "2026-03-10", "2026-03-09");

    expect(res.protectedYesterday).toBe(true);
    expect(res.updatedGoal?.streakShields).toBe(0);
    expect(res.catMessage).toBe("¡Cuidé tu racha ayer mientras descansabas!");

    // Si ya fue protegido previamente, no vuelve a consumir otro escudo
    const secondEval = evaluateStreakProtection(res.updatedGoal, readDays, "2026-03-10", "2026-03-09");
    expect(secondEval.protectedYesterday).toBe(true);
    expect(secondEval.updatedGoal?.streakShields).toBe(0);
  });
});
