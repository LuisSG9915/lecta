import { describe, expect, it, vi } from "vitest";
import { triggerHaptic } from "./haptics";

describe("triggerHaptic", () => {
  it("llama a navigator.vibrate si está disponible", () => {
    const vibrateMock = vi.fn();
    vi.stubGlobal("navigator", { vibrate: vibrateMock });

    triggerHaptic(15);
    expect(vibrateMock).toHaveBeenCalledWith(15);

    vi.unstubAllGlobals();
  });

  it("no lanza error si navigator.vibrate no existe o falla", () => {
    vi.stubGlobal("navigator", {});
    expect(() => triggerHaptic(10)).not.toThrow();

    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("vibrate denied");
      },
    });
    expect(() => triggerHaptic(10)).not.toThrow();

    vi.unstubAllGlobals();
  });
});
