import { describe, expect, it } from "vitest";
import {
  bookProgress,
  chapterMinutesLeft,
  countWords,
  dockProgressText,
  minutesLeft,
  updateWpm,
} from "./progress";
import { formatCompactProgress } from "../components/SmartReaderDock";

describe("countWords", () => {
  it("cuenta palabras separadas por espacios", () => {
    expect(countWords("una dos tres")).toBe(3);
    expect(countWords("  con   espacios   raros \n")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("bookProgress", () => {
  it("pondera por el tamaño de cada sección", () => {
    // secciones: 10, 90 → en la 2ª al 50% es (10+45)/100 = .55
    expect(bookProgress([10, 90], 1, 0.5)).toBeCloseTo(0.55);
  });

  it("acota la proporción y el total vacío", () => {
    expect(bookProgress([], 0, 0.5)).toBe(0);
    expect(bookProgress([100], 0, 2)).toBe(1);
  });
});

describe("minutesLeft", () => {
  it("divide palabras restantes entre la velocidad", () => {
    expect(minutesLeft(1000, 0, 200)).toBe(5);
    expect(minutesLeft(1000, 0.5, 200)).toBe(3); // 500/200 → 2.5 → 3
  });

  it("nunca devuelve negativo ni explota con wpm 0", () => {
    expect(minutesLeft(100, 1, 200)).toBe(0);
    expect(minutesLeft(100, 0, 0)).toBe(100);
  });
});

describe("updateWpm", () => {
  it("descarta muestras poco confiables", () => {
    expect(updateWpm(200, 10, 60_000)).toBe(200); // muy pocas palabras
    expect(updateWpm(200, 500, 5_000)).toBe(200); // muy poco tiempo
    expect(updateWpm(200, 5000, 20 * 60_000)).toBe(200); // sesión eterna
  });

  it("arranca con la observación y luego suaviza", () => {
    expect(updateWpm(null, 200, 60_000)).toBe(200);
    // observada 300, previa 200 → 200*.7 + 300*.3 = 230
    expect(updateWpm(200, 300, 60_000)).toBe(230);
  });

  it("acota la velocidad observada", () => {
    expect(updateWpm(null, 100_000, 60_000)).toBe(600);
    expect(updateWpm(null, 50, 60_000)).toBe(100);
  });
});

describe("chapterMinutesLeft", () => {
  const range = { startSection: 0, endSection: 3 };
  it("sin rango equivale a minutesLeft", () => {
    expect(chapterMinutesLeft([100], 0, null, 600, 0.5, 100)).toBe(minutesLeft(600, 0.5, 100));
  });
  it("suma las secciones siguientes con la razón palabras/byte", () => {
    // sección actual: 600 palabras en 6000 bytes (0.1/byte), al 50 % → 300.
    // siguientes: 3000 y 3000 bytes → 300 + 300. Total 900 / 100 wpm = 9.
    expect(chapterMinutesLeft([6000, 3000, 3000], 0, range, 600, 0.5, 100)).toBe(9);
  });
  it("sin muestra creíble solo cuenta la sección actual", () => {
    expect(chapterMinutesLeft([100, 5000, 5000], 0, range, 30, 0, 30)).toBe(1);
  });
  it("en la última sección del rango equivale a minutesLeft", () => {
    expect(chapterMinutesLeft([6000, 3000, 3000], 2, range, 300, 0.5, 100)).toBe(
      minutesLeft(300, 0.5, 100),
    );
  });
  it("al final de la última sección da 0", () => {
    expect(chapterMinutesLeft([6000, 3000, 3000], 2, range, 300, 1, 100)).toBe(0);
  });
});

describe("dockProgressText", () => {
  const base = { page: 2, pageCount: 10, sectionIndex: 22, sectionTotal: 40, minutes: 12 };
  it("scroll con ordinal usa capítulos reales y lo parsea el dock", () => {
    const text = dockProgressText({ ...base, layout: "scroll", ordinal: { n: 7, total: 20 } });
    expect(text).toBe("Cap. 7 de 20 · ~12 min");
    expect(formatCompactProgress(text).title).toContain("Capítulo 7 de 20");
  });
  it("scroll sin ordinal cae a secciones", () => {
    expect(dockProgressText({ ...base, layout: "scroll", ordinal: null })).toBe(
      "Cap. 23 de 40 · ~12 min",
    );
  });
  it("páginas no cambia y sin minutos los omite", () => {
    expect(dockProgressText({ ...base, layout: "pages", ordinal: { n: 7, total: 20 } })).toBe(
      "Pág. 3 de 10 · ~12 min",
    );
    expect(
      dockProgressText({ ...base, minutes: 0, layout: "scroll", ordinal: { n: 7, total: 20 } }),
    ).toBe("Cap. 7 de 20");
  });
});
