import { describe, expect, it } from "vitest";
import { isDue, Rating, scheduleReview } from "./fsrs";

describe("scheduleReview", () => {
  it("una tarjeta nueva queda programada y no vence de inmediato si va bien", () => {
    const card = scheduleReview(undefined, Rating.Good);
    expect(card.due).toBeInstanceOf(Date);
    expect(isDue(card)).toBe(false);
  });

  it("'Otra vez' la programa en un paso corto de reaprendizaje", () => {
    const card = scheduleReview(undefined, Rating.Again);
    expect(card.due.getTime() - Date.now()).toBeLessThan(60 * 60 * 1000);
  });

  it("'Fácil' programa más lejos que 'Difícil'", () => {
    const easy = scheduleReview(undefined, Rating.Easy);
    const hard = scheduleReview(undefined, Rating.Hard);
    expect(easy.due.getTime()).toBeGreaterThan(hard.due.getTime());
  });

  it("una tarjeta que cruzó JSON repasa sin perder su historial", () => {
    // La tarjeta viaja al servidor como JSON (fechas en string ISO) y
    // vuelve igual: repasarla debe incrementar reps, no reiniciarla.
    const reviewed = scheduleReview(undefined, Rating.Good);
    const viaJson = JSON.parse(JSON.stringify(reviewed)) as typeof reviewed;
    const again = scheduleReview(viaJson, Rating.Good);

    expect(again.reps).toBe(reviewed.reps + 1);
    expect(again.stability).toBeGreaterThan(0);
    expect(again.difficulty).toBeGreaterThan(0);
    expect(again.due).toBeInstanceOf(Date);
    expect(new Date(again.last_review!).getTime()).not.toBeNaN();
  });
});

describe("Consolidación Episódica FSRS (Track 10)", () => {
  it("asigna multiplicadores neurocognitivos correctos por calificación", async () => {
    const { computeEpisodicMultiplier } = await import("./fsrs");
    expect(computeEpisodicMultiplier(Rating.Easy)).toBe(1.35);
    expect(computeEpisodicMultiplier(Rating.Good)).toBe(1.20);
    expect(computeEpisodicMultiplier(Rating.Hard)).toBe(1.00);
    expect(computeEpisodicMultiplier(Rating.Again)).toBe(1.00);
  });

  it("aplica el multiplicador episódico x1.20 en Good aumentando la estabilidad resultante", async () => {
    const { scheduleEpisodicReview } = await import("./fsrs");
    const now = new Date(1700000000000);
    const standard = scheduleReview(undefined, Rating.Good, now);
    const episodic = scheduleEpisodicReview(undefined, Rating.Good, now);

    expect(episodic.stability).toBeCloseTo(standard.stability * 1.20, 2);
  });

  it("aplica el multiplicador episódico x1.35 en Easy aumentando la estabilidad resultante", async () => {
    const { scheduleEpisodicReview } = await import("./fsrs");
    const now = new Date(1700000000000);
    const standard = scheduleReview(undefined, Rating.Easy, now);
    const episodic = scheduleEpisodicReview(undefined, Rating.Easy, now);

    expect(episodic.stability).toBeCloseTo(standard.stability * 1.35, 2);
  });

  it("no altera la estabilidad en calificaciones bajas (Hard o Again)", async () => {
    const { scheduleEpisodicReview } = await import("./fsrs");
    const now = new Date(1700000000000);
    const standardHard = scheduleReview(undefined, Rating.Hard, now);
    const episodicHard = scheduleEpisodicReview(undefined, Rating.Hard, now);
    expect(episodicHard.stability).toBe(standardHard.stability);

    const standardAgain = scheduleReview(undefined, Rating.Again, now);
    const episodicAgain = scheduleEpisodicReview(undefined, Rating.Again, now);
    expect(episodicAgain.stability).toBe(standardAgain.stability);
  });

  it("permite repasos secuenciales con consolidación episódica acumulando estabilidad de forma robusta", async () => {
    const { scheduleEpisodicReview } = await import("./fsrs");
    const t0 = new Date(1700000000000);
    const r1 = scheduleEpisodicReview(undefined, Rating.Good, t0);
    expect(r1.reps).toBe(1);
    expect(r1.stability).toBeGreaterThan(0);

    const t1 = new Date(t0.getTime() + 24 * 60 * 60 * 1000);
    const r2 = scheduleEpisodicReview(r1, Rating.Easy, t1);
    expect(r2.reps).toBe(2);
    expect(r2.stability).toBeGreaterThan(r1.stability);
    expect(r2.due.getTime()).toBeGreaterThan(t1.getTime());
    expect(Number.isFinite(r2.stability)).toBe(true);
    expect(Number.isFinite(r2.difficulty)).toBe(true);
  });

  it("exporta scheduleCapturedReview para programar palabras capturadas intencionalmente", async () => {
    const { scheduleCapturedReview } = await import("./fsrs");
    expect(typeof scheduleCapturedReview).toBe("function");
  });
});
