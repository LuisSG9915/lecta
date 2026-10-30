import { describe, expect, it, vi } from "vitest";
import {
  isDue,
  isReviewDueWord,
  loadRetentionHorizon,
  Rating,
  requestRetentionFor,
  saveRetentionHorizon,
  scheduleReview,
  hydrateRetentionHorizon,
} from "./fsrs";
import { loadSessionValue, saveSessionValue, getActiveUserId } from "./idb";

vi.mock("./idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idb")>()),
  loadSessionValue: vi.fn(async () => undefined),
  saveSessionValue: vi.fn(async () => undefined),
  getActiveUserId: vi.fn(() => null),
}));

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

  it("el horizonte de retención se aplica al instante y se guarda por cuenta", async () => {
    await saveRetentionHorizon("relaxed");
    expect(loadRetentionHorizon()).toBe("relaxed");
    expect(requestRetentionFor()).toBe(0.85);
    expect(requestRetentionFor("intensive")).toBe(0.93);
    expect(saveSessionValue).toHaveBeenCalledWith("lecta:retention_horizon:v1", "relaxed", undefined);
  });

  it("al entrar a una cuenta carga su horizonte; un valor inválido vuelve al estándar", async () => {
    vi.mocked(loadSessionValue).mockResolvedValueOnce("intensive");
    await hydrateRetentionHorizon();
    expect(loadRetentionHorizon()).toBe("intensive");

    vi.mocked(loadSessionValue).mockResolvedValueOnce("otro");
    await hydrateRetentionHorizon();
    expect(loadRetentionHorizon()).toBe("standard");
  });

  it("el horizonte no se filtra entre cuentas", async () => {
    const getActive = vi.mocked(getActiveUserId);
    try {
      getActive.mockReturnValue("u1");
      await saveRetentionHorizon("relaxed");
      expect(loadRetentionHorizon()).toBe("relaxed");

      // La base ya cambió de cuenta pero su ritmo aún no se cargó:
      // el repaso no puede heredar el de u1.
      getActive.mockReturnValue("u2");
      expect(loadRetentionHorizon()).toBe("standard");

      vi.mocked(loadSessionValue).mockResolvedValueOnce("intensive");
      await hydrateRetentionHorizon({ userId: "u2", generation: 1 } as never);
      expect(loadRetentionHorizon()).toBe("intensive");

      getActive.mockReturnValue("u1");
      expect(loadRetentionHorizon()).toBe("relaxed");
    } finally {
      getActive.mockReturnValue(null);
    }
  });

  it("un horizonte más exigente programa repasos más cercanos", () => {
    const base = scheduleReview(undefined, Rating.Good);
    const relaxed = scheduleReview(base, Rating.Good, new Date(), {
      requestRetention: 0.85,
    });
    const intensive = scheduleReview(base, Rating.Good, new Date(), {
      requestRetention: 0.93,
    });
    expect(relaxed.due.getTime()).toBeGreaterThanOrEqual(intensive.due.getTime());
  });
});

describe("Captura intencional", () => {
  it("exporta scheduleCapturedReview para programar palabras capturadas intencionalmente", async () => {
    const { scheduleCapturedReview } = await import("./fsrs");
    expect(typeof scheduleCapturedReview).toBe("function");
  });

  it("defiende contra tarjetas corruptas con tipos y rangos inválidos", () => {
    const corruptCard = {
      stability: "not-a-number",
      difficulty: 999,
      reps: -5,
      lapses: "NaN",
    } as unknown as import("ts-fsrs").Card;
    const reviewed = scheduleReview(corruptCard, Rating.Good);
    expect(typeof reviewed.stability).toBe("number");
    expect(reviewed.stability).toBeGreaterThan(0);
    expect(reviewed.difficulty).toBeLessThanOrEqual(10);
    expect(reviewed.reps).toBeGreaterThanOrEqual(1);
  });
});

describe("isReviewDueWord", () => {
  it("excluye palabras recién guardadas sin primera exposición ni repasos previos", () => {
    expect(isReviewDueWord({ card: undefined, presentedAt: undefined })).toBe(false);
    expect(isReviewDueWord({ card: undefined, presentedAt: 1700000000000 })).toBe(true);
  });
});
