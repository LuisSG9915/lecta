import { describe, expect, it } from "vitest";
import {
  applyMexicanXExceptions,
  normalizeSpanishText,
  numberToSpanishWords,
  ordinalToSpanishWords,
  romanToNumber,
} from "./normalizerEs";

describe("numberToSpanishWords", () => {
  it("cardinales básicos", () => {
    expect(numberToSpanishWords(0)).toBe("cero");
    expect(numberToSpanishWords(1)).toBe("uno");
    expect(numberToSpanishWords(15)).toBe("quince");
    expect(numberToSpanishWords(16)).toBe("dieciséis");
    expect(numberToSpanishWords(20)).toBe("veinte");
    expect(numberToSpanishWords(21)).toBe("veintiuno");
    expect(numberToSpanishWords(30)).toBe("treinta");
    expect(numberToSpanishWords(45)).toBe("cuarenta y cinco");
    expect(numberToSpanishWords(99)).toBe("noventa y nueve");
  });

  it("centenas", () => {
    expect(numberToSpanishWords(100)).toBe("cien");
    expect(numberToSpanishWords(101)).toBe("ciento uno");
    expect(numberToSpanishWords(200)).toBe("doscientos");
    expect(numberToSpanishWords(999)).toBe("novecientos noventa y nueve");
  });

  it("miles y millones", () => {
    expect(numberToSpanishWords(1000)).toBe("mil");
    expect(numberToSpanishWords(1250)).toBe("mil doscientos cincuenta");
    expect(numberToSpanishWords(2000)).toBe("dos mil");
    expect(numberToSpanishWords(1_000_000)).toBe("un millón");
    expect(numberToSpanishWords(2_500_000)).toBe("dos millones quinientos mil");
    expect(numberToSpanishWords(1999)).toBe("mil novecientos noventa y nueve");
  });
});

describe("ordinalToSpanishWords", () => {
  it("ordinales comunes y género", () => {
    expect(ordinalToSpanishWords(1)).toBe("primero");
    expect(ordinalToSpanishWords(1, true)).toBe("primera");
    expect(ordinalToSpanishWords(3)).toBe("tercero");
    expect(ordinalToSpanishWords(10, true)).toBe("décima");
    expect(ordinalToSpanishWords(21)).toBe("vigésimo primero");
    expect(ordinalToSpanishWords(100)).toBe("centésimo");
  });
});

describe("romanToNumber", () => {
  it("romanos válidos e inválidos", () => {
    expect(romanToNumber("XIV")).toBe(14);
    expect(romanToNumber("III")).toBe(3);
    expect(romanToNumber("XXI")).toBe(21);
    expect(romanToNumber("IL")).toBeNull();
    expect(romanToNumber("VX")).toBeNull();
    expect(romanToNumber("abc")).toBeNull();
  });
});

describe("applyMexicanXExceptions", () => {
  it("x mexicana → j (/x/), el resto de x queda intacto", () => {
    expect(applyMexicanXExceptions("México es hermoso")).toBe("Méjico es hermoso");
    expect(applyMexicanXExceptions("la mexicana")).toBe("la mejicana");
    expect(applyMexicanXExceptions("Oaxaca y Xalapa")).toBe("Oajaca y Jalapa");
    expect(applyMexicanXExceptions("Texas y Tlaxcala")).toBe("Tejas y Tlajcala");
    // /ks/ se conserva donde corresponde
    expect(applyMexicanXExceptions("el oxígeno y el taxi")).toBe("el oxígeno y el taxi");
    expect(applyMexicanXExceptions("ex presidente")).toBe("ex presidente");
  });
});

describe("normalizeSpanishText", () => {
  it("números con separador de miles y decimales", () => {
    expect(normalizeSpanishText("1,250.50")).toBe("mil doscientos cincuenta punto cincuenta");
    expect(normalizeSpanishText("1.250,50")).toBe("mil doscientos cincuenta punto cincuenta");
    expect(normalizeSpanishText("3.14")).toBe("tres punto catorce");
    expect(normalizeSpanishText("2,5")).toBe("dos punto cinco");
    expect(normalizeSpanishText("Capítulo 3")).toBe("Capítulo tres");
    expect(normalizeSpanishText("en 1999")).toBe("en mil novecientos noventa y nueve");
  });

  it("números romanos en contexto de obra", () => {
    expect(normalizeSpanishText("Capítulo XIV")).toBe("Capítulo catorce");
    expect(normalizeSpanishText("Tomo III")).toBe("Tomo tres");
    expect(normalizeSpanishText("Siglo XXI")).toBe("Siglo veintiuno");
    // Fuera de contexto no se toca (podría ser sigla)
    expect(normalizeSpanishText("el plan IV")).toBe("el plan IV");
  });

  it("abreviaturas comunes", () => {
    expect(normalizeSpanishText("Sr. García y Dra. López")).toBe("señor García y doctora López");
    expect(normalizeSpanishText("ver pág. 45 y págs. 46-47")).toContain("página");
    expect(normalizeSpanishText("etc.")).toBe("etcétera");
    expect(normalizeSpanishText("núm. 7")).toBe("número siete");
  });

  it("símbolos y moneda", () => {
    expect(normalizeSpanishText("$500")).toBe("quinientos pesos");
    expect(normalizeSpanishText("50%")).toBe("cincuenta por ciento");
    expect(normalizeSpanishText("36 °C")).toBe("treinta y seis grados centígrados");
  });

  it("tipografía de EPUB: comillas y rayas", () => {
    expect(normalizeSpanishText("«Hola» —dijo— ella")).toBe("Hola , dijo, ella");
    expect(normalizeSpanishText("dijo… y siguió")).toBe("dijo, y siguió");
  });

  it("ordinals con indicador", () => {
    expect(normalizeSpanishText("1.º lugar")).toBe("primero lugar");
    expect(normalizeSpanishText("la 3.ª vez")).toBe("la tercera vez");
  });
});
