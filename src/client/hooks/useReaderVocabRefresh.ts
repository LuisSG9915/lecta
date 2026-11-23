// Refresco por sincronización: cuando llegan palabras nuevas se remarca sin
// remontar el lector (así no se pierde la posición) y se recarga la evidencia
// de conocimiento, por si también bajó.
//
// Extraído de Reader.tsx (R1/F3). El efecto sigue dependiendo solo de
// `vocabVersion`: corre cuando la sincronización cambia, no en cada render.
import { useEffect } from "react";
import { selectSavedForEnrichment } from "../lib/enrichment-candidates";
import { captureDbScope, listSavedWords, type DbScope } from "../lib/idb";
import { loadUseAi } from "../lib/ai-pref";
import { enrichBatch } from "../lib/lexicon";
import { refreshProfile } from "../lib/reader-evidence";
import type { SavedWord } from "../lib/idb";
import type { SectionPrediction } from "../lib/knowledge";

// El lote de palabras guardadas sin definición es una pasada única
// por apertura de libro, acotado por el cuaderno real del lector —
// no es gasto recurrente como el de secciones, así que conserva más.
const SAVED_ENRICH_CAP = 20;

type Ref<T> = { current: T };

export interface UseReaderVocabRefreshOptions {
  vocabVersion: number;
  language: string;
  state: string;
  /** Guarda las palabras en los refs/estado del lector. */
  onWordsLoaded: (words: SavedWord[]) => void;
  savedEnrichSentRef: Ref<boolean>;
  sectionIndexRef: Ref<number>;
  profileRefs: Parameters<typeof refreshProfile>[0];
  recordDominated: (words: SavedWord[], lang: string, scope?: DbScope) => unknown;
  applyPrediction: (index: number, lang: string) => SectionPrediction | null;
}

export function useReaderVocabRefresh({
  vocabVersion,
  language,
  state,
  onWordsLoaded,
  savedEnrichSentRef,
  sectionIndexRef,
  profileRefs,
  recordDominated,
  applyPrediction,
}: UseReaderVocabRefreshOptions): void {
  useEffect(() => {
    if (!language || state !== "ready") return;
    void (async () => {
      const scope = captureDbScope();
      const storedWords = await listSavedWords(language, scope);
      onWordsLoaded(storedWords);
      recordDominated(storedWords, language, scope);
      await refreshProfile(profileRefs, language, scope);
      // Guardadas sin definición: un solo lote por apertura del
      // libro — el lector ya dijo que no las sabe, completarlas vale
      // más que perseguir candidatas del análisis.
      if (!savedEnrichSentRef.current) {
        savedEnrichSentRef.current = true;
        const aiOn = await loadUseAi(scope).catch(() => true);
        if (aiOn && scope.userId) {
          const forms = selectSavedForEnrichment(storedWords, new Set(), SAVED_ENRICH_CAP);
          if (forms.length) void enrichBatch(forms, language, scope);
        }
      }
      // La sección visible se reclasifica con cuaderno y perfil
      // actualizados, sin otra consulta al catálogo.
      applyPrediction(sectionIndexRef.current, language);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabVersion]);
}
