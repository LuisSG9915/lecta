import { describe, expect, it } from "vitest";
import {
  buildTipContext,
  hasTipData,
  TIP_MIN_ACTIVE_DAYS,
  TIP_MIN_DAY_MS,
  TIP_WINDOW_DAYS,
  tipEligible,
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
  const opts = { focusMode: "off", weeklyGoalDays: 5 };

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
    expect(ctx.days[0]).toMatchObject({
      dayKey: "2026-10-08",
      minutes: 10,
      wpm: 210,
    });
    expect(ctx.days[1]).toMatchObject({
      dayKey: "2026-10-07",
      minutes: 30,
      regressions: 1,
      wpm: 200,
    });
    expect(ctx.focusMode).toBe("off");
    expect(ctx.weeklyGoalDays).toBe(5);
  });

  it("cuenta los días naturales desde la última lectura de ≥1 min", () => {
    const ctx = buildTipContext(
      [dwell(0, 20_000), dwell(3, 10 * 60_000)],
      opts,
      NOW,
      TZ,
    );
    // Los 20 s de hoy no son «día leído»; el último real fue hace 3.
    expect(ctx.daysSinceLastRead).toBe(3);
    expect(
      buildTipContext([], opts, NOW, TZ).daysSinceLastRead,
    ).toBe(0);
  });

  it("corta la ventana a 14 días", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      dwell(i + 1, 10 * 60_000),
    );
    const ctx = buildTipContext(events, opts, NOW, TZ);
    expect(ctx.days).toHaveLength(TIP_WINDOW_DAYS);
    expect(ctx.daysSinceLastRead).toBe(1);
  });
});

describe("hasTipData", () => {
  const opts = { focusMode: "off", weeklyGoalDays: null };

  it("pide al menos dos días con ≥5 min en la ventana", () => {
    const enough = buildTipContext(
      [dwell(1, TIP_MIN_DAY_MS), dwell(4, TIP_MIN_DAY_MS + 1)],
      opts,
      NOW,
      TZ,
    );
    expect(hasTipData(enough)).toBe(true);

    const thin = buildTipContext(
      [dwell(1, TIP_MIN_DAY_MS), dwell(2, TIP_MIN_DAY_MS - 1)],
      opts,
      NOW,
      TZ,
    );
    expect(hasTipData(thin)).toBe(false);
    expect(
      hasTipData(buildTipContext([], opts, NOW, TZ)),
    ).toBe(false);
  });
});

describe("tipEligible", () => {
  const ctx = buildTipContext(
    Array.from({ length: TIP_MIN_ACTIVE_DAYS }, (_, i) =>
      dwell(i + 1, 10 * 60_000),
    ),
    { focusMode: "off", weeklyGoalDays: null },
    NOW,
    TZ,
  );

  it("pasa con sesión, IA encendida, datos y día libre", () => {
    expect(
      tipEligible({ userId: "u1", useAi: true, lastTipDay: null, ctx }),
    ).toBe(true);
  });

  it("bloquea sin sesión, con IA apagada o si el día ya se consumió", () => {
    expect(
      tipEligible({ userId: null, useAi: true, lastTipDay: null, ctx }),
    ).toBe(false);
    expect(
      tipEligible({ userId: "u1", useAi: false, lastTipDay: null, ctx }),
    ).toBe(false);
    expect(
      tipEligible({
        userId: "u1",
        useAi: true,
        lastTipDay: ctx.dayKey,
        ctx,
      }),
    ).toBe(false);
  });
});
