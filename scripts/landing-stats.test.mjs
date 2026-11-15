import { describe, expect, it } from "vitest";
import { buildFunnel, rate } from "./landing-stats.mjs";

describe("buildFunnel", () => {
  it("agrupa por fuente, suma CTAs y ordena por vistas", () => {
    const funnel = buildFunnel([
      { event: "view", source: "direct", hits: "10" },
      { event: "view", source: "google.com", hits: 40 },
      { event: "cta:hero", source: "google.com", hits: 6 },
      { event: "cta:sticky", source: "google.com", hits: 2 },
      { event: "demo_open", source: "google.com", hits: 12 },
      { event: "demo_save", source: "google.com", hits: 5 },
      { event: "signup", source: "google.com", hits: 3 },
      { event: "pick_cat", source: "direct", hits: 1 },
    ]);
    expect(funnel.map((f) => f.source)).toEqual(["google.com", "direct"]);
    expect(funnel[0]).toMatchObject({
      views: 40,
      cta: 8,
      ctaBy: { hero: 6, sticky: 2 },
      demoOpen: 12,
      demoSave: 5,
      signup: 3,
    });
    expect(funnel[1]).toMatchObject({ views: 10, cta: 0, signup: 0 });
  });
});

describe("rate", () => {
  it("porcentaje con un decimal y guion sin base", () => {
    expect(rate(3, 40)).toBe("7.5%");
    expect(rate(1, 0)).toBe("—");
  });
});
