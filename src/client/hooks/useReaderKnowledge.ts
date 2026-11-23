// Conocimiento y predicción por sección del lector: análisis cacheado del
// destino visible, clasificación contra el perfil, lote automático de
// definiciones con IA y evidencia nueva aplicada de inmediato.
//
// Extraído de Reader.tsx (R1/F2). Los callbacks conservan las mismas
// dependencias que tenían en línea; los refs y setters son estables.
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { applyAttentionBudget } from "../lib/attention-budget";
import type { ChapterAnalyzer } from "../lib/chapter-analysis";
import { selectEnrichmentCandidates } from "../lib/enrichment-candidates";
import { captureDbScope } from "../lib/idb";
import type { EpubBook } from "../lib/epub";
import { batchLookup, enrichBatch } from "../lib/lexicon";
import {
  calibrationBankZipf,
  estimateProfile,
  predictSection,
  type KnowledgeEvidence,
  type SectionPrediction,
  type VocabProfile,
} from "../lib/knowledge";
import type { ReadyAnalysis } from "../lib/reader-evidence";
import type { MarkLevel } from "../lib/word-level";
import { hasUsableDefinition, measuredZipf } from "../../shared/lexicon";
import { useReaderApplyCachedPredictionRef } from "./useReaderApplyCachedPredictionRef";
import { useReaderZipfForLemmaRef } from "./useReaderZipfForLemmaRef";

// Tope del lote automático de definiciones con IA por sección. El
// catálogo ya cubre lo común (Wikcionario); el lote solo cierra
// huecos — 8 bastan para no dejar la hoja llena de «sin definición»
// sin abrir el gasto (cada palabra cuesta ~400–600 tokens).
const AUTO_ENRICH_CAP = 8;

type Ref<T> = { current: T };

export type KnowledgeRow = {
  lemma: string;
  known: boolean;
  status?: "unknown" | "familiar" | "known";
  passiveSeenCount?: number;
  estimatedKnownProb?: number;
};

export interface UseReaderKnowledgeOptions {
  language: string;
  bookHash: string;
  rangeFor: (index: number) => { target: { id: string } } | null;
  analyzerRef: Ref<ChapterAnalyzer | null>;
  profileRef: Ref<VocabProfile | null>;
  savedForms: Ref<Map<string, MarkLevel>>;
  knowledgeMapRef: Ref<Map<string, KnowledgeRow>>;
  sectionIndexRef: Ref<number>;
  sectionTextRef: Ref<string>;
  containerRef: Ref<HTMLElement | null>;
  bookRef: Ref<EpubBook | null>;
  enrichedTargets: Ref<Set<string>>;
  useAiRef: Ref<boolean>;
  evidenceRef: Ref<Map<string, KnowledgeEvidence>>;
  adjustRef: Ref<number>;
  baseThresholdRef: Ref<number>;
  setPrediction: (prediction: SectionPrediction | null) => void;
  setEnriching: Dispatch<SetStateAction<{ index: number; done: number; total: number } | null>>;
  applyCachedPredictionRef: Ref<((index: number, lang: string) => SectionPrediction | null) | null>;
  zipfForLemmaRef: Ref<((lemma: string) => number | null) | null>;
  ingestKnowledgeRow: (row: KnowledgeRow) => void;
}

export function useReaderKnowledge({
  language,
  bookHash,
  rangeFor,
  analyzerRef,
  profileRef,
  savedForms,
  knowledgeMapRef,
  sectionIndexRef,
  sectionTextRef,
  containerRef,
  bookRef,
  enrichedTargets,
  useAiRef,
  evidenceRef,
  adjustRef,
  baseThresholdRef,
  setPrediction,
  setEnriching,
  applyCachedPredictionRef,
  zipfForLemmaRef,
  ingestKnowledgeRow,
}: UseReaderKnowledgeOptions) {
  // Análisis «ready» del destino que contiene la sección.
  const analysisFor = useCallback(
    (index: number): ReadyAnalysis | undefined => {
      const range = rangeFor(index);
      const cached = range ? analyzerRef.current?.cached(range.target.id) : undefined;
      return cached?.state === "ready" ? cached : undefined;
    },
    [rangeFor, analyzerRef],
  );

  // Clasifica el destino ya cacheado contra el perfil vigente y el
  // cuaderno actual. Pura: sin red ni estado.
  const classifyCached = useCallback(
    (index: number): SectionPrediction | null => {
      const cached = analysisFor(index);
      const profile = profileRef.current;
      if (!cached || !profile) return null;
      return predictSection(
        cached.forms,
        cached.entries,
        new Set(savedForms.current.keys()),
        knowledgeMapRef.current,
        profile.threshold,
      );
    },
    [analysisFor, profileRef, savedForms, knowledgeMapRef],
  );

  // Lleva la predicción del destino a la UI si la sección es la
  // visible: remarca el texto (primero guardadas, que ganan sobre las
  // predichas si coinciden).
  const applyCachedPrediction = useCallback(
    (index: number, lang: string): SectionPrediction | null => {
      if (index !== sectionIndexRef.current) return null;
      const prediction = classifyCached(index);
      setPrediction(prediction);
      const container = containerRef.current;
      if (container) {
        applyAttentionBudget(
          container,
          savedForms.current,
          (prediction?.predicted ?? []).map((item) => item.form),
          sectionTextRef.current || container.textContent || "",
          bookHash,
          lang,
        );
      }
      return prediction;
    },
    [
      classifyCached,
      setPrediction,
      bookHash,
      sectionIndexRef,
      containerRef,
      savedForms,
      sectionTextRef,
    ],
  );
  // Espejo de applyCachedPrediction en ref estable — extraído a
  // useReaderApplyCachedPredictionRef (B7).
  useReaderApplyCachedPredictionRef({ applyCachedPrediction, applyCachedPredictionRef });

  // Tras una predicción con huecos (formas sin ficha o predichas sin
  // acepciones), la IA define lo que falta sola: una vez por destino,
  // con tope, y solo si «Usar IA» está activa y hay sesión. Las formas
  // siempre capitalizadas (nombres propios, extranjerismos) se quedan
  // fuera del lote; en la hoja siguen como «Sin definición todavía».
  const maybeAutoEnrich = useCallback(
    async (index: number, prediction: SectionPrediction, lang: string) => {
      const scope = captureDbScope();
      const book = bookRef.current;
      const range = rangeFor(index);
      const analysis = analysisFor(index);
      if (!book || !range || !analysis) return;
      if (enrichedTargets.current.has(range.target.id)) return;
      if (!useAiRef.current || !scope.userId) return;
      const candidates = selectEnrichmentCandidates(
        prediction,
        analysis.capitalOnly,
        knowledgeMapRef.current,
        AUTO_ENRICH_CAP,
      );
      if (!candidates.length) return;
      enrichedTargets.current.add(range.target.id);
      setEnriching({ index, done: 0, total: candidates.length });
      const batch = await enrichBatch(candidates, lang, scope);
      if (bookRef.current !== book) return;
      if (!batch.ok || batch.count === 0) {
        // Solo el fallo de red libera el cupo para reintentar en otra
        // visita; un lote aceptado con 0 programados no cambiaría.
        if (!batch.ok) enrichedTargets.current.delete(range.target.id);
        setEnriching(null);
        return;
      }

      // El workflow corre en segundo plano: consultamos varias veces
      // hasta que las fichas nuevas empiecen a aparecer en el catálogo.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (bookRef.current !== book) return;
        const result = await batchLookup(candidates, lang, scope);
        if (!result.ok) continue;
        const foundNow = candidates.filter((form) => hasUsableDefinition(result.entries[form]));
        if (!foundNow.length && attempt < 5) continue;
        // Las fichas nuevas entran al análisis cacheado; reclasificar
        // decide si eran predichas o resultan conocidas por su zipf.
        for (const form of foundNow) analysis.entries[form] = result.entries[form];
        applyCachedPrediction(index, lang);
        setEnriching((progress) => (progress ? { ...progress, done: foundNow.length } : progress));
        if (foundNow.length >= candidates.length) break;
      }
      setEnriching(null);
    },
    [
      rangeFor,
      analysisFor,
      applyCachedPrediction,
      setEnriching,
      bookRef,
      enrichedTargets,
      knowledgeMapRef,
      useAiRef,
    ],
  );

  // Predicción aplicada a la sección visible más el disparo del lote
  // automático de definiciones cuando corresponde.
  const applyPrediction = useCallback(
    (index: number, lang: string) => {
      const prediction = applyCachedPrediction(index, lang);
      if (prediction) void maybeAutoEnrich(index, prediction, lang);
      return prediction;
    },
    [applyCachedPrediction, maybeAutoEnrich],
  );

  // Medición de un lema desde el análisis cacheado del destino
  // visible: la evidencia escrita en sesión no espera al próximo
  // batchLookup de refreshProfile para pesar en el perfil.
  const zipfForLemma = useCallback(
    (lemma: string): number | null => {
      const cached = analysisFor(sectionIndexRef.current);
      if (!cached) return calibrationBankZipf(lemma, language);
      const matches = [];
      for (const entries of Object.values(cached.entries))
        for (const entry of entries) if (entry.lemma === lemma) matches.push(entry);
      return measuredZipf(matches, lemma) ?? calibrationBankZipf(lemma, language);
    },
    [analysisFor, language, sectionIndexRef],
  );
  // Espejo de zipfForLemma en ref estable — extraído a
  // useReaderZipfForLemmaRef (B7).
  useReaderZipfForLemmaRef({ zipfForLemma, zipfForLemmaRef });
  // Zipf de una forma tal como aparece en el texto: la ficha la usa como
  // dificultad de la señal de consulta (sin ella, β salía del banco CAT,
  // que casi nunca tiene la palabra).
  const zipfForForm = useCallback(
    (form: string): number | null => {
      const key = form.trim().toLowerCase();
      const cached = analysisFor(sectionIndexRef.current);
      return measuredZipf(cached?.entries[key], key) ?? calibrationBankZipf(key, language);
    },
    [analysisFor, language, sectionIndexRef],
  );

  // Evidencia nueva aplicada de inmediato: perfil reestimado y la
  // sección visible reclasificada sin esperar otra recarga.
  const applyKnowledgeRow = useCallback(
    (row: {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }) => {
      ingestKnowledgeRow(row);
      profileRef.current = estimateProfile(
        [...evidenceRef.current.values()],
        adjustRef.current,
        baseThresholdRef.current,
      );
      applyPrediction(sectionIndexRef.current, language);
    },
    [
      ingestKnowledgeRow,
      applyPrediction,
      language,
      evidenceRef,
      adjustRef,
      baseThresholdRef,
      profileRef,
      sectionIndexRef,
    ],
  );

  return {
    analysisFor,
    classifyCached,
    applyCachedPrediction,
    applyPrediction,
    zipfForLemma,
    zipfForForm,
    applyKnowledgeRow,
  };
}
