// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  clearBookReaderSettings,
  hasBookReaderSettings,
  hasExplicitPreparationMode,
  loadReaderSettings,
  parseReaderSettings,
  parseTheme,
  readerCssVars,
  resolveTheme,
  saveReaderSettings,
  loadPracticeCompanionMode,
  savePracticeCompanionMode,
  loadNativeLanguage,
  saveNativeLanguage,
  hasExplicitNativeLanguage,
  readerProfileFor,
  READER_DEFAULTS,
  applyReadingPreset,
  applyStrategyPreset,
  isStrategyPresetActive,
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
      focusMode: "off",
      rulerSize: 3,
      strategyPreset: "immersive",
      focusRuler: false,
      paragraphFocus: false,
      syntacticLines: false,
      chromaticGuide: false,
      chromaticPalette: "editorial",
      bionicAnchors: false,
      strategyContrast: "high",
      ambientPurr: false,
      soundscape: "none",
      highlightLexical: false,
      hideSecondaryIndicators: true,
      visualPacer: false,
      pacerWpm: 210,
    });
  });

  it("lee modo de concentración y descarta valores desconocidos", () => {
    expect(
      parseReaderSettings(
        JSON.stringify({ focusMode: "syntactic", rulerSize: "paragraph" }),
      ),
    ).toMatchObject({ focusMode: "syntactic", rulerSize: "paragraph" });
    expect(
      parseReaderSettings(
        JSON.stringify({ focusMode: "paragraph" }),
      ),
    ).toMatchObject({ focusMode: "paragraph", rulerSize: 3 });
    expect(
      parseReaderSettings(
        JSON.stringify({ focusMode: "chromatic" }),
      ),
    ).toMatchObject({ focusMode: "chromatic", rulerSize: 3 });
    expect(
      parseReaderSettings(
        JSON.stringify({ focusMode: "ruler", rulerSize: 1 }),
      ),
    ).toMatchObject({ focusMode: "ruler", rulerSize: 1 });
    expect(
      parseReaderSettings(
        JSON.stringify({ focusMode: "lupa", rulerSize: 9 }),
      ),
    ).toMatchObject({ focusMode: "off", rulerSize: 3 });
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

  it("lee y acota visualPacer y pacerWpm", () => {
    const active = parseReaderSettings(
      JSON.stringify({ visualPacer: true, pacerWpm: 250 }),
    );
    expect(active.visualPacer).toBe(true);
    expect(active.pacerWpm).toBe(250);

    const clamped = parseReaderSettings(
      JSON.stringify({ visualPacer: false, pacerWpm: 9999 }),
    );
    expect(clamped.visualPacer).toBe(false);
    expect(clamped.pacerWpm).toBe(210);
  });

  it("lee y valida soundscape aceptando paisajes procedurales", () => {
    expect(parseReaderSettings(JSON.stringify({ soundscape: "rain" })).soundscape).toBe("rain");
    expect(parseReaderSettings(JSON.stringify({ soundscape: "hearth" })).soundscape).toBe("hearth");
    expect(parseReaderSettings(JSON.stringify({ soundscape: "night_library" })).soundscape).toBe("night_library");
    expect(parseReaderSettings(JSON.stringify({ ambientPurr: true })).soundscape).toBe("purr");
    expect(parseReaderSettings(JSON.stringify({ soundscape: "unknown" })).soundscape).toBe("none");
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

  it("lee opciones de guía cromática, anclas biónicas y ronroneo ambiental", () => {
    const s = parseReaderSettings(
      JSON.stringify({
        chromaticGuide: true,
        chromaticPalette: "ocean_amber",
        bionicAnchors: true,
        ambientPurr: true,
        strategyContrast: "balanced",
      }),
    );
    expect(s.chromaticGuide).toBe(true);
    expect(s.chromaticPalette).toBe("ocean_amber");
    expect(s.bionicAnchors).toBe(true);
    expect(s.ambientPurr).toBe(true);
    expect(s.strategyContrast).toBe("balanced");
  });

  it("calibra strategyContrast con valores válidos ('soft' | 'balanced' | 'high') y descarta inválidos", () => {
    expect(parseReaderSettings(JSON.stringify({ strategyContrast: "soft" })).strategyContrast).toBe("soft");
    expect(parseReaderSettings(JSON.stringify({ strategyContrast: "balanced" })).strategyContrast).toBe("balanced");
    expect(parseReaderSettings(JSON.stringify({ strategyContrast: "high" })).strategyContrast).toBe("high");
    expect(parseReaderSettings(JSON.stringify({ strategyContrast: "ultra" })).strategyContrast).toBe("high");
    expect(parseReaderSettings(JSON.stringify({})).strategyContrast).toBe("high");
  });
});

describe("applyStrategyPreset y isStrategyPresetActive", () => {
  it("configura immersive (Lectura Limpia): apaga regla, foco y sintaxis", () => {
    const initial = {
      ...READER_DEFAULTS,
      focusRuler: true,
      paragraphFocus: true,
      syntacticLines: true,
      strategyPreset: "custom" as const,
    };
    const result = applyStrategyPreset("immersive", initial);
    expect(result.strategyPreset).toBe("immersive");
    expect(result.focusRuler).toBe(false);
    expect(result.paragraphFocus).toBe(false);
    expect(result.syntacticLines).toBe(false);
    expect(result.focusMode).toBe("off");
    expect(result.hideSecondaryIndicators).toBe(true);
    expect(isStrategyPresetActive("immersive", result)).toBe(true);
  });

  it("configura focus (Modo Neuro-Enfoque / TDAH): activa syntacticLines, chromaticGuide y paragraphFocus", () => {
    const result = applyStrategyPreset("focus", READER_DEFAULTS);
    expect(result.strategyPreset).toBe("focus");
    expect(result.syntacticLines).toBe(true);
    expect(result.chromaticGuide).toBe(true);
    expect(result.paragraphFocus).toBe(true);
    expect(isStrategyPresetActive("focus", result)).toBe(true);
  });

  it("configura lexical (Explorador Léxico): activa syntacticLines y highlightLexical", () => {
    const result = applyStrategyPreset("lexical", READER_DEFAULTS);
    expect(result.strategyPreset).toBe("lexical");
    expect(result.syntacticLines).toBe(true);
    expect(result.focusRuler).toBe(false);
    expect(result.paragraphFocus).toBe(false);
    expect(result.highlightLexical).toBe(true);
    expect(isStrategyPresetActive("lexical", result)).toBe(true);
  });

  it("configura audio (Audio-Lectura Guiada): prepara el modo de audio", () => {
    const result = applyStrategyPreset("audio", READER_DEFAULTS);
    expect(result.strategyPreset).toBe("audio");
    expect(result.focusRuler).toBe(false);
    expect(result.paragraphFocus).toBe(false);
    expect(result.syntacticLines).toBe(false);
    expect(isStrategyPresetActive("audio", result)).toBe(true);
  });

  it("configura custom: conserva banderas manuales", () => {
    const initial = {
      ...READER_DEFAULTS,
      focusRuler: true,
      paragraphFocus: false,
      syntacticLines: true,
    };
    const result = applyStrategyPreset("custom", initial);
    expect(result.strategyPreset).toBe("custom");
    expect(result.focusRuler).toBe(true);
    expect(result.paragraphFocus).toBe(false);
    expect(result.syntacticLines).toBe(true);
    expect(isStrategyPresetActive("custom", result)).toBe(true);
  });
});

describe("readerCssVars", () => {
  it("mapea los ajustes a variables de lectura", () => {
    const vars = readerCssVars({
      ...READER_DEFAULTS,
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
      focusMode: "off",
      rulerSize: 3,
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

describe("PracticeCompanionMode", () => {
  it("defaults to animated when nothing is saved", () => {
    localStorage.clear();
    expect(loadPracticeCompanionMode()).toBe("animated");
  });

  it("persists calm and off modes", () => {
    savePracticeCompanionMode("calm");
    expect(loadPracticeCompanionMode()).toBe("calm");
    savePracticeCompanionMode("off");
    expect(loadPracticeCompanionMode()).toBe("off");
  });

  it("clears storage when set back to animated default", () => {
    savePracticeCompanionMode("off");
    savePracticeCompanionMode("animated");
    expect(loadPracticeCompanionMode()).toBe("animated");
    expect(localStorage.getItem("lecta:companion:practice")).toBeNull();
  });
});

describe("NativeLanguage", () => {
  it("defaults to 'es' when nothing is saved", () => {
    localStorage.clear();
    expect(loadNativeLanguage()).toBe("es");
    expect(hasExplicitNativeLanguage()).toBe(false);
  });

  it("persists chosen language and marks as confirmed", () => {
    saveNativeLanguage("en");
    expect(loadNativeLanguage()).toBe("en");
    expect(hasExplicitNativeLanguage()).toBe(true);
  });

  it("removes storage key when reset to default 'es' but remains confirmed", () => {
    saveNativeLanguage("en");
    saveNativeLanguage("es");
    expect(loadNativeLanguage()).toBe("es");
    expect(localStorage.getItem("lecta:nativeLanguage")).toBeNull();
    expect(hasExplicitNativeLanguage()).toBe(true);
  });

  it("resolves readerProfileFor based on nativeLanguage and bookLanguage", () => {
    expect(readerProfileFor("es", "es")).toBe("native");
    expect(readerProfileFor("en", "es")).toBe("learner");
    expect(readerProfileFor("es", "en")).toBe("learner");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("actualiza <meta name=\"theme-color\"> a #000000 con oled", () => {
    applyTheme("oled");
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute("content")).toBe("#000000");
    expect(document.documentElement.dataset.theme).toBe("oled");
  });

  it("actualiza <meta name=\"theme-color\"> a #141619 con night o noche", () => {
    applyTheme("night");
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe("#141619");
    expect(document.documentElement.dataset.theme).toBe("noche");

    applyTheme("noche");
    expect(meta?.getAttribute("content")).toBe("#141619");
  });

  it("actualiza <meta name=\"theme-color\"> a #FBF7F0 con paper o papel", () => {
    applyTheme("paper");
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe("#FBF7F0");
    expect(document.documentElement.dataset.theme).toBe("papel");
  });
});

describe("applyReadingPreset", () => {
  it("'clean' apaga todas las ayudas visuales", () => {
    const customized = {
      ...READER_DEFAULTS,
      focusRuler: true,
      paragraphFocus: true,
      syntacticLines: true,
      chromaticGuide: true,
      colorGuide: true,
      bionicAnchors: true,
      visualPacer: true,
      highlightLexical: true,
    };
    const res = applyReadingPreset(customized, "clean");
    expect(res.focusRuler).toBe(false);
    expect(res.paragraphFocus).toBe(false);
    expect(res.syntacticLines).toBe(false);
    expect(res.chromaticGuide).toBe(false);
    expect(res.colorGuide).toBe(false);
    expect(res.bionicAnchors).toBe(false);
    expect(res.visualPacer).toBe(false);
    expect(res.highlightLexical).toBe(false);
    expect(res.readingPreset).toBe("clean");
  });

  it("'adhd' activa paragraphFocus y desactiva syntacticLines / colorGuide", () => {
    const initial = {
      ...READER_DEFAULTS,
      syntacticLines: true,
      chromaticGuide: true,
      colorGuide: true,
      paragraphFocus: false,
    };
    const res = applyReadingPreset(initial, "adhd");
    expect(res.paragraphFocus).toBe(true);
    expect(res.syntacticLines).toBe(false);
    expect(res.colorGuide).toBe(false);
    expect(res.chromaticGuide).toBe(false);
    expect(res.readingPreset).toBe("adhd");
  });

  it("'guided' activa syntacticLines y colorGuide y desactiva paragraphFocus", () => {
    const initial = {
      ...READER_DEFAULTS,
      paragraphFocus: true,
      syntacticLines: false,
      colorGuide: false,
      chromaticGuide: false,
    };
    const res = applyReadingPreset(initial, "guided");
    expect(res.syntacticLines).toBe(true);
    expect(res.colorGuide).toBe(true);
    expect(res.chromaticGuide).toBe(true);
    expect(res.paragraphFocus).toBe(false);
    expect(res.readingPreset).toBe("guided");
  });
});

