import { describe, expect, it } from "vitest";
import { buildFunnel, buildGrowthSignals, buildNivelFunnel, rate } from "./landing-stats.mjs";

describe("buildFunnel", () => {
  it("agrupa por fuente, suma CTAs y ordena por vistas ignorando app:* y nivel:*", () => {
    const funnel = buildFunnel([
      { event: "view", source: "direct", hits: "10" },
      { event: "view", source: "google.com", hits: 40 },
      { event: "cta:hero", source: "google.com", hits: 6 },
      { event: "cta:sticky", source: "google.com", hits: 2 },
      { event: "demo_open", source: "google.com", hits: 12 },
      { event: "demo_save", source: "google.com", hits: 5 },
      { event: "signup", source: "google.com", hits: 3 },
      { event: "pick_cat", source: "direct", hits: 1 },
      { event: "nivel:view", source: "instagram.com", hits: 99 },
      { event: "app:share-postal", source: "trial", hits: 15 },
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

describe("buildNivelFunnel", () => {
  it("agrupa vistas, análisis local de EPUB y CTA de /nivel por fuente", () => {
    const rows = [
      { event: "nivel:view", source: "direct", hits: 12 },
      { event: "nivel:view", source: "reddit.com", hits: 30 },
      { event: "nivel:epub", source: "reddit.com", hits: 9 },
      { event: "nivel:cta", source: "reddit.com", hits: 7 },
      { event: "nivel:cta", source: "direct", hits: 3 },
      { event: "view", source: "reddit.com", hits: 100 },
    ];
    expect(buildNivelFunnel(rows)).toEqual([
      { source: "reddit.com", views: 30, epub: 9, cta: 7 },
      { source: "direct", views: 12, epub: 0, cta: 3 },
    ]);
  });
});

describe("buildGrowthSignals", () => {
  it("resume señales de producto M4 por plan ordenadas por total", () => {
    const rows = [
      { event: "app:share-postal", source: "trial", hits: 4 },
      { event: "app:share-postal", source: "plus", hits: 6 },
      { event: "app:article-import", source: "plus", hits: 3 },
      { event: "app:audio-review", source: "free", hits: 2 },
      { event: "app:paywall", source: "free", hits: 50 },
    ];
    expect(buildGrowthSignals(rows)).toEqual([
      { event: "app:share-postal", total: 10, trial: 4, free: 0, plus: 6, unknown: 0 },
      { event: "app:article-import", total: 3, trial: 0, free: 0, plus: 3, unknown: 0 },
      { event: "app:audio-review", total: 2, trial: 0, free: 2, plus: 0, unknown: 0 },
    ]);
  });
});

describe("rate", () => {
  it("porcentaje con un decimal y guion sin base", () => {
    expect(rate(3, 40)).toBe("7.5%");
    expect(rate(1, 0)).toBe("—");
  });
});
