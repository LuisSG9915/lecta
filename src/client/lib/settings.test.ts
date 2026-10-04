import { describe, expect, it } from "vitest";
import {
  parseReaderSettings,
  parseTheme,
  readerCssVars,
  resolveTheme,
  READER_DEFAULTS,
} from "./settings";

describe("parseTheme", () => {
  it("acepta los temas conocidos", () => {
    expect(parseTheme("papel")).toBe("papel");
    expect(parseTheme("crema")).toBe("crema");
    expect(parseTheme("noche")).toBe("noche");
  });

  it("cae en auto con valores nulos o desconocidos", () => {
    expect(parseTheme(null)).toBe("auto");
    expect(parseTheme("auto")).toBe("auto");
    expect(parseTheme("oscuro")).toBe("auto");
    expect(parseTheme("")).toBe("auto");
  });
});

describe("resolveTheme", () => {
  it("respeta la elección manual", () => {
    expect(resolveTheme("crema", true)).toBe("crema");
    expect(resolveTheme("noche", false)).toBe("noche");
  });

  it("en auto sigue al sistema", () => {
    expect(resolveTheme("auto", true)).toBe("noche");
    expect(resolveTheme("auto", false)).toBe("papel");
  });
});

describe("parseReaderSettings", () => {
  it("devuelve los valores por defecto sin dato guardado", () => {
    expect(parseReaderSettings(null)).toEqual(READER_DEFAULTS);
  });

  it("tolera JSON corrupto o con forma distinta", () => {
    expect(parseReaderSettings("{no")).toEqual(READER_DEFAULTS);
    expect(parseReaderSettings('"sans"')).toEqual(READER_DEFAULTS);
    expect(parseReaderSettings("42")).toEqual(READER_DEFAULTS);
  });

  it("conserva valores válidos y fija los booleanos", () => {
    expect(
      parseReaderSettings(
        JSON.stringify({ font: "sans", size: 20, leading: 1.8, measure: 75, justify: true }),
      ),
    ).toEqual({ font: "sans", size: 20, leading: 1.8, measure: 75, justify: true, dropCap: false });
  });

  it("acota tamaño e interlineado fuera de rango", () => {
    const s = parseReaderSettings(JSON.stringify({ size: 40, leading: 0.5 }));
    expect(s.size).toBe(24);
    expect(s.leading).toBe(1.5);
  });

  it("rechaza medidas que no son 55, 65 o 75", () => {
    expect(parseReaderSettings(JSON.stringify({ measure: 70 })).measure).toBe(65);
  });
});

describe("readerCssVars", () => {
  it("mapea los ajustes a variables de lectura", () => {
    const vars = readerCssVars({
      font: "sans",
      size: 20,
      leading: 1.7,
      measure: 55,
      justify: false,
      dropCap: true,
    });
    expect(vars["--read-font"]).toBe("var(--font-sans-alt)");
    expect(vars["--read-size"]).toBe("20px");
    expect(vars["--read-leading"]).toBe("1.7");
    expect(vars["--read-measure"]).toBe("55ch");
  });
});
