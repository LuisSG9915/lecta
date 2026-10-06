// Evaluación cronológica de los modelos de umbral con evidencia
// real anonimizada (lecta, solo lectura): [zipf, conocida, fuente,
// lote]. Los lotes cortan cuando pasan >60 s entre respuestas — cada
// uno reproduce lo que el lector ya había respondido al llegar.
// No hay lemas ni usuarios: solo señales del modelo.
import { describe, expect, it } from "vitest";
import {
  bandModel,
  currentModel,
  evaluateChronological,
  legacyModel,
  type EvalRow,
} from "./profile-models";

const RAW: [number, boolean, string, number][] = [
  [2.94, true, "calibration", 1],
  [2.04, false, "calibration", 1],
  [2.23, true, "calibration", 1],
  [2.04, false, "calibration", 1],
  [2.82, false, "calibration", 1],
  [2.24, true, "calibration", 1],
  [2.22, true, "calibration", 1],
  [2.18, false, "calibration", 1],
  [2.9, true, "calibration", 1],
  [3.91, true, "calibration", 1],
  [3.08, true, "calibration", 1],
  [3.93, false, "calibration", 1],
  [3.1, true, "calibration", 1],
  [3.72, true, "calibration", 1],
  [2.93, false, "calibration", 1],
  [3.1, true, "calibration", 1],
  [3.16, true, "calibration", 1],
  [3.47, true, "calibration", 1],
  [2.92, true, "calibration", 1],
  [3.48, true, "calibration", 1],
  [2.59, true, "calibration", 1],
  [4.5, true, "calibration", 1],
  [3.72, true, "calibration", 1],
  [4.26, true, "calibration", 1],
  [4.09, true, "calibration", 1],
  [4.64, true, "calibration", 1],
  [4.23, true, "calibration", 1],
  [4.94, true, "calibration", 1],
  [4.62, true, "calibration", 1],
  [4.31, true, "calibration", 1],
  [4.41, true, "calibration", 1],
  [4.96, true, "calibration", 1],
  [4.83, true, "calibration", 1],
  [3.76, true, "calibration", 1],
  [4.06, true, "calibration", 1],
  [3.55, true, "calibration", 1],
  [2.5, false, "inferred", 1],
  [1.85, false, "inferred", 1],
  [4.77, true, "declared", 1],
  [5.15, true, "declared", 1],
  [4.77, true, "declared", 1],
  [5.48, true, "preparation", 2],
  [5.78, true, "preparation", 2],
  [5.13, true, "preparation", 2],
  [5.28, true, "preparation", 2],
  [4.12, true, "preparation", 2],
  [4.96, true, "preparation", 2],
  [2.49, true, "preparation", 2],
  [5.15, true, "preparation", 2],
  [1.54, true, "preparation", 2],
  [1.96, true, "preparation", 2],
  [1.33, false, "preparation", 3],
  [1.41, true, "preparation", 3],
  [2.1, false, "saved", 4],
  [2.92, false, "saved", 4],
  [3.32, false, "saved", 5],
  [1.24, false, "preparation", 6],
  [1.49, false, "preparation", 8],
  [1.38, true, "preparation", 8],
  [1.76, false, "saved", 8],
  [1.92, false, "saved", 8],
  [2.46, false, "preparation", 10],
  [2.28, false, "preparation", 10],
  [2.18, false, "preparation", 10],
  [2.91, true, "preparation", 10],
  [2.34, true, "preparation", 10],
  [2.99, true, "preparation", 10],
  [2.83, true, "preparation", 10],
  [2.5, false, "preparation", 10],
  [2.44, true, "preparation", 10],
  [2.33, false, "preparation", 10],
  [1.44, true, "preparation", 10],
  [1.11, true, "preparation", 10],
  [2.75, true, "preparation", 10],
  [1.71, false, "preparation", 10],
  [1.64, false, "preparation", 10],
  [2.85, true, "preparation", 10],
  [2.86, true, "preparation", 10],
  [1.98, false, "preparation", 10],
  [2.51, false, "preparation", 10],
  [1.88, true, "preparation", 11],
  [1.42, false, "preparation", 11],
  [2.13, true, "preparation", 11],
  [2.24, true, "preparation", 11],
  [1.59, true, "preparation", 11],
  [2.43, false, "preparation", 11],
  [1.42, false, "preparation", 11],
  [1.79, false, "preparation", 11],
  [1.68, true, "preparation", 11],
  [2.15, false, "preparation", 11],
  [2.27, true, "calibration", 12],
  [2.23, false, "calibration", 12],
  [2.12, false, "calibration", 12],
  [3.28, true, "calibration", 12],
  [2.87, false, "calibration", 12],
  [2.71, true, "calibration", 12],
  [2.96, true, "calibration", 12],
  [2.74, true, "calibration", 12],
  [2.31, false, "calibration", 12],
  [2.5, true, "calibration", 12],
  [3.11, true, "calibration", 12],
  [2.31, false, "calibration", 12],
  [2.41, true, "calibration", 12],
  [2.82, false, "calibration", 12],
  [3.88, true, "calibration", 12],
  [3.38, true, "calibration", 12],
  [3.84, true, "calibration", 12],
  [3.22, true, "calibration", 12],
  [3.57, true, "calibration", 12],
  [3.5, true, "calibration", 12],
  [4.02, true, "calibration", 12],
  [4.39, true, "calibration", 12],
  [3.1, true, "calibration", 12],
  [3.7, true, "calibration", 12],
  [3.74, true, "calibration", 12],
  [3.25, true, "calibration", 12],
  [4.96, true, "calibration", 12],
  [4.35, true, "calibration", 12],
  [4.84, true, "calibration", 12],
  [4.69, true, "calibration", 12],
  [4.49, true, "calibration", 12],
  [4.53, true, "calibration", 12],
  [4.32, true, "calibration", 12],
  [4.29, true, "calibration", 12],
  [4.57, true, "calibration", 12],
  [4.59, true, "calibration", 12],
  [2.25, false, "saved", 13],
  [2.68, false, "saved", 14],
  [2.87, false, "saved", 15],
  [3.08, true, "declared", 16],
  [2.43, true, "preparation", 17],
  [1.97, false, "preparation", 17],
  [2.45, true, "preparation", 17],
  [2.28, true, "preparation", 17],
  [1.3, false, "preparation", 17],
  [2.49, true, "preparation", 17],
  [1.79, true, "preparation", 17],
  [1.41, false, "preparation", 18],
  [1.87, true, "preparation", 18],
  [1.9, false, "preparation", 18],
  [1.26, true, "preparation", 18],
  [1.86, true, "preparation", 18],
  [1.58, false, "preparation", 18],
  [1.99, true, "preparation", 18],
  [2.02, true, "preparation", 18],
  [1.78, true, "preparation", 18],
  [1.82, false, "preparation", 18],
  [2.87, true, "preparation", 18],
  [1.9, false, "preparation", 18],
  [1.91, false, "preparation", 18],
  [1.59, true, "preparation", 18],
  [1.81, false, "preparation", 18],
  [1.14, false, "preparation", 18],
  [1.29, true, "preparation", 18],
  [1.63, true, "preparation", 18],
  [1.47, false, "preparation", 18],
  [1.92, false, "preparation", 18],
  [1.98, true, "preparation", 18],
  [1.33, false, "preparation", 18],
  [1.71, true, "preparation", 18],
  [1.29, false, "preparation", 18],
  [1.33, true, "preparation", 18],
  [1.7, false, "preparation", 18],
  [1.77, true, "preparation", 18],
  [1.16, false, "preparation", 18],
  [1.88, true, "preparation", 18],
  [1.68, true, "preparation", 18],
  [1.61, true, "preparation", 18],
  [1.16, false, "preparation", 18],
  [1.3, true, "preparation", 18],
  [1.64, true, "preparation", 18],
  [1.92, false, "preparation", 18],
  [1.98, true, "preparation", 18],
  [1.43, true, "preparation", 18],
  [2.01, true, "preparation", 18],
  [1.84, false, "preparation", 18],
  [1.73, true, "preparation", 18],
  [1.37, false, "preparation", 18],
];

const ROWS: EvalRow[] = RAW.map(([zipf, known, source, batch]) => ({
  zipf,
  known,
  source,
  batch,
}));

const MODELS = {
  previo: legacyModel,
  vigente: currentModel,
  bandas: bandModel,
};

const results = evaluateChronological(ROWS, MODELS);
const byModel = Object.fromEntries(results.map((r) => [r.model, r]));
const at = (model: string, batch: number) =>
  byModel[model].batches.find((b) => b.batch === batch);

describe("modelos de umbral", () => {
  it("la regularización no cae al extremo con un lote corto de conocidas raras", () => {
    // Caso documentado: tras el examen + el lote de 11 «la conozco»,
    // el selector anterior bajaba a 1.5 aunque solo ganaba por un
    // error. El vigente (regularizado) se queda en 2.5 o más.
    const afterBatch2 = ROWS.filter((row) => row.batch <= 2);
    expect(legacyModel(afterBatch2)).toBe(1.5);
    expect(currentModel(afterBatch2)).toBeGreaterThanOrEqual(2.5);
  });

  it("los tres modelos devuelven umbrales dentro de la rejilla", () => {
    for (const result of results)
      for (const b of result.batches) {
        expect(b.threshold).toBeGreaterThanOrEqual(1.5);
        expect(b.threshold).toBeLessThanOrEqual(6.5);
      }
  });

  it("en las palabras guardadas el vigente omite menos que el previo", () => {
    // Lotes 4–5 y 13–15 son palabras guardadas (las desconocidas que
    // el modelo más debía anticipar): el vigente no puede omitir más
    // que la línea base anterior en ellas.
    const savedBatches = [4, 5, 13, 14, 15];
    const missed = (model: string) =>
      savedBatches.reduce((n, b) => n + (at(model, b)?.misses ?? 0), 0);
    expect(missed("vigente")).toBeLessThanOrEqual(missed("previo"));
  });

  it("reporta la tabla comparativa por lote", () => {
    // No es una aserción: deja impreso el detalle para revisar qué
    // modelo conviene antes de tocar el selector vigente.
    const lines = results.map((result) =>
      [
        `${result.model} — falsas alarmas: ${result.falseAlarms}, omisiones: ${result.misses}`,
        ...result.batches.map(
          (b) =>
            `  lote ${b.batch}: t=${b.threshold} · ${b.tested} probadas · ${b.falseAlarms} FA · ${b.misses} OM`,
        ),
      ].join("\n"),
    );
    console.log(`\n${lines.join("\n\n")}`);
    expect(results).toHaveLength(3);
  });
});
