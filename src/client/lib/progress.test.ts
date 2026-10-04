import { describe, expect, it } from "vitest";
import { bookProgress, countWords, minutesLeft, updateWpm } from "./progress";

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
