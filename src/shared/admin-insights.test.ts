import { describe, expect, it } from "vitest";
import {
  FSRS_STAGE_SQL,
  addDays,
  classifyDevice,
  dayKeyDiff,
  dayKeyInTz,
  fillDaySeries,
  fsrsStage,
  isRecallHit,
  isTestAccount,
  isVerifiedReview,
  mondayOf,
  normalizeAdminDays,
  normalizeTimeZone,
  recallPct,
  todayKeyInTz,
} from "./admin-insights";

describe("normalizeAdminDays", () => {
  it("acepta los periodos del selector", () => {
    for (const d of [7, 30, 90, 180]) {
      expect(normalizeAdminDays(d)).toBe(d);
      expect(normalizeAdminDays(String(d))).toBe(d);
    }
  });

  it("cae a 30 ante valores fuera de la lista", () => {
    expect(normalizeAdminDays(14)).toBe(30);
    expect(normalizeAdminDays("todos")).toBe(30);
    expect(normalizeAdminDays(undefined)).toBe(30);
    expect(normalizeAdminDays(NaN)).toBe(30);
  });
});

describe("normalizeTimeZone", () => {
  it("conserva una zona IANA válida", () => {
    expect(normalizeTimeZone("America/Mexico_City")).toBe(
      "America/Mexico_City",
    );
    expect(normalizeTimeZone("UTC")).toBe("UTC");
  });

  it("cae a UTC ante basura o vacío", () => {
    expect(normalizeTimeZone("Marte/Olympus")).toBe("UTC");
    expect(normalizeTimeZone("")).toBe("UTC");
    expect(normalizeTimeZone(undefined)).toBe("UTC");
    expect(normalizeTimeZone("';DROP TABLE")).toBe("UTC");
    expect(normalizeTimeZone("x".repeat(80))).toBe("UTC");
  });

  it("respeta un fallback distinto de UTC", () => {
    expect(normalizeTimeZone("", "America/Mexico_City")).toBe(
      "America/Mexico_City",
    );
  });
});

describe("classifyDevice", () => {
  it("reconoce Kindle y e-ink", () => {
    expect(classifyDevice("Mozilla/5.0 (Kindle; Linux)")).toBe("kindle");
    expect(classifyDevice("Mozilla/5.0 (X11; U; eReader)")).toBe("kindle");
    expect(classifyDevice("Mozilla/5.0 (Silk/3.x)")).toBe("kindle");
  });

  it("reconoce teléfonos y tabletas", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS)")).toBe(
      "phone",
    );
    expect(
      classifyDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari",
      ),
    ).toBe("phone");
    // Android sin «Mobile» es ambiguo: las tabletas no la llevan.
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-X710)")).toBe(
      "tablet",
    );
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS)")).toBe("tablet");
  });

  it("reconoce bots y escritorio", () => {
    expect(classifyDevice("Googlebot/2.1")).toBe("bot");
    expect(classifyDevice("curl/8.0")).toBe("bot");
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
      "desktop",
    );
  });

  it("devuelve unknown sin agente", () => {
    expect(classifyDevice(null)).toBe("unknown");
    expect(classifyDevice("")).toBe("unknown");
  });
});

describe("isTestAccount", () => {
  it("marca los dominios de los smoke tests", () => {
    expect(isTestAccount("a-123@smoke.test")).toBe(true);
    expect(isTestAccount("sync-smoke-9@example.com")).toBe(true);
    expect(isTestAccount("ANA@SMOKE.TEST")).toBe(true);
  });

  it("no marca correos reales", () => {
    expect(isTestAccount("luis@correo.mx")).toBe(false);
    expect(isTestAccount("a@smoke.test.evil.com")).toBe(false);
    expect(isTestAccount(null)).toBe(false);
  });
});

describe("regla de aciertos", () => {
  it("excluye los autoinformes 'declared'", () => {
    expect(isVerifiedReview("declared")).toBe(false);
    expect(isVerifiedReview("cloze")).toBe(true);
    expect(isVerifiedReview("practice")).toBe(true);
  });

  it("cuenta good, easy y correct como aciertos", () => {
    for (const r of ["good", "easy", "correct"]) {
      expect(isRecallHit(r)).toBe(true);
    }
    for (const r of ["again", "hard", "wrong", "known"]) {
      expect(isRecallHit(r)).toBe(false);
    }
  });

  it("calcula el porcentaje como el cliente", () => {
    expect(recallPct(4, 3)).toBe(75);
    expect(recallPct(3, 2)).toBe(67);
    expect(recallPct(0, 0)).toBeNull();
  });
});

describe("fsrsStage (espejo de markLevel)", () => {
  it("sigue los mismos cortes de estabilidad que word-level.ts", () => {
    expect(fsrsStage(0, 0)).toBe("new");
    expect(fsrsStage(0, 1)).toBe("learning");
    expect(fsrsStage(1.9, 0)).toBe("new");
    expect(fsrsStage(2, 1)).toBe("learning");
    expect(fsrsStage(20.9, 5)).toBe("learning");
    expect(fsrsStage(21, 5)).toBe("settled");
    expect(fsrsStage(89, 5)).toBe("settled");
    expect(fsrsStage(90, 5)).toBe("mastered");
  });

  it("el SQL contiene los mismos cortes 2 / 21 / 90", () => {
    expect(FSRS_STAGE_SQL).toContain("< 2");
    expect(FSRS_STAGE_SQL).toContain("< 21");
    expect(FSRS_STAGE_SQL).toContain("< 90");
    expect(FSRS_STAGE_SQL).toContain("stability");
    expect(FSRS_STAGE_SQL).toContain("reps");
    // Los valores no numéricos caen a 0, no rompen la consulta.
    expect(FSRS_STAGE_SQL).toContain("ELSE 0 END");
  });
});

describe("claves de día del calendario", () => {
  it("dayKeyInTz respeta la zona horaria", () => {
    // 2026-10-31 23:30 UTC: en México sigue siendo 31 (UTC-6) y en
    // Auckland ya es 1 de noviembre (UTC+13).
    const ts = Date.UTC(2026, 9, 31, 23, 30);
    expect(dayKeyInTz(ts, "UTC")).toBe("2026-10-31");
    expect(dayKeyInTz(ts, "America/Mexico_City")).toBe("2026-10-31");
    expect(dayKeyInTz(ts, "Pacific/Auckland")).toBe("2026-11-01");
  });

  it("todayKeyInTz usa el reloj dado", () => {
    expect(todayKeyInTz("UTC", Date.UTC(2026, 0, 15))).toBe("2026-01-15");
  });

  it("addDays suma y resta días", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-10-31", -6)).toBe("2026-10-25");
  });

  it("mondayOf devuelve el lunes de la semana", () => {
    // 2026-10-31 es sábado; su lunes es 2026-10-26.
    expect(mondayOf("2026-10-31")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    // 2026-11-01 es domingo: pertenece a la semana del 26 de octubre.
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });

  it("dayKeyDiff cuenta días entre claves", () => {
    expect(dayKeyDiff("2026-10-31", "2026-10-01")).toBe(30);
    expect(dayKeyDiff("2026-10-01", "2026-10-31")).toBe(-30);
  });
});

describe("fillDaySeries", () => {
  it("rellena huecos con cero y conserva el orden", () => {
    const rows = [
      { day: "2026-10-30", value: 2 },
      { day: "2026-10-28", value: 1 },
    ];
    const out = fillDaySeries(rows, "2026-10-31", 4, (day) => ({
      day,
      value: 0,
    }));
    expect(out.map((r) => r.day)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(out.map((r) => r.value)).toEqual([1, 0, 2, 0]);
  });

  it("descarta filas fuera de la ventana", () => {
    const out = fillDaySeries(
      [{ day: "2020-01-01", value: 9 }],
      "2026-10-31",
      3,
      (day) => ({ day, value: 0 }),
    );
    expect(out.every((r) => r.day >= "2026-10-29")).toBe(true);
    expect(out.every((r) => r.value === 0)).toBe(true);
  });
});
