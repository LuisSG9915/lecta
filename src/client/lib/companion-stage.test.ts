import { describe, expect, it } from "vitest";
import {
  canWander,
  clampX,
  classifyGesture,
  nextWanderTarget,
  walkDuration,
  xFromPointer,
} from "./companion-stage";

describe("companion-stage helpers", () => {
  describe("clampX", () => {
    it("mantiene valores entre 0 y 1", () => {
      expect(clampX(0.4)).toBe(0.4);
      expect(clampX(-0.1)).toBe(0);
      expect(clampX(1.5)).toBe(1);
      expect(clampX(NaN)).toBe(0.5);
    });
  });

  describe("xFromPointer", () => {
    it("calcula coordenada normalizada dentro del rectángulo", () => {
      const rect = { left: 100, width: 200 };
      expect(xFromPointer(100, rect)).toBe(0);
      expect(xFromPointer(200, rect)).toBe(0.5);
      expect(xFromPointer(300, rect)).toBe(1);
      expect(xFromPointer(50, rect)).toBe(0);
      expect(xFromPointer(400, rect)).toBe(1);
    });

    it("devuelve 0.5 si el ancho es 0", () => {
      expect(xFromPointer(100, { left: 100, width: 0 })).toBe(0.5);
    });
  });

  describe("classifyGesture", () => {
    it("devuelve pending antes de los 220ms y con poco movimiento", () => {
      expect(classifyGesture({ elapsedMs: 100, movedPx: 3 })).toBe("pending");
    });

    it("clasifica como rub si se mueve más de 6px antes de 220ms", () => {
      expect(classifyGesture({ elapsedMs: 150, movedPx: 10 })).toBe("rub");
    });

    it("clasifica como lift si pasan 220ms sin moverse más de 6px", () => {
      expect(classifyGesture({ elapsedMs: 230, movedPx: 2 })).toBe("lift");
    });
  });

  describe("nextWanderTarget", () => {
    it("garantiza distancia mínima de 0.2 al desplazarse", () => {
      for (let i = 0; i < 20; i += 1) {
        const rand = i / 20;
        const fromLeft = nextWanderTarget(rand, 0.2);
        expect(fromLeft).toBeGreaterThanOrEqual(0.4);
        expect(fromLeft).toBeLessThanOrEqual(0.92);

        const fromRight = nextWanderTarget(rand, 0.8);
        expect(fromRight).toBeLessThanOrEqual(0.6);
        expect(fromRight).toBeGreaterThanOrEqual(0.08);

        const fromCenter = nextWanderTarget(rand, 0.5);
        expect(Math.abs(fromCenter - 0.5)).toBeGreaterThanOrEqual(0.19);
      }
    });
  });

  describe("walkDuration", () => {
    it("devuelve duraciones suaves entre 700 y 2200 ms", () => {
      expect(walkDuration(0)).toBe(700);
      expect(walkDuration(0.5)).toBe(1450);
      expect(walkDuration(1)).toBe(2200);
      expect(walkDuration(-0.5)).toBe(1450);
    });
  });

  describe("canWander", () => {
    const baseParams = {
      mood: "awake" as const,
      activeCare: null,
      reducedMotion: false,
      dragging: false,
      hidden: false,
      idleMs: 6000,
      inCloset: false,
      tryOn: false,
    };

    it("permite pasear cuando se cumplen todas las condiciones", () => {
      expect(canWander(baseParams)).toBe(true);
    });

    it("no pasea si está dormido", () => {
      expect(canWander({ ...baseParams, mood: "asleep" })).toBe(false);
    });

    it("no pasea si hay un cuidado activo", () => {
      expect(canWander({ ...baseParams, activeCare: "pet" })).toBe(false);
    });

    it("no pasea si hay movimiento reducido", () => {
      expect(canWander({ ...baseParams, reducedMotion: true })).toBe(false);
    });

    it("no pasea mientras se está arrastrando", () => {
      expect(canWander({ ...baseParams, dragging: true })).toBe(false);
    });

    it("no pasea si la pestaña está oculta", () => {
      expect(canWander({ ...baseParams, hidden: true })).toBe(false);
    });

    it("no pasea si hubo interacción hace menos de 5s", () => {
      expect(canWander({ ...baseParams, idleMs: 3000 })).toBe(false);
    });

    it("no pasea si está en el armario o probándose ropa", () => {
      expect(canWander({ ...baseParams, inCloset: true })).toBe(false);
      expect(canWander({ ...baseParams, tryOn: true })).toBe(false);
    });
  });
});
