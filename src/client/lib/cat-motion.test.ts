import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCatMotion,
  catMotionReduced,
  catReducedMotion,
  prefersReducedMotion,
} from "./cat-motion";

const stubSystemPrefers = (prefers: boolean) =>
  vi.stubGlobal("matchMedia", () => ({ matches: prefers }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.catMotion;
});

describe("catReducedMotion", () => {
  it("resuelve los tres modos", () => {
    expect(catReducedMotion("full", true)).toBe(false);
    expect(catReducedMotion("full", false)).toBe(false);
    expect(catReducedMotion("reduced", false)).toBe(true);
    expect(catReducedMotion("reduced", true)).toBe(true);
    expect(catReducedMotion("system", true)).toBe(true);
    expect(catReducedMotion("system", false)).toBe(false);
  });
});

describe("catMotionReduced", () => {
  it("sin data-cat-motion sigue al sistema", () => {
    stubSystemPrefers(true);
    expect(catMotionReduced()).toBe(true);
    vi.unstubAllGlobals();
    stubSystemPrefers(false);
    expect(catMotionReduced()).toBe(false);
  });

  it("data-cat-motion=reduced gana aunque el sistema no pida reducir", () => {
    stubSystemPrefers(false);
    applyCatMotion("reduced");
    expect(catMotionReduced()).toBe(true);
  });

  it("data-cat-motion=full anima aunque el sistema pida reducir", () => {
    stubSystemPrefers(true);
    applyCatMotion("full");
    expect(catMotionReduced()).toBe(false);
  });

  it("data-cat-motion=system delega al sistema operativo", () => {
    stubSystemPrefers(true);
    applyCatMotion("system");
    expect(catMotionReduced()).toBe(true);
  });
});

describe("applyCatMotion / prefersReducedMotion", () => {
  it("applyCatMotion escribe data-cat-motion en <html>", () => {
    applyCatMotion("full");
    expect(document.documentElement.dataset.catMotion).toBe("full");
  });

  it("prefersReducedMotion lee matchMedia del sistema", () => {
    stubSystemPrefers(true);
    expect(prefersReducedMotion()).toBe(true);
    vi.unstubAllGlobals();
    stubSystemPrefers(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});
