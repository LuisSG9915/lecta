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
});
