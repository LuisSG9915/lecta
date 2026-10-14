import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseColor(val: string): { r: number; g: number; b: number; a: number } | null {
  val = val.trim();
  if (val.startsWith("#")) {
    const hex = val.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }
  const rgbMatch = val.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbMatch) {
    return {
      r: parseFloat(rgbMatch[1]),
      g: parseFloat(rgbMatch[2]),
      b: parseFloat(rgbMatch[3]),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }
  return null;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver(
  fg: { r: number; g: number; b: number; a: number },
  bg: { r: number; g: number; b: number; a: number }
): { r: number; g: number; b: number } {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
}

type ThemeDeclarations = Record<string, string>;

function extractThemeBlocks(css: string): Record<string, ThemeDeclarations> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const blocks: Record<string, ThemeDeclarations> = {
    papel: {},
    blanco: {},
    noche: {},
    oled: {},
    "auto-dark": {},
  };

  const regexes: Array<{ name: keyof typeof blocks; regex: RegExp }> = [
    { name: "papel", regex: /(?:^|[\r\n])\s*:root,\s*:root\[data-theme="papel"\]\s*\{([^}]+)\}/ },
    { name: "blanco", regex: /:root\[data-theme="blanco"\]\s*\{([^}]+)\}/ },
    { name: "noche", regex: /:root\[data-theme="noche"\]\s*\{([^}]+)\}/ },
    { name: "oled", regex: /:root\[data-theme="oled"\]\s*\{([^}]+)\}/ },
    { name: "auto-dark", regex: /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]+)\}/ },
  ];

  for (const { name, regex } of regexes) {
    const match = withoutComments.match(regex);
    if (!match) continue;
    const body = match[1];
    const declMatches = body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
    for (const d of declMatches) {
      const varName = d[1].trim();
      const varValue = d[2].trim();
      blocks[name][varName] = varValue;
    }
  }

  return blocks;
}

describe("tokens.css", () => {
  const cssPath = resolve(__dirname, "tokens.css");
  const cssContent = readFileSync(cssPath, "utf-8");
  const themes = extractThemeBlocks(cssContent);

  it("extrae todos los bloques de tema esperados", () => {
    expect(Object.keys(themes.papel).length).toBeGreaterThan(0);
    expect(Object.keys(themes.blanco).length).toBeGreaterThan(0);
    expect(Object.keys(themes.noche).length).toBeGreaterThan(0);
    expect(Object.keys(themes.oled).length).toBeGreaterThan(0);
    expect(Object.keys(themes["auto-dark"]).length).toBeGreaterThan(0);
  });

  it("define curvas de animación --ease-spring y --ease-soft (Fase 5.1)", () => {
    expect(cssContent).toContain("--ease-spring: cubic-bezier(0.22, 1, 0.36, 1);");
    expect(cssContent).toContain("--ease-soft: cubic-bezier(0.4, 0, 0.2, 1);");
  });

  it("mantiene paridad exacta de tokens de color entre todos los temas", () => {
    const getColorVarNames = (theme: ThemeDeclarations) => {
      return Object.entries(theme)
        .filter(([name, val]) => {
          if (name.startsWith("--cat-")) return false;
          if (name === "--grain") return false;
          if (val.startsWith("var(") || val.startsWith("color-mix(")) return false;
          return parseColor(val) !== null;
        })
        .map(([name]) => name)
        .sort();
    };

    const papelColors = getColorVarNames(themes.papel);
    expect(papelColors.length).toBeGreaterThanOrEqual(20);

    for (const themeName of ["blanco", "noche", "oled", "auto-dark"] as const) {
      const themeColors = getColorVarNames(themes[themeName]);
      expect(themeColors, `Paridad de colores en tema: ${themeName}`).toEqual(papelColors);
    }
  });

  it("cumple contraste WCAG ≥ 4.5:1 en todos los temas", () => {
    for (const [themeName, decls] of Object.entries(themes)) {
      const paperRaw = parseColor(decls["--paper"]);
      const paperRaisedRaw = parseColor(decls["--paper-raised"]);
      const vermilionRaw = parseColor(decls["--vermilion"]);
      const onAccentRaw = parseColor(decls["--on-accent"]);
      const inkRaw = parseColor(decls["--ink"]);
      const inkSoftRaw = parseColor(decls["--ink-soft"]);

      expect(paperRaw, `paper en ${themeName}`).not.toBeNull();
      expect(paperRaisedRaw, `paper-raised en ${themeName}`).not.toBeNull();
      expect(vermilionRaw, `vermilion en ${themeName}`).not.toBeNull();
      expect(onAccentRaw, `on-accent en ${themeName}`).not.toBeNull();
      expect(inkRaw, `ink en ${themeName}`).not.toBeNull();
      expect(inkSoftRaw, `ink-soft en ${themeName}`).not.toBeNull();

      const paper = paperRaw!;
      const paperRaised = paperRaisedRaw!;
      const vermilion = vermilionRaw!;
      const onAccent = onAccentRaw!;
      const ink = inkRaw!;
      const inkSoft = inkSoftRaw!;

      const lumPaper = relativeLuminance(paper.r, paper.g, paper.b);
      const lumPaperRaised = relativeLuminance(paperRaised.r, paperRaised.g, paperRaised.b);

      // Contrast: ink sobre paper y paper-raised
      const cInkPaper = contrastRatio(relativeLuminance(ink.r, ink.g, ink.b), lumPaper);
      const cInkRaised = contrastRatio(relativeLuminance(ink.r, ink.g, ink.b), lumPaperRaised);
      expect(cInkPaper, `--ink sobre --paper en ${themeName} (${cInkPaper.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      expect(cInkRaised, `--ink sobre --paper-raised en ${themeName} (${cInkRaised.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);

      // Contrast: ink-soft sobre paper y paper-raised
      const cInkSoftPaper = contrastRatio(relativeLuminance(inkSoft.r, inkSoft.g, inkSoft.b), lumPaper);
      const cInkSoftRaised = contrastRatio(relativeLuminance(inkSoft.r, inkSoft.g, inkSoft.b), lumPaperRaised);
      expect(cInkSoftPaper, `--ink-soft sobre --paper en ${themeName} (${cInkSoftPaper.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      expect(cInkSoftRaised, `--ink-soft sobre --paper-raised en ${themeName} (${cInkSoftRaised.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);

      // Contrast: vermilion sobre paper y paper-raised
      const cVermilionPaper = contrastRatio(relativeLuminance(vermilion.r, vermilion.g, vermilion.b), lumPaper);
      const cVermilionRaised = contrastRatio(relativeLuminance(vermilion.r, vermilion.g, vermilion.b), lumPaperRaised);
      expect(cVermilionPaper, `--vermilion sobre --paper en ${themeName} (${cVermilionPaper.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      expect(cVermilionRaised, `--vermilion sobre --paper-raised en ${themeName} (${cVermilionRaised.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);

      // Contrast: on-accent sobre vermilion
      const compAccent = onAccent.a < 1 ? compositeOver(onAccent, vermilion) : onAccent;
      const cOnAccent = contrastRatio(
        relativeLuminance(compAccent.r, compAccent.g, compAccent.b),
        relativeLuminance(vermilion.r, vermilion.g, vermilion.b)
      );
      expect(cOnAccent, `--on-accent sobre --vermilion en ${themeName} (${cOnAccent.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
