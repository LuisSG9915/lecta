import { describe, expect, it } from "vitest";
import {
  isStopwordMissclick,
  validateTapIntent,
} from "./tap-intent-guard";

describe("tap-intent-guard", () => {
  describe("isStopwordMissclick", () => {
    it("detecta palabras cortas <= 2 letras", () => {
      expect(isStopwordMissclick("el")).toBe(true);
      expect(isStopwordMissclick("la")).toBe(true);
      expect(isStopwordMissclick("de")).toBe(true);
      expect(isStopwordMissclick("en")).toBe(true);
      expect(isStopwordMissclick("y")).toBe(true);
      expect(isStopwordMissclick("a")).toBe(true);
      expect(isStopwordMissclick("un")).toBe(true);
      expect(isStopwordMissclick("al")).toBe(true);
      expect(isStopwordMissclick("")).toBe(true);
      expect(isStopwordMissclick(null)).toBe(true);
    });

    it("detecta 'que' y conjunciones/preposiciones comunes", () => {
      expect(isStopwordMissclick("que")).toBe(true);
      expect(isStopwordMissclick("del")).toBe(true);
      expect(isStopwordMissclick("los")).toBe(true);
      expect(isStopwordMissclick("las")).toBe(true);
      expect(isStopwordMissclick("por")).toBe(true);
      expect(isStopwordMissclick("con")).toBe(true);
      expect(isStopwordMissclick("the")).toBe(true);
    });

    it("permite palabras con contenido semántico", () => {
      expect(isStopwordMissclick("ataraxia")).toBe(false);
      expect(isStopwordMissclick("libro")).toBe(false);
      expect(isStopwordMissclick("casa")).toBe(false);
      expect(isStopwordMissclick("efímero")).toBe(false);
    });
  });

  describe("validateTapIntent", () => {
    const baseInput = {
      upPoint: { clientX: 500, clientY: 400 },
      downPoint: { clientX: 500, clientY: 400 },
      pointerType: "touch",
      viewportWidth: 1000,
      word: "horizonte",
    };

    it("acepta un tap limpio, centrado e intencional", () => {
      const res = validateTapIntent(baseInput);
      expect(res.valid).toBe(true);
    });

    it("rechaza si el delta de movimiento supera 8px (inicio de swipe o scroll)", () => {
      const res = validateTapIntent({
        ...baseInput,
        downPoint: { clientX: 500, clientY: 400 },
        upPoint: { clientX: 509, clientY: 400 }, // delta = 9px
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("movement_delta");
    });

    it("rechaza si hubo un scroll o cambio de página en los últimos 180ms", () => {
      const now = 100000;
      const res = validateTapIntent({
        ...baseInput,
        now,
        lastScrollOrNavTime: now - 100, // hace 100ms
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("scroll_cooldown");
    });

    it("acepta si el scroll ocurrió hace más de 180ms", () => {
      const now = 100000;
      const res = validateTapIntent({
        ...baseInput,
        now,
        lastScrollOrNavTime: now - 200, // hace 200ms
      });
      expect(res.valid).toBe(true);
    });

    it("rechaza taps táctiles en la zona del pulgar (8% lateral izquierdo o derecho)", () => {
      // 8% de 1000 = 80px
      const leftEdge = validateTapIntent({
        ...baseInput,
        upPoint: { clientX: 50, clientY: 400 },
        downPoint: { clientX: 50, clientY: 400 },
      });
      expect(leftEdge.valid).toBe(false);
      expect(leftEdge.reason).toBe("thumb_edge_zone");

      const rightEdge = validateTapIntent({
        ...baseInput,
        upPoint: { clientX: 950, clientY: 400 },
        downPoint: { clientX: 950, clientY: 400 },
      });
      expect(rightEdge.valid).toBe(false);
      expect(rightEdge.reason).toBe("thumb_edge_zone");
    });

    it("permite taps laterales si es mouse (pointerType !== 'touch')", () => {
      const mouseRes = validateTapIntent({
        ...baseInput,
        pointerType: "mouse",
        upPoint: { clientX: 50, clientY: 400 },
        downPoint: { clientX: 50, clientY: 400 },
      });
      expect(mouseRes.valid).toBe(true);
    });

    it("permite selección en bordes si proviene de long-press explícito", () => {
      const longPressRes = validateTapIntent({
        ...baseInput,
        isLongPress: true,
        upPoint: { clientX: 50, clientY: 400 },
        downPoint: { clientX: 50, clientY: 400 },
      });
      expect(longPressRes.valid).toBe(true);
    });

    it("rechaza si cae sobre una stopword o partícula corta", () => {
      const stopwordRes = validateTapIntent({
        ...baseInput,
        word: "de",
      });
      expect(stopwordRes.valid).toBe(false);
      expect(stopwordRes.reason).toBe("stopword");
    });
  });
});
