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
  return {
    percent: prediction.total
      ? Math.round((covered / prediction.total) * 100)
      : 0,
    total: prediction.total,
    missing: prediction.missing.length,
    uncertain: prediction.uncertain.length,
  };
}

// Etiqueta humana de la insignia. Conservadora a propósito: un 92%
// medido con poca evidencia no se anuncia como «en tu nivel» — el
// número sigue viéndose, pero el texto no promete lo que el perfil aún
// no sabe sostener.
export function coverageLabel(percent: number, confidence: "low" | "mid" | "high") {
  if (confidence === "low") return null;
  if (percent >= 90) return "En tu nivel";
  if (percent >= 75) return "Asequible";
  if (percent >= 60) return "Un reto";
  return "Exigente";
}
