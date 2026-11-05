import { describe, expect, it } from "vitest";
import {
  DEFAULT_KINDLE_PREFS,
  KINDLE_PRESETS,
  matchKindlePreset,
  normalizeKindlePrefs,
  prefsFromRow,
} from "./kindle-prefs";

describe("kindle-prefs (K2)", () => {
  it("devuelve defaults con entradas vacías o inválidas", () => {
    expect(normalizeKindlePrefs(null)).toEqual(DEFAULT_KINDLE_PREFS);
    expect(normalizeKindlePrefs(undefined)).toEqual(DEFAULT_KINDLE_PREFS);
    expect(normalizeKindlePrefs({})).toEqual(DEFAULT_KINDLE_PREFS);
    expect(normalizeKindlePrefs("basura")).toEqual(DEFAULT_KINDLE_PREFS);
  });

  it("normaliza cada campo de forma independiente y descarta valores fuera de vocabulario", () => {
    const prefs = normalizeKindlePrefs({
      fontFamily: "comic-sans",
      fontSize: "xxl",
      lineHeight: "gigante",
      margin: "lg",
      align: "center",
      approach: "anchors",
      layout: "scroll",
    });
    expect(prefs.fontFamily).toBe("literata");
    expect(prefs.fontSize).toBe("xxl");
    expect(prefs.lineHeight).toBe("normal");
    expect(prefs.margin).toBe("lg");
    expect(prefs.align).toBe("justify");
    expect(prefs.approach).toBe("anchors");
    expect(prefs.layout).toBe("scroll");
  });

  it("acepta el vocabulario completo de cada campo", () => {
    for (const approach of ["clean", "paragraphs", "anchors"]) {
      expect(normalizeKindlePrefs({ approach }).approach).toBe(approach);
    }
    for (const fontFamily of ["literata", "source-serif", "atkinson", "opendyslexic"]) {
      expect(normalizeKindlePrefs({ fontFamily }).fontFamily).toBe(fontFamily);
    }
    for (const layout of ["paged", "scroll"]) {
      expect(normalizeKindlePrefs({ layout }).layout).toBe(layout);
    }
  });

  it("prefsFromRow mapea columnas snake_case y tolera fila nula", () => {
    expect(prefsFromRow(null)).toEqual(DEFAULT_KINDLE_PREFS);
    const prefs = prefsFromRow({
      font_family: "atkinson",
      font_size: "lg",
      line_height: "loose",
      margin: "sm",
      align: "left",
      approach: "paragraphs",
      layout: "scroll",
    });
    expect(prefs).toEqual({
      fontFamily: "atkinson",
      fontSize: "lg",
      lineHeight: "loose",
      margin: "sm",
      align: "left",
      approach: "paragraphs",
      layout: "scroll",
    });
  });

  it("«Clásico» es exactamente el preset por defecto", () => {
    // Si cambian los defaults de la cuenta, el preset «Clásico» debe
    // seguirlos: es la promesa de la etiqueta.
    expect(matchKindlePreset(DEFAULT_KINDLE_PREFS)).toBe("clasico");
  });

  it("cada preset sobrevive la normalización y se identifica al revés", () => {
    for (const preset of KINDLE_PRESETS) {
      const normalized = normalizeKindlePrefs(preset.prefs);
      expect(normalized).toEqual(preset.prefs);
      expect(matchKindlePreset(normalized)).toBe(preset.id);
    }
  });

  it("una mezcla que no coincide con ningún preset es «Personalizado» (null)", () => {
    expect(
      matchKindlePreset({ ...DEFAULT_KINDLE_PREFS, fontSize: "xl" }),
    ).toBeNull();
  });
});
