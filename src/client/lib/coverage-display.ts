// Tipos, umbrales y etiquetas puras de cobertura sin arrastrar knowledge/lexicon.

export type BookCoverage = {
  // 0–100 redondeado: fracción del libro que el lector ya conoce o
  // tiene guardada (predicted + missing + uncertain = lo que falta).
  percent: number;
  total: number; // formas únicas analizadas
  missing: number; // sin ficha en el catálogo
  uncertain: number; // con ficha pero sin medición ni evidencia
  // 0–1: fracción de las formas que el catálogo sí pudo medir (ficha
  // con frecuencia o evidencia propia). Debajo de COVERAGE_MEASURED_MIN
  // el porcentaje no se sostiene — «sin ficha» no es «no la conoce» —
  // y la UI muestra COVERAGE_UNMEASURED_LABEL en lugar del número.
  measuredShare: number;
  newWordsCount?: number; // nuevas palabras útiles que aportaría al cuaderno
  // Formas del libro que el lector ya tiene en su Cuaderno: la promesa
  // de «reencuentro» al elegir la siguiente lectura.
  reencuentrosCount?: number;
  reencuentrosPonderados?: number;
};

// Bajo esta fracción el número de cobertura no es confiable: casi
// todas las formas quedaron «sin medir» y un porcentaje pintaría una
// certeza falsa (un libro en inglés sin catálogo marcaría «0 %
// conocido» como si el lector no conociera nada).
export const COVERAGE_MEASURED_MIN = 0.6;
export const COVERAGE_UNMEASURED_LABEL = "Vocabulario aún sin medir";

export function coverageIsReliable(
  coverage: Pick<BookCoverage, "measuredShare">,
): boolean {
  return coverage.measuredShare >= COVERAGE_MEASURED_MIN;
}

// Umbrales únicos de cobertura: la insignia del catálogo, la de la
// estantería y la etiqueta de nivel leen la misma escala. Por debajo
// del ideal, el libro pide apoyo; no hay dos números para lo mismo.
export const COVERAGE_FLUID_MIN = 94;
export const COVERAGE_IDEAL_MIN = 86;

// Orden de recomendación: los libros en zona fluida o ideal (≥ 86 %)
// van antes que los que piden más apoyo; dentro de esa zona gana el
// que repite más palabras del Cuaderno del lector, y a empate manda el
// mayor porcentaje de cobertura.
export function compareBookCoverages(a: BookCoverage, b: BookCoverage): number {
  // Los libros que el catálogo sí pudo medir van antes que los que
  // aún no tienen porcentaje confiable.
  const aOk = coverageIsReliable(a) ? 1 : 0;
  const bOk = coverageIsReliable(b) ? 1 : 0;
  if (aOk !== bOk) return bOk - aOk;
  const aInZone = a.percent >= COVERAGE_IDEAL_MIN ? 1 : 0;
  const bInZone = b.percent >= COVERAGE_IDEAL_MIN ? 1 : 0;
  if (aInZone !== bInZone) return bInZone - aInZone;
  if (aInZone === 1) {
    const aRe = a.reencuentrosPonderados ?? a.reencuentrosCount ?? 0;
    const bRe = b.reencuentrosPonderados ?? b.reencuentrosCount ?? 0;
    if (aRe !== bRe) return bRe - aRe;
  }
  return b.percent - a.percent;
}

// Etiqueta humana de la insignia. Conservadora a propósito: un 92%
// medido con poca evidencia no se anuncia como «en tu nivel» — el
// número sigue viéndose, pero el texto no promete lo que el perfil aún
// no sabe sostener.
export function coverageLabel(percent: number, confidence: "low" | "mid" | "high") {
  if (confidence === "low") return null;
  if (percent >= COVERAGE_FLUID_MIN) return "Lectura relajada";
  if (percent >= COVERAGE_IDEAL_MIN) return "Ideal para tu ritmo";
  if (percent >= 70) return "Un reto";
  return "Exigente";
}

export type AffinityTier = "fluida" | "reto" | "rico";

export function affinityTierOf(percent: number): AffinityTier {
  if (percent >= COVERAGE_FLUID_MIN) return "fluida";
  if (percent >= COVERAGE_IDEAL_MIN) return "reto";
  return "rico";
}

export function affinityBadgeLabel(percent: number): string {
  if (percent >= COVERAGE_FLUID_MIN) return "Lectura Fluida";
  if (percent >= COVERAGE_IDEAL_MIN) return "Reto Ideal (i+1)";
  return "Rico en Vocabulario";
}
