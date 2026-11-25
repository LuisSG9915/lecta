import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
    expect(cssContent).toContain("--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);");
    expect(cssContent).toContain("--ease-soft: cubic-bezier(0.4, 0, 0.2, 1);");
  });

  it("Bloque 3: pizarra noche del landing en los 5 bloques, legible", () => {
    for (const [themeName, decls] of Object.entries(themes)) {
      for (const name of ["--night", "--night-2", "--night-ink", "--night-soft", "--moon", "--mist"]) {
        expect(decls[name], `${name} en ${themeName}`).toBeDefined();
      }
      const night = parseColor(decls["--night"])!;
      const ink = parseColor(decls["--night-ink"])!;
      const ratio = contrastRatio(
        relativeLuminance(ink.r, ink.g, ink.b),
        relativeLuminance(night.r, night.g, night.b),
      );
      expect(ratio, `--night-ink sobre --night en ${themeName} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
    }
    expect(themes.papel["--rule"]).toBe("rgba(120, 95, 70, 0.14)");
    // Lectura biónica: ancla blanca en oscuro y casi negra en claro.
    expect(themes.noche["--ink-anchor"]).toBe("#ffffff");
    expect(themes.oled["--ink-anchor"]).toBe("#ffffff");
    expect(themes["auto-dark"]["--ink-anchor"]).toBe("#ffffff");
    expect(themes.papel["--ink-anchor"]).toBe("#0d0c0a");
    expect(themes.blanco["--ink-rest"]).toBe("#26231f");
    expect(themes.blanco["--rule"]).toBe("rgba(120, 95, 70, 0.14)");
  });

  it("Bloque 3: curva del landing, superficies con nombre y pelajes", () => {
    expect(cssContent).toContain("--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);");
    for (const name of ["--surface-dock", "--surface-herbarium", "--surface-kindle", "--ink-on-night"]) {
      expect(cssContent).toContain(`${name}:`);
    }
    // Las paletas por pelaje viven aquí, fuera de los bloques de tema.
    for (const coat of ["tuxedo", "latte", "ginger", "mist", "calico"]) {
      expect(cssContent).toContain(`.cat.cat--coat-${coat}`);
    }
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

      // Contraste C1 de la ficha: --accent-primary (acciones, bordes y
      // la marca de la cita) sobre la superficie elevada de la tarjeta.
      const accentPrimaryRaw = parseColor(decls["--accent-primary"]);
      expect(accentPrimaryRaw, `accent-primary en ${themeName}`).not.toBeNull();
      const cAccentPrimary = contrastRatio(
        relativeLuminance(accentPrimaryRaw!.r, accentPrimaryRaw!.g, accentPrimaryRaw!.b),
        lumPaperRaised,
      );
      expect(
        cAccentPrimary,
        `--accent-primary sobre --paper-raised en ${themeName} (${cAccentPrimary.toFixed(2)}:1)`,
      ).toBeGreaterThanOrEqual(4.5);

      // Contrast: on-accent sobre vermilion
      const compAccent = onAccent.a < 1 ? compositeOver(onAccent, vermilion) : onAccent;
      const cOnAccent = contrastRatio(
        relativeLuminance(compAccent.r, compAccent.g, compAccent.b),
        relativeLuminance(vermilion.r, vermilion.g, vermilion.b)
      );
      expect(cOnAccent, `--on-accent sobre --vermilion en ${themeName} (${cOnAccent.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
    }
  });
  // Repaso del Cuaderno (docs/designs/2026-11-13-cuaderno-repaso.md, D4): la
  // opción respondida pinta el wash sobre --paper-raised con texto --ink. En
  // papel/blanco --vermilion-wash es opaco, así que el contraste se mide.
  it("las opciones respondidas del repaso leen ≥ 4.5:1 en todos los temas", () => {
    for (const [themeName, decls] of Object.entries(themes)) {
      const ink = parseColor(decls["--ink"])!;
      const raised = parseColor(decls["--paper-raised"])!;
      for (const wash of ["--success-wash", "--vermilion-wash"]) {
        const washColor = parseColor(decls[wash]);
        expect(washColor, `${wash} en ${themeName}`).not.toBeNull();
        const bg = compositeOver(washColor!, raised);
        const ratio = contrastRatio(
          relativeLuminance(ink.r, ink.g, ink.b),
          relativeLuminance(bg.r, bg.g, bg.b),
        );
        expect(ratio, `--ink sobre ${wash} en ${themeName} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Regresión del 2026-10-31: `--text-primary` no existía en ningún archivo,
  // así que `var(--text-primary, #f5f2eb)` caía al fallback crema (pensado
  // para el tema noche) sobre `--surface-elevated` = blanco: la tarjeta de
  // palabra se pintaba a 1.12:1 y parecía vacía. El token tiene que existir
  // e ir por `--ink` para que cada tema lo resuelva solo.
  it("define --text-primary como indirección de --ink", () => {
    const baseRoot = cssContent.match(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/);
    expect(baseRoot, "falta el bloque :root base en tokens.css").toBeTruthy();
    const declaration = baseRoot![1].match(/--text-primary\s*:\s*([^;]+);/);
    expect(declaration?.[1].trim()).toBe("var(--ink)");
  });

  // Regresión F9.6: tokens nunca definidos en tokens.css. Cuando el navegador
  // los resolvía caía al fallback inline (un color fijo de un solo tema o, sin
  // fallback, una declaración inválida que desaparecía del todo, como el borde
  // de `var(--accent)` en reader.css). Cualquier uso nuevo vuelve a romper C1.
  it("ninguna hoja ni componente usa tokens fantasma (nunca definidos en el contrato de temas)", () => {
    const ghosts = [
      /var\(--ink-muted[\s,)]/,
      /var\(--accent[\s,)]/,
      /var\(--r-sm[\s,)]/,
      /var\(--rule-subtle[\s,)]/,
      /var\(--border-soft[\s,)]/,
      /var\(--paper-dim[\s,)]/,
      /var\(--r-md[\s,)]/,
      /var\(--border-subtle[\s,)]/,
      /var\(--card-bg[\s,)]/,
    ];
    const cssFiles = ["reader.css", "components.css", "notebook.css", "shelf.css", "app.css", "game.css", "tokens.css"];
    for (const name of cssFiles) {
      const css = readFileSync(resolve(__dirname, name), "utf-8");
      for (const ghost of ghosts) {
        expect(css, `${name} usa token fantasma ${ghost}`).not.toMatch(ghost);
      }
    }

    const componentsDir = resolve(__dirname, "../components");
    const readerComponentsDir = resolve(componentsDir, "reader");
    const tsxFiles = [
      ...readdirSync(componentsDir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => resolve(componentsDir, f)),
      ...readdirSync(readerComponentsDir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => resolve(readerComponentsDir, f)),
    ];
    for (const filePath of tsxFiles) {
      const src = readFileSync(filePath, "utf-8");
      for (const ghost of ghosts) {
        expect(src, `${filePath} usa token fantasma ${ghost}`).not.toMatch(ghost);
      }
    }
  });

  it("los botones de acento usan --on-accent, no un color fijo", () => {
    const files = ["reader.css", "components.css", "notebook.css"].map((name) =>
      readFileSync(resolve(__dirname, name), "utf-8"),
    );
    const ctaRule = files
      .map((css) => css.match(/\.word-panel__save-cta\s*\{[^}]*\}/)?.[0] ?? "")
      .find(Boolean);
    expect(ctaRule, "no se encontró la regla del CTA de guardado").toBeTruthy();
    expect(ctaRule).toContain("var(--on-accent");
  });
});

describe("Enfoque y Ritmo: contraste efectivo", () => {
  const tokens = readFileSync(resolve(__dirname, "tokens.css"), "utf-8");
  const reader = readFileSync(resolve(__dirname, "reader.css"), "utf-8");
  const themes = extractThemeBlocks(tokens);
  const cssOpacity = (re: RegExp) => Number(re.exec(reader)?.[1]);

  // Opacidad del párrafo no activo (Enfoque): color efectivo = tinta sobre papel.
  const dim = {
    papel: cssOpacity(/data-paragraph-focus\] li \{\s*opacity: ([\d.]+);/),
    blanco: cssOpacity(/data-paragraph-focus\] li \{\s*opacity: ([\d.]+);/),
    noche: cssOpacity(/\[data-theme="oled"\] \.book-content\[data-paragraph-focus\] li \{\s*opacity: ([\d.]+);/),
    oled: cssOpacity(/\[data-theme="oled"\] \.book-content\[data-paragraph-focus\] li \{\s*opacity: ([\d.]+);/),
  } as const;

  it("el párrafo atenuado de Enfoque lee ≥ 4.5:1 en papel, blanco, noche y oled", () => {
    for (const [name, opacity] of Object.entries(dim)) {
      const ink = parseColor(themes[name]["--ink"])!;
      const paper = parseColor(themes[name]["--paper"])!;
      const eff = compositeOver({ ...ink, a: opacity }, { ...paper, a: 1 });
      const ratio = contrastRatio(
        relativeLuminance(eff.r, eff.g, eff.b),
        relativeLuminance(paper.r, paper.g, paper.b),
      );
      expect(opacity, `opacidad en ${name}`).toBeGreaterThan(0);
      expect(ratio, `${name} con opacidad ${opacity}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el acento B de la guía cromática cumple AAA (7.5:1) en papel y blanco", () => {
    for (const name of ["papel", "blanco"]) {
      const b = parseColor(themes[name]["--chroma-anchor-b"])!;
      const paper = parseColor(themes[name]["--paper"])!;
      const ratio = contrastRatio(
        relativeLuminance(b.r, b.g, b.b),
        relativeLuminance(paper.r, paper.g, paper.b),
      );
      expect(ratio, name).toBeGreaterThanOrEqual(7.5);
    }
  });
});

describe("conectores sintácticos", () => {
  // «sin embargo», «no obstante»… se envuelven en [data-connector] para que
  // las anclas biónicas los salten, pero no responden a nada: un subrayado
  // ahí promete «palabra consultable» y es ruido (plan-lectura-flaquezas F1).
  it("ninguna hoja subraya [data-connector]", () => {
    const sheets = [
      ...readdirSync(__dirname)
        .filter((f) => f.endsWith(".css"))
        .map((f) => resolve(__dirname, f)),
      resolve(__dirname, "../styles.css"),
    ];
    for (const sheet of sheets) {
      const css = readFileSync(sheet, "utf-8");
      for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!block[1].includes("data-connector")) continue;
        expect(block[2], `${sheet}: ${block[1].trim()}`).not.toMatch(/text-decoration/);
      }
    }
  });
});
