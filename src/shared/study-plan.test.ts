import { describe, expect, it } from "vitest";
import { buildStudyPlan, STUDY_PLAN_DAILY_CAP, STUDY_PLAN_DAYS } from "./study-plan";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 12);

describe("buildStudyPlan", () => {
  it("sin datos: vacío honesto y ventana por defecto", () => {
    const plan = buildStudyPlan({ now: NOW, dueAt: [], intervals: [] });
    expect(plan.empty).toBe(true);
    expect(plan.minutesToday).toBe(0);
    expect(plan.habit).toBe("default");
    expect(plan.habitSamples).toEqual([]);
    expect(plan.days).toHaveLength(STUDY_PLAN_DAYS);
    expect(plan.next).toBeNull();
  });

  it("reparte las vencidas con tope diario y arrastra lo que sobra", () => {
    const dueAt = Array.from({ length: 60 }, () => NOW - DAY);
    const plan = buildStudyPlan({ now: NOW, dueAt, intervals: [] });
    expect(plan.days[0].reviews).toBe(STUDY_PLAN_DAILY_CAP);
    expect(plan.days[1].reviews).toBe(STUDY_PLAN_DAILY_CAP);
    expect(plan.days[2].reviews).toBe(10);
    expect(plan.days[3].reviews).toBe(0);
    expect(plan.backlog).toBe(0);
    expect(plan.empty).toBe(false);
  });

  it("lo que no cabe en la semana queda como backlog", () => {
    const plan = buildStudyPlan({ now: NOW, dueAt: Array.from({ length: 400 }, () => NOW - 1), intervals: [] });
    expect(plan.backlog).toBe(400 - STUDY_PLAN_DAILY_CAP * STUDY_PLAN_DAYS);
  });

  it("las tarjetas futuras caen en su día", () => {
    const plan = buildStudyPlan({ now: NOW, dueAt: [NOW + 2 * DAY + 1000, NOW + 2 * DAY + 2000], intervals: [] });
    expect(plan.days[2].reviews).toBe(2);
    expect(plan.days[0].reviews).toBe(0);
  });

  it("con hábito real usa el ritmo medido y las muestras", () => {
    const intervals = [1, 2, 3].map((d) => ({ startedAt: NOW - d * DAY, endedAt: NOW - d * DAY + 30 * 60000 }));
    const plan = buildStudyPlan({ now: NOW, dueAt: [], intervals });
    expect(plan.habit).toBe("observed");
    expect(plan.habitSamples).toHaveLength(3);
    expect(plan.readingMinutes).toBe(30);
    expect(plan.minutesToday).toBe(30);
  });

  it("sin hábito sugiere 15 min y deriva el siguiente capítulo", () => {
    const plan = buildStudyPlan({
      now: NOW,
      dueAt: [],
      intervals: [],
      lastPosition: { bookHash: "h", sectionIndex: 3, progress: 0.4 },
    });
    expect(plan.readingMinutes).toBe(15);
    expect(plan.next).toEqual({ bookHash: "h", sectionIndex: 4 });
    expect(plan.empty).toBe(false);
  });

  it("un libro terminado no propone siguiente capítulo", () => {
    const plan = buildStudyPlan({ now: NOW, dueAt: [], intervals: [], lastPosition: { bookHash: "h", sectionIndex: 9, progress: 100 } });
    expect(plan.next).toBeNull();
  });
});
