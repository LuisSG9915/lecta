import { describe, expect, it } from "vitest";
import {
  OPTICAL_RECIPE_STEPS,
  buildOpticalRecipePatch,
  defaultOpticalChoicesFromSettings,
  extractSamplePassage,
  summarizeOpticalRecipe,
} from "./optical-recipe";

describe("optical-recipe", () => {
  it("define los 4 pasos A/B con notas legibles sin jerga", () => {
    expect(OPTICAL_RECIPE_STEPS.map((s) => s.id)).toEqual([
      "spacing",
      "measure",
      "font",
      "layout",
    ]);
    for (const step of OPTICAL_RECIPE_STEPS) {
      expect(step.options).toHaveLength(2);
      expect(step.question.length).toBeGreaterThan(10);
      expect(step.scienceNote.length).toBeGreaterThan(15);
    }
  });

  it("extractSamplePassage salta encabezados cortos y en mayúsculas", () => {
    const raw = [
      "CAPÍTULO IV",
      "EL REGRESO",
      "Subtítulo breve",
      "Cuando abrieron las ventanas de la biblioteca, el aire fresco movió las hojas del cuaderno sobre el escritorio de roble.",
    ].join("\n");

    const sample = extractSamplePassage(raw, "es");
    expect(sample).toContain("Cuando abrieron las ventanas");
    expect(sample).not.toContain("CAPÍTULO IV");
  });

  it("extractSamplePassage recorta textos largos en límite limpio de oración", () => {
    const raw =
      "Primera frase suficientemente larga para que el recorte alcance más de ciento diez caracteres sin dificultad alguna en la lectura. Segunda frase adicional que extiende el párrafo muchísimo más allá de doscientos diez caracteres para probar el límite superior de la muestra.";
    const sample = extractSamplePassage(raw, "es");
    expect(sample.length).toBeLessThanOrEqual(210);
    expect(sample.endsWith(".")).toBe(true);
  });

  it("extractSamplePassage usa pasajes literarios de respaldo en es y en", () => {
    const esSample = extractSamplePassage("Corto", "es-MX");
    const enSample = extractSamplePassage("", "en-US");
    expect(esSample).toContain("mañana");
    expect(enSample).toContain("morning light");
  });

  it("defaultOpticalChoicesFromSettings mapea la configuración actual", () => {
    expect(
      defaultOpticalChoicesFromSettings({
        textSpacing: "normal",
        measure: 65,
        font: "literata",
        layout: "scroll",
      }),
    ).toEqual({
      spacing: "normal",
      measure: "standard",
      font: "literata",
      layout: "scroll",
    });

    expect(
      defaultOpticalChoicesFromSettings({
        textSpacing: "wide",
        measure: 55,
        font: "atkinson",
        layout: "pages",
      }),
    ).toEqual({
      spacing: "relaxed",
      measure: "compact",
      font: "atkinson",
      layout: "pages",
    });
  });

  it("buildOpticalRecipePatch y summarizeOpticalRecipe generan ajustes consistentes", () => {
    const relaxedPatch = buildOpticalRecipePatch({
      spacing: "relaxed",
      measure: "compact",
      font: "atkinson",
      layout: "pages",
    });
    expect(relaxedPatch).toEqual({
      textSpacing: "relaxed",
      measure: 55,
      margins: "wide",
      font: "atkinson",
      layout: "pages",
    });

    const standardPatch = buildOpticalRecipePatch({
      spacing: "normal",
      measure: "standard",
      font: "literata",
      layout: "scroll",
    });
    expect(standardPatch).toEqual({
      textSpacing: "normal",
      measure: 65,
      margins: "medium",
      font: "literata",
      layout: "scroll",
    });

    expect(
      summarizeOpticalRecipe({
        spacing: "relaxed",
        measure: "compact",
        font: "atkinson",
        layout: "pages",
      }),
    ).toEqual([
      { label: "Espaciado", value: "Holgado" },
      { label: "Columna", value: "Compacta (55)" },
      { label: "Letra", value: "Atkinson Next" },
      { label: "Paginación", value: "Por páginas" },
    ]);
  });
});
