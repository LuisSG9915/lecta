// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearBookReaderSettings,
  hasBookReaderSettings,
  hasExplicitPreparationMode,
  loadReaderSettings,
  parseReaderSettings,
  parseTheme,
  readerCssVars,
  resolveTheme,
  saveReaderSettings,
  READER_DEFAULTS,
} from "./settings";

describe("parseTheme", () => {
  it("acepta las paletas conocidas", () => {
    expect(parseTheme("papel")).toBe("papel");
    expect(parseTheme("blanco")).toBe("blanco");
    expect(parseTheme("noche")).toBe("noche");
    expect(parseTheme("oled")).toBe("oled");
  });

  it("migra el «crema» guardado a la paleta sepia", () => {
    expect(parseTheme("crema")).toBe("papel");
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
    expect(resolveTheme("blanco", true)).toBe("blanco");
    expect(resolveTheme("noche", false)).toBe("noche");
    expect(resolveTheme("oled", false)).toBe("oled");
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
    ).toEqual({
      font: "sans",
      size: 20,
      leading: 1.8,
      measure: 75,
      justify: true,
      dropCap: false,
      layout: "scroll",
      pageColumns: 2,
      preparationMode: "auto",
      enableHyphenation: false,
    });
  });

  it("lee enableHyphenation solo cuando es true", () => {
    expect(
      parseReaderSettings(JSON.stringify({ enableHyphenation: true }))
        .enableHyphenation,
    ).toBe(true);
    for (const value of [false, "sí", 1, null]) {
      expect(
        parseReaderSettings(JSON.stringify({ enableHyphenation: value }))
          .enableHyphenation,
      ).toBe(false);
    }
  });

  it("acepta modo paginado y cae a scroll con valores desconocidos", () => {
    expect(
      parseReaderSettings(JSON.stringify({ layout: "pages", pageColumns: 1 })),
    ).toMatchObject({ layout: "pages", pageColumns: 1 });
    expect(
      parseReaderSettings(JSON.stringify({ layout: "flip", pageColumns: 3 })),
    ).toMatchObject({ layout: "scroll", pageColumns: 2 });
  });

  it("acota tamaño e interlineado fuera de rango", () => {
    const s = parseReaderSettings(JSON.stringify({ size: 40, leading: 0.5 }));
    expect(s.size).toBe(24);
    expect(s.leading).toBe(1.5);
  });

  it("rechaza medidas que no son 55, 65 o 75", () => {
    expect(parseReaderSettings(JSON.stringify({ measure: 70 })).measure).toBe(65);
  });

  it("acepta las letras opcionales y rechaza desconocidas", () => {
    for (const font of ["serif", "atkinson", "dyslexic"] as const) {
      expect(parseReaderSettings(JSON.stringify({ font })).font).toBe(font);
    }
    expect(parseReaderSettings(JSON.stringify({ font: "comic" })).font).toBe("literata");
  });

  it("acepta los tres modos de preparación y cae a auto", () => {
    for (const mode of ["auto", "notice", "off"] as const) {
      expect(
        parseReaderSettings(JSON.stringify({ preparationMode: mode })).preparationMode,
      ).toBe(mode);
    }
    expect(
      parseReaderSettings(JSON.stringify({ preparationMode: "siempre" })).preparationMode,
    ).toBe("auto");
    expect(
      parseReaderSettings(JSON.stringify({ preparationMode: 2 })).preparationMode,
    ).toBe("auto");
  });

  it("datos antiguos sin el campo resuelven a auto", () => {
    expect(parseReaderSettings(JSON.stringify({ font: "serif" })).preparationMode).toBe(
      "auto",
    );
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
      layout: "scroll",
      pageColumns: 2,
      preparationMode: "notice",
      enableHyphenation: false,
    });
    expect(vars["--read-font"]).toBe("var(--font-sans-alt)");
    expect(vars["--read-size"]).toBe("20px");
    expect(vars["--read-leading"]).toBe("1.7");
    expect(vars["--read-measure"]).toBe("55ch");
  });
});

describe("ajustes por libro", () => {
  beforeEach(() => localStorage.clear());

  it("guarda con clave propia sin tocar la global", () => {
    saveReaderSettings({ ...READER_DEFAULTS, size: 22 }, "hash1");
    expect(loadReaderSettings("hash1").size).toBe(22);
    expect(loadReaderSettings().size).toBe(READER_DEFAULTS.size);
    expect(hasBookReaderSettings("hash1")).toBe(true);
    expect(hasBookReaderSettings("otro")).toBe(false);
  });

  it("sin ajuste propio hereda la global", () => {
    saveReaderSettings({ ...READER_DEFAULTS, size: 19 });
    expect(loadReaderSettings("hash2").size).toBe(19);
  });

  it("al limpiar el ajuste propio el libro vuelve a heredar", () => {
    saveReaderSettings({ ...READER_DEFAULTS, size: 22 }, "hash3");
    clearBookReaderSettings("hash3");
    expect(hasBookReaderSettings("hash3")).toBe(false);
    expect(loadReaderSettings("hash3")).toEqual(loadReaderSettings());
  });

  it("un ajuste propio corrupto no rompe: cae a los valores por defecto", () => {
    localStorage.setItem("lecta:reader:hash4", "{no json");
    saveReaderSettings({ ...READER_DEFAULTS, size: 19 });
    expect(loadReaderSettings("hash4").size).toBe(READER_DEFAULTS.size);
  });
});

describe("hasExplicitPreparationMode", () => {
  beforeEach(() => localStorage.clear());

  it("sin nada guardado no hay elección", () => {
    expect(hasExplicitPreparationMode()).toBe(false);
    expect(hasExplicitPreparationMode("h1")).toBe(false);
  });

  it("detecta la elección general cuando el libro no tiene archivo", () => {
    saveReaderSettings({ ...READER_DEFAULTS, preparationMode: "notice" });
    expect(hasExplicitPreparationMode("h2")).toBe(true);
  });

  it("un archivo de libro sin el campo no cuenta como elección", () => {
    localStorage.setItem(
      "lecta:reader:h3",
      JSON.stringify({ font: "sans", size: 20 }),
    );
    saveReaderSettings({ ...READER_DEFAULTS, preparationMode: "off" });
    expect(hasExplicitPreparationMode("h3")).toBe(false);
  });

  it("un archivo de libro con el campo sí cuenta", () => {
    localStorage.setItem(
      "lecta:reader:h4",
      JSON.stringify({ preparationMode: "off" }),
    );
    expect(hasExplicitPreparationMode("h4")).toBe(true);
  });

  it("un JSON corrupto no cuenta como elección", () => {
    localStorage.setItem("lecta:reader:h5", "{corrupto");
    expect(hasExplicitPreparationMode("h5")).toBe(false);
  });

  it("volver a los ajustes generales mantiene la elección del libro", () => {
    saveReaderSettings(
      { ...READER_DEFAULTS, preparationMode: "off" },
      "h6",
    );
    clearBookReaderSettings("h6");
    saveReaderSettings({ ...READER_DEFAULTS, preparationMode: "notice" });
    expect(loadReaderSettings("h6").preparationMode).toBe("notice");
    expect(hasExplicitPreparationMode("h6")).toBe(true);
  });
});
