// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  formatRemainingTime,
  formatElapsedMinutes,
  type DeepReadingConfig,
} from "./deep-reading";

describe("deep-reading", () => {
  it("formatea correctamente el tiempo restante en minutos y segundos", () => {
    expect(formatRemainingTime(15 * 60 * 1000)).toBe("15:00");
    expect(formatRemainingTime(5 * 60 * 1000 + 30 * 1000)).toBe("5:30");
    expect(formatRemainingTime(45 * 1000)).toBe("0:45");
    expect(formatRemainingTime(0)).toBe("0:00");
    expect(formatRemainingTime(-1000)).toBe("0:00");
  });

  it("formatea el tiempo transcurrido en minutos legibles", () => {
    expect(formatElapsedMinutes(0)).toBe("menos de 1 min");
    expect(formatElapsedMinutes(30 * 1000)).toBe("1 min");
    expect(formatElapsedMinutes(60 * 1000)).toBe("1 min");
    expect(formatElapsedMinutes(15 * 60 * 1000)).toBe("15 min");
    expect(formatElapsedMinutes(30 * 60 * 1000)).toBe("30 min");
  });

  it("permite configurar opciones de retiro", () => {
    const config: DeepReadingConfig = {
      durationMinutes: 20,
      fullscreen: true,
      keepScreenAwake: true,
    };
    expect(config.durationMinutes).toBe(20);
    expect(config.fullscreen).toBe(true);
    expect(config.keepScreenAwake).toBe(true);
  });
});
