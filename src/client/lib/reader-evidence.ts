// Evidencia del lector: refresco del perfil y exposición pasiva.
//
// Extraído de Reader.tsx (línea de trabajo posterior a la Fase 7). Son funciones que solo leen y
// escriben refs del lector y llaman a módulos puros: no tocan estado de React, así que viven en
// lib/ y se prueban sin jsdom. El lector conserva el dueño de cada ref.
import type { ChapterAnalysis } from "./chapter-analysis";
import { getBookLanguage, type EpubBook } from "./epub";
import {
  captureDbScope,
  listKnowledge,
  listSavedWords,
  recordPassiveExposure,
  type DbScope,
  type KnownWord,
  type SavedWord,
} from "./idb";
import {
  batchLookup,
} from "./lexicon";
import {
  cliticBasesFor,
  computeRequiredDwellMs,
  estimateProfile,
  isCredibleKnowledge,
  resolveEvidence,
  type KnowledgeEvidence,
  type VocabProfile,
} from "./knowledge";
import { betaFromZipf, loadUserLanguageProfile, updateLanguageTheta } from "./profile-models";
import type { MarkLevel } from "./word-level";

/** Un ref de React visto desde aquí: `lib/` no depende de React. */
type Ref<T> = { current: T };

/** Fila de conocimiento tal como la proyecta el lector (sin `key` ni `source`). */
export interface KnowledgeRow {
  lemma: string;
  known: boolean;
  status?: "unknown" | "familiar" | "known";
  passiveSeenCount?: number;
  estimatedKnownProb?: number;
}

/** Destino ya analizado: lo único que la exposición pasiva necesita del análisis. */
export type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

/** Refs que el refesco del perfil lee y reescribe. */
export interface ProfileRefs {
  savedForms: Ref<Map<string, MarkLevel>>;
  evidenceRef: Ref<Map<string, KnowledgeEvidence>>;
  pendingKnowledgeRef: Ref<Set<string>>;
  knowledgeMapRef: Ref<Map<string, KnowledgeRow>>;
  adjustRef: Ref<number>;
  baseThresholdRef: Ref<number>;
  profileRef: Ref<VocabProfile | null>;
}

/** Refs que la exposición pasiva usa para saber qué palabras ya se vieron. */
export interface ExposureRefs {
  bookRef: Ref<EpubBook | null>;
  consultedInPageRef: Ref<Set<string>>;
  pageCountRef: Ref<number>;
  pageEnteredAtRef: Ref<number>;
  sectionIndexRef: Ref<number>;
  savedForms: Ref<Map<string, MarkLevel>>;
}

export interface PassiveExposureInput {
  language: string;
  sectionWords: number;
  analysisFor: (index: number) => ReadyAnalysis | undefined;
  applyKnowledgeRow: (row: KnowledgeRow) => void;
}

// Perfil del lector: la evidencia en ambas direcciones calibra el
// umbral — un «no la conocía» raro pesa lo mismo que un «la conozco»
// frecuente; el zipf de cada lema se mide vía catálogo con el mismo
// criterio que Cuenta (primera acepción de la forma). Con almacén o
// red caídos queda el umbral por defecto más el ajuste manual.
// Solo cuenta la evidencia creíble: un «inferred: no la conozco»
// sin palabra guardada que lo respalde es rastro de una consulta,
// no una declaración (isCredibleKnowledge).
export async function refreshProfile(
  refs: ProfileRefs,
  lang: string,
  scope?: DbScope,
): Promise<void> {
  const {
    savedForms,
    evidenceRef,
    pendingKnowledgeRef,
    knowledgeMapRef,
    adjustRef,
    baseThresholdRef,
    profileRef,
  } = refs;
  const bound = scope ?? captureDbScope();
  const [rows, words] = await Promise.all([
    listKnowledge(lang, bound).catch(() => [] as KnownWord[]),
    listSavedWords(lang, bound).catch(() => [] as SavedWord[]),
  ]);
  const savedLemmas = new Set<string>();
  for (const word of words)
    for (const term of [word.form, word.lemma])
      if (term) savedLemmas.add(term.toLowerCase());
  for (const form of savedForms.current.keys()) savedLemmas.add(form);
  const credible = rows.filter((row) =>
    isCredibleKnowledge(row, savedLemmas),
  );
  const result = credible.length
    ? await batchLookup(
        credible.map((item) => item.lemma),
        lang,
        bound,
      )
    : null;
  const entries = result?.ok ? result.entries : {};
  // Segunda ronda solo para formas sin ficha cuya base clítica se
  // verifica en el catálogo («abrirlo» declara sobre «abrir»). Sin
  // base verificable la forma queda sin medición, como antes.
  const bases = cliticBasesFor(credible, entries);
  const baseResult = bases.length
    ? await batchLookup(bases, lang, bound).catch(() => null)
    : null;
  const resolved = resolveEvidence(
    credible,
    entries,
    baseResult?.ok ? baseResult.entries : {},
    lang,
  );
  // Lo escrito esta sesión y todavía no visible en la lectura del
  // store no se pierde al recargar (el lote de preparación corre
  // antes de que el put sea observable); su medición previa
  // sobrevive aunque el catálogo no la traiga aún.
  const prevEvidence = evidenceRef.current;
  const fetched = new Set(credible.map((row) => row.lemma));
  for (const lemma of pendingKnowledgeRef.current) {
    if (fetched.has(lemma)) continue;
    const local = knowledgeMapRef.current.get(lemma);
    if (local)
      resolved.set(lemma, {
        lemma,
        known: local.known,
        zipf: prevEvidence.get(lemma)?.zipf ?? null,
      });
  }
  const rowByLemma = new Map<string, KnownWord>();
  for (const r of rows) rowByLemma.set(r.lemma.toLowerCase(), r);
  const map = new Map<
    string,
    {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }
  >();
  const nextEvidence = new Map<string, KnowledgeEvidence>();
  for (const [lemma, item] of resolved) {
    const orig = rowByLemma.get(lemma) ?? knowledgeMapRef.current.get(lemma);
    map.set(lemma, {
      lemma,
      known: item.known,
      status: orig?.status,
      passiveSeenCount: orig?.passiveSeenCount,
      estimatedKnownProb: orig?.estimatedKnownProb,
    });
    nextEvidence.set(lemma, { zipf: item.zipf, known: item.known });
  }
  knowledgeMapRef.current = map;
  evidenceRef.current = nextEvidence;
  const next = estimateProfile(
    [...nextEvidence.values()],
    adjustRef.current,
    baseThresholdRef.current,
  );
  profileRef.current = next;
}

// Comprobación de inferencia implícita por exposición pasiva (Fase 4):
// Si la permanencia en la página fue válida (>= 8s y < 450 ppm) y no se consultó
// la palabra en WordPanel, se actualiza su probabilidad de conocimiento.
export function checkPassiveExposure(
  refs: ExposureRefs,
  input: PassiveExposureInput,
): void {
  const {
    bookRef,
    consultedInPageRef,
    pageCountRef,
    pageEnteredAtRef,
    sectionIndexRef,
    savedForms,
  } = refs;
  const { language, sectionWords, analysisFor, applyKnowledgeRow } = input;
  const now = Date.now();
  if (pageEnteredAtRef.current === 0) {
    pageEnteredAtRef.current = now;
    return;
  }
  const dwellMs = now - pageEnteredAtRef.current;
  pageEnteredAtRef.current = now;

  const totalPages = Math.max(1, pageCountRef.current);
  const wordsInPage = Math.max(1, Math.round(sectionWords / totalPages));
  const requiredDwellMs = computeRequiredDwellMs(wordsInPage);
  if (dwellMs < requiredDwellMs) return;

  const speedWpm = Math.round(wordsInPage / (dwellMs / 60000));
  if (speedWpm >= 450) return;

  const analysis = analysisFor(sectionIndexRef.current);
  if (!analysis) return;

  const book = bookRef.current;
  const lang = language || (book ? getBookLanguage(book) : "es");
  const consulted = consultedInPageRef.current;

  const candidates = analysis.forms.filter(
    (f) => !consulted.has(f.toLowerCase()),
  );
  const uniqueLemmas = new Set<string>();
  for (const f of candidates) {
    const entry = analysis.entries[f]?.[0];
    const lemma = (entry?.lemma ?? f).toLowerCase();
    if (!savedForms.current.has(f) && !savedForms.current.has(lemma)) {
      uniqueLemmas.add(lemma);
    }
    if (uniqueLemmas.size >= 8) break;
  }

  const scope = captureDbScope();
  for (const lemma of uniqueLemmas) {
    void recordPassiveExposure(lang, lemma, scope)
      .then((updated) => {
        applyKnowledgeRow({
          lemma: updated.lemma,
          known: updated.known,
          status: updated.status,
          passiveSeenCount: updated.passiveSeenCount,
          estimatedKnownProb: updated.estimatedKnownProb,
        });
      })
      .catch(() => {});
  }
  // Aprendizaje pasivo adaptativo: refuerzo sutil para palabras en frontera (theta ≈ beta) no consultadas
  try {
    const profile = loadUserLanguageProfile();
    const normLang = lang.slice(0, 2).toLowerCase() || "es";
    const currentTheta = profile.thetaByLang[normLang] ?? 0.0;
    for (const f of candidates) {
      const entry = analysis.entries[f]?.[0];
      if (!entry) continue;
      const beta = betaFromZipf(entry.zipf);
      if (Math.abs(currentTheta - beta) <= 1.0) {
        updateLanguageTheta(lang, beta, 1, 0.25);
        break;
      }
    }
  } catch {
    // Ignorar fallo de almacenamiento
  }
  consultedInPageRef.current.clear();
}
