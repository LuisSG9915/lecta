import { describe, expect, it } from "vitest";
import {
  claimSwipe,
  rubberBand,
  settleDuration,
  swipeOutcome,
  tapZone,
} from "./page-gesture";

describe("tapZone", () => {
  const rect = { left: 100, width: 400 };

  it("identifica el 25% izquierdo como prev", () => {
    expect(tapZone(100, rect)).toBe("prev");
    expect(tapZone(150, rect)).toBe("prev");
    expect(tapZone(199, rect)).toBe("prev");
  });

  it("identifica el 50% central como center", () => {
    expect(tapZone(200, rect)).toBe("center");
    expect(tapZone(300, rect)).toBe("center");
    expect(tapZone(400, rect)).toBe("center");
  });

  it("identifica el 25% derecho como next", () => {
    expect(tapZone(401, rect)).toBe("next");
    expect(tapZone(450, rect)).toBe("next");
    expect(tapZone(500, rect)).toBe("next");
  });

  it("maneja anchos menores o iguales a cero devolviendo center", () => {
    expect(tapZone(50, { left: 0, width: 0 })).toBe("center");
    expect(tapZone(50, { left: 0, width: -10 })).toBe("center");
  });
});

describe("claimSwipe", () => {
  it("mantiene pending si el movimiento no supera el umbral de 10px", () => {
    expect(claimSwipe(0, 0)).toBe("pending");
    expect(claimSwipe(5, 5)).toBe("pending");
    expect(claimSwipe(-8, 3)).toBe("pending");
  });

  it("reclama swipe cuando |dx| >= 10 y |dx| > 1.3·|dy|", () => {
    expect(claimSwipe(15, 5)).toBe("swipe");
    expect(claimSwipe(-20, 10)).toBe("swipe");
    expect(claimSwipe(-50, 0)).toBe("swipe");
  });

  it("cancela cuando el movimiento es predominantemente vertical o diagonal amplia", () => {
    expect(claimSwipe(5, 20)).toBe("cancel");
    expect(claimSwipe(15, 15)).toBe("cancel"); // 15 <= 15 * 1.3
    expect(claimSwipe(20, 18)).toBe("cancel"); // 20 <= 18 * 1.3 = 23.4
  });
});

describe("rubberBand", () => {
  it("aplica resistencia lineal ×0.35 en ambos sentidos", () => {
    expect(rubberBand(100)).toBe(35);
    expect(rubberBand(-100)).toBe(-35);
    expect(rubberBand(0)).toBe(0);
  });
});

describe("swipeOutcome", () => {
  const width = 400; // 25% = 100px

  it("confirma avanzar página (1) si dx supera el 25% hacia la izquierda", () => {
    expect(swipeOutcome({ dx: -105, velocity: 0, width })).toBe(1);
  });

  it("confirma retroceder página (-1) si dx supera el 25% hacia la derecha", () => {
    expect(swipeOutcome({ dx: 105, velocity: 0, width })).toBe(-1);
  });

  it("confirma con velocidad rápida > 0.4 px/ms y distancia > 30px", () => {
    expect(swipeOutcome({ dx: -35, velocity: -0.5, width })).toBe(1);
    expect(swipeOutcome({ dx: 35, velocity: 0.5, width })).toBe(-1);
  });

  it("no confirma si la velocidad es rápida pero la distancia <= 30px", () => {
    expect(swipeOutcome({ dx: -25, velocity: -0.6, width })).toBe(0);
  });

  it("cancela (0) si la distancia y la velocidad son insuficientes", () => {
    expect(swipeOutcome({ dx: -60, velocity: -0.2, width })).toBe(0);
    expect(swipeOutcome({ dx: 50, velocity: 0.1, width })).toBe(0);
  });
});

describe("settleDuration", () => {
  it("acota la duración mínima a 160ms para gestos muy rápidos", () => {
    expect(settleDuration(50, 1.2)).toBe(160);
  });

  it("acota la duración máxima a 320ms para gestos muy lentos con distancia remanente", () => {
    expect(settleDuration(300, 0.1)).toBe(320);
  });

  it("calcula valores intermedios según distancia y velocidad", () => {
    expect(settleDuration(100, 0.5)).toBe(200);
  });

  it("proporciona duración adecuada cuando la velocidad es 0", () => {
    const durZero = settleDuration(0, 0);
    const durFull = settleDuration(300, 0);
    expect(durZero).toBeGreaterThanOrEqual(160);
    expect(durFull).toBeLessThanOrEqual(320);
  });
});
