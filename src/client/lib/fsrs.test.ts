import { describe, expect, it } from "vitest";
import {
  isDue,
  loadRetentionHorizon,
  Rating,
  requestRetentionFor,
  saveRetentionHorizon,
  scheduleReview,
} from "./fsrs";

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

  it("el horizonte de retención se guarda y cambia el intervalo pedido", () => {
    // @vitest-environment jsdom no aplica aquí: se simula localStorage.
    const store = new Map<string, string>();
    const g = globalThis as { window?: unknown };
    g.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    };
    try {
      saveRetentionHorizon("relaxed");
      expect(loadRetentionHorizon()).toBe("relaxed");
      expect(requestRetentionFor("relaxed")).toBe(0.85);
      expect(requestRetentionFor("intensive")).toBe(0.93);

      const base = scheduleReview(undefined, Rating.Good);
      const relaxed = scheduleReview(base, Rating.Good, new Date(), {
        requestRetention: 0.85,
      });
      const intensive = scheduleReview(base, Rating.Good, new Date(), {
        requestRetention: 0.93,
      });
      expect(relaxed.due.getTime()).toBeGreaterThanOrEqual(intensive.due.getTime());
    } finally {
      delete g.window;
    }
  });
});

describe("Captura intencional", () => {
  it("exporta scheduleCapturedReview para programar palabras capturadas intencionalmente", async () => {
    const { scheduleCapturedReview } = await import("./fsrs");
    expect(typeof scheduleCapturedReview).toBe("function");
  });
});
