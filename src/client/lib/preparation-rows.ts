// Selección de candidatas por capítulo compartida por el lector y la
// pantalla «Leo este libro en papel»: un único punto donde se arma la
// llamada a buildSuggestionRows garantiza que ambas superficies muestren
// exactamente las mismas palabras. Sin estado, sin red, sin IndexedDB.

import type { ChapterAnalysis } from "./chapter-analysis";
import type { PreparationRow } from "./preparation";
import { buildSuggestionRows, type SuggestionRows } from "./section-words";
import { loadUserTheta } from "./profile-models";
import { loadNativeLanguage } from "./settings";
import type { MarkLevel } from "./word-level";

type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

// El contexto del lector que decide la selección: las formas ya en el
// Cuaderno, la evidencia de conocimiento por lema y el umbral calibrado.
// El llamador resuelve `threshold` (perfil vigente o reestimado).
export type ChapterRowsContext = {
  saved: ReadonlyMap<string, MarkLevel>;
  knowledge: ReadonlyMap<
    string,
    {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }
  >;
  threshold: number;
};

// Misma llamada que hace la preparación del lector: mismos datos de
// entrada, mismas filas. `bookFrequencies` queda fuera a propósito —
// el lector no lo pasa y la lista debe ser idéntica.
export function buildChapterSuggestionRows(
  analysis: ReadyAnalysis,
  lang: string,
  ctx: ChapterRowsContext,
  lex?: Map<string, PreparationRow>,
): SuggestionRows {
  return buildSuggestionRows({
    language: lang,
    forms: analysis.forms,
    entries: analysis.entries,
    capitalOnly: analysis.capitalOnly,
    text: analysis.text,
    saved: ctx.saved,
    knowledge: ctx.knowledge,
    threshold: ctx.threshold,
    userTheta: loadUserTheta(lang),
    isSecondLanguage: lang !== loadNativeLanguage(),
    lex,
  });
}
