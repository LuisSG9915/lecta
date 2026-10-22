import "../styles/reader.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { EpubBook } from "../lib/epub";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint, wordHitFromRange } from "../lib/words";
import { useReaderShortcutsAndGestures } from "../hooks/useReaderShortcutsAndGestures";
import {
  openEpub,
  detectBookLanguage,
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
  hydrateSectionImages,
  stripSoftHyphens,
} from "../lib/epub";
import { sanitizeSectionDocument } from "../lib/sanitize";
import { markWords } from "../lib/marks";
import {
  captureDbScope,
  getStoredBook,
  listAllKnowledge,
  listReadingEvents,
  listSavedWords,
  loadBookPosition,
  saveBookPosition,
  saveKnowledge,
  saveWordWithKnowledge,
  updateBookMeta,
  saveSessionValue,
  listIntervals,
  loadSessionValue,
  type DbScope,
  type SavedWord,
  type SavedBookPosition,
} from "../lib/idb";
import {
  betaFromZipf,
  updateLanguageTheta,
  recordChapterCompleted,
} from "../lib/profile-models";
import { batchLookup, enrichBatch, lookupWord } from "../lib/lexicon";
import { scheduleCapturedReview } from "../lib/reviews";
import {
  selectEnrichmentCandidates,
  selectSavedForEnrichment,
} from "../lib/enrichment-candidates";
import { hasUsableDefinition, measuredZipf } from "../../shared/lexicon";
import {
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD_NATIVE,
  estimateProfile,
  predictSection,
  PROFILE_ADJUST_KEY,
  type KnowledgeEvidence,
  type SectionPrediction,
  type VocabProfile,
} from "../lib/knowledge";
import {
  extractKeyWordFromSentence,
} from "../lib/section-words";
import {
  chapterSummary,
  countSavedInRange,
  hasChapterSummary,
  pruneReadingHistory,
  trackReadingEvent,
  type ChapterSummary,
  type VisitEventDraft,
} from "../lib/reading-events";
import { daysAgo, relativeDay } from "../lib/relative-time";
import {
  countWords,
  bookProgress,
  minutesLeft,
  updateWpm,
  DEFAULT_WPM,
  MAX_SAMPLE_MS,
  MIN_SAMPLE_MS,
  MIN_SAMPLE_WORDS,
} from "../lib/progress";
import { award, localDayKey } from "../lib/game";
import {
  initialCompanion,
  reduceCompanion,
  type CompanionMachine,
  type CompanionSignal,
  type CompanionState,
} from "../lib/companion-state";
import {
  applySyntacticLines,
  clearSyntacticLines,
} from "../lib/syntactic-lines";
import {
  clearParagraphFocus,
  updateParagraphFocus,
} from "../lib/paragraph-focus";
import {
  detectFatigue,
  detectDensePassageStall,
  isReaderIdleSleepy,
  loadBaselineWpm,
  newDenseStallDetector,
  newFocusTracker,
  recordMove,
  resetDenseStallPage,
  evaluateReadingFatigue,
  recordFocusAidOutcome,
  muteBookFocusSuggestions,
  setFocusAutoSuggestEnabled,
  loadFocusTelemetryProfile,
  saveFocusTelemetryProfile,
  type FocusAidType,
  type DenseStallDetector,
  type FocusTracker,
} from "../lib/focus-telemetry";
import {
  loadNativeLanguage,
  loadReaderSettings,
  saveReaderSettings,
  hasBookReaderSettings,
  clearBookReaderSettings,
  hasExplicitPreparationMode,
  readerProfileFor,
  readerCssVars,
  applyStrategyPreset,
  muteBookForPriming,
  disablePrimingGlobally,
  isFeatureFlagEnabled,
  type ReaderSettings,
  type ReadingStrategyPreset,
  type ThemeChoice,
} from "../lib/settings";
import {
  anchorAtViewTop,
  scrollToAnchor,
  scrollToFragment,
  scrollToSnippet,
  charOffsetAtViewTop,
} from "../lib/reading-location";
import {
  pageLayout,
  pageAdvance,
  totalPages,
  anchorAtPage,
  pageForFragment,
  pageForText,
  pageOfElement,
  buildFragmentPageMap,
  type PageLayout,
} from "../lib/pagination";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import {
  dominatedLemmas,
  savedFormLevels,
  type MarkLevel,
} from "../lib/word-level";
import { loadUseAi } from "../lib/ai-pref";
import {
  calibrationDoneKey,
  hasCalibrationEvidence,
} from "../lib/calibration";
import { calibrationBankZipf } from "../lib/knowledge";
import {
  isTtsProgrammaticNav,
  isTtsProgrammaticScroll,
} from "../lib/ttsGuards";
import {
  setCompanionAudioSuppressed,
  startAmbientPurr,
  stopAmbientPurr,
  startSoundscape,
  stopSoundscape,
  type SoundscapeKind,
} from "../lib/companion-audio";
import {
  requestPageRecap,
  requestLastPagesRecap,
  generateZeroSpoilerSceneRecap,
  type PageRecapResult,
  type SceneReturnRecap,
} from "../lib/page-recap";
import { checkHasInactivityGap } from "../lib/reading-activity";
import {
  checkPassiveExposure as checkPassiveExposureEvidence,
  refreshProfile,
} from "../lib/reader-evidence";
import {
  registerBookSections,
  unregisterBookSections,
} from "../lib/book-search";
import { translateParagraph } from "../lib/translate";
import {
  buildPostChapterConsolidationQueue,
  loadPostChapterConsolidationPrefs,
  isConsolidationActive,
  type EpisodicWordItem,
  type ConsolidationModality,
} from "../lib/practice";
import { BilingueParagraph } from "./BilingueParagraph";
import type { FocusSuggestion } from "./SmartReaderDock";
import { ReaderTopBar } from "./reader/ReaderTopBar";
import { ReaderOverlays } from "./reader/ReaderOverlays";
import { ReaderContent } from "./reader/ReaderContent";
import { ReaderDockHost } from "./reader/ReaderDockHost";
import { ReaderFloatingBars } from "./reader/ReaderFloatingBars";
import { ReaderFocusLayers } from "./reader/ReaderFocusLayers";
import { ReaderNotices } from "./reader/ReaderNotices";
import { ReaderSelectionBar } from "./reader/ReaderSelectionBar";
import ReaderSettingsSheet from "./reader/ReaderSettingsSheet";
import { ReaderSearchAndTocSheet } from "./reader/ReaderSearchAndTocSheet";
import { useReaderPersistence } from "../hooks/useReaderPersistence";
import { useReaderAnnotationsAndSearch } from "../hooks/useReaderAnnotationsAndSearch";
import { useReaderTts } from "../hooks/useReaderTts";
import { downloadBookMarkdown } from "../lib/export";
import {
  requestScreenWakeLock,
  releaseScreenWakeLock,
  triggerHaptic,
  type DeepReadingConfig,
  type DeepReadingState,
  type DeepReadingSummary,
} from "../lib/deep-reading";
import {
  isFullscreenSupported,
  toggleFullscreen,
} from "../lib/fullscreen";
import { playCompanionSound } from "../lib/companion-audio";
import { useCompanion } from "./CompanionProvider";
import { useReaderPresence } from "../lib/reader-presence";
import {
  buildChapterCatalog,
  suggestedChapterTarget,
  trackCalibrationOffer,
  type CalibrationTrack,
  targetAt,
  type ChapterCatalog,
  type ChapterTarget,
  type IntraSectionContext,
} from "../lib/chapters";
import {
  loadBookStart,
  resolveEntryTarget,
  type BookStartRecord,
} from "../lib/book-start";
import {
  createChapterAnalyzer,
  deserializeChapterAnalysis,
  serializeChapterAnalysis,
  type ChapterAnalyzer,
  type ChapterAnalysis,
} from "../lib/chapter-analysis";
import {
  lemmaOfFromEntries,
  loadPhrases,
  matchPhrase,
  setBilingualMode,
  type PhraseIndex,
} from "../lib/phrases";

type ReaderState = "idle" | "opening" | "ready" | "error";
type SheetKind = "toc" | "settings" | "search" | "marks";
export type ReaderSettingsTab = "appearance" | "book" | "strategy";

// Metadata del premio por consulta de palabra: el uuid se genera al
// abrir la ficha y viaja congelado en el journal. Vive fuera del
// componente para que reloj/uuid no se lean durante el render.
const consultedAwardMeta = () => {
  const at = Date.now();
  return {
    id: `consult:${crypto.randomUUID()}`,
    at,
    dayKey: localDayKey(at),
  };
};

// Días sin abrir el libro para que aparezca el marcador de retomar:
// una reanudación reciente ya es continua y la tarjeta solo estorba.
const RESUME_CARD_MIN_DAYS = 3;

// Intención de navegación (coordinador T17): todo salto pasa por
// `navigate` y deja registrada de dónde vino — la preparación (T19)
// decide qué interponer según esta intención y el ajuste vigente.
type NavIntent = "initial" | "chapter" | "resume" | "lookup" | "return";

type ReaderProps = {
  bookHash: string;
  file: Blob;
  fileName: string;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onBack: () => void;
  onOpenNotebook: () => void;
  statusText: string;
  errorText: string;
  // Verdadero cuando un panel global (Cuaderno, Cuenta) está abierto
  // encima: las flechas del lector no deben responder detrás de él.
  panelsOpen: boolean;
  theme: ThemeChoice;
  onThemeChange: (choice: ThemeChoice) => void;
  vocabVersion: number;
  // Descarga la muestra y abre la hoja de calibración (vive en App).
  // Devuelve si la hoja quedó abierta — el aviso se conserva cuando
  // no, para reintentar al volver la conexión.
  onRequestCalibration: (language: string) => Promise<boolean>;
  // Sesión confirmada: las funciones con IA piden cuenta — con ella
  // falsa la ficha ya anuncia «Inicia sesión» en vez de fallar tras
  // la espera. La preferencia «Usar IA» se consulta aparte.
  signedIn: boolean;
  readerInitialWord?: string;
};

// Caché por sección: la consulta al catálogo se hace una sola vez por
// sección; ajustar el perfil o registrar evidencia reclasifica con
// estos mismos datos sin otra llamada (predictSection es pura).
// Análisis «ready» de un destino: lo que la preparación y las marcas
// necesitan del cache del analizador por rango.
type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

// Fila del índice: derivada del catálogo de destinos, así la hoja
// navega por destino lógico (sección + fragmento), no solo sección.
type TocRow = { label: string; index: number; depth: number; target: ChapterTarget };

const WPM_KEY = "readingWpm";
// Desplazamiento manual del umbral del perfil («Mostrar menos/más»)
// y preferencia por libro de no mostrar la tarjeta «Antes de leer».

const previewHiddenKey = (hash: string) => `previewHidden:${hash}`;
// Tope del lote automático de definiciones con IA por sección. El
// catálogo ya cubre lo común (Wikcionario); el lote solo cierra
// huecos — 8 bastan para no dejar la hoja llena de «sin definición»
// sin abrir el gasto (cada palabra cuesta ~400–600 tokens).
const AUTO_ENRICH_CAP = 8;
// El lote de palabras guardadas sin definición es una pasada única
// por apertura de libro, acotado por el cuaderno real del lector —
// no es gasto recurrente como el de secciones, así que conserva más.
const SAVED_ENRICH_CAP = 20;

const clampNumber = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

import {
  useReaderChapterPrep,
  markSectionPreviewed,
  shouldAutoShowPreview,
} from "../hooks/useReaderChapterPrep";
export { markSectionPreviewed, shouldAutoShowPreview };

// Registra las palabras dominadas (repasadas, con ≥90 días de
// estabilidad) como evidencia «conocida» inferida: alimenta el
// modelo de conocimiento sin que el lector declare nada. Solo rellena
// huecos — una respuesta explícita del lector jamás se reescribe y una
// lápida no se revive. Es auxiliar: corre suelta y un fallo no
// interrumpe la carga.
export const recordDominated = (words: SavedWord[], lang: string, scope?: DbScope) =>
  (async () => {
    const bound = scope ?? captureDbScope();
    const lemmas = dominatedLemmas(words);
    if (!lemmas.length) return;
    const existing = new Set(
      (await listAllKnowledge(lang, bound)).map((row) => row.lemma),
    );
    for (const lemma of lemmas)
      if (!existing.has(lemma))
        await saveKnowledge(
          {
            language: lang,
            lemma,
            known: true,
            source: "inferred",
          },
          bound,
        );
  })().catch(() => undefined);

export const PRESET_LABELS: Record<ReadingStrategyPreset, string> = {
  clean: "Limpia",
  adhd: "Enfoque",
  guided: "Ritmo",
  focus: "Enfoque",
  lexical: "Léxico",
  immersive: "Inmersivo",
  audio: "Audio",
  custom: "Ajustado",
};

export default function Reader({
  bookHash,
  file,
  fileName,
  onError,
  onStatus,
  onBack,
  onOpenNotebook,
  statusText,
  errorText,
  panelsOpen,
  theme,
  onThemeChange,
  vocabVersion,
  onRequestCalibration,
  signedIn,
  readerInitialWord,
}: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureProbeRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const scrollTimer = useRef<number | undefined>(undefined);
  const rafPending = useRef(false);
  const lastScrollY = useRef(0);
  const savedForms = useRef<Map<string, MarkLevel>>(new Map());
  const sectionTiming = useRef<{ start: number; startRatio: number; words: number } | null>(null);
  const overlayReleaseRef = useRef<OverlayHandle | null>(null);
  const releaseOverlay = () => {
    overlayReleaseRef.current?.release();
    overlayReleaseRef.current = null;
  };
  const tocRowsRef = useRef<TocRow[]>([]);
  const currentChapterPrimedWordsRef = useRef<EpisodicWordItem[]>([]);
  const ttsStopOnNavRef = useRef<(() => void) | null>(null);
  // El analizador por rango (T13) reemplaza al cache por sección:
  // deduplica por destino y trabaja sobre el tramo físico completo.
  // Se crea en loadBook tras el catálogo.
  // Perfil léxico del lector: umbral zipf estimado con la evidencia
  // «conozco / no conozco» más el ajuste manual (knowledge.ts).
  const profileRef = useRef<VocabProfile | null>(null);
  const baseThresholdRef = useRef(DEFAULT_THRESHOLD_NATIVE);
  // Ajuste manual del umbral (session: profileAdjust).
  const adjustRef = useRef(0);
  // Evidencia por lema que alimenta estimateProfile; crece con cada
  // «Ya la conocía» y cada guardado.
  const evidenceRef = useRef(new Map<string, KnowledgeEvidence>());
  // Evidencia explícita por lema para predictSection.
  const knowledgeMapRef = useRef(
    new Map<
      string,
      {
        lemma: string;
        known: boolean;
        status?: "unknown" | "familiar" | "known";
        passiveSeenCount?: number;
        estimatedKnownProb?: number;
      }
    >(),
  );
  // Lemas con evidencia escrita en esta sesión que la próxima
  // recarga del perfil aún podría no ver en el store.
  const pendingKnowledgeRef = useRef(new Set<string>());
  // Id de esta apertura del libro: agrupa los eventos del trayecto
  // en una «visita». Se genera al primer uso (fuera del render).
  const visitIdRef = useRef<string | null>(null);
  // Último destino anotado en el trayecto (una entrada por destino).
  const lastTargetEnteredRef = useRef<string | null>(null);
  // Una sola solicitud de definiciones para guardadas sin acepción
  // por apertura del libro.
  const savedEnrichSentRef = useRef(false);
  // Destinos con análisis en vuelo: dice si el capítulo visible sigue
  // preparándose (el analizador deduplica la promesa por destino).
  const analyzingTargets = useRef(new Set<string>());
  // Destinos que ya gastaron su lote automático de definiciones IA.
  const enrichedTargets = useRef(new Set<string>());
  // Espejo de ajustes para callbacks (el modo de preparación se lee
  // al decidir, no al renderizar).
  const settingsRef = useRef<ReaderSettings | null>(null);
  // Preferencia «Usar IA» en ref: la lee el enriquecimiento automático
  // sin rehacer callbacks ni depender del ciclo de render.
  const useAiRef = useRef(true);

  // Última posición del puntero sobre el texto: la tecla D consulta la
  // palabra bajo el cursor sin necesidad de hacer clic.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  // Espejos en ref de los valores que cambian con cada página: así los
  // callbacks estables (guardado, teclado, restauración) no dependen
  // de re-render ni cierran sobre estado viejo.
  const layoutRef = useRef<"scroll" | "pages">("scroll");
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const metricsRef = useRef<PageLayout | null>(null);
  const sectionIndexRef = useRef(0);
  // Espejo del estado de montaje para el controlador TTS (la sección
  // «terminó de pintar» se consulta al llegar el render, no al decidir).
  const stateRef = useRef<ReaderState>("idle");
  const pageAnchorRef = useRef<string | null>(null);
  // Destino pendiente de una carga de sección: lo resuelve el recuento
  // de páginas, que corre cuando los estilos de columna ya aplicaron.
  const pendingPageRef = useRef<{
    ratio?: number;
    anchor?: string;
    snippet?: string;
    fragment?: string;
    at?: "end";
  } | null>(null);
  // Intención del último salto — la preparación (T19) la consulta al
  // decidir qué interponer.
  const navIntentRef = useRef<NavIntent>("initial");
  // blob: URLs de las imágenes de la sección visible: se revocan al
  // cambiar de sección (en hydrateSectionImages) y al desmontar.
  const imgUrlsRef = useRef<string[]>([]);
  // loadBlob del zip del EPUB (EPUB no lo declara en su tipo público).
  const loadBlobRef = useRef<((name: string) => Promise<Blob | null>) | null>(null);
  // Máquina del gato acompañante (companion-state): vive en ref —
  // solo se refleja a estado cuando cambia el estado visible.
  const companionRef = useRef<CompanionMachine | null>(null);
  // book_opened se envía una sola vez por apertura del libro.
  const companionOpenedRef = useRef(false);
  // Ventana de regresiones para el detector de fatiga (Fase 3).
  const focusTrackerRef = useRef<FocusTracker | null>(null);
  // Rastreo de exposición pasiva por página (Fase 4).
  const pageEnteredAtRef = useRef<number>(0);
  const consultedInPageRef = useRef<Set<string>>(new Set());

  const [state, setState] = useState<ReaderState>("idle");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [sectionTotal, setSectionTotal] = useState(0);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionSizes, setSectionSizes] = useState<number[]>([]);
  const [sectionWords, setSectionWords] = useState(0);
  const [sectionHasImages, setSectionHasImages] = useState(false);
  const [showChapterTitle, setShowChapterTitle] = useState(false);
  const [tocRows, setTocRows] = useState<TocRow[]>([]);
  // Catálogo de destinos (T10/T11); no cambia tras la carga del libro.
  const [catalog, setCatalog] = useState<ChapterCatalog | null>(null);
  const [bookSections, setBookSections] = useState<EpubBook["sections"] | undefined>(undefined);
  const catalogRef = useRef<ChapterCatalog | null>(null);
  // Registro de la elección inicial: el destino de preparación que
  // eligió (o se le sugirió) se consume en la primera evaluación.
  const bookStartRef = useRef<BookStartRecord | null>(null);
  // Analizador por rango (T13): un capítulo repartido es un solo
  // destino con una sola consulta de catálogo.
  const analyzerRef = useRef<ChapterAnalyzer | null>(null);
  // Invitación a la prueba de vocabulario: aparece una vez por apertura
  // del libro al terminar el primer tramo leído, si la cuenta no ha
  // calibrado ni descartado la oferta («calibrationDone»). La franja
  // espera; «Ahora no» marca la llave y cierra la vía automática.
  const [calNotice, setCalNotice] = useState(false);
  // Tramo candidato a «primer lectura real» de la apertura: se arma
  // solo viendo el tramo antes de su final — retomar, un marcador o un
  // salto que aterriza ya en el final no disparan la invitación.
  const calTrack = useRef<CalibrationTrack | null>(null);
  const calEvaluated = useRef(false);
  const [language, setLanguage] = useState("es");
  const [selection, setSelection] = useState<WordHit | null>(null);
  const [charOffsetInChapter, setCharOffsetInChapter] = useState(0);

  const applyCachedPredictionRef = useRef<((index: number, lang: string) => SectionPrediction | null) | null>(null);
  const zipfForLemmaRef = useRef<((lemma: string) => number | null) | null>(null);

  const trackEvent = useCallback(
    (draft: VisitEventDraft) => {
      const visitId = (visitIdRef.current ??= crypto.randomUUID());
      void trackReadingEvent(
        { ...draft, visitId, bookHash },
        captureDbScope(),
      );
    },
    [bookHash],
  );

  const rangeFor = useCallback(
    (index: number) => {
      const cat = catalogRef.current;
      if (!cat) return null;
      return (
        cat.ranges.find((r) => r.startSection <= index && index < r.endSection) ??
        cat.ranges[0] ??
        null
      );
    },
    [],
  );

  const [_analyzing, setAnalyzing] = useState(false);

  const setAnalyzingFor = useCallback((targetId: string, analyzing: boolean) => {
    if (analyzing) analyzingTargets.current.add(targetId);
    else analyzingTargets.current.delete(targetId);
    const current = targetAt(
      catalogRef.current?.ranges ?? [],
      sectionIndexRef.current,
    );
    if (current?.id === targetId) setAnalyzing(analyzing);
  }, []);

  const ingestKnowledgeRow = useCallback(
    (row: {
      lemma: string;
      known: boolean;
      status?: "unknown" | "familiar" | "known";
      passiveSeenCount?: number;
      estimatedKnownProb?: number;
    }) => {
      const lemma = row.lemma.toLowerCase();
      knowledgeMapRef.current.set(lemma, {
        lemma,
        known: row.known,
        status: row.status,
        passiveSeenCount: row.passiveSeenCount,
        estimatedKnownProb: row.estimatedKnownProb,
      });
      const prev = evidenceRef.current.get(lemma);
      evidenceRef.current.set(lemma, {
        known: row.known,
        zipf: prev?.zipf ?? zipfForLemmaRef.current?.(lemma) ?? null,
      });
      pendingKnowledgeRef.current.add(lemma);
    },
    [],
  );

  const {
    prep,
    setPrep,
    prepNotice,
    previewSuggested,
    setPreviewSuggested,
    showPreview,
    setShowPreview,
    closePrepLayer,
    evaluatePreparation,
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
  } = useReaderChapterPrep({
    bookHash,
    bookRef,
    catalogRef,
    analyzerRef,
    language,
    sectionIndexRef,
    settingsRef,
    tocRowsRef,
    bookStartRef,
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
    applyPrediction: (index, lang) => {
      applyCachedPredictionRef.current?.(index, lang);
    },
    trackEvent,
    ingestKnowledgeRow,
    onStatus,
    onError,
    closeOtherOverlays: () => {
      setSheet(null);
      setSelection(null);
    },
  });

  useEffect(() => {
    if (readerInitialWord && state === "ready") {
      setSelection({ word: readerInitialWord });
    }
  }, [readerInitialWord, state]);
  // Índice de locuciones (asset estático): se pide al montar el
  // lector para que el PRIMER toque ya lo tenga en memoria — sin
  // red ni IA en el camino de la consulta.
  const phrasesRef = useRef<PhraseIndex | null>(null);
  // Predicción de la sección visible (marcas punteadas en el texto).
  // Null mientras no haya análisis aplicable.
  const [prediction, setPrediction] = useState<SectionPrediction | null>(null);
  const [_enriching, setEnriching] = useState<{
    index: number;
    done: number;
    total: number;
  } | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [settingsTab, setSettingsTab] = useState<ReaderSettingsTab>("appearance");
  const [barsVisible, setBarsVisible] = useState(true);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings(bookHash));
  const [strategyPaused, setStrategyPaused] = useState(false);
  const [pacerPaused, setPacerPaused] = useState(false);
  const pacerIndexRef = useRef<number>(0);
  const [ttsCapturedToast, setTtsCapturedToast] = useState<string | null>(null);
  // Barra Zen auto-desvanecible (B.1)
  const [isZenFaded, setIsZenFaded] = useState(false);
  const zenFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Telemetría de pasaje denso (B.2)
  const denseStallDetectorRef = useRef<DenseStallDetector>(
    newDenseStallDetector(0),
  );

  const focusTelemetryRef = useRef({
    pageEnteredAt: Date.now(),
    lastFlaggedAt: 0,
    recordPageTurn: function(_wordsOnPage = 100, dwellMs?: number) {
      const now = Date.now();
      const elapsed = dwellMs ?? (now - this.pageEnteredAt);
      this.pageEnteredAt = now;
      if (elapsed > 35_000 && now - this.lastFlaggedAt > 120_000) {
        this.lastFlaggedAt = now;
        return true;
      }
      return false;
    },
  });

  const showNotice = useCallback(
    (msg: string) => {
      onStatus(msg);
    },
    [onStatus],
  );

  const chapterAnalysis = useMemo(() => {
    const count = prepNotice?.count ?? 0;
    if (count <= 0) return null;
    return {
      coveragePct: 95,
      unknownKeyWords: Array.from({ length: count }, (_, i) => ({ id: i })),
    };
  }, [prepNotice]);

  const lastActivityAtRef = useRef<number>(0);
  const [stallBubble, setStallBubble] = useState<string | null>(null);
  const stallBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bookOverride, setBookOverride] = useState(() => hasBookReaderSettings(bookHash));
  const [seenStatus, setSeenStatus] = useState(statusText);

  // Track 5: Burbuja "¿En qué me quedé?" tras > 6 horas de inactividad
  const [recapBubbleVisible, setRecapBubbleVisible] = useState(false);
  const [recapBubbleBullets, setRecapBubbleBullets] = useState<string[]>([]);
  const [recapBubbleLoading, setRecapBubbleLoading] = useState(false);
  const recapCheckedRef = useRef(false);

  // Track 12: Ensamblaje Maestro de Ciclo de Vida del Capítulo
  const currentChapterLookups = useRef<EpisodicWordItem[]>([]);
  const chapterStartedAtRef = useRef<number>(Date.now());
  const pendingNextChapterRef = useRef<number | null>(null);
  const [postChapterQueue, setPostChapterQueue] = useState<
    Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>
  >([]);
  const [fatigueSuggestion, setFatigueSuggestion] = useState<FocusSuggestion | null>(null);
  const [sceneRecap, setSceneRecap] = useState<SceneReturnRecap | null>(null);
  const sectionTextRef = useRef<string>("");
  const sessionStartRef = useRef<number>(Date.now());
  const pageTurnTimeRef = useRef<number>(Date.now());
  const [activeBilingualParagraph, setActiveBilingualParagraph] = useState<{
    originalText: string;
    translatedText?: string;
  } | null>(null);

  // Track 5: Doble toque para traducir párrafo
  const lastTapRef = useRef<{ time: number; element: HTMLElement | null }>({ time: 0, element: null });
  const [returnPoint, setReturnPoint] = useState<{
    sectionIndex: number;
    ratio: number;
    anchor?: string;
  } | null>(null);
  const [selButton, setSelButton] = useState<{
    x: number;
    y: number;
    placement: "top" | "bottom";
    singleWordHit: WordHit | null;
  } | null>(null);
  const lastPointerTypeRef = useRef<string>("mouse");
  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const [deepModal, setDeepModal] = useState(false);
  const [pageRecap, setPageRecap] = useState<{
    loading: boolean;
    data: PageRecapResult | null;
    error: string | null;
  } | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [deepReading, setDeepReading] = useState<DeepReadingState | null>(null);
  const [deepSummary, setDeepSummary] = useState<DeepReadingSummary | null>(null);
  const isDeepReading = Boolean(deepReading?.active);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageMetrics, setPageMetrics] = useState<PageLayout | null>(null);

  const [activeScrollFragment, setActiveScrollFragment] = useState<string | null>(null);
  const activeScrollFragRef = useRef<string | null>(null);

  const currentSectionTargets = useMemo(() => {
    if (!catalog) return [];
    return catalog.targets.filter((t: ChapterTarget) => t.sectionIndex === sectionIndex);
  }, [catalog, sectionIndex]);
  const currentSectionTargetsRef = useRef<ChapterTarget[]>([]);
  useEffect(() => {
    currentSectionTargetsRef.current = currentSectionTargets;
  }, [currentSectionTargets]);

  const [fragmentPageMap, setFragmentPageMap] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    if (
      settings.layout !== "pages" ||
      !pageMetrics ||
      !containerRef.current ||
      currentSectionTargets.length <= 1
    ) {
      setFragmentPageMap(null);
      return;
    }
    const fragments = currentSectionTargets
      .map((t: ChapterTarget) => t.fragment)
      .filter((f: string | undefined): f is string => Boolean(f));
    setFragmentPageMap(buildFragmentPageMap(containerRef.current, pageMetrics, fragments));
  }, [settings.layout, pageMetrics, currentSectionTargets]);

  const activeIntraContext = useMemo<IntraSectionContext>(() => {
    if (settings.layout === "pages") {
      return {
        currentPage: page,
        fragmentPageMap: fragmentPageMap ?? undefined,
        activeFragment: activeScrollFragment,
      };
    }
    return {
      activeFragment: activeScrollFragment,
    };
  }, [settings.layout, page, fragmentPageMap, activeScrollFragment]);

  const currentChapterTarget = useMemo(() => {
    if (!catalog) return null;
    return targetAt(catalog.ranges, sectionIndex, activeIntraContext);
  }, [catalog, sectionIndex, activeIntraContext]);

  const {
    annotations,
    bookmark,
    passages,
    searchQ,
    setSearchQ,
    searchHits,
    searchDone,
    editingNote,
    setEditingNote,
    noteDraft,
    setNoteDraft,
    quoteCard,
    setQuoteCard,
    catPassageExplanation,
    setCatPassageExplanation,
    sectionLabel,
    saveBookmarkHere,
    removeMark,
    saveNote,
    savePassageSelection,
    openQuoteCardFromSelection,
    askCatAboutSelection,
    savePassageDirectly,
  } = useReaderAnnotationsAndSearch({
    bookHash,
    sectionIndex,
    state,
    vocabVersion,
    prediction,
    bookRef,
    containerRef,
    metricsRef,
    layoutRef,
    pageRef,
    tocRows,
    tocRowsRef,
    currentChapterTarget,
    sectionTitle,
    title,
    author,
    language,
    signedIn,
    captureDbScope,
    onStatus,
    setSelButton,
  });
  // Gato acompañante en el lector: el aspecto (etapa, accesorios,
  // nombre, presencia) viene del CompanionProvider único — aquí solo
  // queda el estado visible de la máquina local de lectura.
  const [catState, setCatState] = useState<CompanionState | null>(null);
  const [catSleepy, setCatSleepy] = useState(false);
  // Sugerencia de pausa 20-20-20 cuando la telemetría marca fatiga.
  const [fatigueNotice, setFatigueNotice] = useState(false);
  // Marcador de retomar: contexto visible al reabrir el libro tras
  // días sin leerlo (diseño: plan-marcador-retomar). Máxima prioridad
  // en la franja de avisos — es el mensaje de apertura.
  const [resumeCard, setResumeCard] = useState<{
    label: string | null;
    lastReadText: string;
    daysSince: number;
    savedInRange: number;
    rereadTo: { index: number; fragment?: string } | null;
  } | null>(null);
  // Segmento de lectura abierto: empieza con la primera señal real y


  // Compañero desde el proveedor único: preferencia del juego, etapa,
  // accesorios equipados, nombre y modo de presencia de la cuenta —
  // el lector no carga estado de perfil propio (eso vive arriba).
  const companion = useCompanion();
  const catEnabled = companion.enabled === true;
  const presenceMode = companion.presence;

  // Cubierta de la lectura para pausa y presencia: hojas del lector,
  // paneles de la app, preparación/calibración pendiente y la propia
  // hoja del gato — esta última pausa el tiempo de lectura igual que
  // cualquier otra capa.
  const readingPaused =
    sheet !== null ||
    panelsOpen ||
    state !== "ready" ||
    prep !== null ||
    companion.open;
  // Para la presencia además cuenta cualquier capa modal encima
  // (consulta de palabra, calibración, diálogos) aunque aún no haya
  // cerrado el segmento: son el mismo concepto de «tapado».
  const presenceOverlay =
    readingPaused || selection !== null || companion.modalOpen;

  // Pestaña oculta para el planificador (aparte del seguimiento de
  // actividad, que ya la escucha para cerrar el segmento).
  const [docHidden, setDocHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Precarga del índice de locuciones: asset estático, una vez por
  // montaje del lector; si no estaba listo para el primer toque el
  // match se omite sin bloquear la ficha.
  useEffect(() => {
    let cancelled = false;
    void loadPhrases().then((index) => {
      if (!cancelled) phrasesRef.current = index;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Planificador de presencia (fase 5): recibe señales reales del
  // lector y decide cuándo se ve el gato según el modo de la cuenta.
  // Las callbacks devueltas son estables (entran en deps de
  // noteActivity sin rearmar sus efectos).
  const {
    visible: catVisible,
    greeting: catGreeting,
    greet: greetCat,
    suppressed: catSuppressed,
    setSuppressed: setCatSuppressed,
    activity: presenceActivity,
    idle: presenceIdle,
    react: presenceReact,
  } = useReaderPresence({
    enabled: catEnabled,
    mode: presenceMode,
    ready: state === "ready",
    overlay: presenceOverlay,
    hidden: docHidden,
    machine: catState,
  });

  // Los festejos del inbox esperan contexto seguro: con presencia
  // «off», supresión por libro o cualquier capa encima quedan
  // pendientes sin marcar como vistos.
  const setCelebrationBlocked = companion.setCelebrationBlocked;
  const celebrationBlocked =
    !catEnabled ||
    presenceMode === "off" ||
    catSuppressed ||
    presenceOverlay;
  useEffect(() => {
    setCelebrationBlocked(celebrationBlocked);
    return () => setCelebrationBlocked(false);
  }, [celebrationBlocked, setCelebrationBlocked]);

  // Desvanecer al ocultar: la visita queda un instante montada con
  // data-out (la animación de salida vive en reader.css; con
  // reduced-motion el navegador la reduce sola y no se nota).
  const [catRendered, setCatRendered] = useState(false);
  const [catLeaving, setCatLeaving] = useState(false);
  // Ajuste durante el render (como `seenStatus` más abajo): sube en
  // cuanto la presencia lo dice; al ocultar queda en salida un tramo
  // y el temporizador de abajo la retira.
  if (catVisible && catLeaving) {
    // Volvió antes de acabar el fundido: se queda sin transición.
    setCatLeaving(false);
  } else if (catVisible && !catRendered) {
    setCatRendered(true);
  } else if (!catVisible && catRendered && !catLeaving) {
    setCatLeaving(true);
  }
  useEffect(() => {
    if (!catLeaving) return;
    const timer = window.setTimeout(() => {
      setCatRendered(false);
      setCatLeaving(false);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [catLeaving]);
  // Con el juego apagado la máquina se retira en el efecto de abajo;
  // aquí se suelta su estado visible (ajuste durante el render).
  if (!catEnabled && catState !== null) setCatState(null);
  // ¿Se dibuja el gato ahora? Solo si el juego está encendido, la
  // máquina local existe y el planificador lo dice.
  const catShown = catEnabled && catRendered && catState !== null;

  // Al tocar al gato del lector reacciona con un brinco antes de
  // abrir su hoja: el gesto se siente vivo, no como un acceso seco.
  // El temporizador vive en ref para limpiarlo al desmontar.
  const catTapTimer = useRef<number | null>(null);
  const [catTap, setCatTap] = useState(false);
  const [catSavedWord, setCatSavedWord] = useState(false);
  const catSavedWordTimer = useRef<number | null>(null);
  const onStallBubbleClick = useCallback(() => {
    setStallBubble(null);
    if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
    const updated: ReaderSettings = {
      ...settings,
      paragraphFocus: true,
      focusMode: "paragraph",
    };
    setSettings(updated);
    saveReaderSettings(updated, bookHash);
    triggerHaptic("success");
  }, [settings, bookHash]);

  const onCatTap = () => {
    if (stallBubble) {
      onStallBubbleClick();
      return;
    }
    if (catTapTimer.current !== null) return;
    // Movimiento reducido: el brinco no se anima y la espera de 600ms
    // sería tiempo muerto — la hoja abre de inmediato.
    if (companion.reducedMotion) {
      companion.openPanel();
      return;
    }
    setCatTap(true);
    catTapTimer.current = window.setTimeout(() => {
      catTapTimer.current = null;
      setCatTap(false);
      companion.openPanel();
    }, 600);
  };
  useEffect(
    () => () => {
      if (catTapTimer.current !== null)
        window.clearTimeout(catTapTimer.current);
      if (catSavedWordTimer.current !== null)
        window.clearTimeout(catSavedWordTimer.current);
    },
    [],
  );

  // Barra Zen auto-desvanecible (B.1): a los 3s de lectura activa o tras cambiar de página,
  // la barra superior se desvanece suavemente a opacidad 0.15. Un movimiento de ratón o
  // toque en el tercio superior la restaura al 100%.
  const resetZenFadeTimer = useCallback(() => {
    setIsZenFaded(false);
    if (zenFadeTimerRef.current) clearTimeout(zenFadeTimerRef.current);
    zenFadeTimerRef.current = setTimeout(() => {
      setIsZenFaded(true);
    }, 3000);
  }, []);

  // Al cambiar de página o sección, reinicia temporizador Zen y limpia pasaje denso
  const navKey = `${sectionIndex}:${page}`;
  const [prevNavKey, setPrevNavKey] = useState(navKey);
  if (navKey !== prevNavKey) {
    setPrevNavKey(navKey);
    setIsZenFaded(false);
    if (stallBubble !== null) {
      setStallBubble(null);
    }
  }

  useEffect(() => {
    if (zenFadeTimerRef.current) clearTimeout(zenFadeTimerRef.current);
    zenFadeTimerRef.current = setTimeout(() => {
      setIsZenFaded(true);
    }, 3000);
    if (denseStallDetectorRef.current) {
      resetDenseStallPage(denseStallDetectorRef.current, Date.now());
    }
    if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
  }, [navKey]);

  // Escucha de actividad de puntero y toques para despertar la barra Zen y registrar telemetría
  useEffect(() => {
    const onPointerActivity = (e: Event) => {
      lastActivityAtRef.current = Date.now();
      let clientY = 0;
      if ("clientY" in e && typeof (e as { clientY: unknown }).clientY === "number") {
        clientY = (e as { clientY: number }).clientY;
      } else if ("touches" in e && (e as TouchEvent).touches.length > 0) {
        clientY = (e as TouchEvent).touches[0].clientY;
      }
      if (isZenFaded) {
        if ("clientY" in e || clientY < window.innerHeight / 3) {
          resetZenFadeTimer();
        }
      } else {
        resetZenFadeTimer();
      }
    };

    window.addEventListener("pointermove", onPointerActivity, { passive: true });
    window.addEventListener("touchstart", onPointerActivity, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerActivity);
      window.removeEventListener("touchstart", onPointerActivity);
      if (zenFadeTimerRef.current) clearTimeout(zenFadeTimerRef.current);
    };
  }, [isZenFaded, resetZenFadeTimer]);

  // Chequeo periódico de pasajes densos (B.2)
  useEffect(() => {
    const checkDenseStall = () => {
      if (state !== "ready" || isDeepReading) return;
      const now = Date.now();
      const baselineWpm = loadBaselineWpm();
      const pageWords = Math.max(30, Math.round(sectionWords / (pageCount || 1)));
      const isStalled = detectDensePassageStall(
        denseStallDetectorRef.current,
        now,
        pageWords,
        baselineWpm,
        lastActivityAtRef.current,
      );
      if (isStalled) {
        if (settings.strategyPreset === "immersive") {
          setStallBubble(
            "¿Pasaje denso? Tócame para iluminar el párrafo paso a paso.",
          );
          if (stallBubbleTimerRef.current)
            clearTimeout(stallBubbleTimerRef.current);
          stallBubbleTimerRef.current = setTimeout(() => {
            setStallBubble(null);
          }, 6000);
        }
      }
    };

    const interval = setInterval(checkDenseStall, 4000);
    return () => {
      clearInterval(interval);
      if (stallBubbleTimerRef.current) clearTimeout(stallBubbleTimerRef.current);
    };
  }, [
    state,
    isDeepReading,
    sectionWords,
    pageCount,
    settings.strategyPreset,
  ]);

  if (seenStatus !== statusText) setSeenStatus(statusText);

  // ---------- Gato acompañante y telemetría de foco ----------

  // Única puerta a la máquina del gato: nunca asigna sin cambiar —
  // el re-render solo corre cuando cambia el estado visible. La
  // actividad continua (scroll, páginas) se acota a una señal cada
  // 4 s: el estado visible no cambia por cada píxel recorrido.
  const signalCompanion = useCallback(
    (sig: Omit<CompanionSignal, "at"> & { at?: number }) => {
      const m = companionRef.current;
      if (!m) return;
      const full: CompanionSignal = { ...sig, at: sig.at ?? Date.now() };
      if (
        full.kind === "reading_activity" &&
        (m.state === "reading" || m.state === "deep_focus") &&
        full.at - m.lastActiveAt < 4_000
      )
        return;
      const next = reduceCompanion(m, full);
      companionRef.current = next;
      setCatState((prev) => (prev === next.state ? prev : next.state));
      // Momentos con peso hacen asomar al gato a responder aunque no
      // toque visita programada: consulta de palabra, meta del día o
      // fatiga. El enfriamiento propio de react() evita el acoso.
      if (
        full.kind === "word_consulted" ||
        full.kind === "goal_completed" ||
        full.kind === "fatigue_detected"
      )
        presenceReact();
    },
    [presenceReact],
  );

  const capturePositionRef = useRef<() => SavedBookPosition | null>(() => null);

  const {
    latestPositionRef,
    noteActivity,
    closeActivity,
    saveSoon,
  } = useReaderPersistence({
    bookHash,
    isReady: state === "ready",
    capturePosition: () => capturePositionRef.current(),
    signalCompanion,
    awardReading: (input, scope, receipt) => award(input, scope, receipt),
    presenceActivity,
    presenceIdle,
    setCatSleepy,
    paused: readingPaused,
  });

  // Track 5: Detección de inactividad > 6h para "¿En qué me quedé?" (Track 8: Cero Spoilers)
  useEffect(() => {
    if (recapCheckedRef.current || !bookHash) return;
    recapCheckedRef.current = true;
    const scope = captureDbScope();
    void listIntervals(scope)
      .then((intervals) => {
        if (checkHasInactivityGap(intervals, bookHash)) {
          const offset = containerRef.current
            ? charOffsetAtViewTop(containerRef.current, sectionTextRef.current)
            : sectionTextRef.current.length;
          const textBefore = sectionTextRef.current.slice(0, offset);
          const lastInterval = intervals[intervals.length - 1];
          const lastMs = lastInterval ? lastInterval.endedAt : Date.now() - 7 * 3600 * 1000;
          const recap = generateZeroSpoilerSceneRecap(
            textBefore,
            lastMs,
            Date.now(),
            language || "es",
          );
          setSceneRecap(recap);
          setRecapBubbleVisible(true);
        }
      })
      .catch(() => undefined);
  }, [bookHash, language]);

  const handleTriggerReturnRecap = async () => {
    setRecapBubbleLoading(true);
    try {
      const container = containerRef.current;
      const lastPages: string[] = [];
      if (container) {
        if (settings.layout === "pages" && pageMetrics) {
          const paras = Array.from(
            container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
          );
          for (let pIdx = Math.max(0, page - 2); pIdx <= page; pIdx++) {
            const pageParas = paras.filter((el) => pageOfElement(el, pageMetrics) === pIdx);
            if (pageParas.length > 0) {
              lastPages.push(pageParas.map((el) => el.textContent ?? "").join("\n\n"));
            }
          }
        }
        if (lastPages.length === 0) {
          const paras = Array.from(
            container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
          );
          const text = paras.slice(-15).map((el) => el.textContent ?? "").join("\n\n");
          if (text) lastPages.push(text);
        }
      }

      const res = await requestLastPagesRecap(
        {
          lastPagesText: lastPages,
          bookTitle: title,
          chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
        },
        captureDbScope(),
      );

      setRecapBubbleBullets(res.bullets.slice(0, 3));
    } catch {
      setRecapBubbleBullets([
        "La lectura retoma en este punto de la obra.",
        "Los personajes y reflexiones continúan desenvolviéndose.",
      ]);
    } finally {
      setRecapBubbleLoading(false);
    }
  };

  // Track 5: Registrar secciones en book-search para búsquedas sin spoilers
  useEffect(() => {
    if (bookHash && bookRef.current?.sections) {
      registerBookSections(bookHash, bookRef.current.sections, tocRowsRef.current);
    }
    return () => {
      if (bookHash) unregisterBookSections(bookHash);
    };
  }, [bookHash, state]);

  // Track 5: Contexto de lectura para el gato (personajes sin spoilers en la página visible)
  useEffect(() => {
    if (!companion?.setReaderContext) return;
    const container = containerRef.current;
    let pageText = "";
    if (container) {
      if (settings.layout === "pages" && pageMetrics) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const pageParas = paras.filter((p) => pageOfElement(p, pageMetrics) === page);
        if (pageParas.length > 0) {
          pageText = pageParas.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
      if (!pageText) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const viewH = window.innerHeight;
        const visible = paras.filter((p) => {
          const rect = p.getBoundingClientRect();
          return rect.bottom >= 0 && rect.top <= viewH;
        });
        if (visible.length > 0) {
          pageText = visible.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
    }

    companion.setReaderContext({
      pageText,
      currentChapterIndex: sectionIndex,
      bookId: bookHash,
      sections: bookRef.current?.sections,
      toc: tocRowsRef.current,
    });
  }, [companion, page, sectionIndex, bookHash, settings.layout, pageMetrics, state]);

  // Track 5 & Track 11: Doble toque para traducir párrafo (modo bilingüe fluido en inglés)
  const toggleParagraphTranslation = async (p: HTMLElement) => {
    if (language !== "en") return;
    const existing = p.querySelector(".paragraph-inline-translation");
    if (existing) {
      existing.remove();
      setActiveBilingualParagraph(null);
      return;
    }
    if (p.querySelector(".paragraph-translating-indicator")) return;

    const originalText = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!originalText) return;

    const indicator = document.createElement("span");
    indicator.className = "paragraph-translating-indicator";
    indicator.textContent = " ⏳ Traduciendo...";
    p.appendChild(indicator);

    try {
      const translation = await translateParagraph(originalText, "en", "es", captureDbScope());
      indicator.remove();
      if (translation && translation !== originalText) {
        const span = document.createElement("span");
        span.className = "paragraph-inline-translation";
        const em = document.createElement("em");
        em.textContent = translation;
        span.appendChild(em);
        p.appendChild(span);
        setActiveBilingualParagraph({
          originalText,
          translatedText: translation,
        });
      }
    } catch {
      indicator.remove();
    }
  };

  const handleContainerDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (language !== "en") return;
    const target = event.target as HTMLElement;
    const p = target.closest<HTMLElement>("p, blockquote");
    if (p && containerRef.current?.contains(p)) {
      void toggleParagraphTranslation(p);
    }
  };

  // Las capas del lector son mutuamente excluyentes: abrir una cierra
  // la anterior y reutiliza su entrada de historial cuando existe. Si
  // la entrada salió vía «atrás», el close deja el ref limpio para que
  // la siguiente capa empuje una entrada nueva.
  const openSelection = (hit: WordHit) => {
    noteActivity();
    // Locución en la oración del toque: matching por lema con el
    // análisis ya en caché del capítulo (capítulo sin analizar →
    // solo superficie; degradación documentada en phrases.ts).
    if (hit.context && phrasesRef.current) {
      const analysis = analyzerRef.current?.cached(
        targetAt(
          catalogRef.current?.ranges ?? [],
          sectionIndexRef.current,
        )?.id ?? "",
      );
      hit.phrase =
        matchPhrase(
          phrasesRef.current,
          hit.context,
          hit.word,
          lemmaOfFromEntries(
            analysis?.state === "ready" ? analysis.entries : undefined,
          ),
        ) ?? undefined;
    }
    const close = () => {
      overlayReleaseRef.current = null;
      setSelection(null);
    };
    if (overlayReleaseRef.current) overlayReleaseRef.current.swap(close);
    else overlayReleaseRef.current = pushOverlay(close);
    setSheet(null);
    setSelection(hit);
    if (containerRef.current) {
      setCharOffsetInChapter(charOffsetAtViewTop(containerRef.current, sectionTextRef.current));
    }
    consultedInPageRef.current.add(hit.word.toLowerCase());
    // Recalibración adaptativa hacia abajo (outcome = 0) para el idioma actual y registro en lookups del capítulo
    try {
      const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
      const cachedAnalysis = analysisFor(sectionIndexRef.current);
      const hitEntry = cachedAnalysis?.entries[hit.word.toLowerCase()]?.[0];
      const wordBeta = betaFromZipf(hitEntry?.zipf);
      updateLanguageTheta(currentLang, wordBeta, 0, 0.8);

      const tocLabel = tocRowsRef.current.find((r) => r.index === sectionIndexRef.current)?.label;
      const lookupItem: EpisodicWordItem = {
        lemma: hitEntry?.lemma || hit.word.toLowerCase(),
        surfaceForm: hit.word,
        lang: currentLang,
        shortGloss: hitEntry?.senses?.[0]?.definition || "",
        chapterSentence: hit.context || hit.word,
        chapterTitle: tocLabel || `Sección ${sectionIndexRef.current + 1}`,
        source: "in-chapter-lookup",
        partOfSpeech: hitEntry?.pos ?? undefined,
      };
      if (!currentChapterLookups.current.some((l) => l.lemma === lookupItem.lemma)) {
        currentChapterLookups.current.push(lookupItem);
      }
    } catch {
      // Ignorar fallo al persistir theta o lookups
    }
    // La consulta es un acto neutral para el modelo, pero sí queda en
    // el trayecto: sirve para distinguir curiosidad de guardado.
    trackEvent({
      kind: "word_consulted",
      sectionIndex: sectionIndexRef.current,
      form: hit.word,
      origin: "text",
    });
    // Una consulta = un evento del journal, sellado al abrir la ficha.
    void award({ kind: "consulted" }, captureDbScope(), consultedAwardMeta());
    signalCompanion({ kind: "word_consulted" });
    recordConsult(hit.word);
  };

  const closeSelection = () => {
    releaseOverlay();
    setSelection(null);
  };

  const openSheet = (kind: SheetKind) => {
    const close = () => {
      overlayReleaseRef.current = null;
      setSheet(null);
    };
    if (overlayReleaseRef.current) overlayReleaseRef.current.swap(close);
    else overlayReleaseRef.current = pushOverlay(close);
    setSelection(null);
    setSheet(kind);
  };

  const closeSheet = () => {
    releaseOverlay();
    setSheet(null);
  };

  const openSettings = (tab: ReaderSettingsTab = "appearance") => {
    const resolvedTab = tab === "strategy" ? "appearance" : tab;
    setSettingsTab(resolvedTab);
    openSheet("settings");
  };



  // Compañero de lectura: la máquina local solo existe con el juego
  // encendido (lo dice el proveedor único, nada se recarga aquí). Al
  // quedar lista la lectura se le avisa book_opened una vez; si el
  // juego se apaga la máquina se retira entera — el catState suelto
  // lo limpia el ajuste de render de abajo.
  useEffect(() => {
    if (!catEnabled) {
      companionRef.current = null;
      companionOpenedRef.current = false;
      return;
    }
    if (!companionRef.current)
      companionRef.current = initialCompanion(Date.now());
    // Publica el estado vigente de la máquina (tick la refleja sin
    // cambiarla — el setter real vive dentro de signalCompanion).
    signalCompanion({ kind: "tick", at: Date.now() });
    if (state === "ready" && !companionOpenedRef.current) {
      companionOpenedRef.current = true;
      signalCompanion({ kind: "book_opened", at: Date.now() });
      // Saludo de bienvenida: asoma con la pata en alto al abrir el
      // libro (el planificador lo da una sola vez por lectura).
      greetCat();
    }
  }, [catEnabled, state, signalCompanion, greetCat]);

  // Latido del gato: caduca los transitorios y lo acuesta cuando ya
  // no llegan señales de lectura.
  useEffect(() => {
    if (!catEnabled) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      signalCompanion({ kind: "tick", at: now });
      const sleepy = isReaderIdleSleepy(focusTrackerRef.current, now);
      setCatSleepy(sleepy);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [catEnabled, signalCompanion]);

  const scrollRatioNow = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    return max > 0 ? clampNumber(window.scrollY / max, 0, 1) : 0;
  };

  const PAGE_GAP = 48;

  // La fracción leída en el modo actual: scroll vertical o página.
  const currentRatioNow = useCallback(() => {
    if (layoutRef.current === "pages") {
      const total = pageCountRef.current;
      return total > 1 ? pageRef.current / (total - 1) : 0;
    }
    return scrollRatioNow();
  }, []);

  // Posición actual completa según el modo de lectura. Lee refs, no
  // estado, para servir también desde callbacks estables (guardado al
  // ocultar, al desmontar, restauración tras pintar).
  const capturePosition = useCallback((): SavedBookPosition | null => {
    const container = containerRef.current;
    const book = bookRef.current;
    if (!container || !book) return null;
    const sizes = book.sections.map((s) => Math.max(0, s.size || 0));
    const index = sectionIndexRef.current;
    let ratio: number;
    let anchor: string | undefined;
    let scrollTop = 0;
    if (layoutRef.current === "pages") {
      const metrics = metricsRef.current;
      ratio = currentRatioNow();
      anchor = metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : undefined;
    } else {
      ratio = scrollRatioNow();
      anchor = anchorAtViewTop(container) ?? undefined;
      scrollTop = window.scrollY;
    }
    const pos: SavedBookPosition = {
      bookHash,
      sectionIndex: index,
      scrollTop,
      ratio,
      progress: bookProgress(sizes, index, ratio),
      anchor,
      updatedAt: Date.now(),
    };
    latestPositionRef.current = pos;
    return pos;
  }, [bookHash]);
  useEffect(() => {
    capturePositionRef.current = capturePosition;
  }, [capturePosition]);

  // Mide la caja útil y reparte las columnas. La medida (ch) se toma
  // de una sonda real para respetar la fuente elegida. El recuento de
  // páginas NO va aquí: scrollWidth solo es válido después de que los
  // estilos de columna aplican, lo mide el efecto de pageMetrics.
  const computeMetrics = useCallback((): PageLayout | null => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container) return null;
    const availW = viewport.clientWidth;
    const measurePx =
      measureProbeRef.current?.getBoundingClientRect().width || 624;
    const one = settings.pageColumns === 1;
    const boxW = one ? Math.min(availW, measurePx) : availW;
    const metrics = pageLayout(boxW, one ? boxW : measurePx, PAGE_GAP);
    // La altura real de la columna: el tope de las imágenes en modo
    // páginas (una figura más alta que la columna salta de página y
    // deja una hoja vacía).
    container.style.setProperty("--page-col-h", `${viewport.clientHeight}px`);
    metricsRef.current = metrics;
    setPageMetrics(metrics);
    return metrics;
  }, [settings.pageColumns]);

  // anchor=false en aterrizajes de remeasure: el ancla rastreada solo
  // cambia por navegación real o restauración pendiente, nunca por un
  // aterrizaje intermedio con métricas aún falsas.
  const setPageIdx = useCallback((next: number, updateAnchor = true) => {
    const clamped = Math.max(0, Math.min(pageCountRef.current - 1, next));
    pageRef.current = clamped;
    setPage(clamped);
    // El rectángulo de la selección queda viejo al mover la página:
    // el botón «Guardar pasaje» no debe flotar fuera de lugar.
    setSelButton(null);
    const metrics = metricsRef.current;
    const container = containerRef.current;
    if (updateAnchor && metrics && container)
      pageAnchorRef.current = anchorAtPage(container, metrics, clamped);
  }, []);

  // Cierra la medición de velocidad de la sección anterior: solo cuenta
  // cuando hubo texto suficiente y una pausa razonable de lectura.
  // Devuelve el dwell medido para que el llamador lo anote en el
  // trayecto (loadSection sí conoce trackEvent en sus dependencias).
  const finalizeTiming = useCallback(
    (endRatio: number): { ms: number; words: number } | null => {
      const timing = sectionTiming.current;
      if (!timing) return null;
      sectionTiming.current = null;
      const wordsRead = Math.max(0, (endRatio - timing.startRatio) * timing.words);
      const spent = Date.now() - timing.start;
      const next = updateWpm(wpm, wordsRead, spent);
      if (next !== null && next !== wpm) {
        setWpm(next);
        void saveSessionValue(WPM_KEY, String(next), captureDbScope());
      }
      return { ms: spent, words: Math.max(0, Math.round(wordsRead)) };
    },
    [wpm],
  );

  // ---------- Predicción por sección (perfil del lector) ----------

  // ---------- Predicción por destino (perfil del lector) ----------

  // Análisis «ready» del destino que contiene la sección.
  const analysisFor = useCallback(
    (index: number): ReadyAnalysis | undefined => {
      const range = rangeFor(index);
      const cached = range
        ? analyzerRef.current?.cached(range.target.id)
        : undefined;
      return cached?.state === "ready" ? cached : undefined;
    },
    [rangeFor],
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
    [analysisFor],
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
      if (container)
        markWords(
          container,
          savedForms.current,
          new Set((prediction?.predicted ?? []).map((item) => item.form)),
          lang,
        );
      return prediction;
    },
    [classifyCached],
  );
  useEffect(() => {
    applyCachedPredictionRef.current = applyCachedPrediction;
  }, [applyCachedPrediction]);

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
        const foundNow = candidates.filter((form) =>
          hasUsableDefinition(result.entries[form]),
        );
        if (!foundNow.length && attempt < 5) continue;
        // Las fichas nuevas entran al análisis cacheado; reclasificar
        // decide si eran predichas o resultan conocidas por su zipf.
        for (const form of foundNow) analysis.entries[form] = result.entries[form];
        applyCachedPrediction(index, lang);
        setEnriching((progress) =>
          progress ? { ...progress, done: foundNow.length } : progress,
        );
        if (foundNow.length >= candidates.length) break;
      }
      setEnriching(null);
    },
    [rangeFor, analysisFor, applyCachedPrediction],
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

  // ---------- Trayecto de lectura (diagnóstico local) ----------

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
    [analysisFor, language],
  );
  useEffect(() => {
    zipfForLemmaRef.current = zipfForLemma;
  }, [zipfForLemma]);

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
    [ingestKnowledgeRow, applyPrediction, language],
  );

  // La consulta del diccionario enlaza con el conocimiento: una
  // evidencia «desconocida» inferida — la fuente más débil del
  // arbitraje, que jamás deshace una respuesta explícita del lector.
  // El lema sale del catálogo; una forma sin lema no escribe nada.
  // Es auxiliar: corre suelta y un fallo no interrumpe la lectura.
  const recordConsult = (form: string) => {
    const scope = captureDbScope();
    void (async () => {
      const res = await lookupWord(form, language, scope);
      if (!res.ok || !res.found) return;
      const lemma = res.entries[0]?.lemma;
      if (!lemma) return;
      const row = await saveKnowledge(
        { language, lemma, known: false, source: "inferred" },
        scope,
      );
      // Solo se aplica al modelo si la evidencia desconocida quedó
      // vigente: cuando otra fuente gana el arbitraje, manda ella.
      if (row && !row.deleted && row.known === false)
        applyKnowledgeRow({ lemma: row.lemma, known: row.known });
    })().catch(() => undefined);
  };

  // Avance o retroceso de navegación hacia la ventana de fatiga; el
  // retroceso queda además en el trayecto. Si la tasa de regresiones
  // ya muestra cansancio: bostezo del gato, aviso 20-20-20 y la
  // muestra que lo provocó en el trayecto.
  const trackMove = useCallback(
    (back: boolean) => {
      const at = Date.now();
      const t =
        focusTrackerRef.current ??
        (focusTrackerRef.current = newFocusTracker(at));
      recordMove(t, at, back);
      if (back)
        trackEvent({
          kind: "page_regressed",
          sectionIndex: sectionIndexRef.current,
        });
      const hit = detectFatigue(t, at);
      if (!hit) return;
      trackEvent({
        kind: "fatigue_flag",
        sectionIndex: sectionIndexRef.current,
        regressions: hit.backs,
        moves: hit.moves,
      });
      signalCompanion({ kind: "fatigue_detected", at });
      setFatigueNotice(true);
    },
    [trackEvent, signalCompanion],
  );

  // Avanzar a la sección siguiente habiendo llegado casi al final
  // cuenta como tramo terminado: el gato celebra. Saltar por el
  // índice o el buscador no celebra — no es «terminar» el capítulo.
  const navNextSection = (index: number, fragment?: string) => {
    if (currentRatioNow() >= 0.85)
      signalCompanion({ kind: "goal_completed" });
    trackMove(false);
    void navigate("chapter", { index, fragment });
  };

  const navPrevSection = (index: number, fragment?: string) => {
    trackMove(true);
    void navigate("chapter", { index, fragment });
  };


  const loadSection = useCallback(
    async (
      index: number,
      restore: {
        ratio?: number;
        anchor?: string;
        snippet?: string;
        fragment?: string;
        at?: "end";
      } = {},
    ) => {
      const book = bookRef.current;
      const section = book?.sections[index];
      const container = containerRef.current;
      if (!book || !section || !container) return;

      // El dwell medido queda en el trayecto atribuido a la sección
      // que se está dejando (sectionIndexRef aún no cambia). Misma
      // barra de credibilidad que la velocidad: pasadas fugaces o
      // sesiones olvidadas no cuentan como tiempo de lectura.
      const dwell = finalizeTiming(currentRatioNow());
      if (
        dwell &&
        dwell.ms >= MIN_SAMPLE_MS &&
        dwell.ms <= MAX_SAMPLE_MS &&
        dwell.words >= MIN_SAMPLE_WORDS
      )
        trackEvent({
          kind: "section_dwell",
          sectionIndex: sectionIndexRef.current,
          ms: Math.round(dwell.ms),
          words: dwell.words,
        });
      setState("opening");
      setSelection(null);
      activeScrollFragRef.current = restore.fragment ?? null;
      setActiveScrollFragment(restore.fragment ?? null);
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
        // Guiones blandos fuera antes de marcar, medir o anclar: el
        // texto que queda es el mismo con guionado activo o no.
        stripSoftHyphens(sanitized);
        const lang = language || getBookLanguage(book);
        // Si la sección ya estaba analizada, sus marcas (guardadas +
        // predichas) entran desde el primer pintado; si no, llegan al
        // terminar el análisis sobre el contenedor ya montado.
        const prediction = classifyCached(index);
        markWords(
          sanitized,
          savedForms.current,
          new Set((prediction?.predicted ?? []).map((item) => item.form)),
          lang,
        );
        // «Líneas sintácticas» envuelve el párrafo en unidades con
        // sentido antes del primer pintado; las marcas ya puestas
        // quedan dentro de su línea.
        const isChromaInit =
          Boolean(settingsRef.current?.chromaticGuide || settingsRef.current?.focusMode === "chromatic");
        if (
          settingsRef.current?.syntacticLines ||
          settingsRef.current?.focusMode === "syntactic" ||
          isChromaInit ||
          settingsRef.current?.bionicAnchors ||
          settingsRef.current?.visualPacer
        ) {
          applySyntacticLines(sanitized, {
            syntacticLines: settingsRef.current?.syntacticLines,
            chromaticGuide: isChromaInit,
            bionicAnchors: settingsRef.current?.bionicAnchors,
          });
        }
        // Las imágenes del EPUB viajan como blob: URLs: las rutas
        // internas se quitan antes de montar (evita 404 contra el
        // origen) y se rellenan ya pintado el texto. En modo paginado
        // el recuento se repite cuando todas asientan.
        const loadBlob = loadBlobRef.current;
        if (loadBlob)
          void hydrateSectionImages(
            sanitized,
            section,
            loadBlob,
            imgUrlsRef.current,
            {
              isCurrent: () =>
                bookRef.current === book && sectionIndexRef.current === index,
              onSettled: () => {
                if (layoutRef.current === "pages") computeMetrics();
              },
            },
          );
        const first = sanitized.firstElementChild;
        const ownHeading = first ? /^H[1-6]$/i.test(first.tagName) : false;
        const text = [...sanitized.childNodes]
          .map((node) => node.textContent ?? "")
          .join("\n");
        sectionTextRef.current = text;
        if (sectionIndexRef.current >= 0 && index !== sectionIndexRef.current) {
          currentChapterLookups.current = [];
          chapterStartedAtRef.current = Date.now();
        }
        triggerL2Precache(index, book.sections.length, lang);
        const enterFrom =
          sectionIndexRef.current >= 0 && index !== sectionIndexRef.current
            ? index > sectionIndexRef.current
              ? "next"
              : "prev"
            : null;
        if (enterFrom) {
          container.dataset.enterFrom = enterFrom;
        } else {
          delete container.dataset.enterFrom;
        }
        container.replaceChildren(sanitized);
        container.classList.remove("section-enter");
        void container.offsetWidth;
        container.classList.add("section-enter");
        // El análisis del capítulo corre después de pintar el texto y
        // sin bloquearlo: extrae formas, consulta el catálogo y deja la
        // precarga de la sección siguiente.
        void analyzeSection(index, text);

        // Estado de paginación de la sección anterior fuera: sin el
        // reinicio, un recuento puede aterrizar en la página vieja.
        pageRef.current = 0;
        pageCountRef.current = 1;
        pageAnchorRef.current = null;
        setPage(0);
        setPageCount(1);
        // En paginado el destino real lo resuelve el recuento después
        // del primer «ready»: la posición intermedia (página 0 de 1)
        // no es evidencia de lectura — el seguimiento de la invitación
        // ignora observaciones con un aterrizaje pendiente.
        if (layoutRef.current === "pages") pendingPageRef.current = restore;

        const total = countWords(text);
        const tocLabel = tocRowsRef.current.find((row) => row.index === index)?.label;

        setSectionWords(total);
        // La nota «sin texto legible» solo aplica si tampoco hay
        // imagen: una sección de portada o mapa sí tiene contenido.
        setSectionHasImages(Boolean(sanitized.querySelector("img, image")));
        setSectionIndex(index);
        sectionIndexRef.current = index;
        // Las marcas muestran la predicción cacheada si la hay; el
        // análisis en vuelo la trae cuando termina.
        setPrediction(prediction);
        const current = targetAt(
          catalogRef.current?.ranges ?? [],
          index,
        );
        setAnalyzing(
          current != null && analyzingTargets.current.has(current.id),
        );
        setSectionTitle(tocLabel ?? `Sección ${index + 1}`);
        setShowChapterTitle(Boolean(tocLabel) && !ownHeading);
        setScrollRatio(restore.ratio ?? 0);
        setState("ready");

        // En pestaña oculta el rAF no corre: el fallback con timer
        // evita que la restauración y el guardado queden muertos.
        const paint = (cb: () => void) =>
          document.hidden ? window.setTimeout(cb, 50) : requestAnimationFrame(cb);
        paint(() => {
          if (layoutRef.current === "pages") {
            // En modo paginado la medida decide las columnas; el
            // destino exacto lo resuelve el recuento, cuando ya hay
            // estilos de columna aplicados y scrollWidth es real.
            computeMetrics();
          } else {
            const doc = document.documentElement;
            const max = doc.scrollHeight - window.innerHeight;
            // Primero el ancla de texto (exacta aunque cambie la letra);
            // si no está en esta sección, la fracción guardada.
            const anchored = restore.snippet
              ? scrollToSnippet(container, restore.snippet)
              : restore.fragment
                ? scrollToFragment(container, restore.fragment)
                : restore.anchor
                  ? scrollToAnchor(container, restore.anchor, { markResume: true })
                  : false;
            if (anchored) {
              // listo
            } else if (restore.at === "end") window.scrollTo(0, Math.max(0, max));
            else window.scrollTo(0, (restore.ratio ?? 0) * Math.max(0, max));
          }
          sectionTiming.current = {
            start: Date.now(),
            startRatio: currentRatioNow(),
            words: total,
          };
          // Guardar después de restaurar: el ancla debe describir el
          // bloque que efectivamente quedó visible. En páginas el
          // destino real lo resuelve el recuento (pendingPageRef);
          // capturar aquí guardaría la página 0 por encima de la
          // posición restaurada.
          if (layoutRef.current !== "pages") {
            const pos = capturePosition();
            if (pos) void saveBookPosition(pos, captureDbScope());
          }
        });
      } catch {
        setState("error");
        onError("No pudimos abrir esta sección del libro.");
      }
    },
    [
      finalizeTiming,
      onError,
      computeMetrics,
      capturePosition,
      currentRatioNow,
      classifyCached,
      analyzeSection,
      trackEvent,
      language,
    ],
  );

  // Coordinador de navegación: todo salto registra su intención para
  // que la preparación (T19) sepa si debe interponerse. El destino
  // físico sigue siendo sección + restauración — el formato de
  // posición persistida no cambia.
  const navigate = useCallback(
    (
      intent: NavIntent,
      dest: {
        index: number;
        fragment?: string;
        restore?: {
          ratio?: number;
          anchor?: string;
          snippet?: string;
          fragment?: string;
          at?: "end";
        };
      },
    ) => {
      navIntentRef.current = intent;
      // La voz solo cede ante navegación del lector: los avances que
      // hace el propio TTS dentro del target llegan protegidos por
      // withTtsProgrammaticNav y no cierran la sesión.
      if (!isTtsProgrammaticNav()) ttsStopOnNavRef.current?.();
      const restore = { ...dest.restore };
      if (dest.fragment) restore.fragment = dest.fragment;
      const prevTargetId = targetAt(
        catalogRef.current?.ranges ?? [],
        sectionIndexRef.current,
      )?.id ?? null;

      // Optimización intra-sección: si ya estamos en la misma sección y lista,
      // desplazamos directamente al nuevo fragmento sin recargar todo el documento.
      if (
        dest.index === sectionIndexRef.current &&
        dest.fragment &&
        containerRef.current &&
        stateRef.current === "ready"
      ) {
        if (layoutRef.current === "pages" && metricsRef.current) {
          const targetPage = pageForFragment(
            containerRef.current,
            dest.fragment,
            metricsRef.current,
          );
          if (targetPage !== null) {
            setPageIdx(targetPage, true);
          }
        } else {
          scrollToFragment(containerRef.current, dest.fragment);
        }
        activeScrollFragRef.current = dest.fragment;
        setActiveScrollFragment(dest.fragment);
        if (intent === "initial" || intent === "chapter") {
          void evaluatePreparation(dest.index, "enter", prevTargetId);
        }
        return Promise.resolve();
      }

      const result = loadSection(dest.index, restore);
      // Solo «entrar» puede interponer preparación; reanudar, buscar
      // y regresar nunca la disparan. La decisión corre tras la carga
      // y jamás la bloquea — si la sección falló no hay nada que
      // evaluar (sectionIndexRef no cambió).
      if (intent === "initial" || intent === "chapter")
        void result.then(() => {
          if (sectionIndexRef.current === dest.index)
            void evaluatePreparation(dest.index, "enter", prevTargetId);
        });
      return result;
    },
    [loadSection, evaluatePreparation],
  );

  // ---------- «Leer en voz alta» ----------
  const {
    ttsRef,
    ttsSnap,
    ttsConsentOpen,
    setTtsConsentOpen,
    ttsDownloadProgress,
    isKittenModelDownloaded,
    handleDeleteTtsModel,
    onTtsRequest,
    onTtsConsentAccept,
    togglePlayPause,
    prevSentence,
    nextSentence,
    cycleSpeed,
    stopTts,
  } = useReaderTts({
    bookHash,
    state,
    language,
    sectionIndex,
    sectionIndexRef,
    stateRef,
    containerRef,
    catalogRef,
    metricsRef,
    layoutRef,
    latestPositionRef,
    companion,
    docHidden,
    selection,
    sheet,
    panelsOpen,
    prep,
    fatigueNotice,
    setPageIdx,
    setCompanionAudioSuppressed,
    navigate,
    trackEvent,
    noteActivity,
    closeSheet,
    onShowNotice: onStatus,
  });

  useEffect(() => {
    ttsStopOnNavRef.current = () => ttsRef.current?.stop("navigation");
  }, [ttsRef]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    // El array se muta por sección pero su identidad es estable:
    // capturarlo aquí permite drenarlo al desmontar sin leer el ref.
    const imgUrls = imgUrlsRef.current;

    const loadBook = async () => {
      // Todo el montaje corre bajo este contexto: si la cuenta cambia
      // a la mitad, las lecturas siguen saliendo de la base que abrió
      // el libro — nunca una mezcla de dos cuentas.
      const scope = captureDbScope();
      setState("opening");
      onStatus("Abriendo libro…");
      // Análisis y preparación del libro anterior no aplican a este:
      // analizador, hoja, avisos y deduplicación se reinician. Perfil
      // y cuaderno sí persisten: los reconstruimos abajo.
      analyzerRef.current?.clear();
      analyzerRef.current = null;
      catalogRef.current = null;
      analyzingTargets.current.clear();
      enrichedTargets.current.clear();
      resetPrepForBook();
      bookStartRef.current = null;
      knowledgeMapRef.current = new Map();
      evidenceRef.current = new Map();
      pendingKnowledgeRef.current.clear();
      lastTargetEnteredRef.current = null;
      savedEnrichSentRef.current = false;
      profileRef.current = null;
      baseThresholdRef.current = DEFAULT_THRESHOLD_NATIVE;
      adjustRef.current = 0;
      // Poda perezosa del trayecto: conserva el historial reciente.
      void pruneReadingHistory(undefined, scope);
      setPrediction(null);
      setAnalyzing(false);
      setEnriching(null);
      setBookSections(undefined);
      try {
        const { book, close, loadBlob } = await openEpub(file);
        if (disposed) {
          void close();
          return;
        }
        cleanup = close;
        bookRef.current = book;
        loadBlobRef.current = loadBlob;
        const storedBook = await getStoredBook(bookHash, scope).catch(() => undefined);
        const detectedLanguage = await detectBookLanguage(book).catch(() => getBookLanguage(book));
        const bookLanguage = storedBook?.language || detectedLanguage;
        const nativeLanguage = loadNativeLanguage();
        const readerProfile = readerProfileFor(nativeLanguage, bookLanguage);
        baseThresholdRef.current =
          readerProfile === "native"
            ? DEFAULT_THRESHOLD_NATIVE
            : DEFAULT_THRESHOLD_LEARNER;
        const storedWords = await listSavedWords(bookLanguage, scope);
        savedForms.current = savedFormLevels(storedWords);
        recordDominated(storedWords, bookLanguage, scope);
        setLanguage(bookLanguage);
        const bookTitle = getBookTitle(book);
        const bookAuthor = getBookAuthor(book);
        setTitle(bookTitle);
        setAuthor(bookAuthor);
        setSectionTotal(book.sections.length);
        setSectionSizes(book.sections.map((section) => Math.max(0, section.size || 0)));

        void updateBookMeta(
          bookHash,
          {
            language: bookLanguage,
            title: bookTitle,
            author: bookAuthor,
            sectionCount: book.sections.length,
          },
          scope,
        ).catch(() => null);

        // Catálogo de destinos (T10): semántica landmarks→índice,
        // fragmentos conservados. El índice viejo se reconstruye como
        // filas sobre los targets — la posición sigue siendo física.
        const catalog = buildChapterCatalog(book);
        setCatalog(catalog);
        setBookSections(book.sections);
        catalogRef.current = catalog;
        // Analizador por rango (T13): deduplica por destino y extrae
        // solo el texto del tramo. La lectura nunca espera por él.
        analyzerRef.current = createChapterAnalyzer(catalog, {
          book,
          language: bookLanguage,
          isCurrent: () => bookRef.current === book,
          loadCached: async (targetId) => {
            const raw = await loadSessionValue(`chapAn:${bookHash}:${targetId}`, scope);
            return raw ? deserializeChapterAnalysis(raw) : null;
          },
          saveCached: async (targetId, result) => {
            const raw = serializeChapterAnalysis(result);
            if (raw) await saveSessionValue(`chapAn:${bookHash}:${targetId}`, raw, scope);
          },
        });
        const rows: TocRow[] = catalog.targets.map((target) => ({
          label: target.label,
          index: target.sectionIndex,
          depth: target.depth,
          target,
        }));
        tocRowsRef.current = rows;
        setTocRows(rows);

        const storedWpm = Number(await loadSessionValue(WPM_KEY, scope));
        if (storedWpm >= 100 && storedWpm <= 600) setWpm(storedWpm);

        // Perfil del lector: evidencia por lema + zipf medido. Corre en
        // paralelo con la primera sección; al llegar, reclasifica lo
        // que haya pintado (y marca las predichas). La preferencia de
        // la tarjeta es por libro; el ajuste del umbral, por sesión.
        const storedAdjust = Number(await loadSessionValue(PROFILE_ADJUST_KEY, scope));
        adjustRef.current = Number.isFinite(storedAdjust) ? storedAdjust : 0;
        const previewPref = await loadSessionValue(previewHiddenKey(bookHash), scope);
        // Migración única de la preferencia antigua «ocultar tarjeta»:
        // si nunca hubo elección nueva, queda como modo «off» del libro.
        // Se guarda el ajuste completo ya resuelto: el archivo del libro
        // reemplaza todo el JSON, no se mezcla con el general.
        if (previewPref === "1" && !hasExplicitPreparationMode(bookHash)) {
          saveReaderSettings(
            { ...loadReaderSettings(bookHash), preparationMode: "off" },
            bookHash,
          );
          setSettings(loadReaderSettings(bookHash));
          setBookOverride(true);
        }
        const profileReady = refreshProfile(
          { savedForms, evidenceRef, pendingKnowledgeRef, knowledgeMapRef, adjustRef, baseThresholdRef, profileRef },
          bookLanguage,
          scope,
        );

        // Entrada única (T18): posición → reanudar; registro previo →
        // destino elegido; ninguno → preguntar sin renderizar la
        // sección cero. La elección se guarda como `bookStart:v1`,
        // separada del avance.
        const saved = await loadBookPosition(bookHash, scope);
        const start = await loadBookStart(bookHash, scope).catch(() => null);
        const entry = resolveEntryTarget(saved, start, catalog, book.sections.length);
        // Lectura en 0 Segundos (Regla 2 Zero-Friction): Apertura inmediata sin bloqueos
        // ni modales forzados de calibración o preparación al tocar un libro.
        bookStartRef.current = entry.kind === "target" ? start : null;
        if (entry.kind === "ask") {
          const suggested = catalog?.targets?.length
            ? (suggestedChapterTarget(catalog, title) ??
              catalog.targets.find((t) => t.kind === "chapter") ??
              catalog.targets[0])
            : null;
          void navigate("initial", {
            index: suggested?.sectionIndex ?? 0,
            fragment: suggested?.fragment,
          });
          return;
        }
        if (entry.kind === "resume") {
          await navigate("resume", {
            index: entry.sectionIndex,
            restore: { ratio: entry.ratio, anchor: entry.anchor },
          });
          // Marcador de retomar: con la posición quieta ≥3 días el
          // lector perdió el hilo — la tarjeta le dice dónde quedó y
          // le da la opción de releer el capítulo desde su inicio.
          const daysSince = saved ? daysAgo(saved.updatedAt) : 0;
          if (daysSince >= RESUME_CARD_MIN_DAYS && !disposed) {
            const range = catalog.ranges.find(
              (r) =>
                r.startSection <= entry.sectionIndex &&
                entry.sectionIndex < r.endSection,
            );
            const events = await listReadingEvents(bookHash, scope).catch(
              () => [],
            );
            if (disposed) return;
            const savedInRange = range ? countSavedInRange(events, range) : 0;
            const target = range?.target ?? null;
            setResumeCard({
              label: target?.label ?? null,
              lastReadText: saved ? relativeDay(saved.updatedAt) : "",
              daysSince,
              savedInRange,
              rereadTo:
                target &&
                (target.sectionIndex < entry.sectionIndex ||
                  (entry.ratio ?? 0) > 0.02)
                  ? { index: target.sectionIndex, fragment: target.fragment }
                  : null,
            });
            trackEvent({
              kind: "resume_shown",
              sectionIndex: entry.sectionIndex,
              daysSince,
              savedInRange,
            });
          }
        } else {
          // «target» con destino registrado, o «ask» sin catálogo
          // útil: se abre el inicio físico del libro.
          await navigate("initial", {
            index: entry.kind === "target" ? entry.target.sectionIndex : 0,
            fragment: entry.kind === "target" ? entry.target.fragment : undefined,
          });
        }
        void profileReady.then(() => {
          if (!disposed) applyPrediction(sectionIndexRef.current, bookLanguage);
        });
        if (!disposed) {
          onStatus(
            entry.kind === "resume" && entry.sectionIndex > 0
              ? `Volviste al capítulo ${entry.sectionIndex + 1}.`
              : "",
          );
        }
      } catch {
        if (!disposed) {
          setState("error");
          onError("No pudimos abrir este EPUB. El archivo puede estar protegido, dañado o usar maquetación fija.");
        }
      }
    };

    void loadBook();

    return () => {
      disposed = true;
      releaseOverlay();
      finalizeTiming(currentRatioNow());
      cleanup?.();
      window.clearTimeout(scrollTimer.current);
      for (const url of imgUrls.splice(0)) URL.revokeObjectURL(url);
    };
    // tocRows se usa dentro de loadSection pero se calcula aquí; el
    // efecto corre una sola vez por libro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash, file]);

  // Cuando la sincronización trae palabras nuevas, remarcamos sin
  // remontar el lector (así no se pierde la posición). De paso se
  // recarga la evidencia de conocimiento, por si también bajó.
  useEffect(() => {
    if (!language || state !== "ready") return;
    void (async () => {
      const scope = captureDbScope();
      const storedWords = await listSavedWords(language, scope);
      savedForms.current = savedFormLevels(storedWords);
      recordDominated(storedWords, language, scope);
      await refreshProfile(
        { savedForms, evidenceRef, pendingKnowledgeRef, knowledgeMapRef, adjustRef, baseThresholdRef, profileRef },
        language,
        scope,
      );
      // Guardadas sin definición: un solo lote por apertura del
      // libro — el lector ya dijo que no las sabe, completarlas vale
      // más que perseguir candidatas del análisis.
      if (!savedEnrichSentRef.current) {
        savedEnrichSentRef.current = true;
        const aiOn = await loadUseAi(scope).catch(() => true);
        if (aiOn && scope.userId) {
          const forms = selectSavedForEnrichment(
            storedWords,
            new Set(),
            SAVED_ENRICH_CAP,
          );
          if (forms.length) void enrichBatch(forms, language, scope);
        }
      }
      // La sección visible se reclasifica con cuaderno y perfil
      // actualizados, sin otra consulta al catálogo.
      applyPrediction(sectionIndexRef.current, language);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabVersion]);

  // Trayecto: anota cada destino distinto al que se entra en la
  // visita (secciones del mismo capítulo comparten destino y no
  // repiten). Es diagnóstico local; nada de esto bloquea la lectura.
  useEffect(() => {
    if (state !== "ready") return;
    const target = currentChapterTarget ?? targetAt(catalog?.ranges ?? [], sectionIndex);
    if (!target || lastTargetEnteredRef.current === target.id) return;
    lastTargetEnteredRef.current = target.id;
    trackEvent({
      kind: "target_entered",
      targetId: target.id,
      sectionIndex,
    });
  }, [state, sectionIndex, catalog, currentChapterTarget, trackEvent]);

  // Preferencia «Usar IA» (una sola lectura por apertura del libro).
  // Con ella apagada, el enriquecimiento automático ni se ofrece ni se
  // llama; la tarjeta igual muestra las predichas sin definición.
  useEffect(() => {
    let cancelled = false;
    void loadUseAi(captureDbScope()).then((on) => {
      if (!cancelled) useAiRef.current = on;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Marcas de pasajes guardados en la sección actual. Va después del
  // Menú flotante sobre la selección del usuario.
  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      const sel = window.getSelection();
      const container = containerRef.current;
      if (!sel || sel.isCollapsed || !container || !sel.rangeCount) {
        setSelButton(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelButton(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelButton(null);
        return;
      }

      const rawText = sel.toString().trim();
      const words = rawText.split(/\s+/).filter(Boolean);
      const singleWordHit = wordHitFromRange(range, container, language);

      // Si la selección tiene exactamente 1 palabra (o coincide con toque de palabra),
      // abrir directamente la ficha léxica y NO desplegar la barra de pasajes
      if (words.length === 1 || (words.length === 0 && singleWordHit)) {
        const hit = singleWordHit || {
          word: words[0].replace(/[.,;:!?¡¿"«»()]/g, ""),
          context: rawText,
        };
        if (hit.word) {
          openSelection(hit);
          setSelButton(null);
          return;
        }
      }

      // Si la selección tiene 2 o más palabras, desplegar la barra de pasajes
      if (words.length >= 2) {
        const isTouch =
          lastPointerTypeRef.current === "touch" ||
          lastPointerTypeRef.current === "pen" ||
          (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

        let placement: "top" | "bottom" = isTouch ? "bottom" : "top";
        let y = isTouch ? rect.bottom : rect.top;

        if (placement === "bottom" && rect.bottom + 64 > window.innerHeight && rect.top > 64) {
          placement = "top";
          y = rect.top;
        } else if (placement === "top" && rect.top < 64 && rect.bottom + 64 <= window.innerHeight) {
          placement = "bottom";
          y = rect.bottom;
        }

        const centerX = rect.left + rect.width / 2;
        const menuHalfW = 170;
        const clampedX = Math.max(menuHalfW + 12, Math.min(centerX, window.innerWidth - menuHalfW - 12));

        setSelButton({ x: clampedX, y, placement, singleWordHit: null });
      } else {
        setSelButton(null);
      }
    };
    const onSelection = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
    const hide = () => setSelButton(null);
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", hide);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Aviso único de descubrimiento para la pulsación larga en táctil (clave por cuenta)
  useEffect(() => {
    if (state !== "ready") return;
    const isTouchDevice =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
    if (!isTouchDevice) return;

    const key = "hint:longPress:v1";
    const scope = captureDbScope();
    let timer: number | undefined;
    void loadSessionValue(key, scope).then((seen) => {
      if (!seen) {
        setShowLongPressHint(true);
        timer = window.setTimeout(() => {
          setShowLongPressHint(false);
          void saveSessionValue(key, "1", scope).catch(() => undefined);
        }, 6000);
      }
    });
    return () => window.clearTimeout(timer);
  }, [state]);

  // Barras que se retiran al bajar y vuelven al subir, y guardado de
  // posición con la fracción leída de la sección. En modo paginado el
  // documento no hace scroll, pero el guardado por ocultar sigue vivo.
  useEffect(() => {
    const onScroll = () => {
      // El auto-scroll que sigue a la voz no es señal de lectura:
      // no abre ni estira el segmento de actividad. El scroll crudo
      // del lector sí (adelantar con los ojos es uso bimodal).
      if (!isTtsProgrammaticScroll()) noteActivity();
      saveSoon();
      if (rafPending.current) return;
      rafPending.current = true;
      const paint = document.hidden
        ? (cb: FrameRequestCallback) => window.setTimeout(cb, 50)
        : requestAnimationFrame;
      paint(() => {
        rafPending.current = false;
        const y = window.scrollY;
        const delta = y - lastScrollY.current;
        lastScrollY.current = y;
        if (y < 90 || delta < -4) setBarsVisible(true);
        else if (delta > 4 && y > 160) setBarsVisible(false);
        setScrollRatio(scrollRatioNow());
        if (containerRef.current && currentSectionTargetsRef.current.length > 1) {
          const frags = containerRef.current.querySelectorAll("[data-frag-id]");
          let bestFrag: string | null = null;
          for (const el of frags) {
            const rect = el.getBoundingClientRect();
            if (rect.top <= 180) {
              bestFrag = el.getAttribute("data-frag-id");
            }
          }
          if (bestFrag !== activeScrollFragRef.current) {
            activeScrollFragRef.current = bestFrag;
            setActiveScrollFragment(bestFrag);
          }
        }
        if (
          (settingsRef.current?.paragraphFocus ||
            settingsRef.current?.focusMode === "paragraph") &&
          containerRef.current
        ) {
          updateParagraphFocus(containerRef.current);
        }
      });
    };
    // Al salir de la página no hay debounce que esperar: guardar ya.
    const onHide = () => {
      if (document.visibilityState === "hidden") closeActivity();
      if (document.visibilityState !== "hidden") return;
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos, captureDbScope());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(scrollTimer.current);
    };
  }, [saveSoon, capturePosition, closeActivity, noteActivity]);

  // Recomponer la paginación conservando el ancla: al cambiar modo,
  // columnas, fuente, tamaño, sección — y cuando la ventana o las
  // fuentes terminan de cargar (ResizeObserver + document.fonts.ready).
  // Solo reparte columnas: el recuento y el ancla los resuelve el
  // efecto de pageMetrics, con los estilos de columna ya aplicados.
  const remeasure = useCallback(() => {
    if (layoutRef.current !== "pages") return;
    computeMetrics();
  }, [computeMetrics]);

  // Recuento real de páginas: corre tras el pintado de las columnas
  // (doble rAF; scrollWidth a medio reflujo da conteos fantasma). Con
  // pestaña oculta el rAF no corre y se usa el mismo fallback por
  // timer que en la carga de sección.
  useEffect(() => {
    const metrics = pageMetrics;
    if (!metrics || layoutRef.current !== "pages") return;
    let live = true;
    const run = () => {
      if (!live || layoutRef.current !== "pages") return;
      const container = containerRef.current;
      if (!container) return;
      const total = totalPages(container.scrollWidth, metrics);
      pageCountRef.current = total;
      setPageCount(total);
      const pending = pendingPageRef.current;
      pendingPageRef.current = null;
      let next = pageRef.current;
      let intent = false;
      if (pending) {
        intent = true;
        if (pending.snippet)
          next = pageForText(container, pending.snippet, metrics, "snippet") ?? 0;
        else if (pending.fragment)
          next = pageForFragment(container, pending.fragment, metrics) ?? 0;
        else if (pending.anchor)
          next = pageForText(container, pending.anchor, metrics, "anchor") ?? 0;
        else if (pending.at === "end") next = total - 1;
        else if (pending.ratio) next = Math.round(pending.ratio * (total - 1));
        else next = 0;
      } else if (pageAnchorRef.current) {
        next =
          pageForText(container, pageAnchorRef.current, metrics, "anchor", false) ??
          pageRef.current;
      }
      setPageIdx(Math.min(next, total - 1), intent);
      // Con el destino pendiente ya resuelto se conoce la página real:
      // esta captura corrige la posición que la carga dejó en el tope.
      if (pending) {
        const pos = capturePosition();
        if (pos) void saveBookPosition(pos, captureDbScope());
      }
    };
    const handle = document.hidden
      ? window.setTimeout(run, 60)
      : requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      live = false;
      if (document.hidden) window.clearTimeout(handle);
      else cancelAnimationFrame(handle);
    };
  }, [pageMetrics, setPageIdx, capturePosition]);

  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    remeasure();
  }, [settings.layout, settings.pageColumns, settings.size, settings.font, settings.measure, state, sectionIndex, remeasure]);

  // Al cambiar el modo (scroll↔páginas) o lo que refluye el texto
  // (fuente, tamaño, medida, interlineado), el ancla devuelve al mismo
  // punto: página nueva en paginado, scroll restaurado en continuo.
  // `layoutRef` todavía guarda el modo anterior dentro de este efecto
  // (su espejo corre después): así se distingue la transición de un
  // refluje dentro del mismo modo.
  useEffect(() => {
    if (state !== "ready") return;
    const wasPages = layoutRef.current === "pages";
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      const saved = latestPositionRef.current;
      if (!container) return;
      if (settings.layout === "scroll") {
        if (saved?.anchor) {
          const scrolled = scrollToAnchor(container, saved.anchor);
          if (!scrolled) {
            const ratio = saved?.ratio ?? 0;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, ratio * Math.max(0, max));
          }
        }
      } else {
        // Venir del scroll: el ancla visible manda sobre la página
        // recordada; dentro del modo ya manda pageAnchorRef.
        if (!wasPages && saved?.anchor) pageAnchorRef.current = saved.anchor;
        remeasure();
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layout, settings.font, settings.size, settings.measure, settings.leading, state]);

  // «Líneas sintácticas» envuelve el texto ya montado; al salir del
  // modo se desenrolla. Como en un refluje, después se reubica la
  // lectura al mismo ancla (página en paginado, scroll en continuo).
  useEffect(() => {
    if (state !== "ready") return;
    const container = containerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      const isChroma =
        Boolean(settings.chromaticGuide || settings.focusMode === "chromatic");
      const needsLines =
        !strategyPaused &&
        (settings.syntacticLines ||
          settings.focusMode === "syntactic" ||
          isChroma ||
          settings.bionicAnchors ||
          settings.visualPacer);
      if (needsLines) {
        applySyntacticLines(container, {
          syntacticLines: settings.syntacticLines,
          chromaticGuide: isChroma,
          bionicAnchors: settings.bionicAnchors,
        });
      } else {
        clearSyntacticLines(container);
      }

      container.dataset.chromaPalette = settings.chromaticPalette || "editorial";
      container.dataset.chromaticGuide = isChroma && !strategyPaused ? "true" : "false";
      container.dataset.bionicAnchors = settings.bionicAnchors && !strategyPaused ? "true" : "false";

      if (!strategyPaused && (settings.paragraphFocus || settings.focusMode === "paragraph"))
        updateParagraphFocus(container);
      else clearParagraphFocus(container);

      // Las líneas sintácticas reenvuelven los nodos de texto: el
      // mapa de oraciones quedó viejo y se re-ancla por huella.
      ttsRef.current?.onDomMutated();
      if (layoutRef.current === "pages") {
        remeasure();
      } else {
        const saved = latestPositionRef.current;
        const max =
          document.documentElement.scrollHeight - window.innerHeight;
        if (!saved?.anchor || !scrollToAnchor(container, saved.anchor))
          window.scrollTo(0, (saved?.ratio ?? 0) * Math.max(0, max));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [
    settings.focusMode,
    settings.syntacticLines,
    settings.chromaticGuide,
    settings.chromaticPalette,
    settings.bionicAnchors,
    settings.paragraphFocus,
    settings.visualPacer,
    strategyPaused,
    state,
    remeasure,
  ]);

  // En modo foco de párrafo, reenfocar al cambiar de sección o de página.
  useEffect(() => {
    if (
      state !== "ready" ||
      strategyPaused ||
      (!settings.paragraphFocus && settings.focusMode !== "paragraph")
    )
      return;
    const container = containerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      updateParagraphFocus(container);
    });
    return () => cancelAnimationFrame(raf);
  }, [
    settings.focusMode,
    settings.paragraphFocus,
    strategyPaused,
    state,
    page,
    sectionIndex,
  ]);

  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let timer: number | undefined;
    let cancelled = false;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(remeasure, 120);
    });
    observer.observe(viewport);
    void document.fonts?.ready?.then?.(() => {
      if (!cancelled) remeasure();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [settings.layout, state, sectionIndex, remeasure]);

  useEffect(() => {
    pageEnteredAtRef.current = Date.now();
  }, [page, sectionIndex]);

  // Exposición pasiva: la lógica vive en lib/reader-evidence.ts; aquí solo se
  // le pasan los refs y el estado que lee.
  const checkPassiveExposure = useCallback(
    () =>
      checkPassiveExposureEvidence(
        { bookRef, consultedInPageRef, pageCountRef, pageEnteredAtRef, sectionIndexRef, savedForms },
        { language, sectionWords, analysisFor, applyKnowledgeRow },
      ),
    [analysisFor, sectionWords, applyKnowledgeRow, language],
  );

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso).
  const goPage = useCallback(
    (delta: number) => {
      noteActivity();
      trackMove(delta < 0);
      checkPassiveExposure();

      // Al avanzar página, pasa a lectura inmersiva ocultando las barras
      if (delta > 0) {
        setBarsVisible(false);
      }

      // Track 9: Neuro-Foco en vivo
      const now = Date.now();
      const dwellTimeMs = Math.max(500, now - pageTurnTimeRef.current);
      pageTurnTimeRef.current = now;
      const direction: "forward" | "backward" = delta > 0 ? "forward" : "backward";
      const isL2 = (language || (bookRef.current ? getBookLanguage(bookRef.current) : "es")) !== loadNativeLanguage();
      if (isFeatureFlagEnabled("focusTelemetry")) {
        const telemetryProfile = loadFocusTelemetryProfile();
        const fatigueResult = evaluateReadingFatigue(
          telemetryProfile,
          {
            dwellTimeMs,
            direction,
            wordCountOnPage: 80,
            sessionMinutesElapsed: Math.max(0, (now - sessionStartRef.current) / 60000),
            bookId: bookHash,
            lang: language || "es",
            recentBackwardCountInWindow: delta < 0 ? 1 : 0,
          },
          isL2,
        );
        saveFocusTelemetryProfile(fatigueResult.updatedProfile);
        if (fatigueResult.isFatigued) {
          setFatigueSuggestion({
            isFatigued: true,
            reason: fatigueResult.reason,
            recommendedAid: fatigueResult.recommendedAid,
          });
        } else if (fatigueResult.reason === "none") {
          setFatigueSuggestion(null);
        }
      } else {
        setFatigueSuggestion(null);
      }

      // Sugerencia consentida de Guía Visual (Lectura Biónica) ante pasaje denso
      const shouldSuggestBionic = focusTelemetryRef.current.recordPageTurn(
        Math.max(1, Math.round(sectionWords / Math.max(1, pageCountRef.current))),
        dwellTimeMs,
      );
      if (
        shouldSuggestBionic &&
        !settingsRef.current?.bionicAnchors &&
        !(settingsRef.current as { bionicReading?: boolean } | null)?.bionicReading
      ) {
        showNotice("¿Pasaje denso? Puedes activar la «Guía visual de sílabas» en el menú Aa.");
      }

      const next = pageRef.current + delta;
      if (next < 0) {
        if (sectionIndexRef.current > 0)
          return navigate("chapter", {
            index: sectionIndexRef.current - 1,
            restore: { at: "end" },
          });
        return Promise.resolve();
      }
      if (next >= pageCountRef.current) {
        // En la última página el ratio ya es ~1: pasar a la sección
        // siguiente cuenta como tramo terminado (el gato celebra).
        if (sectionIndexRef.current + 1 < sectionTotal) {
          const nextIndex = sectionIndexRef.current + 1;
          try {
            const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
            recordChapterCompleted(currentLang);
          } catch {
            // Ignorar fallo de guardado
          }
          signalCompanion({ kind: "goal_completed", at: Date.now() });

          // Track 6 & 10: Fin de Capítulo: Aprendizaje Pasivo + Consolidación Episódica
          checkPassiveExposure();
          const prefs = loadPostChapterConsolidationPrefs();
          const candidates: EpisodicWordItem[] = [
            ...currentChapterLookups.current,
            ...currentChapterPrimedWordsRef.current,
          ];
          const queue = isFeatureFlagEnabled("vocabGames")
            ? buildPostChapterConsolidationQueue(candidates, prefs, isL2, { bookId: bookHash })
            : [];

          if (queue.length > 0 && isConsolidationActive(bookHash) && isFeatureFlagEnabled("vocabGames")) {
            setPostChapterQueue(queue);
            pendingNextChapterRef.current = nextIndex;
            const durationMinutes = Math.max(1, Math.round((Date.now() - chapterStartedAtRef.current) / 60000));
            setDeepSummary({
              durationMinutes,
              targetMinutes: 15,
              sectionsRead: 1,
              completedNaturally: true,
              wordsAssimilated: sectionWords,
            });
            return Promise.resolve();
          }

          return navigate("chapter", { index: nextIndex });
        }
        return Promise.resolve();
      }
      setPageIdx(next);
      saveSoon();
      return Promise.resolve();
    },
    [navigate, saveSoon, sectionTotal, setPageIdx, noteActivity, trackMove, signalCompanion, checkPassiveExposure, language, bookHash, sectionWords],
  );


  // Espejo del modo para callbacks estables (guardado, teclado,
  // restauración): leen refs, no estado que cierra viejo.
  useEffect(() => {
    layoutRef.current = settings.layout;
  }, [settings.layout]);



  // Modo Retiro de lectura: ciclo de sesión inmersiva, bloqueo de pantalla y cierre
  const deepReadingRef = useRef<DeepReadingState | null>(null);
  useEffect(() => {
    deepReadingRef.current = deepReading;
  }, [deepReading]);

  const finishDeepReading = useCallback(async (natural = false) => {
    if (wakeLockRef.current) {
      await releaseScreenWakeLock(wakeLockRef.current);
      wakeLockRef.current = null;
    }
    await toggleFullscreen(false);

    if (natural) {
      playCompanionSound("purr");
      triggerHaptic("success");
    } else {
      triggerHaptic("light");
    }

    const current = deepReadingRef.current;
    if (current) {
      const elapsed = Date.now() - current.startedAt;
      const durationMinutes = Math.max(1, Math.round(elapsed / 60_000));
      const sectionsRead = Math.max(
        1,
        Math.abs(sectionIndexRef.current - current.initialSectionIndex) + 1,
      );

      // Si duró más de 45 segundos, mostrar resumen de cierre sereno
      if (elapsed >= 45_000) {
        const wordsAssimilated = Math.max(3, sectionsRead * 4);
        const coverageDeltaPercent = Math.max(1, Math.min(5, sectionsRead));
        const summary: DeepReadingSummary = {
          durationMinutes,
          targetMinutes: current.targetMinutes,
          sectionsRead,
          completedNaturally: natural,
          wordsAssimilated,
          coverageDeltaPercent,
        };
        setDeepSummary(summary);
      }
    }

    setDeepReading(null);
  }, [setDeepReading]);

  const startDeepReading = async (config: DeepReadingConfig) => {
    setDeepModal(false);
    triggerHaptic("success");
    if (config.fullscreen) {
      await toggleFullscreen(true);
    }
    if (config.keepScreenAwake) {
      wakeLockRef.current = await requestScreenWakeLock();
    }
    setBarsVisible(false);
    const now = Date.now();
    const targetEndedAt =
      config.durationMinutes > 0
        ? now + config.durationMinutes * 60_000
        : null;

    setDeepReading({
      active: true,
      targetMinutes: config.durationMinutes,
      startedAt: now,
      targetEndedAt,
      elapsedMs: 0,
      initialSectionIndex: sectionIndexRef.current,
      sectionsRead: 1,
      wordsRead: 0,
    });
  };

  // Temporizador y ciclo del Retiro de Lectura
  useEffect(() => {
    if (!deepReading?.active) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - deepReading.startedAt;
      if (deepReading.targetEndedAt != null && now >= deepReading.targetEndedAt) {
        clearInterval(interval);
        void finishDeepReading(true);
      } else {
        setDeepReading((prev) => (prev ? { ...prev, elapsedMs: elapsed } : null));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deepReading?.active, deepReading?.startedAt, deepReading?.targetEndedAt, finishDeepReading]);

  const { isFullscreenActive, handleToggleFullscreen } = useReaderShortcutsAndGestures({
    viewportRef,
    containerRef,
    lastPointRef: lastPoint,
    layout: settings.layout,
    page,
    pageCount,
    pageAdvancePx: pageMetrics ? pageAdvance(pageMetrics.boxW, pageMetrics.gap) : 0,
    sectionIndex,
    sectionTotal,
    reducedMotion: companion.reducedMotion,
    panelsOpen,
    selectionActive: Boolean(selection),
    sheetActive: Boolean(sheet),
    language,
    visualPacerActive: Boolean(settings.visualPacer),
    deepReadingActive: Boolean(deepReading?.active),
    onTurnPage: goPage,
    onCenterTap: () => {
      setBarsVisible((prev) => !prev);
    },
    onNavPrevSection: (idx) => navPrevSection(idx),
    onNavNextSection: (idx) => navNextSection(idx),
    onOpenSheet: (s) => {
      if (s === "toc" || s === "search" || s === "marks") {
        openSheet(s);
      }
    },
    onOpenSelection: (hit) => openSelection(hit),
    onTogglePacer: () => setPacerPaused((p) => !p),
    onFinishDeepReading: (cancelled) => void finishDeepReading(cancelled),
    noteActivity,
    ttsStatus: ttsSnap?.status,
  });

  const onWordSaved = useCallback((word: SavedWord) => {
    ttsRef.current?.noteSavedWord();
    void scheduleCapturedReview(word.form, bookHash, word.context, language).catch(() => {});
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.set(form.toLowerCase(), "new");
    }
    // Reacción afectuosa y alegre del gato al guardar una joya léxica
    setCatSavedWord(true);
    if (catSavedWordTimer.current !== null)
      window.clearTimeout(catSavedWordTimer.current);
    catSavedWordTimer.current = window.setTimeout(() => {
      catSavedWordTimer.current = null;
      setCatSavedWord(false);
    }, 2400);
    // Reclasifica la sección visible: la palabra pasa a «guardada»
    // tanto en la tarjeta como en las marcas del texto.
    applyPrediction(sectionIndexRef.current, language);
    onStatus(`«${word.form}» ya está en tu cuaderno.`);
  }, [language, applyPrediction, onStatus]);

  const handleTtsCaptureWord = useCallback(async () => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    const currentSentence = ctl.getCurrentSentence();
    if (!currentSentence) return;

    const keyWord = extractKeyWordFromSentence(
      currentSentence,
      language,
    );
    if (!keyWord || !keyWord.form) return;

    triggerHaptic("selection");
    const scope = captureDbScope();
    try {
      const { word: savedWord } = await saveWordWithKnowledge(
        {
          word: {
            form: keyWord.form,
            lemma: keyWord.lemma || keyWord.form.toLowerCase(),
            pos: keyWord.pos,
            language,
            context: currentSentence,
            bookHash,
          },
          knowledge: {
            language,
            lemma: (keyWord.lemma || keyWord.form).toLowerCase(),
            known: false,
            source: "saved",
            status: "unknown",
          },
        },
        scope,
      );
      onWordSaved(savedWord);
      setTtsCapturedToast(keyWord.form);
      setTimeout(() => setTtsCapturedToast(null), 2500);
    } catch {
      // fallback silencioso
    }
  }, [language, bookHash, onWordSaved, setTtsCapturedToast]);

  const onWordRemoved = (word: SavedWord) => {
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.delete(form.toLowerCase());
    }
    // Al salir del cuaderno puede volver a entrar como predicha: la
    // reclasificación actualiza lista y marcas.
    applyPrediction(sectionIndexRef.current, language);
    onStatus(`«${word.form}» se quitó del cuaderno.`);
  };

  // Saltos desde hojas (índice, búsqueda, marcadores): guardan el punto
  // de partida para «Volver a donde estaba».
  const jumpTo = (
    index: number,
    locate?: { anchor?: string; snippet?: string; fragment?: string },
    intent: NavIntent = "lookup",
  ) => {
    const pos = latestPositionRef.current;
    if (pos) {
      setReturnPoint({
        sectionIndex: pos.sectionIndex,
        ratio: pos.ratio ?? 0,
        anchor: pos.anchor,
      });
    }
    closeSheet();
    // Saltar a una sección anterior cuenta como retroceso para la
    // ventana de fatiga (el salto en sí no celebra ni registra).
    trackMove(index < sectionIndexRef.current);
    navigate(intent, {
      index,
      fragment: locate?.fragment,
      restore: { anchor: locate?.anchor, snippet: locate?.snippet },
    });
  };

  const goBack = () => {
    const point = returnPoint;
    setReturnPoint(null);
    if (point) {
      trackMove(point.sectionIndex < sectionIndexRef.current);
      navigate("return", {
        index: point.sectionIndex,
        restore: { ratio: point.ratio, anchor: point.anchor },
      });
    }
  };

  // «Releer el capítulo» del marcador de retomar: salta al inicio del
  // destino con jumpTo — eso deja «Volver a donde estaba» armado para
  // regresar a la posición exacta tras el repaso.
  const rereadChapter = () => {
    const card = resumeCard;
    setResumeCard(null);
    if (!card?.rereadTo) return;
    trackEvent({
      kind: "resume_reread",
      sectionIndex: card.rereadTo.index,
      daysSince: card.daysSince,
    });
    jumpTo(
      card.rereadTo.index,
      { fragment: card.rereadTo.fragment },
      "chapter",
    );
  };

  // El modo de preparación lo leen los callbacks de navegación sin
  // depender del ciclo de render.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const updateSettings = (patch: Partial<ReaderSettings>) => {
    setSettings((current) => {
      let presetPatch: Partial<ReaderSettings> = {};
      if (
        (patch.focusRuler !== undefined ||
          patch.paragraphFocus !== undefined ||
          patch.syntacticLines !== undefined ||
          patch.chromaticGuide !== undefined ||
          (patch as Record<string, unknown>).colorGuide !== undefined) &&
        (patch.strategyPreset === undefined || patch.readingPreset === undefined)
      ) {
        presetPatch = {
          strategyPreset: patch.strategyPreset ?? "custom",
          readingPreset: "custom",
        };
      }
      const next = { ...current, ...patch, ...presetPatch };
      if (patch.focusRuler === true) {
        next.focusRuler = true;
        next.paragraphFocus = false;
        next.focusMode = "ruler";
      } else if (patch.paragraphFocus === true) {
        next.paragraphFocus = true;
        next.focusRuler = false;
        next.focusMode = "paragraph";
      } else if (patch.focusMode !== undefined) {
        next.focusMode = patch.focusMode;
      } else if (patch.focusRuler === false && patch.paragraphFocus === false) {
        next.focusRuler = false;
        next.paragraphFocus = false;
        if (next.chromaticGuide) {
          next.focusMode = "chromatic";
        } else if (next.syntacticLines) {
          next.focusMode = "syntactic";
        } else {
          next.focusMode = "off";
        }
      } else if (next.paragraphFocus) {
        next.focusMode = "paragraph";
      } else if (next.focusRuler) {
        next.focusMode = "ruler";
      } else if (next.chromaticGuide) {
        next.focusMode = "chromatic";
      } else if (next.syntacticLines) {
        next.focusMode = "syntactic";
      } else {
        next.focusMode = "off";
      }
      saveReaderSettings(next, bookHash);
      setBookOverride(true);
      return next;
    });
  };

  const selectStrategyPreset = (preset: ReadingStrategyPreset) => {
    const updated = applyStrategyPreset(preset, settings);
    updateSettings(updated);
    if (preset === "audio") {
      if (ttsSnap.status === "idle") {
        onTtsRequest();
      }
    } else if (preset === "immersive") {
      if (ttsSnap.status !== "idle") {
        ttsRef.current?.stop("user");
      }
    }
  };



  const handleRecapClick = async () => {
    triggerHaptic("selection");
    setPageRecap({ loading: true, data: null, error: null });

    const container = containerRef.current;
    let pageText = "";
    if (container) {
      if (settings.layout === "pages" && pageMetrics) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const pageParas = paras.filter((p) => pageOfElement(p, pageMetrics) === page);
        if (pageParas.length > 0) {
          pageText = pageParas.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
      if (!pageText) {
        const paras = Array.from(
          container.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, li"),
        );
        const viewH = window.innerHeight;
        const visible = paras.filter((p) => {
          const rect = p.getBoundingClientRect();
          return rect.bottom >= 0 && rect.top <= viewH;
        });
        if (visible.length > 0) {
          pageText = visible.map((p) => p.textContent ?? "").join("\n\n");
        }
      }
      if (!pageText) {
        pageText = container.textContent?.slice(0, 1500) || "";
      }
    }

    try {
      const result = await requestPageRecap(
        {
          text: pageText,
          bookTitle: title,
          chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
        },
        captureDbScope(),
      );
      setPageRecap({ loading: false, data: result, error: null });
    } catch {
      setPageRecap({
        loading: false,
        data: null,
        error: "No se pudo recuperar el hilo de la página.",
      });
    }
  };

  // Track 9: Neuro-Foco - Manejadores de píldora adaptativa
  const handleAcceptFocusAid = (aid: FocusAidType) => {
    const prof = loadFocusTelemetryProfile();
    const updated = recordFocusAidOutcome(prof, aid, true);
    saveFocusTelemetryProfile(updated);
    setFatigueSuggestion(null);

    const updatedSettings: ReaderSettings = { ...settings };
    if (aid === "paragraph-focus") {
      updatedSettings.paragraphFocus = true;
      updatedSettings.focusMode = "paragraph";
    } else if (aid === "syntactic-lines") {
      updatedSettings.syntacticLines = true;
      updatedSettings.focusMode = "syntactic";
    } else if (aid === "focus-ruler") {
      updatedSettings.focusRuler = true;
      updatedSettings.focusMode = "ruler";
    }
    setSettings(updatedSettings);
    saveReaderSettings(updatedSettings, bookHash);
    triggerHaptic("success");
  };

  const handleDismissFocusSuggestion = () => {
    if (fatigueSuggestion?.recommendedAid) {
      const prof = loadFocusTelemetryProfile();
      const updated = recordFocusAidOutcome(prof, fatigueSuggestion.recommendedAid, false);
      saveFocusTelemetryProfile(updated);
    }
    setFatigueSuggestion(null);
  };

  const handleMuteFocusForBook = () => {
    const prof = loadFocusTelemetryProfile();
    const updated = muteBookFocusSuggestions(prof, bookHash);
    saveFocusTelemetryProfile(updated);
    setFatigueSuggestion(null);
  };

  const handleDisableFocusGlobally = () => {
    const prof = loadFocusTelemetryProfile();
    const updated = setFocusAutoSuggestEnabled(prof, false);
    saveFocusTelemetryProfile(updated);
    setFatigueSuggestion(null);
  };

  const handleCreateQuoteCard = () => {
    closeSheet();
    const sel = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
    if (sel && sel.length >= 2) {
      setQuoteCard({
        text: sel,
        bookTitle: title,
        author,
        chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
        alreadySaved: false,
      });
      return;
    }
    const container = containerRef.current;
    const firstP = container?.querySelector("p, blockquote");
    const fallbackText =
      firstP?.textContent?.replace(/\s+/g, " ").trim() ||
      title ||
      "Lectura en Lecta";
    setQuoteCard({
      text: fallbackText,
      bookTitle: title,
      author,
      chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
      alreadySaved: false,
    });
  };

  const handleExportBook = async () => {
    try {
      await downloadBookMarkdown(bookHash, title);
    } catch (err) {
      console.error("Error al exportar libro:", err);
    }
  };

  // El libro vuelve a heredar los ajustes generales del lector.
  const useGlobalSettings = () => {
    clearBookReaderSettings(bookHash);
    setSettings(loadReaderSettings());
    setBookOverride(false);
  };

  // Las barras se ocultan en retiro de lectura o cuando el usuario las conmuta.
  const barsShown = !isDeepReading && barsVisible;

  const viewRatio =
    settings.layout === "pages"
      ? pageCount > 1
        ? page / (pageCount - 1)
        : 0
      : scrollRatio;
  const progress = bookProgress(sectionSizes, sectionIndex, viewRatio);
  const minutes = minutesLeft(sectionWords, viewRatio, wpm);

  // El hilo de progreso lleno cuenta como libro terminado; el journal
  // deduplica el crédito por bookHash así que el efecto puede
  // repetirse. El evento lleva un uuid por ocurrencia (dos dispositivos
  // pueden terminar el mismo libro): se congela en la primera
  // detección para que los re-disparos manden el mismo premio. La
  // celebración también se dispara una sola vez por libro.
  const bookCheeredRef = useRef<string | null>(null);
  const bookAwardRef = useRef<{ hash: string; meta: { id: string; at: number; dayKey: string } } | null>(null);
  useEffect(() => {
    if (progress >= 0.995) {
      if (bookAwardRef.current?.hash !== bookHash) {
        const at = Date.now();
        bookAwardRef.current = {
          hash: bookHash,
          meta: {
            id: `book:${bookHash}:${crypto.randomUUID()}`,
            at,
            dayKey: localDayKey(at),
          },
        };
      }
      void award(
        { kind: "book_finished", bookHash },
        captureDbScope(),
        bookAwardRef.current.meta,
      );
      if (bookCheeredRef.current !== bookHash) {
        bookCheeredRef.current = bookHash;
        signalCompanion({ kind: "goal_completed" });
      }
    }
  }, [progress, bookHash, signalCompanion]);

  // Micro-hitos de página (25%, 50%, 75%, 100%) para dopamina visual y retención TDAH
  const lastCheckpointRef = useRef<number>(0);
  const lastSectionForCheckpointRef = useRef<number>(sectionIndex);
  useEffect(() => {
    if (lastSectionForCheckpointRef.current !== sectionIndex) {
      lastSectionForCheckpointRef.current = sectionIndex;
      lastCheckpointRef.current = 0;
    }
    if (state !== "ready") return;
    const checkpoints = [0.25, 0.5, 0.75, 1.0];
    for (const cp of checkpoints) {
      if (viewRatio >= cp && lastCheckpointRef.current < cp) {
        lastCheckpointRef.current = cp;
        window.dispatchEvent(
          new CustomEvent("lecta:checkpoint-reached", {
            detail: { checkpoint: cp },
          }),
        );
        presenceReact();
        break;
      }
    }
  }, [viewRatio, sectionIndex, state, presenceReact]);

  // Paisajes sonoros procedurales Web Audio y ronroneo ambiental («Body Doubling» acústico)
  useEffect(() => {
    const activeSound =
      settings.soundscape || (settings.ambientPurr ? "purr" : "none");
    const shouldPlay =
      activeSound !== "none" &&
      !strategyPaused &&
      state === "ready" &&
      !readingPaused &&
      ttsSnap.status !== "speaking";

    if (shouldPlay) {
      if (activeSound === "purr") {
        startAmbientPurr();
      } else {
        startSoundscape(activeSound as SoundscapeKind);
      }
    } else {
      stopAmbientPurr();
      stopSoundscape();
    }
    return () => {
      stopAmbientPurr();
      stopSoundscape();
    };
  }, [
    settings.soundscape,
    settings.ambientPurr,
    strategyPaused,
    state,
    readingPaused,
    ttsSnap.status,
  ]);

  // Marcapasos Visual ("Ritmo Guiado" para TDAH)
  useEffect(() => {
    const container = containerRef.current;
    if (
      !settings.visualPacer ||
      strategyPaused ||
      pacerPaused ||
      state !== "ready" ||
      readingPaused
    ) {
      if (container) {
        container.querySelectorAll(".lecta-pacer-active").forEach((el) => {
          el.classList.remove("lecta-pacer-active");
        });
      }
      return;
    }

    if (!container) return;

    let timer: number | null = null;
    let destroyed = false;

    const stepPacer = () => {
      if (destroyed) return;
      const chunks = Array.from(
        container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"),
      );
      if (chunks.length === 0) return;

      if (pacerIndexRef.current >= chunks.length) {
        pacerIndexRef.current = 0;
      }
      const activeChunk = chunks[pacerIndexRef.current];

      chunks.forEach((chunk, i) => {
        if (i === pacerIndexRef.current) {
          chunk.classList.add("lecta-pacer-active");
        } else {
          chunk.classList.remove("lecta-pacer-active");
        }
      });

      if (activeChunk) {
        const rect = activeChunk.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 80 || rect.top < 60) {
          activeChunk.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      const text = activeChunk?.textContent || "";
      const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
      const wpm = settings.pacerWpm || 210;
      const durationMs = Math.max(200, Math.min(5000, Math.round((words / wpm) * 60_000)));

      pacerIndexRef.current += 1;
      timer = window.setTimeout(stepPacer, durationMs);
    };

    stepPacer();

    return () => {
      destroyed = true;
      if (timer) window.clearTimeout(timer);
      if (container) {
        container.querySelectorAll(".lecta-pacer-active").forEach((el) => {
          el.classList.remove("lecta-pacer-active");
        });
      }
    };
  }, [
    settings.visualPacer,
    settings.pacerWpm,
    strategyPaused,
    pacerPaused,
    state,
    readingPaused,
    sectionIndex,
  ]);

  // Invitación a la prueba de vocabulario, una vez por apertura del
  // libro: se ofrece al terminar el primer tramo que el lector leyó
  // (su última sección con la vista casi completa, o ya más allá).
  // Todo lo que decide corre en el dispositivo — sin red hasta que la
  // persona acepta y App descarga la muestra.
  useEffect(() => {
    if (state !== "ready" || calEvaluated.current) return;
    // En paginado la posición aterriza cuando el recuento resuelve el
    // destino pendiente: observar antes leería un «página 0 de 1»
    // ficticio — y lo que cuenta es dónde quedó el lector.
    if (pendingPageRef.current) return;
    const next = trackCalibrationOffer(
      calTrack.current,
      sectionIndex,
      viewRatio,
      rangeFor,
    );
    calTrack.current = next.track;
    if (!next.offer) return;
    calEvaluated.current = true;
    void (async () => {
      // Disponible en español e inglés; con otra lengua la invitación
      // no existiría.
      if (language !== "es" && language !== "en") return;
      const scope = captureDbScope();
      const doneKey = calibrationDoneKey(language);
      const done = await loadSessionValue(doneKey, scope).catch(
        () => "1",
      );
      if (done != null) return;
      // Evidencia de calibración (p. ej. bajada por sincronización)
      // también cierra la oferta y deja la marca para no releer.
      if (await hasCalibrationEvidence(language, scope).catch(() => false)) {
        void saveSessionValue(doneKey, "1", scope).catch(
          () => undefined,
        );
        return;
      }
      setCalNotice(true);
    })();
  }, [state, sectionIndex, viewRatio, language, rangeFor]);

  // «Ajustar mi vocabulario»: la descarga corre por App; si la hoja no
  // llegó a abrirse (sin conexión o muestra vacía) el aviso se conserva
  // para reintentar.
  const acceptCalibrationNotice = async () => {
    if (await onRequestCalibration(language)) setCalNotice(false);
  };

  // «Ahora no»: cierra la oferta automática — la prueba queda a mano
  // desde Cuenta, con el borrador si se empezó.
  const dismissCalibrationNotice = () => {
    setCalNotice(false);
    void saveSessionValue(calibrationDoneKey(language), "1", captureDbScope()).catch(
      () => undefined,
    );
  };

  const currentTargetIdx = catalog
    ? catalog.targets.findIndex((t) => t.id === currentChapterTarget?.id)
    : -1;
  const nextTarget =
    currentTargetIdx >= 0 && catalog ? catalog.targets[currentTargetIdx + 1] : null;
  const prevTarget =
    currentTargetIdx > 0 && catalog ? catalog.targets[currentTargetIdx - 1] : null;

  // Si hay otro sub-capítulo dentro de la MISMA sección física (ej. King's Cage: múltiples anclas
  // en index_split_000.html), navegar al siguiente destino salta a ese ancla intra-sección.
  // De lo contrario, la lectura física avanza sección por sección (sectionIndex + 1), SIN saltarse
  // secciones intermedias (ej. Red Queen: el texto de un capítulo puede abarcar varias secciones).
  const nextTargetInSameSection =
    nextTarget && nextTarget.sectionIndex === sectionIndex && nextTarget.fragment
      ? nextTarget
      : null;
  const prevTargetInSameSection =
    prevTarget && prevTarget.sectionIndex === sectionIndex && prevTarget.fragment
      ? prevTarget
      : null;

  const nextRow = nextTargetInSameSection
    ? { index: sectionIndex, fragment: nextTargetInSameSection.fragment, label: nextTargetInSameSection.label }
    : sectionIndex + 1 < sectionTotal
      ? {
          index: sectionIndex + 1,
          fragment:
            nextTarget && nextTarget.sectionIndex === sectionIndex + 1
              ? nextTarget.fragment
              : tocRows.find((r) => r.index === sectionIndex + 1)?.target.fragment,
          label:
            (nextTarget && nextTarget.sectionIndex === sectionIndex + 1 ? nextTarget.label : null) ??
            tocRows.find((r) => r.index === sectionIndex + 1)?.label ??
            (currentChapterTarget?.label ? `${currentChapterTarget.label} (cont.)` : `Sección ${sectionIndex + 2}`),
        }
      : null;

  const prevRow = prevTargetInSameSection
    ? { index: sectionIndex, fragment: prevTargetInSameSection.fragment, label: prevTargetInSameSection.label }
    : sectionIndex > 0
      ? {
          index: sectionIndex - 1,
          fragment:
            prevTarget && prevTarget.sectionIndex === sectionIndex - 1
              ? prevTarget.fragment
              : tocRows.find((r) => r.index === sectionIndex - 1)?.target.fragment,
          label:
            (prevTarget && prevTarget.sectionIndex === sectionIndex - 1 ? prevTarget.label : null) ??
            tocRows.find((r) => r.index === sectionIndex - 1)?.label ??
            "Anterior",
        }
      : null;

  // ---------- Resumen de cierre de capítulo ----------

  // ¿El lector llegó al final del capítulo? En la última sección del
  // tramo y con la vista casi completa: en desplazamiento, cerca del
  // pie (una sección sola ocuparía toda la vista sin este umbral); en
  // páginas, en la última página. «uncertain» también cuenta: es un
  // destino del índice sin clasificar — la mayoría de los EPUB no
  // traen landmarks y sin ellos casi todo cae ahí. Solo se excluyen
  // preliminares y ajenos.
  const endTarget = currentChapterTarget ?? targetAt(catalog?.ranges ?? [], sectionIndex);
  // En render no se puede leer catalogRef (rangeFor lo hace): el
  // estado `catalog` refleja el mismo catálogo — línea previa lo usa.
  const endRange =
    catalog?.ranges.find(
      (range) =>
        range.startSection <= sectionIndex && sectionIndex < range.endSection,
    ) ?? null;
  const atChapterEnd =
    endTarget != null &&
    endTarget.kind !== "preliminary" &&
    endTarget.kind !== "frontmatter" &&
    endTarget.kind !== "other" &&
    endRange != null &&
    sectionIndex === endRange.endSection - 1 &&
    (settings.layout === "pages" ? page + 1 >= pageCount : scrollRatio >= 0.9);

  // El conteo se calcula una sola vez por capítulo y por visita:
  // volver al final del mismo capítulo no re-consulta el historial
  // (la tarjeta muestra la foto de cuando se cerró). El «una vez» solo
  // traba cuando hubo algo que contar: si el lector llegó al final sin
  // actividad y luego consulta palabras, volver al pie sí reevalúa.
  const [endSummary, setEndSummary] = useState<{
    targetId: string;
    summary: ChapterSummary;
  } | null>(null);
  const summaryForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!atChapterEnd || !endTarget || !endRange) return;
    if (summaryForRef.current === endTarget.id) return;
    const range = endRange;
    const visitId = visitIdRef.current ?? "";
    void listReadingEvents(bookHash, captureDbScope())
      .then((events) => {
        const summary = chapterSummary(events, range, visitId);
        if (hasChapterSummary(summary)) {
          summaryForRef.current = endTarget.id;
          setEndSummary({ targetId: endTarget.id, summary });
        } else {
          setEndSummary(null);
        }
      })
      .catch(() => undefined);
  }, [atChapterEnd, endTarget, endRange, bookHash]);

  const summaryParts = endSummary
    ? [
        endSummary.summary.saved > 0 &&
          `${endSummary.summary.saved} palabra${endSummary.summary.saved === 1 ? "" : "s"} al Cuaderno`,
        endSummary.summary.consulted > 0 &&
          `${endSummary.summary.consulted} consulta${endSummary.summary.consulted === 1 ? "" : "s"}`,
        endSummary.summary.declaredKnown > 0 &&
          `${endSummary.summary.declaredKnown} conocida${endSummary.summary.declaredKnown === 1 ? "" : "s"}`,
        endSummary.summary.dwellMs >= 60_000 &&
          `≈${Math.max(1, Math.round(endSummary.summary.dwellMs / 60_000))} min`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  // Una vez calculado el resumen queda fijo aunque el scroll baje del
  // umbral (la propia tarjeta empuja el contenido al aparecer). Solo
  // se muestra en la última sección del tramo — no en las anteriores.
  const chapterEndCard =
    endSummary != null &&
    endSummary.targetId === endTarget?.id &&
    endRange != null &&
    sectionIndex === endRange.endSection - 1 &&
    endTarget ? (
      <div className="chapter-summary" role="status">
        <p className="chapter-summary-text">
          Cerraste «{endTarget.label}»
          {summaryParts ? ` — ${summaryParts}` : ""}
        </p>
        <button
          type="button"
          className="btn--quiet"
          onClick={onOpenNotebook}
        >
          Ver Cuaderno
        </button>
      </div>
    ) : null;

  return (
    <div
      className="reader reader-shell"
      data-dock-ghost={!barsShown ? "true" : "false"}
      data-tts-active={ttsSnap.status !== "idle" ? "true" : "false"}
      data-recap-visible={recapBubbleVisible ? "true" : "false"}
      data-inspector-open={selection ? "true" : "false"}
      style={readerCssVars(settings) as CSSProperties}
      data-font={settings.font}
      data-justify={settings.justify || undefined}
      data-dropcap={settings.dropCap || undefined}
      data-layout={settings.layout === "pages" ? "pages" : undefined}
      data-hyphens={settings.enableHyphenation || undefined}
      data-fullscreen={isFullscreenActive || undefined}
    >
      <div
        ref={measureProbeRef}
        aria-hidden="true"
        className="measure-probe"
      />
      <ReaderTopBar
        onBack={onBack}
        title={currentChapterTarget?.label || sectionTitle || title || fileName}
        author={author}
        progress={progress}
        isZenFaded={isZenFaded}
        barsShown={barsShown}
        onOpenToc={() => openSheet("toc")}
        onOpenAppearance={() => openSettings("appearance")}
        onOpenMore={() => openSettings("book")}
      />

      <ReaderContent
        title={title}
        containerRef={containerRef}
        viewportRef={viewportRef}
        settings={settings}
        state={state}
        sectionIndex={sectionIndex}
        sectionTotal={sectionTotal}
        sectionWords={sectionWords}
        sectionTitle={sectionTitle}
        sectionHasImages={sectionHasImages}
        showChapterTitle={showChapterTitle}
        strategyPaused={strategyPaused}
        page={page}
        pageCount={pageCount}
        pageAdvance={pageAdvance}
        pageMetrics={pageMetrics}
        ttsSnap={ttsSnap}
        selection={selection}
        setSelection={setSelection}
        setBarsVisible={setBarsVisible}
        setShowLongPressHint={setShowLongPressHint}
        showLongPressHint={showLongPressHint}
        recapBubbleVisible={recapBubbleVisible}
        recapBubbleLoading={recapBubbleLoading}
        recapBubbleBullets={recapBubbleBullets}
        setRecapBubbleVisible={setRecapBubbleVisible}
        sceneRecap={sceneRecap}
        chapterEndCard={chapterEndCard}
        nextRow={nextRow}
        prevRow={prevRow}
        language={language}
        noteActivity={noteActivity}
        navigate={navigate}
        goPage={goPage}
        navNextSection={navNextSection}
        navPrevSection={navPrevSection}
        openSelection={openSelection}
        extractWordAtPoint={extractWordAtPoint}
        handleContainerDoubleClick={handleContainerDoubleClick}
        handleTriggerReturnRecap={handleTriggerReturnRecap}
        toggleParagraphTranslation={toggleParagraphTranslation}
        lastPointRef={lastPoint}
        lastTapRef={lastTapRef}
        lastPointerTypeRef={lastPointerTypeRef}
        pacerIndexRef={pacerIndexRef}
        onBack={onBack}
      />

      {/* Botones de navegación lateral flotantes */}
      {state === "ready" && !isDeepReading ? (
        <>
          <button
            type="button"
            className="reader-nav-edge reader-nav-prev"
            disabled={
              settings.layout === "pages"
                ? sectionIndex === 0 && page === 0
                : prevRow == null && sectionIndex === 0
            }
            onClick={() => {
              triggerHaptic("selection");
              if (settings.layout === "pages") {
                goPage(-1);
              } else if (prevRow) {
                navPrevSection(prevRow.index, prevRow.fragment);
              } else if (sectionIndex > 0) {
                navPrevSection(sectionIndex - 1);
              }
            }}
            aria-label={settings.layout === "pages" ? "Página anterior" : "Sección anterior"}
            title={
              settings.layout === "pages"
                ? "Página anterior (←)"
                : `Sección anterior: ${prevRow?.label ?? "Anterior"}`
            }
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="reader-nav-edge reader-nav-next"
            disabled={
              settings.layout === "pages"
                ? sectionIndex + 1 >= sectionTotal && page + 1 >= pageCount
                : nextRow == null && sectionIndex + 1 >= sectionTotal
            }
            onClick={() => {
              triggerHaptic("selection");
              if (settings.layout === "pages") {
                goPage(1);
              } else if (nextRow) {
                navNextSection(nextRow.index, nextRow.fragment);
              } else if (sectionIndex + 1 < sectionTotal) {
                navNextSection(sectionIndex + 1);
              }
            }}
            aria-label={settings.layout === "pages" ? "Página siguiente" : "Sección siguiente"}
            title={
              settings.layout === "pages"
                ? "Página siguiente (→)"
                : `Sección siguiente: ${nextRow?.label ?? "Siguiente"}`
            }
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      ) : null}

      <ReaderNotices
        resumeCard={resumeCard}
        rereadChapter={rereadChapter}
        setResumeCard={setResumeCard}
        previewSuggested={previewSuggested}
        setPreviewSuggested={setPreviewSuggested}
        showPreview={showPreview}
        setShowPreview={setShowPreview}
        chapterAnalysis={chapterAnalysis}
        openPrepManual={openPrepManual}
        bookHash={bookHash}
        sectionIndex={sectionIndex}
        dismissPrepNotice={dismissPrepNotice}
        calNotice={calNotice}
        prep={prep}
        prepNotice={prepNotice}
        isDeepReading={isDeepReading}
        acceptCalibrationNotice={acceptCalibrationNotice}
        dismissCalibrationNotice={dismissCalibrationNotice}
        fatigueNotice={fatigueNotice}
        setFatigueNotice={setFatigueNotice}
      />

      {/* SmartReaderDock (Track 2): Dock Inteligente Único que muta entre Lectura, Audio y Lienzo Puro */}
      {state === "ready" && !isDeepReading ? (
        <ReaderDockHost
          settings={settings}
          updateSettings={updateSettings}
          errorText={errorText}
          page={page}
          pageCount={pageCount}
          sectionIndex={sectionIndex}
          sectionTotal={sectionTotal}
          minutes={minutes}
          prediction={prediction}
          scrollRatio={scrollRatio}
          barsShown={barsShown}
          setBarsVisible={setBarsVisible}
          setGlossaryOpen={setGlossaryOpen}
          setSettingsTab={setSettingsTab}
          setSheet={setSheet}
          setStrategyPaused={setStrategyPaused}
          setTtsConsentOpen={setTtsConsentOpen}
          ttsSnap={ttsSnap}
          onTtsRequest={onTtsRequest}
          togglePlayPause={togglePlayPause}
          prevSentence={prevSentence}
          nextSentence={nextSentence}
          cycleSpeed={cycleSpeed}
          stopTts={stopTts}
          handleTtsCaptureWord={handleTtsCaptureWord}
          handleRecapClick={handleRecapClick}
          isDeepReading={isDeepReading}
          selection={selection}
          companion={companion}
          catState={catState}
          catShown={catShown}
          catLeaving={catLeaving}
          catTap={catTap}
          catSavedWord={catSavedWord}
          catSleepy={catSleepy}
          catGreeting={catGreeting}
          onCatTap={onCatTap}
          stallBubble={stallBubble}
          onStallBubbleClick={onStallBubbleClick}
          fatigueSuggestion={fatigueSuggestion}
          handleAcceptFocusAid={handleAcceptFocusAid}
          handleDismissFocusSuggestion={handleDismissFocusSuggestion}
          handleMuteFocusForBook={handleMuteFocusForBook}
          handleDisableFocusGlobally={handleDisableFocusGlobally}
        />
      ) : null}

      <ReaderFocusLayers
        settings={settings}
        state={state}
        strategyPaused={strategyPaused}
        catEnabled={catEnabled}
        presenceMode={presenceMode}
        catSuppressed={catSuppressed}
        companion={companion}
        catState={catState}
        isDeepReading={isDeepReading}
        deepReading={deepReading}
        finishDeepReading={finishDeepReading}
        progress={progress}
      />


      <ReaderSearchAndTocSheet
        sheet={sheet}
        closeSheet={closeSheet}
        setSheet={setSheet}
        tocRows={tocRows}
        currentChapterTarget={currentChapterTarget}
        catalog={catalog}
        sectionIndex={sectionIndex}
        activeIntraContext={activeIntraContext}
        jumpTo={jumpTo}
        annotations={annotations}
        setGlossaryOpen={setGlossaryOpen}
        searchQ={searchQ}
        setSearchQ={setSearchQ}
        searchDone={searchDone}
        searchHits={searchHits}
        sectionLabel={sectionLabel}
        bookmark={bookmark}
        passages={passages}
        saveBookmarkHere={saveBookmarkHere}
        removeMark={removeMark}
        editingNote={editingNote}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        setEditingNote={setEditingNote}
        saveNote={saveNote}
        setQuoteCard={setQuoteCard}
        bookHash={bookHash}
        title={title}
        author={author}
      />

      {sheet === "settings" ? (
        <ReaderSettingsSheet
          settings={settings}
          updateSettings={updateSettings}
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          closeSheet={closeSheet}
          theme={theme}
          onThemeChange={onThemeChange}
          language={language}
          bookHash={bookHash}
          bookOverride={bookOverride}
          useGlobalSettings={useGlobalSettings}
          companion={companion}
          presenceMode={presenceMode}
          catEnabled={catEnabled}
          catSuppressed={catSuppressed}
          setCatSuppressed={setCatSuppressed}
          openPrepManual={openPrepManual}
          openSheet={openSheet}
          handleCreateQuoteCard={handleCreateQuoteCard}
          handleExportBook={handleExportBook}
          handleToggleFullscreen={handleToggleFullscreen}
          isFullscreenActive={isFullscreenActive}
          isFullscreenSupported={isFullscreenSupported}
          onOpenNotebook={onOpenNotebook}
          setGlossaryOpen={setGlossaryOpen}
        />
      ) : null}

      <ReaderSelectionBar
        returnPoint={returnPoint}
        setReturnPoint={setReturnPoint}
        goBack={goBack}
        selButton={selButton}
        setSelButton={setSelButton}
        openSelection={openSelection}
        savePassageSelection={savePassageSelection}
        openQuoteCardFromSelection={openQuoteCardFromSelection}
        askCatAboutSelection={askCatAboutSelection}
        setDeepModal={setDeepModal}
        showLongPressHint={showLongPressHint}
      />



      <ReaderFloatingBars
        settings={settings}
        state={state}
        strategyPaused={strategyPaused}
        isDeepReading={isDeepReading}
        pacerPaused={pacerPaused}
        setPacerPaused={setPacerPaused}
        updateSettings={updateSettings}
        ttsCapturedToast={ttsCapturedToast}
        activeBilingualParagraph={activeBilingualParagraph}
        bookHash={bookHash}
        language={language}
        setBilingualMode={setBilingualMode}
      />
      <ReaderOverlays
        bookHash={bookHash}
        bookTitle={title}
        author={author}
        language={language}
        sectionIndex={sectionIndex}
        signedIn={signedIn}
        selection={selection}
        onCloseSelection={closeSelection}
        onWordSaved={onWordSaved}
        onWordRemoved={onWordRemoved}
        onKnowledgeChanged={(row, { form, kind }) => {
          applyKnowledgeRow(row);
          try {
            const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
            const zipf = zipfForLemma(row.lemma);
            const beta = betaFromZipf(zipf);
            if (kind === "saved") {
              void scheduleCapturedReview(form, bookHash, undefined, currentLang).catch(() => {});
              updateLanguageTheta(currentLang, beta, 0, 1.0);
            } else if (kind === "declared") {
              updateLanguageTheta(currentLang, beta, 1, 1.0);
            }
          } catch {
            // Ignorar fallo al persistir theta
          }
          trackEvent(
            kind === "saved"
              ? {
                  kind: "word_saved",
                  sectionIndex: sectionIndexRef.current,
                  form,
                  lemma: row.lemma,
                  origin: "text",
                }
              : {
                  kind: "word_declared_known",
                  sectionIndex: sectionIndexRef.current,
                  lemma: row.lemma,
                  origin: "text",
                },
          );
        }}
        bookSections={bookSections}
        toc={catalog?.targets?.map((t) => ({ index: t.sectionIndex, label: t.label }))}
        charOffsetInChapter={charOffsetInChapter}
        currentChapterTitle={
          currentChapterTarget?.label ??
          catalog?.targets?.find((t) => t.sectionIndex === sectionIndex)?.label ??
          sectionTitle
        }
        compactMode={
          !strategyPaused &&
          (settings.strategyPreset === "focus" ||
            settings.focusMode === "chromatic" ||
            settings.paragraphFocus ||
            settings.syntacticLines ||
            settings.chromaticGuide)
        }
        prep={prep}
        onRowsPresented={recordPresented}
        onAnswerPrep={answerPrep}
        onConfirmPrep={() => void confirmPrep()}
        onSkipPrep={skipPrep}
        onRetryPrep={() => void retryPrep()}
        onClosePrep={() => {
          releaseOverlay();
          closePrepLayer();
        }}
        onDiscardPrep={discardPrep}
        initialStrategy={settings.strategyPreset}
        onSelectStrategy={(preset) => selectStrategyPreset(preset)}
        onMarkKnown={(lemma, beta) => {
          const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
          updateLanguageTheta(currentLang, beta, 1, 1.0);
          const scope = captureDbScope();
          void saveKnowledge({ language: currentLang, lemma, known: true, source: "inferred" }, scope);
        }}
        onSaveToPractice={(lemma, beta) => {
          const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
          updateLanguageTheta(currentLang, beta, 0, 0.5);
          const scope = captureDbScope();
          void saveWordWithKnowledge(
            {
              word: {
                form: lemma,
                lemma,
                language: currentLang,
                bookHash,
              },
              knowledge: {
                language: currentLang,
                lemma,
                known: false,
                source: "saved",
                status: "unknown",
              },
            },
            scope,
          );
        }}
        onMuteForBook={(id) => {
          muteBookForPriming(id);
          setPrep(null);
          closePrepLayer();
        }}
        onDisableGlobally={() => {
          disablePrimingGlobally();
          updateSettings({ chapterPrimingMode: "off" });
          setPrep(null);
          closePrepLayer();
        }}
        onStartReading={() => {
          releaseOverlay();
          closePrepLayer();
        }}
        quoteCard={quoteCard}
        onCloseQuoteCard={() => setQuoteCard(null)}
        onSaveQuoteCardPassage={(text) => void savePassageDirectly(text)}
        deepModal={deepModal}
        onStartDeepReading={(config) => void startDeepReading(config)}
        onCloseDeepModal={() => setDeepModal(false)}
        deepSummary={deepSummary}
        postChapterQueue={postChapterQueue}
        onShareDeepSummaryQuote={(quote) => {
          setQuoteCard({
            text: quote || "La lectura profunda transforma el tiempo en memoria viva.",
            bookTitle: title,
            author,
            chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
          });
        }}
        onContinueDeepSummary={() => {
          setDeepSummary(null);
          setPostChapterQueue([]);
          if (pendingNextChapterRef.current !== null) {
            const target = pendingNextChapterRef.current;
            pendingNextChapterRef.current = null;
            void navigate("chapter", { index: target });
          }
        }}
        onCloseDeepSummary={() => {
          setDeepSummary(null);
          setPostChapterQueue([]);
          if (pendingNextChapterRef.current !== null) {
            const target = pendingNextChapterRef.current;
            pendingNextChapterRef.current = null;
            void navigate("chapter", { index: target });
          }
        }}
        glossaryOpen={glossaryOpen}
        onCloseGlossary={() => setGlossaryOpen(false)}
        onSelectGlossaryTerm={(word) => {
          setGlossaryOpen(false);
          openSelection({ word, context: "" });
        }}
        onGlossaryWordSaved={onWordSaved}
        ttsConsentOpen={ttsConsentOpen}
        onTtsConsentAccept={onTtsConsentAccept}
        onTtsConsentDismiss={() => setTtsConsentOpen(false)}
        ttsDownloadProgress={ttsDownloadProgress}
        isKittenModelDownloaded={isKittenModelDownloaded}
        onDeleteTtsModel={() => void handleDeleteTtsModel()}
        pageRecap={pageRecap}
        onClosePageRecap={() => setPageRecap(null)}
        catPassageExplanation={catPassageExplanation}
        onCloseCatExplanation={() => setCatPassageExplanation(null)}
      />
    </div>
  );
}

export { BilingueParagraph };
