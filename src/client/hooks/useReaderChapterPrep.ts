import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { SectionPreviewRow } from "../components/SectionPreview";
import type { ChapterTarget, ChapterCatalog, ChapterRange } from "../lib/chapters";
import { targetAt } from "../lib/chapters";
import type { ChapterAnalyzer, ChapterAnalysis } from "../lib/chapter-analysis";
import {
  decidePreparation,
  acknowledgePreparationEntry,
  savePreparationRecord,
  loadPreparationRecord,
  newPreparationRecord,
  preparationRecordKey,
  confirmPreparation,
  buildPreparationEvidence,
  buildPreparationWords,
  type PreparationRecord,
  type PreparationRow,
  type PreparationAnswers,
} from "../lib/preparation";
import {
  buildSuggestionRows,
  type SuggestionRows,
} from "../lib/section-words";
import {
  planPredictiveChapterPrecache,
  prefetchUpcomingChaptersLexicon,
} from "../lib/offline-dictionary";
import { isPrimingMutedForBook, loadNativeLanguage, isFeatureFlagEnabled } from "../lib/settings";
import { hasAnyLearningHistory, type DbScope } from "../lib/idb";
import type { EpisodicWordItem } from "../lib/practice";
import type { EpubBook } from "../lib/epub";
import { getBookLanguage } from "../lib/epub";
import type { ReaderSettings } from "../lib/settings";
import type { OverlayHandle } from "../lib/history";
import type { BookStartRecord } from "../lib/book-start";
import type { VisitEventDraft } from "../lib/reading-events";
import { markLevel, type MarkLevel } from "../lib/word-level";
import { estimateProfile, type KnowledgeEvidence, type VocabProfile } from "../lib/knowledge";
import { loadUserTheta } from "../lib/profile-models";

type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

export function shouldAutoShowPreview(
  chapterPreviewMode: string | undefined,
  bookId: string,
  sectionIndex: number,
  _coveragePct?: number,
  unknownKeyWordsCount = 0,
): boolean {
  if (chapterPreviewMode === "off") return false;
  if (unknownKeyWordsCount <= 0) return false;
  const key = `lecta:previewed:${bookId}:${sectionIndex}`;
  try {
    if (sessionStorage.getItem(key) === "1" || localStorage.getItem(key) === "1") {
      return false;
    }
  } catch {
    // ignore storage errors
  }
  return true;
}

export function markSectionPreviewed(bookId: string, sectionIndex: number): void {
  const key = `lecta:previewed:${bookId}:${sectionIndex}`;
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // ignore storage errors
  }
}

export interface PrepSheetState {
  target: ChapterTarget;
  record: PreparationRecord;
  analysis: "loading" | "ready" | "error";
  rows: SectionPreviewRow[];
  uncertain: SectionPreviewRow[];
  deferred: SectionPreviewRow[];
  presentationId: string;
  answers: PreparationAnswers;
  saving: boolean;
}

export interface PrepNoticeState {
  target: ChapterTarget;
  summary: boolean;
  count: number | null;
}

export interface UseReaderChapterPrepOptions {
  bookHash: string;
  bookRef: MutableRefObject<EpubBook | null>;
  catalogRef: MutableRefObject<ChapterCatalog | null>;
  analyzerRef: MutableRefObject<ChapterAnalyzer | null>;
  language: string;
  sectionIndexRef: MutableRefObject<number>;
  settingsRef: MutableRefObject<ReaderSettings | null>;
  tocRowsRef: MutableRefObject<{ label: string; index: number }[]>;
  bookStartRef: MutableRefObject<BookStartRecord | null>;
  currentChapterTarget?: ChapterTarget | null;
  currentChapterPrimedWordsRef: MutableRefObject<EpisodicWordItem[]>;
  savedForms: MutableRefObject<Map<string, MarkLevel>>;
  knowledgeMapRef: MutableRefObject<
    Map<
      string,
      {
        lemma: string;
        known: boolean;
        status?: "unknown" | "familiar" | "known";
        passiveSeenCount?: number;
        estimatedKnownProb?: number;
      }
    >
  >;
  evidenceRef: MutableRefObject<Map<string, KnowledgeEvidence>>;
  profileRef: MutableRefObject<VocabProfile | null>;
  adjustRef: MutableRefObject<number>;
  baseThresholdRef: MutableRefObject<number>;
  overlayReleaseRef: MutableRefObject<OverlayHandle | null>;
  pushOverlay: (close: () => void) => OverlayHandle;
  releaseOverlay: () => void;
  captureDbScope: () => DbScope;
  rangeFor: (index: number) => ChapterRange | null;
  setAnalyzingFor: (targetId: string, analyzing: boolean) => void;
  applyPrediction: (index: number, lang: string) => void;
  trackEvent: (draft: VisitEventDraft) => void;
  ingestKnowledgeRow: (item: {
    lemma: string;
    known: boolean;
    status?: "unknown" | "familiar" | "known";
    passiveSeenCount?: number;
    estimatedKnownProb?: number;
  }) => void;
  onStatus: (msg: string) => void;
  onError: (msg: string) => void;
  closeOtherOverlays: () => void;
}

export function useReaderChapterPrep({
  bookHash,
  bookRef,
  catalogRef,
  analyzerRef,
  language,
  sectionIndexRef,
  settingsRef,
  tocRowsRef,
  bookStartRef,
  currentChapterTarget = null,
  currentChapterPrimedWordsRef,
  savedForms,
  knowledgeMapRef,
  evidenceRef,
  profileRef,
  adjustRef,
  baseThresholdRef,
  overlayReleaseRef,
  pushOverlay,
  releaseOverlay,
  captureDbScope,
  rangeFor,
  setAnalyzingFor,
  applyPrediction,
  trackEvent,
  ingestKnowledgeRow,
  onStatus,
  onError,
  closeOtherOverlays,
}: UseReaderChapterPrepOptions) {
  const [prep, setPrep] = useState<PrepSheetState | null>(null);
  const [prepNotice, setPrepNotice] = useState<PrepNoticeState | null>(null);
  const [previewSuggested, setPreviewSuggested] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const prepRef = useRef<PrepSheetState | null>(null);
  const prepLexRef = useRef(new Map<string, PreparationRow>());
  const prepDismissed = useRef(new Set<string>());
  const prepEvaluated = useRef<string | null>(null);
  const presentedKeysRef = useRef(new Set<string>());

  const prepRowsFor = useCallback(
    (
      analysis: ReadyAnalysis,
      lang: string,
      lex?: Map<string, PreparationRow>,
    ): SuggestionRows =>
      buildSuggestionRows({
        language: lang,
        forms: analysis.forms,
        entries: analysis.entries,
        capitalOnly: analysis.capitalOnly,
        text: analysis.text,
        saved: savedForms.current,
        knowledge: knowledgeMapRef.current,
        threshold:
          profileRef.current?.threshold ??
          estimateProfile(
            [...evidenceRef.current.values()],
            adjustRef.current,
            baseThresholdRef.current,
          ).threshold,
        userTheta: loadUserTheta(
          profileRef.current?.threshold ??
          estimateProfile(
            [...evidenceRef.current.values()],
            adjustRef.current,
            baseThresholdRef.current,
          ).threshold,
          lang,
        ),
        isSecondLanguage: lang !== loadNativeLanguage(),
        lex,
      }),
    [
      savedForms,
      knowledgeMapRef,
      profileRef,
      evidenceRef,
      adjustRef,
      baseThresholdRef,
    ],
  );

  const closePrepLayer = useCallback(() => {
    setShowPreview(false);
    const current = prepRef.current;
    prepRef.current = null;
    setPrep(null);
    if (current) {
      void savePreparationRecord(
        {
          ...current.record,
          updatedAt: Date.now(),
        },
        captureDbScope(),
      ).catch(() => undefined);
      if (
        current.record.disposition === "pending" &&
        settingsRef.current?.preparationMode !== "off"
      )
        setPrepNotice({
          target: current.target,
          summary: false,
          count: current.rows.length || null,
        });
    }
  }, [captureDbScope, settingsRef]);

  const openPrepSheet = useCallback(
    async (target: ChapterTarget, record: PreparationRecord | null) => {
      if (!isFeatureFlagEnabled("chapterPriming")) return;
      const scope = captureDbScope();
      const cat = catalogRef.current;
      const analyzer = analyzerRef.current;
      const book = bookRef.current;
      const range =
        cat?.ranges.find((r) => r.target.id === target.id) ??
        (cat?.ranges && cat.ranges.length > 0
          ? cat.ranges.find((r) => r.target.sectionIndex === target.sectionIndex) ?? cat.ranges[0]
          : undefined);
      if (!cat || !analyzer || !book || !range) return;
      const lang = language || getBookLanguage(book);
      const base =
        record ??
        (await loadPreparationRecord(bookHash, target.id, scope).catch(() => null)) ??
        newPreparationRecord({ bookHash, targetId: target.id, updatedAt: Date.now() });
      const close = () => {
        overlayReleaseRef.current = null;
        closePrepLayer();
      };
      if (overlayReleaseRef.current) overlayReleaseRef.current.swap(close);
      else overlayReleaseRef.current = pushOverlay(close);
      closeOtherOverlays();
      presentedKeysRef.current.clear();

      const cached = analyzer.cached(range.target.id);
      const cachedSuggestion =
        cached?.state === "ready"
          ? prepRowsFor(cached, lang, prepLexRef.current)
          : null;

      const initial: PrepSheetState = {
        target,
        record: base,
        analysis: cachedSuggestion ? ("ready" as const) : ("loading" as const),
        rows: cachedSuggestion ? cachedSuggestion.rows : ([] as SectionPreviewRow[]),
        uncertain: cachedSuggestion ? cachedSuggestion.uncertain : ([] as SectionPreviewRow[]),
        deferred: cachedSuggestion ? cachedSuggestion.deferred : ([] as SectionPreviewRow[]),
        presentationId: crypto.randomUUID(),
        answers: base.answers,
        saving: false,
      };
      prepRef.current = initial;
      setPrep(initial);
      const result = await analyzer.analyze(range);
      const current = prepRef.current;
      if (!current || current.target.id !== target.id) return;
      if (result.state === "ready") {
        const suggestion = prepRowsFor(result, lang, prepLexRef.current);
        const next: PrepSheetState = {
          ...current,
          analysis: "ready" as const,
          rows: suggestion.rows,
          uncertain: suggestion.uncertain,
          deferred: suggestion.deferred,
        };
        prepRef.current = next;
        setPrep(next);
      } else {
        const next: PrepSheetState = { ...current, analysis: "error" as const };
        prepRef.current = next;
        setPrep(next);
      }
    },
    [
      bookHash,
      language,
      prepRowsFor,
      catalogRef,
      analyzerRef,
      bookRef,
      overlayReleaseRef,
      pushOverlay,
      closePrepLayer,
      closeOtherOverlays,
      captureDbScope,
    ],
  );

  const evaluatePreparation = useCallback(
    async (
      index: number,
      via: "enter" | "analysis-settled" = "enter",
      prevTargetId: string | null = null,
    ) => {
      const cat = catalogRef.current;
      const book = bookRef.current;
      if (!cat || !book) return;
      const recorded = bookStartRef.current;
      if (via === "enter") bookStartRef.current = null;
      let target: ChapterTarget | null = null;
      if (via === "enter" && recorded?.preparationTargetId) {
        target =
          cat.targets.find(
            (item) => item.id === recorded.preparationTargetId,
          ) ?? null;
      }
      target ??= targetAt(cat.ranges, index);
      if (!target) return;
      let firstEval = false;
      if (via === "enter") {
        firstEval = prepEvaluated.current == null;
        if (!firstEval && prevTargetId === target.id) return;
        prepEvaluated.current = target.id;
      }
      const scope = captureDbScope();
      const record = await loadPreparationRecord(bookHash, target.id, scope).catch(
        () => null,
      );
      if (bookRef.current !== book) return;
      if (
        isPrimingMutedForBook(bookHash) ||
        settingsRef.current?.chapterPrimingMode === "off"
      ) {
        setPrepNotice(null);
        return;
      }
      const decision = decidePreparation({
        mode: settingsRef.current?.preparationMode ?? "auto",
        intent: via,
        record,
        noticeDismissed: prepDismissed.current.has(target.id),
      });
      let opening = decision.opening;
      if (opening === "prepare" && firstEval) {
        if (!(await hasAnyLearningHistory(scope).catch(() => true)))
          opening = "notice";
        if (bookRef.current !== book) return;
      }
      if (opening === "prepare") {
        opening = "notice";
      }
      if (opening === "notice" || opening === "summary") {
        if (opening === "summary" && record)
          void savePreparationRecord(
            acknowledgePreparationEntry(record, Date.now()),
            scope,
          ).catch(() => undefined);
        const cached = analyzerRef.current?.cached(target.id);
        const count =
          cached?.state === "ready"
            ? prepRowsFor(cached, language || getBookLanguage(book)).rows.length
            : null;
        setPrepNotice({
          target,
          summary: opening === "summary",
          count,
        });
        if (
          shouldAutoShowPreview(
            (settingsRef.current as { chapterPreview?: string; preparationMode?: string } | null)?.chapterPreview ?? settingsRef.current?.preparationMode,
            bookHash,
            target.sectionIndex,
            95,
            count ?? 0,
          )
        ) {
          setPreviewSuggested(true);
        } else {
          setPreviewSuggested(false);
        }
        return;
      }
      setPrepNotice((cur) => (cur?.target.id === target.id ? null : cur));
      setPreviewSuggested(false);
    },
    [
      bookHash,
      language,
      prepRowsFor,
      catalogRef,
      bookRef,
      bookStartRef,
      settingsRef,
      analyzerRef,
      captureDbScope,
    ],
  );

  const runSectionAnalysis = useCallback(
    async (index: number, knownText?: string) => {
      const book = bookRef.current;
      const analyzer = analyzerRef.current;
      const range = rangeFor(index);
      if (!book || !analyzer || !range) return;
      const lang = language || getBookLanguage(book);
      setAnalyzingFor(range.target.id, true);
      try {
        const result = await analyzer.analyze(
          range,
          knownText != null
            ? { knownSection: { index, text: knownText } }
            : undefined,
        );
        if (result.state === "ready") {
          applyPrediction(index, lang);
          const suggestion = prepRowsFor(result, lang, prepLexRef.current);
          const tocLabel = tocRowsRef.current.find((r) => r.index === index)?.label;
          const primed: EpisodicWordItem[] = (suggestion?.rows ?? []).slice(0, 5).map((row) => ({
            lemma: row.lemma || row.form,
            surfaceForm: row.form,
            lang,
            shortGloss: row.meaning || "",
            chapterSentence: row.context || row.contextSnippet || row.form,
            chapterTitle: tocLabel || `Sección ${index + 1}`,
            source: "pre-chapter-primed",
            partOfSpeech: row.pos ?? undefined,
          }));
          if (primed.length > 0) {
            currentChapterPrimedWordsRef.current = primed;
          }
          void evaluatePreparation(index, "analysis-settled");
        }
      } finally {
        setAnalyzingFor(range.target.id, false);
      }
    },
    [
      rangeFor,
      setAnalyzingFor,
      applyPrediction,
      evaluatePreparation,
      language,
      prepRowsFor,
      bookRef,
      analyzerRef,
      tocRowsRef,
      currentChapterPrimedWordsRef,
    ],
  );

  const analyzeSection = useCallback(
    async (index: number, knownText?: string) => {
      await runSectionAnalysis(index, knownText);
      void analyzerRef.current?.preloadNext(index);
    },
    [runSectionAnalysis, analyzerRef],
  );

  const triggerL2Precache = useCallback(
    (index: number, totalSections: number, lang: string) => {
      const isL2 = lang !== loadNativeLanguage();
      if (isL2 && (typeof navigator === "undefined" || !("onLine" in navigator) || navigator.onLine)) {
        planPredictiveChapterPrecache(index, totalSections, 2);
        void prefetchUpcomingChaptersLexicon(bookHash, index, {
          lookahead: 2,
          language: lang,
          scope: captureDbScope(),
        });
      }
    },
    [bookHash, captureDbScope],
  );

  const answerPrep = useCallback(
    (key: string, answer: "known" | "unknown") => {
      const current = prepRef.current;
      if (!current) return;
      const answers = { ...current.answers, [key]: answer };
      const record = {
        ...current.record,
        answers,
        updatedAt: Date.now(),
      };
      const next: PrepSheetState = { ...current, answers, record };
      prepRef.current = next;
      setPrep(next);
      void savePreparationRecord(record, captureDbScope()).catch(() => undefined);
      trackEvent({
        kind: "preparation_answered",
        targetId: current.target.id,
        presentationId: current.presentationId,
        key,
        answer,
      });
    },
    [captureDbScope, trackEvent],
  );

  const confirmPrep = useCallback(async () => {
    const current = prepRef.current;
    if (!current || current.saving) return;
    const withSaving: PrepSheetState = { ...current, saving: true };
    prepRef.current = withSaving;
    setPrep(withSaving);
    const lex = prepLexRef.current;
    const rows: PreparationRow[] = [
      ...current.rows,
      ...current.uncertain,
      ...current.deferred,
    ].map((row) => lex.get(row.key) ?? { form: row.form, lemma: row.lemma });
    const record: PreparationRecord = {
      ...current.record,
      answers: current.answers,
      disposition: "reviewed",
      updatedAt: Date.now(),
    };
    prepRef.current = { ...withSaving, record };
    const result = await confirmPreparation(
      {
        record,
        recordKey: preparationRecordKey(bookHash, current.target.id),
        knowledge: buildPreparationEvidence(language, rows, current.answers),
        words: buildPreparationWords(language, rows, current.answers, bookHash),
      },
      captureDbScope(),
    );
    if (!result.saved) {
      const reverted: PrepSheetState = { ...withSaving, saving: false };
      prepRef.current = reverted;
      setPrep(reverted);
      onError("No se pudo guardar la preparación. Intenta de nuevo.");
      return;
    }
    for (const item of result.knowledge) ingestKnowledgeRow(item);
    for (const word of result.words) {
      const level = markLevel(word.card);
      for (const form of [word.form, word.lemma]) {
        if (!form) continue;
        const key = form.toLowerCase();
        if (level) savedForms.current.set(key, level);
        else savedForms.current.delete(key);
      }
    }
    const next = estimateProfile(
      [...evidenceRef.current.values()],
      adjustRef.current,
      baseThresholdRef.current,
    );
    profileRef.current = next;
    applyPrediction(sectionIndexRef.current, language);
    releaseOverlay();
    closePrepLayer();
    if (!result.synced)
      onStatus("Guardado en este dispositivo; se sincroniza al volver la conexión.");
    else if (result.words.length)
      onStatus(`${result.words.length} palabra(s) agregada(s) a tu cuaderno.`);
  }, [
    bookHash,
    language,
    captureDbScope,
    onError,
    ingestKnowledgeRow,
    savedForms,
    evidenceRef,
    adjustRef,
    baseThresholdRef,
    profileRef,
    applyPrediction,
    sectionIndexRef,
    releaseOverlay,
    closePrepLayer,
    onStatus,
  ]);

  const skipPrep = useCallback(() => {
    const current = prepRef.current;
    if (!current) return;
    const record: PreparationRecord = {
      ...current.record,
      answers: current.answers,
      disposition: "skipped",
      entryAcknowledged: true,
      updatedAt: Date.now(),
    };
    prepRef.current = { ...current, record };
    trackEvent({
      kind: "preparation_skipped",
      targetId: current.target.id,
      presentationId: current.presentationId,
    });
    releaseOverlay();
    closePrepLayer();
  }, [trackEvent, releaseOverlay, closePrepLayer]);

  const retryPrep = useCallback(async () => {
    const current = prepRef.current;
    const analyzer = analyzerRef.current;
    const cat = catalogRef.current;
    if (!current || !analyzer || !cat) return;
    const range = cat.ranges.find((r) => r.target.id === current.target.id);
    if (!range) return;
    const loading: PrepSheetState = { ...current, analysis: "loading" as const };
    prepRef.current = loading;
    setPrep(loading);
    const result = await analyzer.analyze(range);
    const now = prepRef.current;
    if (!now || now.target.id !== current.target.id) return;
    const suggestion =
      result.state === "ready"
        ? prepRowsFor(result, language, prepLexRef.current)
        : null;
    const next: PrepSheetState = suggestion
      ? {
          ...now,
          analysis: "ready" as const,
          rows: suggestion.rows,
          uncertain: suggestion.uncertain,
          deferred: suggestion.deferred,
        }
      : { ...now, analysis: "error" as const };
    prepRef.current = next;
    setPrep(next);
  }, [analyzerRef, catalogRef, prepRowsFor, language]);

  const discardPrep = useCallback(() => {
    const current = prepRef.current;
    if (!current) return;
    const record: PreparationRecord = {
      ...current.record,
      answers: {},
      updatedAt: Date.now(),
    };
    const next: PrepSheetState = { ...current, answers: {}, record };
    prepRef.current = next;
    setPrep(next);
    void savePreparationRecord(record, captureDbScope()).catch(() => undefined);
  }, [captureDbScope]);

  const openPrepManual = useCallback(() => {
    setShowPreview(true);
    const target =
      prepNotice?.target ??
      currentChapterTarget ??
      targetAt(catalogRef.current?.ranges ?? [], sectionIndexRef.current) ??
      catalogRef.current?.targets?.[0];
    setPrepNotice(null);
    if (target) void openPrepSheet(target, null);
  }, [prepNotice, currentChapterTarget, catalogRef, sectionIndexRef, openPrepSheet]);

  const dismissPrepNotice = useCallback(() => {
    if (prepNotice) prepDismissed.current.add(prepNotice.target.id);
    setPrepNotice(null);
  }, [prepNotice]);

  const recordPresented = useCallback(
    (rows: SectionPreviewRow[]) => {
      const current = prepRef.current;
      if (!current) return;
      const fresh = rows.filter((row) => !presentedKeysRef.current.has(row.key));
      if (!fresh.length) return;
      for (const row of fresh) presentedKeysRef.current.add(row.key);
      trackEvent({
        kind: "preparation_presented",
        targetId: current.target.id,
        presentationId: current.presentationId,
        rows: fresh.map((row) => ({
          key: row.key,
          form: row.form,
          lemma: row.lemma ?? undefined,
          reason: row.reason ?? "rarity",
          zipf: row.zipf,
        })),
      });
      const freshPrimed: EpisodicWordItem[] = fresh.slice(0, 5).map((row) => ({
        lemma: row.lemma || row.form,
        surfaceForm: row.form,
        lang: language || "es",
        shortGloss: row.meaning || "",
        chapterSentence: row.context || row.contextSnippet || row.form,
        chapterTitle: current.target.label,
        source: "pre-chapter-primed",
        partOfSpeech: row.pos ?? undefined,
      }));
      if (freshPrimed.length > 0) {
        currentChapterPrimedWordsRef.current = freshPrimed;
      }
    },
    [language, trackEvent, currentChapterPrimedWordsRef],
  );

  const resetPrepForBook = useCallback(() => {
    prepLexRef.current = new Map();
    prepDismissed.current.clear();
    prepEvaluated.current = null;
    prepRef.current = null;
    setPrep(null);
    setPrepNotice(null);
    setPreviewSuggested(false);
    setShowPreview(false);
  }, []);

  return {
    prep,
    setPrep,
    prepNotice,
    setPrepNotice,
    previewSuggested,
    setPreviewSuggested,
    showPreview,
    setShowPreview,
    prepRef,
    prepLexRef,
    prepDismissed,
    prepEvaluated,
    presentedKeysRef,
    prepRowsFor,
    closePrepLayer,
    openPrepSheet,
    evaluatePreparation,
    runSectionAnalysis,
    analyzeSection,
    triggerL2Precache,
    answerPrep,
    confirmPrep,
    skipPrep,
    retryPrep,
    discardPrep,
    openPrepManual,
    dismissPrepNotice,
    recordPresented,
    resetPrepForBook,
  };
}
