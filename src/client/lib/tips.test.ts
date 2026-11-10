import { describe, expect, it } from "vitest";
import {
  buildTipContext,
  composeTip,
  hasTipData,
  TIP_MIN_BASELINE_DAYS,
  TIP_MIN_DAY_MS,
  TIP_WINDOW_DAYS,
  tipEligible,
  type TipContext,
  type TipDayStats,
} from "./tips";
import type { ReadingEvent } from "./idb";

const TZ = "America/Mexico_City";
// Jueves 8 oct 2026, 21:00 local (02:00 UTC del 9).
const NOW = Date.UTC(2026, 9, 9, 2, 0, 0);

const dwell = (dayOffset: number, ms: number, words = 0): ReadingEvent => ({
  id: `e-${dayOffset}-${ms}-${words}`,
  version: 1,
  visitId: "v",
  bookHash: "b",
  createdAt: NOW - dayOffset * 86_400_000,
  kind: "section_dwell",
  sectionIndex: 0,
  ms,
  words,
});

const regressed = (dayOffset: number): ReadingEvent => ({
  id: `r-${dayOffset}`,
  version: 1,
  visitId: "v",
  bookHash: "b",
  createdAt: NOW - dayOffset * 86_400_000,
  kind: "page_regressed",
  sectionIndex: 0,
});

describe("buildTipContext", () => {
  const opts = { focusMode: "off" };

  it("agrega por día local, más reciente primero, con ritmo estimado", () => {
    const ctx = buildTipContext(
      [
        dwell(0, 10 * 60_000, 2100), // hoy: 10 min, 210 ppm
        dwell(1, 30 * 60_000, 6000),
        regressed(1),
        dwell(2, 20 * 60_000, 4000),
      ],
      opts,
      NOW,
      TZ,
    );
    expect(ctx.dayKey).toBe("2026-10-08");
    expect(ctx.days).toHaveLength(3);
    expect(ctx.days[0]).toEqual({
      dayKey: "2026-10-08",
      minutes: 10,
      regressions: 0,
      wpm: 210,
    });
    expect(ctx.days[1]).toMatchObject({
      dayKey: "2026-10-07",
      minutes: 30,
      regressions: 1,
      wpm: 200,
    });
    expect(ctx.focusMode).toBe("off");
  });

  it("corta la ventana a 14 días", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      dwell(i + 1, 10 * 60_000),
    );
    expect(buildTipContext(events, opts, NOW, TZ).days).toHaveLength(
      TIP_WINDOW_DAYS,
    );
  });
});

describe("hasTipData y tipEligible", () => {
  const opts = { focusMode: "off" };
  const days = (n: number, ms = 10 * 60_000) =>
    Array.from({ length: n }, (_, i) => dwell(i + 1, ms));

  it("pide el día comparado más dos días de referencia con ≥5 min", () => {
    const need = 1 + TIP_MIN_BASELINE_DAYS;
    expect(hasTipData(buildTipContext(days(need), opts, NOW, TZ))).toBe(true);
    expect(
      hasTipData(buildTipContext(days(need - 1), opts, NOW, TZ)),
    ).toBe(false);
    // Días por debajo de 5 min no cuentan.
    expect(
      hasTipData(
        buildTipContext(days(need, TIP_MIN_DAY_MS - 1), opts, NOW, TZ),
      ),
    ).toBe(false);
  });

  it("bloquea si el consejo de hoy ya se mostró", () => {
    const ctx = buildTipContext(days(3), opts, NOW, TZ);
    expect(tipEligible({ lastTipDay: null, ctx })).toBe(true);
    expect(tipEligible({ lastTipDay: "2026-10-01", ctx })).toBe(true);
    expect(tipEligible({ lastTipDay: ctx.dayKey, ctx })).toBe(false);
  });
});

describe("composeTip", () => {
  const day = (
    dayKey: string,
    minutes: number,
    regressions: number,
    wpm: number,
  ): TipDayStats => ({ dayKey, minutes, regressions, wpm });
  const ctxOf = (days: TipDayStats[], focusMode = "off"): TipContext => ({
    dayKey: days[0]?.dayKey ?? "2026-10-08",
    days,
    focusMode,
  });
  // Tres días de referencia: ~0,2 retrocesos/min y 200 ppm.
  const baseline = [
    day("2026-10-07", 20, 4, 200),
    day("2026-10-06", 30, 6, 210),
    day("2026-10-05", 25, 5, 190),
  ];

  it("ofrece la regla de foco cuando los retrocesos suben y nombra el dato", () => {
    const tip = composeTip(ctxOf([day("2026-10-08", 20, 12, 200), ...baseline]));
    expect(tip?.action).toBe("focus_ruler");
    expect(tip?.tip).toContain("volviste atrás 12 veces en 20 min");
    expect(tip?.tip).toContain("puede ser buena relectura");
  });

  it("no ofrece la regla a quien ya la usa ni con pocos retrocesos", () => {
    expect(
      composeTip(ctxOf([day("2026-10-08", 20, 12, 200), ...baseline], "ruler")),
    ).toBeNull();
    // 7 retrocesos en 5 min es una tasa alta, pero bajo el mínimo absoluto.
    expect(composeTip(ctxOf([day("2026-10-08", 5, 7, 200), ...baseline]))).toBeNull();
  });

  it("ofrece las líneas sintácticas cuando el ritmo cae y nombra ambos ritmos", () => {
    const tip = composeTip(ctxOf([day("2026-10-08", 20, 4, 140), ...baseline]));
    expect(tip?.action).toBe("syntactic");
    expect(tip?.tip).toContain("unas 140 palabras por minuto");
    expect(tip?.tip).toContain("rondan las 200");
    expect(tip?.tip).toContain("Un día lento también puede ser un buen día");
  });

  it("calla en un día normal, sin ritmo medido o con poca referencia", () => {
    expect(composeTip(ctxOf([day("2026-10-08", 20, 4, 195), ...baseline]))).toBeNull();
    expect(composeTip(ctxOf([day("2026-10-08", 20, 4, 0), ...baseline]))).toBeNull();
    expect(
      composeTip(ctxOf([day("2026-10-08", 20, 12, 140), baseline[0]])),
    ).toBeNull();
    expect(
      composeTip(
        ctxOf([day("2026-10-08", 20, 4, 140), ...baseline], "syntactic"),
      ),
    ).toBeNull();
  });

  it("nunca afirma un estado del lector ni regaña", () => {
    const tips = [
      composeTip(ctxOf([day("2026-10-08", 20, 12, 200), ...baseline])),
      composeTip(ctxOf([day("2026-10-08", 20, 4, 140), ...baseline])),
    ];
    for (const t of tips) {
      expect(t).not.toBeNull();
      expect(t!.tip).not.toMatch(/cansad|fatiga|distra|TDAH|dislexia|deberías/i);
      expect(t!.tip.split(/\s+/).length).toBeLessThanOrEqual(45);
    }
  });
});
