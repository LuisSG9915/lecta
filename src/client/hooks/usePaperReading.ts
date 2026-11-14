// Controlador de «Leo este libro en papel»: abre el EPUB guardado,
// arma el catálogo de capítulos y analiza el elegido con la MISMA
// cadena del lector (createChapterAnalyzer + buildChapterSuggestionRows
// con el perfil de refreshProfile), así las palabras que salen aquí
// son las mismas que saldrían en la preparación del lector.
//
// Invariantes heredadas: cada respuesta queda como borrador al tocarla
// y se confirma sola al salir de la hoja o al marcar «Terminé», por la
// transacción de confirmPreparation (local primero, push después). El
// alta manual usa saveWordWithKnowledge con el idioma real del libro;
// «Deshacer» solo toca palabras creadas en esta visita. Si la cuenta
// cambia a mitad de camino, no se empuja nada con la sesión nueva.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildChapterCatalog,
  type ChapterCatalog,
  type ChapterRange,
  type ChapterTarget,
} from "../lib/chapters";
import {
  catalogFromPaperGuide,
  createGuideChapterAnalyzer,
} from "../lib/paper-guide";
import {
  paperGuideSessionKey,
  sanitizePaperBookGuide,
  type PaperBookGuide,
} from "../../shared/paper-guide";
import { fetchBookGuide } from "../lib/books";
import {
  createChapterAnalyzer,
  chapterAnalysisCacheKey,
  deserializeChapterAnalysis,
  serializeChapterAnalysis,
  type ChapterAnalyzer,
  type ChapterAnalysis,
} from "../lib/chapter-analysis";
import {
  detectBookLanguage,
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
  openEpub,
  type EpubBook,
} from "../lib/epub";
import {
  captureDbScope,
  getStoredBook,
  isDbScopeActive,
  listSavedWords,
  loadSavedWord,
  loadSessionValue,
  saveSessionValue,
  saveWordWithKnowledge,
  type DbScope,
  type SavedWord,
} from "../lib/idb";
import {
  buildPreparationEvidence,
  buildPreparationWords,
  confirmPreparation,
  loadPreparationRecord,
  newPreparationRecord,
  preparationRecordKey,
  savePreparationRecord,
  type PreparationAnswers,
  type PreparationRecord,
  type PreparationRow,
} from "../lib/preparation";
import {
  estimateProfile,
  type KnowledgeEvidence,
  type VocabProfile,
} from "../lib/knowledge";
import {
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD_NATIVE,
  PROFILE_ADJUST_KEY,
} from "../lib/profile-models";
import { refreshProfile, type KnowledgeRow } from "../lib/reader-evidence";
import { buildChapterSuggestionRows } from "../lib/preparation-rows";
import {
  contextIfPresent,
  groupPaperChapters,
  loadPaperReading,
  paperChapterStatus,
  savePaperReading,
  splitPaperRows,
  type PaperReadingRecord,
} from "../lib/paper-reading";
import type { SuggestionRow } from "../lib/section-words";
import { lookupWord } from "../lib/lexicon";
import { bookFrequenciesOf, loadBookVocab } from "../lib/book-vocab";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import { reportClientError, reportErrorObject } from "../lib/client-errors";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { pushWordsToServer, removeWord } from "../lib/vocab";
import { award, localDayKey } from "../lib/game";
import { loadNativeLanguage, readerProfileFor } from "../lib/settings";
import { markLevel, savedFormLevels, type MarkLevel } from "../lib/word-level";

type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

export type PaperChapterEntry = {
  target: ChapterTarget;
  status: "new" | "prepared" | "read";
  unknownCount: number;
};

export type PaperSheetState = {
  target: ChapterTarget;
  range: ChapterRange;
  record: PreparationRecord;
  analysis: "loading" | "ready" | "error";
  text: string;
  chapterForms: string[];
  main: SuggestionRow[];
  more: SuggestionRow[];
  uncertain: SuggestionRow[];
  answers: PreparationAnswers;
  // Hay respuestas desde la última confirmación.
  dirty: boolean;
  saving: boolean;
  // Panel posterior a «Terminé este capítulo».
  finished: boolean;
};

export type ManualSaveOutcome =
  | { kind: "saved"; form: string; wordKey: string; meaning?: string }
  | { kind: "already"; form: string }
  | { kind: "error"; form: string };

export function usePaperReading(
  bookHash: string,
  options?: { onStatus?: (message: string) => void },
) {
  const [phase, setPhase] = useState<"opening" | "error" | "ready">("opening");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState<string | undefined>();
  const [language, setLanguage] = useState("es");
  const [entries, setEntries] = useState<PaperChapterEntry[]>([]);
  const [extras, setExtras] = useState<PaperChapterEntry[]>([]);
  const [lastTargetId, setLastTargetId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PaperSheetState | null>(null);
  const [manualSaves, setManualSaves] = useState<ManualSaveOutcome[]>([]);

  const onStatus = options?.onStatus;

  const openSeq = useRef(0);
  const bookRef = useRef<EpubBook | null>(null);
  const closeRef = useRef<(() => Promise<void> | void) | null>(null);
  const analyzerRef = useRef<ChapterAnalyzer | null>(null);
  const rangesRef = useRef<Map<string, ChapterRange>>(new Map());
  const scopeRef = useRef<DbScope | undefined>(undefined);
  const langRef = useRef("es");
  // Mismo conteo por libro que la hoja del lector: listas idénticas.
  const bookFreqRef = useRef<Map<string, number> | null>(null);
  // Mismas fuentes del perfil que el lector: mismas filas de salida.
  const savedFormsRef = useRef<Map<string, MarkLevel>>(new Map());
  const savedTermsRef = useRef<Set<string>>(new Set());
  const knowledgeMapRef = useRef<Map<string, KnowledgeRow>>(new Map());
  const evidenceRef = useRef(new Map<string, KnowledgeEvidence>());
  const pendingKnowledgeRef = useRef(new Set<string>());
  const adjustRef = useRef(0);
  const baseThresholdRef = useRef(DEFAULT_THRESHOLD_NATIVE);
  const profileRef = useRef<VocabProfile | null>(null);
  const thresholdRef = useRef(DEFAULT_THRESHOLD_NATIVE);
  const lexRef = useRef<Map<string, PreparationRow>>(new Map());
  const sheetRef = useRef<PaperSheetState | null>(null);
  // Entrada de historial de la hoja abierta: «atrás» la cierra
  // (guardando borrador) y cerrarla por UI consume el push con
  // release(), como hace useReaderChapterPrep.
  const overlayHandleRef = useRef<OverlayHandle | null>(null);
  // La hoja usa el closeChapter vigente sin depender de orden de
  // declaración; el efecto de más abajo lo mantiene al día.
  const closeChapterRef = useRef<() => Promise<void>>(async () => {});
  const paperRef = useRef<PaperReadingRecord>({
    version: 1,
    bookHash,
    readTargetIds: [],
    lastTargetId: null,
    updatedAt: 0,
  });
  const prepRecordsRef = useRef<Map<string, PreparationRecord | null>>(
    new Map(),
  );
  // Palabras creadas por el alta manual en esta visita: solo ellas se
  // pueden deshacer.
  const manualCreatedRef = useRef(new Set<string>());
  // Formas ya en el Cuaderno (estado React: la vista las marca y el
  // autocompletado las lee).
  const [savedTerms, setSavedTerms] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Palabras del Cuaderno ligadas a ESTE libro: decide si el panel
  // posterior a «Terminé» ofrece repasarlas.
  const [bookWordCount, setBookWordCount] = useState(0);
  // Formas del libro completo (manifiesto ya analizado): segundo nivel
  // del autocompletado del alta manual, tras las del capítulo.
  const [bookForms, setBookForms] = useState<string[]>([]);

  const profileRefs = () => ({
    savedForms: savedFormsRef,
    evidenceRef,
    pendingKnowledgeRef,
    knowledgeMapRef,
    adjustRef,
    baseThresholdRef,
    profileRef,
  });

  const disposed = (seq: number) => seq !== openSeq.current;

  const entryFor = useCallback((target: ChapterTarget): PaperChapterEntry => {
    const status = paperChapterStatus(
      target.id,
      prepRecordsRef.current.get(target.id) ?? null,
      paperRef.current,
    );
    return { target, ...status };
  }, []);

  const refreshEntry = useCallback(
    (targetId: string) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.target.id === targetId ? entryFor(entry.target) : entry,
        ),
      );
      setExtras((prev) =>
        prev.map((entry) =>
          entry.target.id === targetId ? entryFor(entry.target) : entry,
        ),
      );
    },
    [entryFor],
  );

  const open = useCallback(async () => {
    const seq = ++openSeq.current;
    setPhase("opening");
    setSheet(null);
    sheetRef.current = null;
    const staleOverlay = overlayHandleRef.current;
    overlayHandleRef.current = null;
    staleOverlay?.release();
    const scope = captureDbScope();
    scopeRef.current = scope;
    try {
      const stored = await getStoredBook(bookHash, scope).catch(
        () => undefined,
      );
      if (disposed(seq)) return;
      if (!stored) {
        // El libro no está en la base de esta cuenta (restaurado a
        // medias, cuenta cambiada o IndexedDB limpiada).
        reportClientError({
          name: "PaperOpen",
          code: "stored_book_missing",
        });
        setPhase("error");
        return;
      }

      const loadCached = async (targetId: string) => {
        const raw = await loadSessionValue(
          chapterAnalysisCacheKey(bookHash, targetId),
          scope,
        );
        return raw ? deserializeChapterAnalysis(raw) : null;
      };
      const saveCached = async (targetId: string, result: ChapterAnalysis) => {
        const raw = serializeChapterAnalysis(result);
        if (raw)
          await saveSessionValue(
            chapterAnalysisCacheKey(bookHash, targetId),
            raw,
            scope,
          );
      };

      let catalog: ChapterCatalog;
      let guideForms: string[] | null = null;

      // Guía comunitaria (modelo A1): sesión `paperGuide:v1:` primero,
      // servidor después — también cuando el registro no es paperOnly
      // pero su EPUB no abre (fila vieja envenenada o blob evacuado):
      // si la guía existe, el índice papel se repara solo en vez de
      // quedarse en «No se pudo abrir».
      const loadGuide = async (): Promise<PaperBookGuide | null> => {
        const guideKey = paperGuideSessionKey(bookHash);
        const rawGuide = await loadSessionValue(guideKey, scope).catch(
          () => null,
        );
        let loaded: PaperBookGuide | null = null;
        if (rawGuide) {
          try {
            loaded = sanitizePaperBookGuide(JSON.parse(rawGuide), bookHash);
          } catch {
            // Valor de sesión ilegible: la guía se vuelve a pedir.
          }
        }
        if (!loaded) {
          const fetched = await fetchBookGuide(bookHash, scope).catch(
            () => null,
          );
          loaded = fetched ? sanitizePaperBookGuide(fetched, bookHash) : null;
          if (loaded)
            await saveSessionValue(
              guideKey,
              JSON.stringify(loaded),
              scope,
            ).catch(() => undefined);
        }
        return loaded;
      };

      const wantsGuide = Boolean(stored.paperOnly) && stored.data.size === 0;
      const opened = wantsGuide
        ? null
        : await openEpub(stored.data).catch(() => null);
      if (disposed(seq)) {
        void opened?.close();
        return;
      }
      const guide = opened ? null : await loadGuide();
      if (disposed(seq)) return;

      if (guide) {
        const lang = stored.language || guide.language || "es";
        langRef.current = lang;
        setLanguage(lang);
        setTitle(stored.title || guide.title);
        setAuthor(stored.author || guide.author || undefined);
        catalog = catalogFromPaperGuide(guide);
        rangesRef.current = new Map(
          catalog.ranges.map((range) => [range.target.id, range]),
        );
        const analyzer = createGuideChapterAnalyzer(guide, {
          language: lang,
          isCurrent: () => analyzerRef.current === analyzer,
          loadCached,
          saveCached,
        });
        analyzerRef.current = analyzer;
        // Autocompletado del alta manual: todas las formas de la guía.
        guideForms = [
          ...new Set(guide.chapters.flatMap((ch) => ch.forms)),
        ];
      } else if (opened) {
        const { book, close } = opened;
        bookRef.current = book;
        closeRef.current = close;
        const detected = await detectBookLanguage(book).catch(() =>
          getBookLanguage(book),
        );
        const lang = stored.language || detected;
        langRef.current = lang;
        setLanguage(lang);
        setTitle(getBookTitle(book));
        setAuthor(getBookAuthor(book));

        catalog = buildChapterCatalog(book);
        rangesRef.current = new Map(
          catalog.ranges.map((range) => [range.target.id, range]),
        );
        analyzerRef.current = createChapterAnalyzer(catalog, {
          book,
          language: lang,
          isCurrent: () => bookRef.current === book,
          loadCached,
          saveCached,
        });
      } else {
        // Ni EPUB que abra ni guía disponible: adjunta sin publicar,
        // sesión caduca o sin red — el reporte dice cuál camino falló.
        reportClientError({
          name: "PaperOpen",
          code: wantsGuide ? "paper_guide_unavailable" : "epub_and_guide_missing",
        });
        setPhase("error");
        return;
      }

      // Perfil del lector por la misma cadena de refreshProfile.
      const lang = langRef.current;
      const storedWords = await listSavedWords(lang, scope).catch(
        () => [] as SavedWord[],
      );
      savedFormsRef.current = savedFormLevels(storedWords);
      const terms = new Set<string>();
      for (const word of storedWords) {
        if (word.deleted) continue;
        if (word.form) terms.add(word.form.toLowerCase());
        if (word.lemma) terms.add(word.lemma.toLowerCase());
      }
      savedTermsRef.current = terms;
      setSavedTerms(terms);
      setBookWordCount(
        storedWords.filter(
          (word) => !word.deleted && word.bookHash === bookHash,
        ).length,
      );
      baseThresholdRef.current =
        readerProfileFor(loadNativeLanguage(), lang) === "native"
          ? DEFAULT_THRESHOLD_NATIVE
          : DEFAULT_THRESHOLD_LEARNER;
      const storedAdjust = Number(
        await loadSessionValue(PROFILE_ADJUST_KEY, scope).catch(() => null),
      );
      adjustRef.current = Number.isFinite(storedAdjust) ? storedAdjust : 0;
      await refreshProfile(profileRefs(), lang, scope);
      thresholdRef.current =
        profileRef.current?.threshold ??
        estimateProfile(
          [...evidenceRef.current.values()],
          adjustRef.current,
          baseThresholdRef.current,
        ).threshold;
      if (disposed(seq)) return;

      const paper = await loadPaperReading(bookHash, scope);
      paperRef.current = paper ?? {
        version: 1,
        bookHash,
        readTargetIds: [],
        lastTargetId: null,
        updatedAt: 0,
      };
      setLastTargetId(paperRef.current.lastTargetId);
      const groups = groupPaperChapters(catalog);
      const allTargets = [...groups.reading, ...groups.extras];
      const preps = await Promise.all(
        allTargets.map(async (target) => {
          const record = await loadPreparationRecord(
            bookHash,
            target.id,
            scope,
          ).catch(() => null);
          return [target.id, record] as const;
        }),
      );
      if (disposed(seq)) return;
      prepRecordsRef.current = new Map(preps);
      const manifest = guideForms
        ? null
        : await loadBookVocab(bookHash, scope, langRef.current).catch(
            () => null,
          );
      bookFreqRef.current = bookFrequenciesOf(manifest);
      setBookForms(guideForms ?? manifest?.forms ?? []);
      setExtras(groups.extras.map(entryFor));
      setEntries(groups.reading.map(entryFor));
      setPhase("ready");
    } catch (error) {
      if (!disposed(seq)) {
        reportErrorObject(error, "paper_open");
        setPhase("error");
      }
    }
  }, [bookHash, entryFor]);

  useEffect(() => {
    // La apertura corre en una microtarea: el efecto solo programa el
    // trabajo, no fija estado de forma síncrona.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void open();
    });
    return () => {
      cancelled = true;
      openSeq.current += 1;
      // Si quedaba una hoja con borrador (la pantalla se desmontó sin
      // pasar por closeChapter), lo confirma antes de soltar el libro.
      void closeChapterRef.current();
      const close = closeRef.current;
      closeRef.current = null;
      bookRef.current = null;
      analyzerRef.current = null;
      if (close) void close();
    };
  }, [open]);

  const setSheetState = (next: PaperSheetState | null) => {
    sheetRef.current = next;
    setSheet(next);
  };

  const applyAnalysis = (
    result: ReadyAnalysis,
    current: PaperSheetState,
  ): PaperSheetState => {
    lexRef.current = new Map();
    const suggestion = buildChapterSuggestionRows(
      result,
      langRef.current,
      {
        saved: savedFormsRef.current,
        knowledge: knowledgeMapRef.current,
        threshold: thresholdRef.current,
        bookFrequencies: bookFreqRef.current ?? undefined,
      },
      lexRef.current,
    );
    const split = splitPaperRows(suggestion, result.text);
    return {
      ...current,
      analysis: "ready",
      text: result.text,
      chapterForms: result.forms,
      main: split.main,
      more: split.more,
      uncertain: split.uncertain,
    };
  };

  const runAnalysis = useCallback(async (current: PaperSheetState) => {
    const analyzer = analyzerRef.current;
    if (!analyzer) return;
    const result = await analyzer.analyze(current.range);
    const live = sheetRef.current;
    if (!live || live.target.id !== current.target.id) return;
    if (result.state === "ready") setSheetState(applyAnalysis(result, live));
    else setSheetState({ ...live, analysis: "error" });
  }, []);

  const openChapter = useCallback(
    async (entry: PaperChapterEntry) => {
      const scope = scopeRef.current;
      const analyzer = analyzerRef.current;
      const range = rangesRef.current.get(entry.target.id);
      if (!analyzer || !range) return;
      // La entrada de historial se empuja en el gesto que abre la hoja
      // (antes de cualquier await): «atrás» cierra la hoja, no la
      // pantalla. El close va por la ref para conservar el autoguardado.
      const previousOverlay = overlayHandleRef.current;
      overlayHandleRef.current = null;
      previousOverlay?.release();
      const handle = pushOverlay(() => {
        overlayHandleRef.current = null;
        void closeChapterRef.current();
      });
      overlayHandleRef.current = handle;
      const record =
        prepRecordsRef.current.get(entry.target.id) ??
        (await loadPreparationRecord(bookHash, entry.target.id, scope).catch(
          () => null,
        )) ??
        newPreparationRecord({
          bookHash,
          targetId: entry.target.id,
          updatedAt: Date.now(),
        });
      // «Atrás» durante la carga del registro: no reaparecer la hoja.
      if (overlayHandleRef.current !== handle) return;
      const initial: PaperSheetState = {
        target: entry.target,
        range,
        record,
        analysis: "loading",
        text: "",
        chapterForms: [],
        main: [],
        more: [],
        uncertain: [],
        answers: record.answers,
        dirty: false,
        saving: false,
        finished: false,
      };
      setSheetState(initial);
      setManualSaves([]);
      // «Aquí te quedaste»: el último destino abierto queda marcado.
      paperRef.current = {
        ...paperRef.current,
        lastTargetId: entry.target.id,
        updatedAt: Date.now(),
      };
      setLastTargetId(entry.target.id);
      void savePaperReading(paperRef.current, scope).catch(() => undefined);
      const cached = analyzer.cached(entry.target.id);
      if (cached?.state === "ready") {
        setSheetState(applyAnalysis(cached, initial));
        return;
      }
      await runAnalysis(initial);
    },
    [bookHash, runAnalysis],
  );

  const retryAnalysis = useCallback(() => {
    const current = sheetRef.current;
    if (!current) return;
    setSheetState({ ...current, analysis: "loading" });
    void runAnalysis({ ...current, analysis: "loading" });
  }, [runAnalysis]);

  const answerWord = useCallback(
    (key: string, answer: "known" | "unknown") => {
      const current = sheetRef.current;
      if (!current) return;
      const answers = { ...current.answers, [key]: answer };
      const record = { ...current.record, answers, updatedAt: Date.now() };
      const next: PaperSheetState = {
        ...current,
        answers,
        record,
        dirty: true,
      };
      setSheetState(next);
      prepRecordsRef.current.set(current.target.id, record);
      void savePreparationRecord(record, captureDbScope()).catch(
        () => undefined,
      );
    },
    [],
  );

  // Confirma el borrador por la misma transacción de la preparación del
  // lector. Devuelve falso si el guardado local falló (se reintenta al
  // salir o al tocar «Terminé» otra vez).
  const confirmSheetAnswers = useCallback(async (): Promise<boolean> => {
    const current = sheetRef.current;
    if (!current || current.saving) return true;
    if (!current.dirty || !Object.keys(current.answers).length) return true;
    setSheetState({ ...current, saving: true });
    const rows: PreparationRow[] = [
      ...current.main,
      ...current.more,
      ...current.uncertain,
    ].map(
      (row) =>
        lexRef.current.get(row.key) ?? { form: row.form, lemma: row.lemma },
    );
    const record: PreparationRecord = {
      ...current.record,
      answers: current.answers,
      disposition: "reviewed",
      updatedAt: Date.now(),
    };
    const result = await confirmPreparation(
      {
        record,
        recordKey: preparationRecordKey(bookHash, current.target.id),
        knowledge: buildPreparationEvidence(
          langRef.current,
          rows,
          current.answers,
        ),
        words: buildPreparationWords(
          langRef.current,
          rows,
          current.answers,
          bookHash,
        ),
      },
      scopeRef.current,
    );
    const live = sheetRef.current;
    if (!result.saved) {
      if (live?.target.id === current.target.id)
        setSheetState({ ...live, saving: false });
      onStatus?.("No se pudo guardar. Intenta de nuevo.");
      return false;
    }
    // Mismos merges locales que confirmPrep: las siguientes sugerencias
    // y el alta manual ya ven las palabras y la evidencia nuevas.
    for (const item of result.knowledge) {
      const lemma = item.lemma.toLowerCase();
      knowledgeMapRef.current.set(lemma, {
        lemma,
        known: item.known,
      });
      pendingKnowledgeRef.current.add(lemma);
    }
    for (const word of result.words) {
      const level = markLevel(word.card);
      for (const form of [word.form, word.lemma]) {
        if (!form) continue;
        const key = form.toLowerCase();
        if (level) savedFormsRef.current.set(key, level);
        else savedFormsRef.current.delete(key);
        savedTermsRef.current.add(key);
      }
    }
    setSavedTerms(new Set(savedTermsRef.current));
    setBookWordCount((count) => count + result.words.length);
    // Perfil reestimado por la misma cadena que cuando el lector
    // incorpora evidencia nueva.
    void refreshProfile(profileRefs(), langRef.current, scopeRef.current)
      .then(() => {
        thresholdRef.current =
          profileRef.current?.threshold ?? thresholdRef.current;
      })
      .catch(() => undefined);
    prepRecordsRef.current.set(current.target.id, record);
    refreshEntry(current.target.id);
    if (live?.target.id === current.target.id)
      setSheetState({
        ...live,
        record,
        dirty: false,
        saving: false,
      });
    onStatus?.(
      result.synced
        ? result.words.length
          ? `${result.words.length} palabra(s) agregada(s) a tu cuaderno.`
          : ""
        : "Guardado en este dispositivo; se sincroniza al volver la conexión.",
    );
    return true;
  }, [bookHash, onStatus, refreshEntry]);

  const closeChapter = useCallback(async () => {
    await confirmSheetAnswers();
    const handle = overlayHandleRef.current;
    overlayHandleRef.current = null;
    setSheetState(null);
    setManualSaves([]);
    // Consume el push que abrió la hoja; si «atrás» ya lo sacó de la
    // pila, release() no hace nada.
    handle?.release();
  }, [confirmSheetAnswers]);

  const finishChapter = useCallback(async () => {
    const ok = await confirmSheetAnswers();
    if (!ok) return;
    const current = sheetRef.current;
    if (!current) return;
    if (!paperRef.current.readTargetIds.includes(current.target.id)) {
      paperRef.current = {
        ...paperRef.current,
        readTargetIds: [...paperRef.current.readTargetIds, current.target.id],
        updatedAt: Date.now(),
      };
      void savePaperReading(paperRef.current, scopeRef.current).catch(
        () => undefined,
      );
    }
    refreshEntry(current.target.id);
    const live = sheetRef.current;
    if (live) setSheetState({ ...live, finished: true });
  }, [confirmSheetAnswers, refreshEntry]);

  const toggleRead = useCallback(() => {
    const current = sheetRef.current;
    if (!current) return;
    const id = current.target.id;
    const readTargetIds = paperRef.current.readTargetIds.includes(id)
      ? paperRef.current.readTargetIds.filter((item) => item !== id)
      : [...paperRef.current.readTargetIds, id];
    paperRef.current = {
      ...paperRef.current,
      readTargetIds,
      updatedAt: Date.now(),
    };
    void savePaperReading(paperRef.current, scopeRef.current).catch(
      () => undefined,
    );
    refreshEntry(id);
    setSheetState({ ...current, finished: false });
  }, [refreshEntry]);

  // Alta manual de una palabra encontrada en el libro físico. La frase
  // del capítulo solo se adjunta si la palabra aparece en él — nunca el
  // inicio del texto como contexto ajeno.
  const addManualWord = useCallback(
    async (form: string): Promise<ManualSaveOutcome> => {
      const scope = scopeRef.current;
      const lang = langRef.current;
      const trimmed = form.trim();
      if (!trimmed) return { kind: "error", form };
      const existing = await loadSavedWord(lang, trimmed, scope).catch(
        () => undefined,
      );
      if (existing && !existing.deleted)
        return { kind: "already", form: trimmed };
      const res = await lookupWord(trimmed, lang, scope).catch(() => null);
      const entry = res?.ok && res.found ? res.entries?.[0] : undefined;
      const sense = entry?.senses?.[0];
      const text = sheetRef.current?.text ?? "";
      const context = text ? contextIfPresent(text, trimmed) : undefined;
      let saved;
      try {
        saved = await saveWordWithKnowledge(
          {
            word: {
              form: trimmed,
              lemma: entry?.lemma || trimmed,
              pos: entry?.pos,
              meaning: sense?.definition,
              senseEntryId: entry?.entryId,
              senseOrder: sense?.senseOrder,
              language: lang,
              bookHash,
              context,
              priority: true,
            },
            knowledge: {
              language: lang,
              lemma: (entry?.lemma || trimmed).toLowerCase(),
              known: false,
              source: "saved",
            },
          },
          scope,
        );
      } catch {
        return { kind: "error", form: trimmed };
      }
      const { word, knowledge } = saved;
      manualCreatedRef.current.add(word.key);
      const low = word.form.toLowerCase();
      savedTermsRef.current.add(low);
      if (word.lemma) savedTermsRef.current.add(word.lemma.toLowerCase());
      setSavedTerms(new Set(savedTermsRef.current));
      const level = markLevel(word.card);
      if (level) savedFormsRef.current.set(low, level);
      else savedFormsRef.current.delete(low);
      knowledgeMapRef.current.set(
        (word.lemma || low).toLowerCase(),
        { lemma: (word.lemma || low).toLowerCase(), known: false },
      );
      const bound = scope ?? captureDbScope();
      if (isDbScopeActive(bound)) {
        void pushWordsToServer([word], bound);
        if (knowledge) void pushKnowledgeToServer([knowledge], bound);
      }
      const awardedAt = Date.now();
      void award(
        { kind: "saved", zipf: entry?.zipf ?? null },
        scope,
        {
          id: `saved:${word.key}:${word.updatedAt ?? word.savedAt}`,
          at: awardedAt,
          dayKey: localDayKey(awardedAt),
        },
      );
      const outcome: ManualSaveOutcome = {
        kind: "saved",
        form: trimmed,
        wordKey: word.key,
        meaning: sense?.definition,
      };
      setBookWordCount((count) => count + 1);
      setManualSaves((prev) => [...prev, outcome]);
      return outcome;
    },
    [bookHash],
  );

  // «Deshacer» solo retira lo que esta alta acaba de crear: una palabra
  // que ya estaba en el Cuaderno nunca se borra desde aquí.
  const undoManualWord = useCallback(async (wordKey: string) => {
    if (!manualCreatedRef.current.has(wordKey)) return;
    manualCreatedRef.current.delete(wordKey);
    const removed = await removeWord(wordKey, scopeRef.current).catch(
      () => undefined,
    );
    if (removed) {
      savedTermsRef.current.delete(removed.form.toLowerCase());
      savedFormsRef.current.delete(removed.form.toLowerCase());
      setSavedTerms(new Set(savedTermsRef.current));
      setBookWordCount((count) => Math.max(0, count - 1));
    }
    setManualSaves((prev) =>
      prev.filter((save) => save.kind !== "saved" || save.wordKey !== wordKey),
    );
  }, []);

  // Mantiene closeChapterRef al día sin mutar refs durante el render
  // (la hoja lo usa desde el overlay de historial).
  useEffect(() => {
    closeChapterRef.current = closeChapter;
  });

  return {
    phase,
    title,
    author,
    language,
    entries,
    extras,
    lastTargetId,
    retryOpen: open,
    sheet,
    manualSaves,
    savedTerms,
    bookWordCount,
    bookForms,
    openChapter,
    closeChapter,
    retryAnalysis,
    answerWord,
    finishChapter,
    toggleRead,
    addManualWord,
    undoManualWord,
  };
}
