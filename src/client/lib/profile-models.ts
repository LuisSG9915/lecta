import { estimateProfile, type KnowledgeEvidence } from "./knowledge";

// ---------- Modelos candidatos del umbral de sugerencias ----------
//
// Todos responden la misma pregunta con la misma evidencia — «¿a
// partir de qué zipf predigo conocida?»— para que la evaluación
// cronológica (profile-eval) compare los mismos dos errores:
//   · falsa alarma: el lector la conoce pero el umbral la sugiere;
//   · omisión: el lector no la conoce pero el umbral la da por sabida.
// Ninguno está activado en producción: la comparación decide cuál
// sustituye a la línea base.

export type SelectorModel = (evidence: KnowledgeEvidence[]) => number;

// Rejilla de umbrales candidatos, la misma que usa estimateProfile.
export const THRESHOLD_CANDIDATES = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const measured = (evidence: KnowledgeEvidence[]) =>
  evidence.filter(
    (item): item is KnowledgeEvidence & { zipf: number } =>
      typeof item.zipf === "number" && Number.isFinite(item.zipf),
  );

const errorsAt = (items: { zipf: number; known: boolean }[], t: number) =>
  items.reduce(
    (n, item) => n + (item.zipf! >= t === item.known ? 0 : 1),
    0,
  );

// Línea base previa: minimiza errores sin regularización (a empate
// gana el más cercano al valor base 3.0). Ya no es el selector — se
// conserva solo para la comparación cronológica.
export const legacyModel: SelectorModel = (evidence) => {
  const items = measured(evidence);
  let best = 3.0;
  let bestErrors = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const t of THRESHOLD_CANDIDATES) {
    const errors = errorsAt(items, t);
    const distance = Math.abs(t - 3.0);
    if (errors < bestErrors || (errors === bestErrors && distance < bestDistance)) {
      best = t;
      bestErrors = errors;
      bestDistance = distance;
    }
  }
  return best;
};

// Selector vigente: estimateProfile, ya con la regularización λ=2.
export const currentModel: SelectorModel = (evidence) =>
  estimateProfile(evidence).threshold;

// Regularizado hacia el valor base: el conteo de errores más un
// castigo por alejarse de 3.0. Con λ=2, una muestra corta de «la
// conozco» raras ya no arrastra el umbral al extremo — es la caída a
// 1.5 que vimos en las pruebas reales: ahí 1.5 ganaba por un solo
// error menos y el castigo lo revierte.
export function regularizedModel(
  evidence: KnowledgeEvidence[],
  lambda = 2,
  base = 3.0,
): number {
  const items = measured(evidence);
  let best = base;
  let bestScore = errorsAt(items, base) + lambda * 0;
  for (const t of THRESHOLD_CANDIDATES) {
    const score = errorsAt(items, t) + lambda * Math.abs(t - base);
    if (
      score < bestScore ||
      (score === bestScore && Math.abs(t - base) < Math.abs(best - base))
    ) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// Estimación por bandas: tasa de «no la conozco» por banda zipf de
// 0.5, suavizada (Laplace) hacia la tasa global. El umbral queda en
// el borde superior de la banda más alta que aún se desconoce con
// probabilidad ≥ 0.5 — por debajo se predice desconocida.
export function bandModel(evidence: KnowledgeEvidence[], alpha = 2): number {
  const items = measured(evidence);
  if (!items.length) return 3.0;
  const edges = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5];
  const globalUnknown = items.filter((i) => !i.known).length / items.length;
  let threshold = 1.5;
  for (let i = 0; i + 1 < edges.length; i++) {
    const band = items.filter((item) => item.zipf! >= edges[i] && item.zipf! < edges[i + 1]);
    const unknown = band.filter((item) => !item.known).length;
    const rate = (unknown + alpha * globalUnknown) / (band.length + alpha);
    if (rate >= 0.5) threshold = edges[i + 1];
  }
  return threshold;
}

// ---------- Evaluación cronológica ----------
//
// Para cada lote: los modelos se ajustan SOLO con la evidencia
// anterior y se evalúan en ese lote — así nada del futuro «prueba»
// el comportamiento pasado. Filas de entrada: evidencia ya resuelta
// por lema efectivo con su zipf.

export type EvalRow = {
  zipf: number;
  known: boolean;
  source: string;
  batch: number;
};

export type BatchResult = {
  batch: number;
  threshold: number;
  tested: number;
  falseAlarms: number;
  misses: number;
};

export type ModelResult = {
  model: string;
  batches: BatchResult[];
  falseAlarms: number;
  misses: number;
};

export function evaluateChronological(
  rows: readonly EvalRow[],
  models: Record<string, SelectorModel>,
): ModelResult[] {
  const batches = [...new Set(rows.map((row) => row.batch))].sort(
    (a, b) => a - b,
  );
  return Object.entries(models).map(([model, select]) => {
    const results: BatchResult[] = [];
    let falseAlarms = 0;
    let misses = 0;
    for (const batch of batches) {
      const train = rows.filter((row) => row.batch < batch);
      const test = rows.filter((row) => row.batch === batch);
      if (!train.length || !test.length) continue;
      const threshold = select(train);
      let fa = 0;
      let om = 0;
      for (const row of test) {
        const predictedKnown = row.zipf >= threshold;
        if (predictedKnown && !row.known) om++;
        if (!predictedKnown && row.known) fa++;
      }
      falseAlarms += fa;
      misses += om;
      results.push({ batch, threshold, tested: test.length, falseAlarms: fa, misses: om });
    }
    return { model, batches: results, falseAlarms, misses };
  });
}
