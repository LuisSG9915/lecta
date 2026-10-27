import {
  listKnowledge,
  listSavedWords,
  loadSessionValue,
  type DbScope,
  type KnownWord,
  type SavedWord,
} from "./idb";
import {
  cliticBasesFor,
  estimateProfile,
  isCredibleKnowledge,
  predictSection,
  PROFILE_ADJUST_KEY,
  resolveEvidence,
  type KnowledgeEvidence,
} from "./knowledge";
import { batchLookup, type LexiconEntry } from "./lexicon";

// Cobertura de vocabulario por libro: qué fracción de sus formas únicas
// el lector ya conoce según su perfil. Una envoltura sobre predictSection
// — el mismo clasificador que decide las sugerencias de una sección,
// aplicado al libro completo. La usa la insignia del catálogo (manifiesto
// precomputado por el seed) y la de los libros propios (análisis local
// con la misma forma de datos).

export type CoverageInputs = {
  // Formas y lemas guardados en el cuaderno, en minúsculas — mismo
  // conjunto que el lector (savedFormLevels de Reader).
  saved: Set<string>;
  // Evidencia creíble por lema: «ya la sé» / «no la sé» explícitas e
  // inferidas con respaldo — mismo filtro isCredibleKnowledge.
  knowledge: Map<string, { lemma: string; known: boolean }>;
  threshold: number;
  confidence: "low" | "mid" | "high";
  // Cuántas filas de evidencia alimentaron el perfil: sirve para no
  // presumir una cobertura medida con casi nada detrás.
  evidenceCount: number;
};

export type BookCoverage = {
  // 0–100 redondeado: fracción del libro que el lector ya conoce o
  // tiene guardada (predicted + missing + uncertain = lo que falta).
  percent: number;
  total: number; // formas únicas analizadas
  missing: number; // sin ficha en el catálogo
  uncertain: number; // con ficha pero sin medición ni evidencia
  newWordsCount?: number; // nuevas palabras útiles que aportaría al cuaderno
  // Formas del libro que el lector ya tiene en su Cuaderno: la promesa
  // de «reencuentro» al elegir la siguiente lectura.
  reencuentrosCount?: number;
};

// Reúne las tres fuentes del perfil — cuaderno, conocimiento declarado/
// inferido y el ajuste manual — con la misma cadena que el lector
// (refreshProfile): mismas reglas = misma lectura de nivel.
export async function inputsForCoverage(
  language: string,
  scope?: DbScope,
): Promise<CoverageInputs> {
  const [rows, words] = await Promise.all([
    listKnowledge(language, scope).catch(() => [] as KnownWord[]),
    listSavedWords(language, scope).catch(() => [] as SavedWord[]),
  ]);

  const saved = new Set<string>();
  for (const word of words) {
    for (const term of [word.form, word.lemma]) {
      if (term) saved.add(term.toLowerCase());
    }
  }

  const credible = rows.filter((row) => isCredibleKnowledge(row, saved));
  const knowledge = new Map<string, { lemma: string; known: boolean }>();
  const evidence: KnowledgeEvidence[] = [];

  if (credible.length) {
    const result = await batchLookup(
      credible.map((item) => item.lemma),
      language,
      scope,
    ).catch(() => null);
    const entries = result?.ok ? result.entries : {};
    // Formas sin ficha cuya base clítica existe: declaran sobre el lema
    // base («abrirlo» → «abrir»), igual que en el lector.
    const bases = cliticBasesFor(credible, entries);
    const baseResult = bases.length
      ? await batchLookup(bases, language, scope).catch(() => null)
      : null;
    const resolved = resolveEvidence(
      credible,
      entries,
      baseResult?.ok ? baseResult.entries : {},
    );
    for (const [lemma, item] of resolved) {
      knowledge.set(lemma, { lemma, known: item.known });
      evidence.push({ zipf: item.zipf, known: item.known });
    }
  }

  const storedAdjust = Number(
    await loadSessionValue(PROFILE_ADJUST_KEY, scope).catch(() => null),
  );
  const profile = estimateProfile(
    evidence,
    Number.isFinite(storedAdjust) ? storedAdjust : 0,
  );
  return {
    saved,
    knowledge,
    threshold: profile.threshold,
    confidence: profile.confidence,
    evidenceCount: evidence.length,
  };
}

// Idioma de la cobertura: el de la evidencia por lema («es», «en»).
// Las etiquetas regionales del EPUB («en-US») se reducen a dos letras.
export function coverageLanguageOf(language?: string | null): string {
  return (language || "es").slice(0, 2).toLowerCase();
}

// Perfil por idioma, leído una sola vez por idioma y lote: cada libro se
// mide contra lo que el lector sabe de SU idioma. Un fallo deja ese
// idioma sin insignias (null), sin apagar los demás.
export function createCoverageInputsLoader(
  scope: DbScope | undefined,
  load: (
    language: string,
    scope?: DbScope,
  ) => Promise<CoverageInputs | null> = inputsForCoverage,
): (language?: string | null) => Promise<CoverageInputs | null> {
  const cache = new Map<string, Promise<CoverageInputs | null>>();
  return (language) => {
    const lang = coverageLanguageOf(language);
    let pending = cache.get(lang);
    if (!pending) {
      pending = load(lang, scope).catch(() => null);
      cache.set(lang, pending);
    }
    return pending;
  };
}

// Cobertura de un libro a partir de sus formas + el mapa de fichas
// (del manifiesto del catálogo o del análisis local — misma forma de
// dato, mismo resultado).
export function coverageOfBook(
  forms: string[],
  entriesByForm: Record<string, LexiconEntry[]>,
  inputs: CoverageInputs,
): BookCoverage {
  const prediction = predictSection(
    forms,
    entriesByForm,
    inputs.saved,
    inputs.knowledge,
    inputs.threshold,
  );
  // «Cubierta» = ya en el cuaderno o clasificada como conocida. Las
  // predichas y diferidas son vocabulario que el lector aún no tiene;
  // missing/uncertain no se pueden afirmar conocidas tampoco.
  const covered = prediction.savedCount + prediction.knownCount;
  const newWordsCount =
    prediction.predicted.length + (prediction.deferred?.length ?? 0);
  const reencounterLemmas = new Set<string>();
  for (const form of forms) {
    const lower = form.toLowerCase();
    const matched = (entriesByForm[form] ?? []).find((entry) =>
      inputs.saved.has(entry.lemma.toLowerCase()),
    );
    if (matched) reencounterLemmas.add(matched.lemma.toLowerCase());
    else if (inputs.saved.has(lower))
      reencounterLemmas.add(entriesByForm[form]?.[0]?.lemma?.toLowerCase() || lower);
  }
  return {
    percent: prediction.total
      ? Math.round((covered / prediction.total) * 100)
      : 0,
    total: prediction.total,
    missing: prediction.missing.length,
    uncertain: prediction.uncertain.length,
    newWordsCount,
    reencuentrosCount: reencounterLemmas.size,
  };
}

// Orden de recomendación: los libros en zona fluida o ideal (≥ 86 %)
// van antes que los que piden más apoyo; dentro de esa zona gana el
// que repite más palabras del Cuaderno del lector, y a empate manda el
// mayor porcentaje de cobertura.
export function compareBookCoverages(a: BookCoverage, b: BookCoverage): number {
  const aInZone = a.percent >= COVERAGE_IDEAL_MIN ? 1 : 0;
  const bInZone = b.percent >= COVERAGE_IDEAL_MIN ? 1 : 0;
  if (aInZone !== bInZone) return bInZone - aInZone;
  if (aInZone === 1) {
    const aRe = a.reencuentrosCount ?? 0;
    const bRe = b.reencuentrosCount ?? 0;
    if (aRe !== bRe) return bRe - aRe;
  }
  return b.percent - a.percent;
}

// Umbrales únicos de cobertura: la insignia del catálogo, la de la
// estantería y la etiqueta de nivel leen la misma escala. Por debajo
// del ideal, el libro pide apoyo; no hay dos números para lo mismo.
export const COVERAGE_FLUID_MIN = 94;
export const COVERAGE_IDEAL_MIN = 86;

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
