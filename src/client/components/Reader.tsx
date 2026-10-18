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
import { tapZone } from "../lib/page-gesture";
import { usePageGesture } from "../lib/use-page-gesture";
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
  hasAnyLearningHistory,
  listAllKnowledge,
  listReadingEvents,
  listKnowledge,
  listSavedWords,
  loadBookPosition,
  saveBookPosition,
  saveKnowledge,
  saveWordWithKnowledge,
  updateBookMeta,
  recordPassiveExposure,
  saveReadingInterval,
  saveSessionValue,
  listIntervals,
  loadSessionValue,
  type DbScope,
  type KnownWord,
  type SavedWord,
  type SavedBookPosition,
  type SavedInterval,
} from "../lib/idb";
import {
  loadUserTheta,
  betaFromZipf,
  loadUserLanguageProfile,
  updateLanguageTheta,
  recordChapterCompleted,
} from "../lib/profile-models";
import { batchLookup, enrichBatch, explainInPassage, lookupWord } from "../lib/lexicon";
import {
  selectEnrichmentCandidates,
  selectSavedForEnrichment,
} from "../lib/enrichment-candidates";
import { hasUsableDefinition, measuredZipf } from "../../shared/lexicon";
import {
  cliticBasesFor,
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD_NATIVE,
  estimateProfile,
  isCredibleKnowledge,
  predictSection,
  PROFILE_ADJUST_KEY,
  resolveEvidence,
  type KnowledgeEvidence,
  type SectionPrediction,
  type VocabProfile,
} from "../lib/knowledge";
import {
  buildSuggestionRows,
  extractKeyWordFromSentence,
  type SuggestionRows,
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
  focusBlock,
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
  READER_LIMITS,
  LEADING_OPTIONS,
  MARGIN_OPTIONS,
  PREPARATION_MODES,
  READING_STRATEGY_PRESETS,
  CHROMATIC_PALETTES,
  applyStrategyPreset,
  applyReadingPreset,
  detectActiveReadingPreset,
  isStrategyPresetActive,
  isPrimingMutedForBook,
  muteBookForPriming,
  disablePrimingGlobally,
  type ChromaticPalette,
  type ReaderSettings,
  type ReadingStrategyPreset,
  type SoundscapeSetting,
  type ThemeChoice,
} from "../lib/settings";
import {
  anchorAtViewTop,
  scrollToAnchor,
  scrollToFragment,
  scrollToSnippet,
} from "../lib/reading-location";
import { searchBookSections, type SearchHit } from "../lib/book-search";
import {
  listAnnotations,
  saveAnnotation,
  removeAnnotation,
  updateAnnotation,
  type SavedAnnotation,
} from "../lib/idb";
import { makeBookmark, makePassage, type PassageTone } from "../lib/annotations";
import { applyPassageMarks } from "../lib/passage-marks";
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
import {
  pushAnnotationsToServer,
  pushActivityToServer,
} from "../lib/reading-sync";
import {
  dayKeyOf,
  IDLE_MS,
  MIN_INTERVAL_MS,
  ROLL_MS,
  timeByDay,
} from "../lib/reading-activity";
import { DAY_GOAL_MS } from "../lib/reading-goal";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import {
  dominatedLemmas,
  markLevel,
  savedFormLevels,
  type MarkLevel,
} from "../lib/word-level";
import { loadUseAi } from "../lib/ai-pref";
import {
  calibrationDoneKey,
  hasCalibrationEvidence,
} from "../lib/calibration";
import { calibrationBankZipf } from "../../shared/calibration-bank";
import {
  isTtsProgrammaticNav,
  isTtsProgrammaticScroll,
  noteTtsProgrammaticScroll,
  withTtsProgrammaticNav,
} from "../lib/ttsGuards";
import {
  consentTts,
  isTtsSupported,
  loadTtsSettings,
} from "../lib/ttsSettings";
import { sentenceIndexForAnchor } from "../lib/ttsSentences";
import {
  createTtsController,
  type TtsController,
} from "../lib/ttsController";
import {
  TTS_IDLE,
  TTS_PLAYER_RATES,
  type TtsEngineMode,
  type TtsSnapshot,
} from "../lib/ttsTypes";
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
  type PageRecapResult,
} from "../lib/page-recap";
import { checkHasInactivityGap } from "../lib/reading-activity";
import {
  registerBookSections,
  unregisterBookSections,
} from "../lib/book-search";
import { translateParagraph } from "../lib/translate";
import { ReaderRecapBubble } from "./ReaderRecapBubble";
import { BilingueParagraph } from "./BilingueParagraph";
import { kittenTtsEngine } from "../lib/kittenTtsEngine";
import TtsConsentDialog from "./TtsConsentDialog";
import SmartReaderDock from "./SmartReaderDock";
import WordPanel from "./WordPanel";
import SectionPreview, { type SectionPreviewRow } from "./SectionPreview";
import Sheet from "./Sheet";
import Dialog from "./Dialog";
import Icon from "./Icon";
import { ProgressInk } from "./ProgressInk";
import ReaderMoreMenu from "./ReaderMoreMenu";
import QuoteCardModal from "./QuoteCardModal";
import DeepReadingModal from "./DeepReadingModal";
import DeepReadingSummaryModal from "./DeepReadingSummaryModal";
import BookGlossaryModal from "./BookGlossaryModal";
import { downloadBookMarkdown } from "../lib/export";
import {
  formatRemainingTime,
  formatElapsedMinutes,
  requestScreenWakeLock,
  releaseScreenWakeLock,
  triggerHaptic,
  type DeepReadingConfig,
  type DeepReadingState,
  type DeepReadingSummary,
} from "../lib/deep-reading";
import {
  isFullscreen,
  isFullscreenSupported,
  subscribeFullscreenChange,
  toggleFullscreen,
} from "../lib/fullscreen";
import { playCompanionSound } from "../lib/companion-audio";
import ThemeMenu, { FontCarousel, StepperControl } from "./ThemeMenu";
import Toggle from "./Toggle";
import { Companion } from "./Companion";
import { CompanionButton } from "./CompanionButton";
import { useCompanion } from "./CompanionProvider";
import { eligibleDelta, useReaderPresence } from "../lib/reader-presence";
import { FocusRuler, rulerBandPx } from "./FocusRuler";
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
  saveBookStart,
  resolveEntryTarget,
  type BookStartRecord,
} from "../lib/book-start";
import BookStart from "./BookStart";
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
  type PhraseIndex,
} from "../lib/phrases";
import {
  acknowledgePreparationEntry,
  buildPreparationEvidence,
  buildPreparationWords,
  confirmPreparation,
  decidePreparation,
  loadPreparationRecord,
  newPreparationRecord,
  preparationRecordKey,
  savePreparationRecord,
  type PreparationAnswers,
  type PreparationRecord,
  type PreparationRow,
} from "../lib/preparation";

type ReaderState = "idle" | "opening" | "ready" | "error";
type SheetKind = "toc" | "settings" | "search" | "marks";
export type ReaderSettingsTab = "strategy" | "appearance" | "book";

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
  const overlayRelease = useRef<OverlayHandle | null>(null);
  const tocRowsRef = useRef<TocRow[]>([]);
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
  // Filas de preparación ya anotadas como realmente visibles.
  const presentedKeysRef = useRef(new Set<string>());
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
  // Espejo de la hoja de preparación para los callbacks (igual que
  // sectionIndexRef para la sección): evita cerrar sobre estado viejo.
  const prepRef = useRef<{
    target: ChapterTarget;
    record: PreparationRecord;
    analysis: "loading" | "ready" | "error";
    rows: SectionPreviewRow[];
    uncertain: SectionPreviewRow[];
    deferred: SectionPreviewRow[];
    answers: PreparationAnswers;
    // Identifica la presentación en el trayecto: cada apertura de la
    // hoja agrupa lo que se mostró y lo que se respondió.
    presentationId: string;
    saving: boolean;
  } | null>(null);
  // Datos léxicos por clave de respuesta: la vista solo recibe la fila
  // ligera; al confirmar se reconstruye la PreparationRow completa.
  const prepLexRef = useRef(new Map<string, PreparationRow>());
  // Espejo de ajustes para callbacks (el modo de preparación se lee
  // al decidir, no al renderizar).
  const settingsRef = useRef<ReaderSettings | null>(null);
  // Preferencia «Usar IA» en ref: la lee el enriquecimiento automático
  // sin rehacer callbacks ni depender del ciclo de render.
  const useAiRef = useRef(true);
  // Última posición capturada en vida: la usa el guardado al desmontar,
  // cuando el contenedor ya está fuera del DOM y no puede medirse.
  const latestPosition = useRef<SavedBookPosition | null>(null);
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
  // Elección inicial pendiente (T18): sin posición ni registro se
  // pregunta dónde empezar antes de renderizar una sección.
  const [askStart, setAskStart] = useState(false);
  // Registro de la elección inicial: el destino de preparación que
  // eligió (o se le sugirió) se consume en la primera evaluación.
  const bookStartRef = useRef<BookStartRecord | null>(null);
  // Analizador por rango (T13): un capítulo repartido es un solo
  // destino con una sola consulta de catálogo.
  const analyzerRef = useRef<ChapterAnalyzer | null>(null);
  // Hoja de preparación controlada (T19): el lector marca conocidas/
  // desconocidas y el controlador guarda vía confirmPreparation.
  const [prep, setPrep] = useState<{
    target: ChapterTarget;
    record: PreparationRecord;
    analysis: "loading" | "ready" | "error";
    rows: SectionPreviewRow[];
    uncertain: SectionPreviewRow[];
    deferred: SectionPreviewRow[];
    answers: PreparationAnswers;
    presentationId: string;
    saving: boolean;
  } | null>(null);
  // Aviso/acceso persistente «Palabras del capítulo»: vive en la zona
  // de controles, fuera del texto, hasta atenderlo o descartarlo.
  const [prepNotice, setPrepNotice] = useState<{
    target: ChapterTarget;
    summary: boolean;
    count: number | null;
  } | null>(null);
  const prepDismissed = useRef(new Set<string>());
  const prepEvaluated = useRef<string | null>(null);
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
  // Índice de locuciones (asset estático): se pide al montar el
  // lector para que el PRIMER toque ya lo tenga en memoria — sin
  // red ni IA en el camino de la consulta.
  const phrasesRef = useRef<PhraseIndex | null>(null);
  // Predicción de la sección visible (marcas punteadas en el texto).
  // Null mientras no haya análisis aplicable.
  const [prediction, setPrediction] = useState<SectionPrediction | null>(null);
  const [_analyzing, setAnalyzing] = useState(false);
  const [_enriching, setEnriching] = useState<{
    index: number;
    done: number;
    total: number;
  } | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [settingsTab, setSettingsTab] = useState<ReaderSettingsTab>("strategy");
  const [barsVisible, setBarsVisible] = useState(true);
  const [isFullscreenActive, setIsFullscreenActive] = useState(() => isFullscreen());
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
  const lastActivityAtRef = useRef<number>(0);
  const [stallBubble, setStallBubble] = useState<string | null>(null);
  const stallBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bookOverride, setBookOverride] = useState(() => hasBookReaderSettings(bookHash));
  const [seenStatus, setSeenStatus] = useState(statusText);
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);

  // Track 5: Burbuja "¿En qué me quedé?" tras > 6 horas de inactividad
  const [recapBubbleVisible, setRecapBubbleVisible] = useState(false);
  const [recapBubbleBullets, setRecapBubbleBullets] = useState<string[]>([]);
  const [recapBubbleLoading, setRecapBubbleLoading] = useState(false);
  const recapCheckedRef = useRef(false);

  // Track 5: Doble toque para traducir párrafo
  const lastTapRef = useRef<{ time: number; element: HTMLElement | null }>({ time: 0, element: null });
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchDone, setSearchDone] = useState(true);
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
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [quoteCard, setQuoteCard] = useState<{
    text: string;
    bookTitle?: string;
    author?: string;
    chapterTitle?: string;
    alreadySaved?: boolean;
  } | null>(null);
  const [deepModal, setDeepModal] = useState(false);
  const [catPassageExplanation, setCatPassageExplanation] = useState<{
    passage: string;
    loading: boolean;
    data: {
      contextualMeaning: string;
      toneAndNuance: string;
      catTip: string;
    } | null;
    error: string | null;
  } | null>(null);
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

  const fragmentPageMap = useMemo(() => {
    if (
      settings.layout !== "pages" ||
      !pageMetrics ||
      !containerRef.current ||
      currentSectionTargets.length <= 1
    ) {
      return null;
    }
    const fragments = currentSectionTargets
      .map((t: ChapterTarget) => t.fragment)
      .filter((f: string | undefined): f is string => Boolean(f));
    return buildFragmentPageMap(containerRef.current, pageMetrics, fragments);
  }, [settings.layout, pageMetrics, currentSectionTargets, sectionIndex, pageCount]);

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
  const searchAbort = useRef<AbortController | null>(null);
  // Segmento de lectura abierto: empieza con la primera señal real y
  // termina donde quedó la última — el rato que sigue sin señales no
  // cuenta. `paused` lo cierran las hojas, los paneles y la pestaña
  // oculta: hojas/repaso/inactividad no son lectura.
  const activityRef = useRef<{ startedAt: number; lastActiveAt: number } | null>(null);
  const pausedRef = useRef(true);

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
    readingPaused || selection !== null || askStart || companion.modalOpen;

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

  const releaseOverlay = () => {
    overlayRelease.current?.release();
    overlayRelease.current = null;
  };

  // Día «leído» ya celebrado: evita repetir la celebración si otro
  // segmento cruza el umbral el mismo día (la llave es día local).
  const dayGoalRef = useRef<{ dayKey: string; done: boolean } | null>(null);

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

  // Toda señal de lectura real pasa por aquí: scroll, cambio de página,
  // flechas, toques en el texto y consultas de palabra. Con hoja,
  // panel o pestaña oculta la señal se ignora.
  const noteActivity = useCallback(() => {
    if (pausedRef.current || document.hidden) return;
    const now = Date.now();
    const seg = activityRef.current;
    // El planificador de presencia cuenta solo actividad elegible:
    // el delta entre señales reales, acotado como el seguimiento —
    // un hueco mayor a IDLE_MS no regala su tiempo completo, y sin
    // segmento vivo la señal no trae tiempo a cuestas.
    const delta = eligibleDelta(seg, now, IDLE_MS);
    if (!seg) activityRef.current = { startedAt: now, lastActiveAt: now };
    else seg.lastActiveAt = now;
    presenceActivity(delta);
    setCatSleepy(false);
    signalCompanion({ kind: "reading_activity", at: now });
  }, [signalCompanion, presenceActivity]);

  // Cierra el segmento abierto y, si duró lo bastante, lo guarda como
  // intervalo inmutable. Termina en la última señal, no en «ahora»:
  // los segundos quietos antes de la pausa tampoco cuentan.
  const closeActivity = useCallback(() => {
    const seg = activityRef.current;
    activityRef.current = null;
    // Sin segmento vivo el lector está inactivo para la presencia —
    // las visitas se difieren sin acumular deuda.
    presenceIdle(true);
    if (!seg) return;
    const endedAt = Math.min(seg.lastActiveAt, Date.now());
    if (endedAt - seg.startedAt < MIN_INTERVAL_MS) return;
    const interval: SavedInterval = {
      id: crypto.randomUUID(),
      bookHash,
      startedAt: seg.startedAt,
      endedAt,
    };
    // El tramo se midió bajo esta cuenta: si la sesión cambia antes de
    // que el guardado termine, aterriza en su base — nunca en la nueva.
    const scope = captureDbScope();
    void saveReadingInterval(interval, scope).then(() =>
      pushActivityToServer([interval], scope),
    );
    // El día del premio se fija con la zona del emisor (la misma de la
    // meta diaria de abajo): el journal replica la racha con esos
    // dayKey, no con la zona de quien sincronice.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayKey = dayKeyOf(endedAt, tz);
    void award({ kind: "read", ms: endedAt - seg.startedAt }, scope, {
      id: `read:${interval.id}`,
      at: endedAt,
      dayKey,
      interval: { startedAt: seg.startedAt, endedAt },
    });

    // Meta del día: si este tramo lleva al día por encima del mínimo
    // de «día leído» (60 s), el gato celebra — una sola vez por día.
    // El total se pide al almacén para no celebrar dos veces cuando el
    // lector ya había leído hoy en otra sesión; el intervalo en vuelo
    // se suma por separado (se filtra por id por si ya aterrizó).
    void listIntervals(scope)
      .then((list) => {
        if (dayGoalRef.current?.dayKey !== dayKey)
          dayGoalRef.current = { dayKey, done: false };
        if (dayGoalRef.current.done) return;
        const saved =
          timeByDay(
            list.filter((i) => i.id !== interval.id),
            tz,
          ).find((d) => d.dayKey === dayKey)?.ms ?? 0;
        const segMs = endedAt - seg.startedAt;
        if (saved < DAY_GOAL_MS && saved + segMs >= DAY_GOAL_MS) {
          dayGoalRef.current.done = true;
          signalCompanion({ kind: "goal_completed", at: endedAt });
        }
      })
      .catch(() => undefined);
  }, [bookHash, signalCompanion, presenceIdle]);

  // Track 5: Detección de inactividad > 6h para "¿En qué me quedé?"
  useEffect(() => {
    if (recapCheckedRef.current || !bookHash) return;
    recapCheckedRef.current = true;
    const scope = captureDbScope();
    void listIntervals(scope)
      .then((intervals) => {
        if (checkHasInactivityGap(intervals, bookHash)) {
          setRecapBubbleVisible(true);
        }
      })
      .catch(() => undefined);
  }, [bookHash]);

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

  // Track 5: Doble toque para traducir párrafo (modo bilingüe fluido en inglés)
  const toggleParagraphTranslation = async (p: HTMLElement) => {
    if (language !== "en") return;
    const existing = p.querySelector(".paragraph-inline-translation");
    if (existing) {
      existing.remove();
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
      overlayRelease.current = null;
      setSelection(null);
    };
    if (overlayRelease.current) overlayRelease.current.swap(close);
    else overlayRelease.current = pushOverlay(close);
    setSheet(null);
    setSelection(hit);
    consultedInPageRef.current.add(hit.word.toLowerCase());
    // Recalibración adaptativa hacia abajo (outcome = 0) para el idioma actual
    try {
      const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
      const cachedAnalysis = analysisFor(sectionIndexRef.current);
      const hitEntry = cachedAnalysis?.entries[hit.word.toLowerCase()]?.[0];
      const wordBeta = betaFromZipf(hitEntry?.zipf);
      updateLanguageTheta(currentLang, wordBeta, 0, 0.8);
    } catch {
      // Ignorar fallo al persistir theta
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
      overlayRelease.current = null;
      setSheet(null);
    };
    if (overlayRelease.current) overlayRelease.current.swap(close);
    else overlayRelease.current = pushOverlay(close);
    setSelection(null);
    setSheet(kind);
  };

  const closeSheet = () => {
    releaseOverlay();
    setSheet(null);
  };

  const openSettings = (tab: ReaderSettingsTab = "strategy") => {
    setSettingsTab(tab);
    openSheet("settings");
  };

  // Las pausas cierran el segmento en su última señal; al volver, la
  // siguiente señal abre uno nuevo sin arrastrar el tiempo de pausa.
  // La hoja del gato (vive en el proveedor) también pausa: cuidar al
  // gato no es lectura.
  useEffect(() => {
    pausedRef.current = readingPaused;
    if (pausedRef.current) closeActivity();
  }, [readingPaused, closeActivity]);

  // Latido del segmento: si pasó el umbral sin señales cierra donde
  // quedó la última; si sigue vivo pero ya es largo lo «rueda» para
  // que una caída de la pestaña no se lleve la sesión entera.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const seg = activityRef.current;
      if (!seg) return;
      const now = Date.now();
      if (now - seg.lastActiveAt > IDLE_MS) {
        closeActivity();
        return;
      }
      if (now - seg.startedAt >= ROLL_MS) {
        const restartAt = seg.lastActiveAt;
        closeActivity();
        if (!pausedRef.current && !document.hidden) {
          activityRef.current = { startedAt: restartAt, lastActiveAt: restartAt };
          // El segmento sigue vivo tras la ronda: sin esto la
          // presencia quedaría «inactiva» hasta la próxima señal.
          presenceIdle(false);
        }
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [closeActivity, presenceIdle]);

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
    latestPosition.current = pos;
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash]);

  // Guardado con debounce: igual que al hacer scroll, también sirve al
  // pasar de página. El contexto se ata al tick que programó el
  // guardado: si la cuenta cambia antes de que corra, la posición cae
  // en la base que leyó — no en la recién activada.
  const saveSoon = useCallback(() => {
    const scope = captureDbScope();
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos, scope);
    }, 400);
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

  // Bandera de «sección analizándose» por índice; el estado `analyzing`
  // ---------- Predicción por destino (perfil del lector) ----------

  // Rango del catálogo que contiene la sección física.
  const rangeFor = useCallback(
    (index: number) =>
      catalogRef.current?.ranges.find(
        (range) =>
          range.startSection <= index && index < range.endSection,
      ) ?? null,
    [],
  );

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

  // Bandera de «destino analizándose» por id de target; el estado
  // `analyzing` solo refleja el destino visible.
  const setAnalyzingFor = useCallback(
    (targetId: string, on: boolean) => {
      if (on) analyzingTargets.current.add(targetId);
      else analyzingTargets.current.delete(targetId);
      const current = targetAt(
        catalogRef.current?.ranges ?? [],
        sectionIndexRef.current,
      );
      if (current?.id === targetId) setAnalyzing(on);
    },
    [],
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

  // Registra un evento de esta visita y este libro. Auxiliar:
  // trackReadingEvent ya traga sus errores y respeta la preferencia
  // de Cuenta; aquí solo falta el `void` y los ids de contexto.
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

  // Anota las filas que la hoja dejó realmente visibles (página
  // inicial, «Ver más», consulta secundaria), deduplicando por clave.
  const recordPresented = (rows: SectionPreviewRow[]) => {
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
  };

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

  // Evidencia recién escrita entra al modelo en memoria y queda
  // marcada como pendiente: refreshProfile no la pisa si el store aún
  // no la refleja al releer.
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
        zipf: prev?.zipf ?? zipfForLemma(lemma),
        known: row.known,
      });
      pendingKnowledgeRef.current.add(lemma);
    },
    [zipfForLemma],
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

  // ---------- Preparación de vocabulario (T19) ----------

  // Filas de la hoja desde un análisis listo: la selección principal
  // (predichas + «aprendiendo») y la consulta secundaria con lo que
  // el catálogo no sabe medir — nombres propios y extranjerismos solo
  // capitalizados quedan fuera. Los datos léxicos completos van a
  // prepLexRef por clave: el confirmar los necesita para armar
  // evidencia y palabras sin volver a buscarlos.
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
    [],
  );

  // Cierra la capa de preparación: la corre el `close` del historial
  // (botón atrás) y los cierres explícitos — release() solo desenrolla
  // la entrada, el estado hay que limpiarlo aquí. Conserva el borrador
  // y, si sigue pendiente, deja el aviso como vía para retomarlo (en
  // modo «off» el acceso manual basta, no se muestra nada).
  const closePrepLayer = () => {
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
  };

  // Abre la hoja de preparación para un destino: capa propia del
  // historial (atrás = cerrar hoja, como el resto de ventanas) y
  // análisis compartido con el pipeline del capítulo — deduplicado.
  const openPrepSheet = useCallback(
    async (target: ChapterTarget, record: PreparationRecord | null) => {
      const scope = captureDbScope();
      const cat = catalogRef.current;
      const analyzer = analyzerRef.current;
      const book = bookRef.current;
      const range = cat?.ranges.find((r) => r.target.id === target.id);
      if (!cat || !analyzer || !book || !range) return;
      const lang = language || getBookLanguage(book);
      const base =
        record ??
        (await loadPreparationRecord(bookHash, target.id, scope).catch(() => null)) ??
        newPreparationRecord({ bookHash, targetId: target.id, updatedAt: Date.now() });
      const close = () => {
        overlayRelease.current = null;
        closePrepLayer();
      };
      if (overlayRelease.current) overlayRelease.current.swap(close);
      else overlayRelease.current = pushOverlay(close);
      setSheet(null);
      setSelection(null);
      presentedKeysRef.current.clear();
      const initial = {
        target,
        record: base,
        analysis: "loading" as const,
        rows: [] as SectionPreviewRow[],
        uncertain: [] as SectionPreviewRow[],
        deferred: [] as SectionPreviewRow[],
        presentationId: crypto.randomUUID(),
        answers: base.answers,
        saving: false,
      };
      prepRef.current = initial;
      setPrep(initial);
      const result = await analyzer.analyze(range);
      const current = prepRef.current;
      // El resultado tardío se descarta si la hoja ya no es la misma.
      if (!current || current.target.id !== target.id) return;
      if (result.state === "ready") {
        const suggestion = prepRowsFor(result, lang, prepLexRef.current);
        const next = {
          ...current,
          analysis: "ready" as const,
          rows: suggestion.rows,
          uncertain: suggestion.uncertain,
          deferred: suggestion.deferred,
        };
        prepRef.current = next;
        setPrep(next);
      } else {
        const next = { ...current, analysis: "error" as const };
        prepRef.current = next;
        setPrep(next);
      }
    },
    [bookHash, prepRowsFor, language],
  );

  // Evalúa la matriz de apertura para un destino y actúa: hoja, aviso
  // persistente, resumen de una sola vez o nada. `enter` corre al
  // entrar al capítulo; `analysis-settled` solo actualiza el aviso.
  const evaluatePreparation = useCallback(
    async (
      index: number,
      via: "enter" | "analysis-settled" = "enter",
      prevTargetId: string | null = null,
    ) => {
      const cat = catalogRef.current;
      const book = bookRef.current;
      if (!cat || !book) return;
      // La primera entrada usa el destino de preparación elegido al
      // seleccionar inicio (preparar el capítulo leyendo la intro);
      // después manda el destino que contiene la sección.
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
        // Entrar a otra sección del mismo destino no reevalúa: solo
        // la primera evaluación del libro o un cambio real de destino
        // disparan la decisión. `prevTargetId` viene de navigate y
        // distingue «intro → cap1» de «cap1 §2 → cap1 §3».
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
      // El primer capítulo de una cuenta sin historial: la hoja
      // pediría clasificar palabras que el perfil aún no sabe usar —
      // entra directo con el aviso discreto; la calibración después
      // del primer tramo aprende el nivel sin pedirlo por adelantado.
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
        setPrepNotice({
          target,
          summary: opening === "summary",
          count:
            cached?.state === "ready"
              ? prepRowsFor(cached, language || getBookLanguage(book)).rows.length
              : null,
        });
        return;
      }
      setPrepNotice((cur) => (cur?.target.id === target.id ? null : cur));
    },
    [bookHash, openPrepSheet, prepRowsFor, language],
  );

  // Análisis del destino de la sección: deduplicado por el analizador,
  // sin bloquear la pintura. Un fallo no impide leer — la hoja muestra
  // su propio estado de error si el usuario la abre.
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
          // Si hay aviso para este destino, el conteo se actualiza;
          // si el aviso fue descartado, no reaparece.
          void evaluatePreparation(index, "analysis-settled");
        }
      } finally {
        setAnalyzingFor(range.target.id, false);
      }
    },
    [rangeFor, setAnalyzingFor, applyPrediction, evaluatePreparation, language],
  );

  // Análisis con precarga: al terminar deja lista también la siguiente
  // parte real del catálogo (el próximo capítulo, no otra sección).
  const analyzeSection = useCallback(
    async (index: number, knownText?: string) => {
      await runSectionAnalysis(index, knownText);
      void analyzerRef.current?.preloadNext(index);
    },
    [runSectionAnalysis],
  );

  // ---------- Acciones de la hoja de preparación ----------

  // Respuesta en borrador: se persiste al vuelo para que cerrar y
  // reabrir la retome donde quedó.
  const answerPrep = (key: string, answer: "known" | "unknown") => {
    const current = prepRef.current;
    if (!current) return;
    const answers = { ...current.answers, [key]: answer };
    const record = {
      ...current.record,
      answers,
      updatedAt: Date.now(),
    };
    const next = { ...current, answers, record };
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
  };

  // «Guardar y leer»: lote atómico (registro + conocimiento + Cuaderno)
  // vía confirmPreparation; lo escrito alimenta marcas y perfil.
  const confirmPrep = async () => {
    const current = prepRef.current;
    if (!current || current.saving) return;
    const withSaving = { ...current, saving: true };
    prepRef.current = withSaving;
    setPrep(withSaving);
    const lex = prepLexRef.current;
    // Las diferidas también pueden haberse respondido (consulta
    // aparte): su evidencia y sus palabras entran al mismo lote.
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
    // La disposición final queda en prepRef antes de cerrar: el
    // persist de closePrepLayer guarda este registro, no el borrador.
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
      const reverted = { ...withSaving, saving: false };
      prepRef.current = reverted;
      setPrep(reverted);
      onError("No se pudo guardar la preparación. Intenta de nuevo.");
      return;
    }
    // Aplica lo escrito: evidencia al perfil (ambas respuestas pesan,
    // con su zipf resuelto del análisis), desconocidas al Cuaderno.
    for (const item of result.knowledge) ingestKnowledgeRow(item);
    for (const word of result.words) {
      // El nivel sale de la tarjeta realmente escrita: una palabra ya
      // guardada conserva su tarjeta (la mezcla no la baja a «new») y
      // una dominada respondida por ficha rara deja de marcarse.
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
      onStatus(
          `${result.words.length} palabra(s) agregada(s) a tu cuaderno.`,
      );
  };

  // «Leer sin preparar»: marca el destino como declinado — no se vuelve
  // a interponer y no genera evidencia.
  const skipPrep = () => {
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
  };

  // Reintento tras error de análisis: mismo flujo de apertura, la capa
  // del historial ya existe — solo se actualiza el estado.
  const retryPrep = async () => {
    const current = prepRef.current;
    const analyzer = analyzerRef.current;
    const cat = catalogRef.current;
    if (!current || !analyzer || !cat) return;
    const range = cat.ranges.find((r) => r.target.id === current.target.id);
    if (!range) return;
    const loading = { ...current, analysis: "loading" as const };
    prepRef.current = loading;
    setPrep(loading);
    const result = await analyzer.analyze(range);
    const now = prepRef.current;
    if (!now || now.target.id !== current.target.id) return;
    const suggestion =
      result.state === "ready"
        ? prepRowsFor(result, language, prepLexRef.current)
        : null;
    const next = suggestion
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
  };

  // Descarte explícito del borrador: vacía respuestas sin cerrar.
  const discardPrep = () => {
    const current = prepRef.current;
    if (!current) return;
    const record: PreparationRecord = {
      ...current.record,
      answers: {},
      updatedAt: Date.now(),
    };
    const next = { ...current, answers: {}, record };
    prepRef.current = next;
    setPrep(next);
    void savePreparationRecord(record, captureDbScope()).catch(() => undefined);
  };

  // Acceso manual «Palabras del capítulo» (modo «off» incluido): abre
  // la hoja del destino visible respetando su registro previo.
  const openPrepManual = () => {
    const target =
      prepNotice?.target ??
      currentChapterTarget ??
      targetAt(catalogRef.current?.ranges ?? [], sectionIndexRef.current);
    setPrepNotice(null);
    if (target) void openPrepSheet(target, null);
  };

  const dismissPrepNotice = () => {
    if (prepNotice) prepDismissed.current.add(prepNotice.target.id);
    setPrepNotice(null);
  };

  // Perfil del lector: la evidencia en ambas direcciones calibra el
  // umbral — un «no la conocía» raro pesa lo mismo que un «la conozco»
  // frecuente; el zipf de cada lema se mide vía catálogo con el mismo
  // criterio que Cuenta (primera acepción de la forma). Con almacén o
  // red caídos queda el umbral por defecto más el ajuste manual.
  // Solo cuenta la evidencia creíble: un «inferred: no la conozco»
  // sin palabra guardada que lo respalde es rastro de una consulta,
  // no una declaración (isCredibleKnowledge).
  const refreshProfile = useCallback(async (lang: string, scope?: DbScope) => {
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
  }, []);

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
      if (!isTtsProgrammaticNav()) ttsRef.current?.stop("navigation");
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
  // La sesión vive en un controlador estable creado una vez por
  // montaje; las funciones del lector que toca se sirven por espejo
  // (misma razón que sectionIndexRef: evitar cierres de estado viejo
  // sin rehacer la sesión en cada render).
  const ttsRef = useRef<TtsController | null>(null);
  const [ttsSnap, setTtsSnap] = useState<TtsSnapshot>(TTS_IDLE);
  const [ttsConsentOpen, setTtsConsentOpen] = useState(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState<number | null>(null);
  const [isKittenModelDownloaded, setIsKittenModelDownloaded] = useState(false);

  useEffect(() => {
    if (ttsConsentOpen) {
      void kittenTtsEngine.isModelDownloaded().then((downloaded) => {
        setIsKittenModelDownloaded(downloaded);
      });
    }
  }, [ttsConsentOpen]);

  const handleDeleteTtsModel = async () => {
    await kittenTtsEngine.removeDownloadedModel();
    setIsKittenModelDownloaded(false);
    setTtsDownloadProgress(null);
  };
  const ttsFns = useRef({
    navigate,
    trackEvent,
    noteActivity,
    onStatus,
    reducedMotion: companion.reducedMotion,
    language,
    closeSheet,
  });

  // Los espejos se actualizan tras cada commit: las dependencias del
  // controlador leen siempre la versión vigente de estas funciones.
  useEffect(() => {
    ttsFns.current = {
      navigate,
      trackEvent,
      noteActivity,
      onStatus,
      reducedMotion: companion.reducedMotion,
      language,
      closeSheet,
    };
    stateRef.current = state;
  });

  useEffect(() => {
    const ctl = createTtsController({
      language: () => ttsFns.current.language,
      root: () => containerRef.current,
      sectionIndex: () => sectionIndexRef.current,
      sectionReady: () => stateRef.current === "ready",
      navigateSection: (index) => {
        // Salto interno del target: envuelto para que navigate no lo
        // lea como navegación explícita (que sí detiene la sesión).
        // Intent «resume» porque la voz continúa el tramo — «chapter»
        // podría interponer la hoja de preparación a media sesión.
        withTtsProgrammaticNav(() => {
          void ttsFns.current.navigate("resume", { index });
        });
      },
      reveal: (el) => {
        // El scroll que sigue a la voz no es del lector: la ventana
        // de tiempo lo exime de las señales de actividad.
        noteTtsProgrammaticScroll();
        const metrics = metricsRef.current;
        if (layoutRef.current === "pages" && metrics) {
          setPageIdx(pageOfElement(el, metrics));
          return;
        }
        el.scrollIntoView({
          block: "center",
          behavior: ttsFns.current.reducedMotion ? "auto" : "smooth",
        });
      },
      emit: (draft) =>
        ttsFns.current.trackEvent(draft as unknown as VisitEventDraft),
      noteActivity: () => ttsFns.current.noteActivity(),
      onSnapshot: setTtsSnap,
      onSessionEnd: (reason) => {
        if (reason === "error")
          ttsFns.current.onStatus("No se pudo leer en voz alta.");
      },
      resolveStartIndex: (items) => {
        // Arranca donde el lector tiene la vista: la posición
        // guardada si cae en esta sección; si no, el bloque visible
        // más alto; sin ninguna de las dos, la primera oración.
        const saved = latestPosition.current;
        const anchor =
          saved?.sectionIndex === sectionIndexRef.current && saved.anchor
            ? saved.anchor
            : containerRef.current
              ? anchorAtViewTop(containerRef.current)
              : null;
        return sentenceIndexForAnchor(items, anchor);
      },
    });
    // La asignación al ref va por función (patrón de analyzerRef):
    // el lint de react-hooks no admite escrituras directas aquí.
    const attach = (next: TtsController | null) => {
      ttsRef.current = next;
    };
    attach(ctl);
    return () => {
      ctl.destroy();
      attach(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pausas de la sesión: pestaña oculta («visibility», con cierre
  // automático prolongado en el controlador) gana siempre; la ficha
  // de palabra lleva razón propia («word_lookup»); cualquier otra
  // hoja o capa es «panel_opened»; el aviso de fatiga, «fatigue».
  // Ninguna reanuda sola: volver es siempre decisión del lector.
  useEffect(() => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    if (ttsSnap.status !== "speaking" && ttsSnap.status !== "preparing")
      return;
    if (docHidden) ctl.pause("visibility");
    else if (selection) ctl.pause("word_lookup");
    else if (
      sheet ||
      panelsOpen ||
      prep ||
      askStart ||
      companion.open ||
      companion.modalOpen
    )
      ctl.pause("panel_opened");
    else if (fatigueNotice) ctl.pause("fatigue");
  }, [
    ttsSnap.status,
    docHidden,
    selection,
    sheet,
    panelsOpen,
    prep,
    askStart,
    companion.open,
    companion.modalOpen,
    fatigueNotice,
  ]);

  // La sección que el avance programático pidió terminó de pintar:
  // el controlador reconstruye el mapa ahí y sigue hablando.
  useEffect(() => {
    if (state === "ready") ttsRef.current?.onSectionRendered();
  }, [state, sectionIndex]);

  // El gato guarda silencio mientras la voz corre — supresión
  // temporal, no toca su preferencia de sonido ni su celebración.
  useEffect(() => {
    setCompanionAudioSuppressed(ttsSnap.status === "speaking");
    return () => setCompanionAudioSuppressed(false);
  }, [ttsSnap.status]);

  const startTts = () => {
    const ctl = ttsRef.current;
    if (!ctl || state !== "ready") return;
    closeSheet();
    const index = sectionIndexRef.current;
    // El territorio es el rango [startSection, endSection) del
    // destino que cubre la sección visible; sin catálogo, la sección
    // sola (lee lo visible y termina con chapter_end).
    const range = (catalogRef.current?.ranges ?? []).find(
      (r) => r.startSection <= index && index < r.endSection,
    );
    ctl.start(
      {
        bookHash,
        targetId: range?.target.id ?? `s${index}`,
        startSection: range?.startSection ?? index,
        endSection: range?.endSection ?? index + 1,
        sectionIndex: index,
      },
      // El índice real lo resuelve resolveStartIndex sobre el mapa
      // ya construido (posición guardada → bloque visible → 0).
      0,
    );
  };

  const onTtsRequest = () => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    if (ttsSnap.status !== "idle") {
      ctl.stop("user");
      return;
    }
    // Primer uso del dispositivo: el aviso de privacidad va primero;
    // cancelarlo no vuelve a insistir (solo reaparece si se toca).
    if (loadTtsSettings().consentedAt === null) {
      setTtsConsentOpen(true);
      return;
    }
    startTts();
  };

  const onTtsConsentAccept = (engineMode?: TtsEngineMode) => {
    consentTts(undefined, engineMode ? { engine: engineMode } : undefined);
    setTtsConsentOpen(false);
    trackEvent({
      kind: "tts_setting_changed",
      enabled: true,
      source: "reader_tools",
    });
    startTts();
  };

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
      prepLexRef.current = new Map();
      prepDismissed.current.clear();
      prepEvaluated.current = null;
      bookStartRef.current = null;
      prepRef.current = null;
      knowledgeMapRef.current = new Map();
      evidenceRef.current = new Map();
      pendingKnowledgeRef.current.clear();
      presentedKeysRef.current.clear();
      lastTargetEnteredRef.current = null;
      savedEnrichSentRef.current = false;
      profileRef.current = null;
      baseThresholdRef.current = DEFAULT_THRESHOLD_NATIVE;
      adjustRef.current = 0;
      // Poda perezosa del trayecto: conserva el historial reciente.
      void pruneReadingHistory(undefined, scope);
      setPrediction(null);
      setPrep(null);
      setPrepNotice(null);
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
        const profileReady = refreshProfile(bookLanguage, scope);

        // Entrada única (T18): posición → reanudar; registro previo →
        // destino elegido; ninguno → preguntar sin renderizar la
        // sección cero. La elección se guarda como `bookStart:v1`,
        // separada del avance.
        const saved = await loadBookPosition(bookHash, scope);
        const start = await loadBookStart(bookHash, scope).catch(() => null);
        const entry = resolveEntryTarget(saved, start, catalog, book.sections.length);
        if (disposed) return;
        // El destino de preparación elegido al seleccionar el inicio
        // lo consume la primera evaluación «enter» — solo aplica si
        // la entrada viene del registro, no de una reanudación.
        bookStartRef.current = entry.kind === "target" ? start : null;
        if (entry.kind === "ask" && catalog.targets.length) {
          const suggested =
            suggestedChapterTarget(catalog, title) ??
            catalog.targets.find((t) => t.kind === "chapter") ??
            catalog.targets[0];
          if (suggested) {
            void navigate("initial", {
              index: suggested.sectionIndex,
              fragment: suggested.fragment,
            });
            return;
          }
          setAskStart(true);
          onStatus("");
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
      await refreshProfile(language, scope);
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

  // Marcadores y pasajes del libro (una sola lectura por apertura).
  useEffect(() => {
    void listAnnotations(bookHash, captureDbScope()).then(setAnnotations);
  }, [bookHash]);

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
  // remarcado de vocabulario (guardadas + predichas): `prediction`
  // reordena nodos de texto cuando el análisis llega, así que el
  // fallback de pasajes vuelve a correr encima.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || state !== "ready") return;
    applyPassageMarks(
      container,
      annotations.filter((a) => a.kind === "passage" && a.sectionIndex === sectionIndex),
    );
  }, [annotations, sectionIndex, state, vocabVersion, prediction]);

  // Búsqueda progresiva dentro del libro: entrega resultados conforme
  // avanza, se cancela al cambiar la consulta o cerrar la hoja.
  useEffect(() => {
    searchAbort.current?.abort();
    const query = searchQ.trim();
    if (query.length < 2 || !bookRef.current) return;
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    const timer = window.setTimeout(() => {
      void (async () => {
        const book = bookRef.current;
        if (!book) return;
        setSearchHits([]);
        setSearchDone(false);
        for await (const hit of searchBookSections(
          book.sections,
          tocRowsRef.current,
          query,
          { signal: ctrl.signal, limit: 100 },
        )) {
          setSearchHits((prev) => [...prev, hit]);
        }
        if (!ctrl.signal.aborted) setSearchDone(true);
      })();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [searchQ]);

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
      const saved = latestPosition.current;
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
        const saved = latestPosition.current;
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

  // Comprobación de inferencia implícita por exposición pasiva (Fase 4):
  // Si la permanencia en la página fue válida (>= 8s y < 450 ppm) y no se consultó
  // la palabra en WordPanel, se actualiza su probabilidad de conocimiento.
  const checkPassiveExposure = useCallback(() => {
    const now = Date.now();
    if (pageEnteredAtRef.current === 0) {
      pageEnteredAtRef.current = now;
      return;
    }
    const dwellMs = now - pageEnteredAtRef.current;
    pageEnteredAtRef.current = now;
    if (dwellMs < 8000) return;

    const totalPages = Math.max(1, pageCountRef.current);
    const wordsInPage = Math.max(1, Math.round(sectionWords / totalPages));
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
  }, [analysisFor, sectionWords, applyKnowledgeRow, language]);

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso).
  const goPage = useCallback(
    (delta: number) => {
      noteActivity();
      trackMove(delta < 0);
      checkPassiveExposure();
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
          try {
            const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
            recordChapterCompleted(currentLang);
          } catch {
            // Ignorar fallo de guardado
          }
          signalCompanion({ kind: "goal_completed", at: Date.now() });
          return navigate("chapter", { index: sectionIndexRef.current + 1 });
        }
        return Promise.resolve();
      }
      setPageIdx(next);
      saveSoon();
      return Promise.resolve();
    },
    [navigate, saveSoon, sectionTotal, setPageIdx, noteActivity, trackMove, signalCompanion, checkPassiveExposure],
  );

  usePageGesture({
    viewportRef,
    containerRef,
    layout: settings.layout,
    page,
    pageCount,
    pageAdvance: pageMetrics ? pageAdvance(pageMetrics.boxW, pageMetrics.gap) : 0,
    isFirstPageInBook: sectionIndex === 0,
    isLastPageInBook: sectionIndex + 1 >= sectionTotal,
    reducedMotion: companion.reducedMotion,
    onTurnPage: goPage,
    onCenterTap: () => {
      setBarsVisible((prev) => !prev);
    },
  });

  // Espejo del modo para callbacks estables (guardado, teclado,
  // restauración): leen refs, no estado que cierra viejo.
  useEffect(() => {
    layoutRef.current = settings.layout;
  }, [settings.layout]);

  // Referencia fresca para el guardado al desmontar: si el lector se
  // cierra sin más scroll (ajustó la letra y salió, sección corta), el
  // debounce pudo no correr y la posición quedaría vieja. Al desmontar el
  // contenedor ya está desconectado del DOM (los rectángulos dan 0), así
  // que se escribe la última posición capturada en vida, no una nueva.
  // `ready` evita guardar el estado inicial: en StrictMode el cleanup
  // corre una vez al montar y pisaría la posición guardada.
  const latest = useRef({ ready: state === "ready" });
  useEffect(() => {
    latest.current = { ready: state === "ready" };
  });
  useEffect(() => {
    return () => {
      closeActivity();
      if (!latest.current.ready) return;
      const pos = latestPosition.current;
      if (!pos) return;
      void saveBookPosition(
        { ...pos, updatedAt: Date.now() },
        captureDbScope(),
      );
    };
  }, [bookHash, closeActivity]);

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

  // Sincronización del estado de pantalla completa
  useEffect(() => {
    return subscribeFullscreenChange(() => {
      setIsFullscreenActive(isFullscreen());
    });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    triggerHaptic("selection");
    const next = await toggleFullscreen();
    setIsFullscreenActive(next);
  }, [setIsFullscreenActive]);

  // Limpieza de pantalla completa y wake lock al desmontar el lector
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        void releaseScreenWakeLock(wakeLockRef.current);
      }
      void toggleFullscreen(false);
    };
  }, []);

  // Screen Wake Lock activo durante la lectura / reproducción de TTS
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let isLive = true;

    const acquireLock = async () => {
      if (typeof document === "undefined" || document.hidden || !isLive) return;
      try {
        if (typeof navigator !== "undefined" && "wakeLock" in navigator && navigator.wakeLock?.request) {
          sentinel = await navigator.wakeLock.request("screen");
        }
      } catch {
        sentinel = null;
      }
    };

    const releaseLock = async () => {
      try {
        await sentinel?.release();
      } catch {
        // ignore
      } finally {
        sentinel = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void acquireLock();
      } else {
        void releaseLock();
      }
    };

    void acquireLock();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isLive = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      void releaseLock();
    };
  }, [ttsSnap?.status, deepReading?.active]);

  // Atajos de lectura: ← / → / Espacio / AvPág / RePág pasan página o sección.
  // Ctrl+F abre búsqueda; T abre índice; M abre marcadores; D consulta palabra;
  // F / F11 alterna pantalla completa; Tab siempre trae las barras de vuelta.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") setBarsVisible(true);
      const target = event.target;
      const inInput =
        target instanceof HTMLElement &&
        Boolean(target.closest("input, textarea, select, [contenteditable]"));

      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        if (!inInput) {
          event.preventDefault();
          openSheet("search");
          return;
        }
      }

      if (selection || sheet || panelsOpen) return;
      if (inInput) return;

      if (deepReading?.active && event.key === "Escape") {
        event.preventDefault();
        void finishDeepReading(false);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === "t" || event.key === "T") {
          event.preventDefault();
          openSheet("toc");
          return;
        }
        if (event.key === "m" || event.key === "M") {
          event.preventDefault();
          openSheet("marks");
          return;
        }
        if (event.key === "f" || event.key === "F") {
          event.preventDefault();
          void handleToggleFullscreen();
          return;
        }
      }

      if (event.key === "F11") {
        event.preventDefault();
        void handleToggleFullscreen();
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        noteActivity();
        if (settings.visualPacer) {
          setPacerPaused((p) => !p);
          return;
        }
        if (layoutRef.current === "pages") {
          if (event.shiftKey) goPage(-1);
          else goPage(1);
        } else {
          window.scrollBy({
            top: (event.shiftKey ? -1 : 1) * Math.round(window.innerHeight * 0.75),
            behavior: "smooth",
          });
        }
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        noteActivity();
        if (layoutRef.current === "pages") goPage(1);
        else window.scrollBy({ top: Math.round(window.innerHeight * 0.75), behavior: "smooth" });
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        noteActivity();
        if (layoutRef.current === "pages") goPage(-1);
        else window.scrollBy({ top: -Math.round(window.innerHeight * 0.75), behavior: "smooth" });
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") noteActivity();
      if (event.key === "ArrowLeft") {
        if (layoutRef.current === "pages") goPage(-1);
        else if (sectionIndex > 0) navPrevSection(sectionIndex - 1);
      }
      if (event.key === "ArrowRight") {
        if (layoutRef.current === "pages") goPage(1);
        else if (sectionIndex + 1 < sectionTotal) navNextSection(sectionIndex + 1);
      }
      if (
        (event.key === "d" || event.key === "D") &&
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        lastPoint.current &&
        containerRef.current
      ) {
        const hit = extractWordAtPoint(
          lastPoint.current.x,
          lastPoint.current.y,
          containerRef.current,
          language,
        );
        if (hit) openSelection(hit);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, sheet, panelsOpen, sectionIndex, sectionTotal, navigate, goPage, noteActivity, language, handleToggleFullscreen]);

  const onWordSaved = useCallback((word: SavedWord) => {
    ttsRef.current?.noteSavedWord();
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
    const pos = latestPosition.current;
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

  // Elección inicial confirmada: el registro queda separado del
  // avance y el lector navega al destino elegido como entrada.
  const confirmStart = (choice: {
    readingTargetId: string;
    preparationTargetId: string | null;
  }) => {
    const target = catalog?.targets.find(
      (item) => item.id === choice.readingTargetId,
    );
    if (!target) return;
    setAskStart(false);
    void saveBookStart(bookHash, choice, captureDbScope()).catch(
      () => undefined,
    );
    // La primera evaluación prepara el destino registrado (p. ej. el
    // primer capítulo) aunque la lectura empiece en la intro.
    bookStartRef.current = {
      version: 1,
      readingTargetId: choice.readingTargetId,
      preparationTargetId: choice.preparationTargetId,
      updatedAt: Date.now(),
    };
    void navigate("initial", {
      index: target.sectionIndex,
      fragment: target.fragment,
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

  const refreshAnnotations = async (scope?: DbScope) => {
    setAnnotations(await listAnnotations(bookHash, scope ?? captureDbScope()));
  };

  const pushAnnotation = (entry: SavedAnnotation, scope?: DbScope) => {
    const bound = scope ?? captureDbScope();
    setAnnotations((prev) => [...prev.filter((a) => a.key !== entry.key), entry]);
    void pushAnnotationsToServer([entry], bound);
  };

  const bookmark = annotations.find((a) => a.kind === "bookmark");

  const saveBookmarkHere = async () => {
    const container = containerRef.current;
    const metrics = metricsRef.current;
    const anchor = container
      ? layoutRef.current === "pages" && metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : (anchorAtViewTop(container) ?? undefined)
      : undefined;
    const scope = captureDbScope();
    pushAnnotation(
      await saveAnnotation(makeBookmark(bookHash, sectionIndex, anchor), scope),
      scope,
    );
    onStatus("Marcador guardado en este lugar.");
  };

  const removeMark = async (key: string) => {
    const scope = captureDbScope();
    const tombstone = await removeAnnotation(key, scope);
    if (tombstone) void pushAnnotationsToServer([tombstone], scope);
    await refreshAnnotations(scope);
    onStatus("Marcado eliminado.");
  };

  const saveNote = async (annotation: SavedAnnotation) => {
    const scope = captureDbScope();
    const updated = await updateAnnotation(
      {
        ...annotation,
        note: noteDraft.trim() || undefined,
      },
      scope,
    );
    pushAnnotation(updated, scope);
    setEditingNote(null);
  };

  // La selección del usuario se convierte en pasaje con su contexto
  // para reubicarlo aunque cambie la letra o el ancho.
  const savePassageSelection = async (color: PassageTone = "amber") => {
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
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);
    const input = makePassage(
      bookHash,
      sectionIndex,
      sel.toString(),
      before.toString(),
      after.toString(),
      color,
    );
    sel.removeAllRanges();
    setSelButton(null);
    if (!input) return;
    const scope = captureDbScope();
    pushAnnotation(await saveAnnotation(input, scope), scope);
    const toneName = color === "salvia" ? "Salvia" : color === "dario" ? "Azul Darío" : "Ámbar";
    onStatus(`Pasaje resaltado con tinta (${toneName}).`);
  };

  const openQuoteCardFromSelection = () => {
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || !sel.rangeCount) {
      setSelButton(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2) {
      setSelButton(null);
      return;
    }
    setQuoteCard({
      text,
      bookTitle: title,
      author,
      chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
      alreadySaved: false,
    });
    setSelButton(null);
  };

  const askCatAboutSelection = async () => {
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || !sel.rangeCount) {
      setSelButton(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2) {
      setSelButton(null);
      return;
    }
    sel.removeAllRanges();
    setSelButton(null);

    setCatPassageExplanation({
      passage: text,
      loading: true,
      data: null,
      error: null,
    });

    if (!signedIn) {
      setCatPassageExplanation({
        passage: text,
        loading: false,
        data: {
          contextualMeaning: `Apreciación del fragmento: «${text.slice(0, 100)}...»`,
          toneAndNuance: "Literario",
          catTip: "Inicia sesión para recibir lecturas profundas con IA en vivo.",
        },
        error: null,
      });
      return;
    }

    try {
      const scope = captureDbScope();
      const res = await explainInPassage(
        {
          sentence: text,
          bookTitle: title,
          author,
          language,
        },
        scope,
      );
      if (res.ok) {
        setCatPassageExplanation({
          passage: text,
          loading: false,
          data: {
            contextualMeaning: res.contextualMeaning,
            toneAndNuance: res.toneAndNuance,
            catTip: res.catTip,
          },
          error: null,
        });
      } else {
        setCatPassageExplanation({
          passage: text,
          loading: false,
          data: {
            contextualMeaning: `Apreciación del fragmento: «${text.slice(0, 120)}»`,
            toneAndNuance: "Literario",
            catTip: "No pudimos conectar con la IA en este momento, pero disfruta de este pasaje.",
          },
          error: null,
        });
      }
    } catch {
      setCatPassageExplanation({
        passage: text,
        loading: false,
        data: null,
        error: "No se pudo consultar al gato literario.",
      });
    }
  };

  const savePassageDirectly = async (text: string) => {
    const input = makePassage(bookHash, sectionIndex, text);
    if (!input) return;
    const scope = captureDbScope();
    pushAnnotation(await saveAnnotation(input, scope), scope);
    onStatus("Pasaje guardado en Marcadores y Cuaderno.");
  };

  const sectionLabel = (index: number) =>
    tocRows.find((row) => row.index === index)?.label ?? `Sección ${index + 1}`;

  const passages = annotations.filter((a) => a.kind === "passage");

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
      } else if (patch.focusRuler === false && patch.paragraphFocus === false) {
        next.focusRuler = false;
        next.paragraphFocus = false;
        if (next.syntacticLines) {
          next.focusMode = "syntactic";
        } else {
          next.focusMode = "off";
        }
      } else if (next.paragraphFocus) {
        next.focusMode = "paragraph";
      } else if (next.focusRuler) {
        next.focusMode = "ruler";
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


  const onToggleSyntacticLines = (checked: boolean) => {
    updateSettings({
      syntacticLines: checked,
      strategyPreset: "custom",
    });
  };

  const onToggleChromaticGuide = (checked: boolean) => {
    updateSettings({
      chromaticGuide: checked,
      strategyPreset: "custom",
    });
  };

  const onSelectChromaPalette = (palette: ChromaticPalette) => {
    updateSettings({
      chromaticPalette: palette,
      strategyPreset: "custom",
    });
  };

  const onToggleBionicAnchors = (checked: boolean) => {
    updateSettings({
      bionicAnchors: checked,
      strategyPreset: "custom",
    });
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
      className="reader"
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
      <header
        className={`reader-bar ${isZenFaded ? "reader-head--faded" : ""}`.trim()}
        data-zen-faded={isZenFaded || undefined}
        data-hidden={!barsShown || undefined}
      >
        <button
          type="button"
          className="btn--quiet reader-back"
          onClick={onBack}
          aria-label="Volver a la estantería"
        >
          <Icon name="back" size={18} />
          <span className="reader-back-label"> Estantería</span>
        </button>
        <p className="reader-bar-title" title={currentChapterTarget?.label || sectionTitle || title || fileName}>
          {currentChapterTarget?.label || sectionTitle || title || fileName}
          {author ? <span className="reader-bar-author"> · {author}</span> : null}
        </p>
        <div className="reader-bar-progress" aria-hidden="true">
          <ProgressInk
            value={Math.round(progress * 100)}
            max={100}
            variant="vermilion"
            ariaValueText={`${Math.round(progress * 100)}% del libro`}
          />
        </div>
        <div className="reader-bar-actions">
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={() => openSheet("toc")}
            aria-label="Índice del libro"
            title="Índice (T)"
          >
            <Icon name="index" size={20} />
            <span className="reader-btn-text">Índice</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn reader-bar-btn--settings"
            onClick={() => openSettings("strategy")}
            aria-label="Ajustes de lectura y apariencia"
            title="Ajustes de lectura (Aa / ✨)"
          >
            <span className="reader-btn-icon reader-btn-icon--aa" aria-hidden="true">Aa</span>
            <Icon name="sparkles" size={14} />
            <span className="reader-btn-text">Lectura</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={onOpenNotebook}
            aria-label="Abrir Cuaderno de vocabulario"
            title="Cuaderno"
          >
            <Icon name="notebook" size={20} />
            <span className="reader-btn-text">Cuaderno</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn reader-bar-btn--more"
            onClick={() => openSettings("book")}
            aria-label="Opciones del libro"
            title="Opciones del libro"
          >
            <Icon name="more" size={20} />
            <span className="reader-btn-text">Libro</span>
          </button>
        </div>
      </header>

      <div
        className={`reader-body reader__stage ${settings.chromaticGuide && !strategyPaused ? "reader__stage--chromatic" : ""}`}
        data-strategy-contrast={settings.strategyContrast}
        data-has-floating-bar={ttsSnap.status !== "idle" || (settings.visualPacer && !strategyPaused) ? "true" : undefined}
      >
        {state === "opening" && !title ? (
          <p className="reader-loading">Abriendo libro…</p>
        ) : null}
        {state === "error" ? (
          <div className="reader-error">
            <p>No pudimos abrir esta sección del libro.</p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => void navigate("chapter", { index: sectionIndex, restore: { ratio: 0 } })}
              >
                Intentar de nuevo
              </button>
              <button type="button" className="btn--quiet" onClick={onBack}>
                Volver a la estantería
              </button>
            </div>
          </div>
        ) : null}
        {state === "ready" && sectionWords === 0 && !sectionHasImages ? (
          <p className="reader-empty meta">
            Esta sección no tiene texto legible (puede ser una portada o una imagen).
          </p>
        ) : null}
        {showChapterTitle ? <h1 className="chapter-title">{sectionTitle}</h1> : null}
        {recapBubbleVisible ? (
          <ReaderRecapBubble
            recapBullets={recapBubbleBullets}
            isLoading={recapBubbleLoading}
            onDismiss={() => setRecapBubbleVisible(false)}
            onTriggerRecap={handleTriggerReturnRecap}
          />
        ) : null}
        <div className="page-viewport" ref={viewportRef}>
          <div
            ref={containerRef}
            className={`book-content reader__stage ${settings.chromaticGuide && !strategyPaused ? "reader__stage--chromatic" : ""}`}
            data-focus-mode={strategyPaused ? "off" : settings.focusMode}
            data-paragraph-focus={
              (!strategyPaused && (settings.paragraphFocus || settings.focusMode === "paragraph")) || undefined
            }
            data-strategy-preset={settings.strategyPreset}
            data-strategy-contrast={settings.strategyContrast}
            data-strategy-paused={strategyPaused || undefined}
            data-has-floating-bar={ttsSnap.status !== "idle" || (settings.visualPacer && !strategyPaused) ? "true" : undefined}
            data-hide-indicators={
              settings.hideSecondaryIndicators || settings.strategyPreset === "immersive" || undefined
            }
            style={
              settings.layout === "pages" && pageMetrics
                ? ({
                    inlineSize: `${pageMetrics.boxW}px`,
                    blockSize: "100%",
                    columnWidth: `${pageMetrics.colW}px`,
                    columnGap: `${pageMetrics.gap}px`,
                    columnFill: "auto",
                    "--page-x": `${-page * pageAdvance(pageMetrics.boxW, pageMetrics.gap)}px`,
                  } as CSSProperties)
                : undefined
            }
            lang={language}
            onDoubleClick={handleContainerDoubleClick}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return;
            if (!strategyPaused && (settings.focusMode === "paragraph" || settings.paragraphFocus)) {
              const block = (event.target as HTMLElement).closest("p, blockquote, li");
              if (block && container.contains(block)) {
                focusBlock(container, block);
              }
            }
            if (settings.visualPacer) {
              const chunk = (event.target as HTMLElement).closest<HTMLElement>(".lecta-syntactic-chunk");
              if (chunk && container.contains(chunk)) {
                const allChunks = Array.from(container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"));
                const idx = allChunks.indexOf(chunk);
                if (idx >= 0) {
                  pacerIndexRef.current = idx;
                  allChunks.forEach((c, i) => {
                    if (i === idx) c.classList.add("lecta-pacer-active");
                    else c.classList.remove("lecta-pacer-active");
                  });
                }
              }
            }
            // Los enlaces internos del EPUB (notas al pie, índice)
            // apuntan a rutas que no existen en la app: no navegar.
            if ((event.target as HTMLElement).closest("a")) event.preventDefault();

            const isTouch =
              lastPointerTypeRef.current === "touch" ||
              lastPointerTypeRef.current === "pen" ||
              (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
            const sel = window.getSelection();
            const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0;

            if (isTouch) {
              // En táctil (modelo Kindle):
              // Track 5: Detección de doble toque en táctil para traducir párrafo si el libro está en inglés
              if (language === "en") {
                const target = event.target as HTMLElement;
                const p = target.closest<HTMLElement>("p, blockquote");
                const now = Date.now();
                if (p && lastTapRef.current.element === p && now - lastTapRef.current.time < 350) {
                  lastTapRef.current = { time: 0, element: null };
                  void toggleParagraphTranslation(p);
                  return;
                }
                lastTapRef.current = { time: now, element: p };
              }

              if (selection) {
                setSelection(null);
                return;
              }

              // 1. Si hay una selección de texto activa, el toque solo la limpia
              if (hasSelection) {
                sel.removeAllRanges();
                return;
              }

              // 2. Navegación táctil en páginas: 25% bordes pasa página, centro alterna barras
              if (settings.layout === "pages") {
                const viewport = viewportRef.current ?? container;
                const rect = viewport.getBoundingClientRect();
                const zone = tapZone(event.clientX, rect);
                if (zone === "next") {
                  void goPage(1);
                } else if (zone === "prev") {
                  void goPage(-1);
                } else {
                  setBarsVisible((v) => !v);
                }
              } else {
                setBarsVisible((v) => !v);
              }
            } else {
              // En ratón (escritorio):
              // Riesgo 5: al soltar tras seleccionar texto, no abrir la ficha de palabra
              if (hasSelection) {
                return;
              }

              const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
              if (hit) {
                openSelection(hit);
              } else {
                if (settings.layout === "pages") {
                  const viewport = viewportRef.current ?? container;
                  const rect = viewport.getBoundingClientRect();
                  const zone = tapZone(event.clientX, rect);
                  if (zone === "next") {
                    void goPage(1);
                  } else if (zone === "prev") {
                    void goPage(-1);
                  } else {
                    setBarsVisible((v) => !v);
                  }
                } else {
                  setBarsVisible(true);
                }
              }
            }
          }}
          onPointerMove={(event) => {
            lastPoint.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerDown={(event) => {
            noteActivity();
            lastPointerTypeRef.current = event.pointerType;
            if (showLongPressHint) {
              setShowLongPressHint(false);
              void saveSessionValue("hint:longPress:v1", "1", captureDbScope()).catch(() => undefined);
            }
          }}
          aria-busy={state === "opening"}
          aria-label="Contenido de la sección"
        />
        </div>
        {settings.layout === "pages" ? (
          <>
            {chapterEndCard}
          <nav className="page-nav" aria-label="Navegación de páginas">
            <button
              type="button"
              className="page-nav-btn"
              disabled={sectionIndex === 0 && page === 0}
              onClick={() => {
                triggerHaptic("selection");
                void goPage(-1);
              }}
              aria-label="Página anterior"
            >
              <span aria-hidden="true">‹</span> Anterior
            </button>
            <div className="page-nav-center">
              <span className="page-nav-count meta" aria-live="polite">
                {pageCount ? `Página ${page + 1} de ${pageCount}` : ""}
              </span>
              {pageCount > 1 ? (
                <div className="thread page-nav-thread" aria-hidden="true">
                  <div
                    className="thread-fill"
                    style={{ "--thread-value": `${Math.round(((page + 1) / pageCount) * 100)}%` } as CSSProperties}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="page-nav-btn"
              disabled={sectionIndex + 1 >= sectionTotal && page + 1 >= pageCount}
              onClick={() => {
                triggerHaptic("selection");
                void goPage(1);
              }}
              aria-label="Página siguiente"
            >
              Siguiente <span aria-hidden="true">›</span>
            </button>
          </nav>
          </>
        ) : (
          <>
            {chapterEndCard}
          <nav className="reader-end" aria-label="Navegación de secciones">
            {prevRow != null || sectionIndex > 0 ? (
              <button
                type="button"
                className="reader-end-link"
                onClick={() => {
                  if (prevRow) {
                    navPrevSection(prevRow.index, prevRow.fragment);
                  } else {
                    navPrevSection(sectionIndex - 1);
                  }
                }}
              >
                ← {prevRow?.label ?? "Anterior"}
              </button>
            ) : (
              <span />
            )}
            {nextRow != null || sectionIndex + 1 < sectionTotal ? (
              <button
                type="button"
                className="reader-end-link"
                onClick={() => {
                  if (nextRow) {
                    navNextSection(nextRow.index, nextRow.fragment);
                  } else {
                    navNextSection(sectionIndex + 1);
                  }
                }}
              >
                Siguiente: {nextRow?.label ?? `Sección ${sectionIndex + 2}`} →
              </button>
            ) : (
              <span className="reader-end-done meta">Fin del libro</span>
            )}
          </nav>
          </>
        )}
      </div>

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

      {/* Marcador de retomar: máxima prioridad en la franja — es el
          mensaje de apertura cuando el libro llevaba días cerrado.
          Mientras está visible, el resto de avisos espera; al
          descartarlo vuelven a su orden normal. */}
      {resumeCard ? (
        <div className="reader-prep" role="status">
          <span className="reader-prep-text">
            {resumeCard.label
              ? `Quedaste en «${resumeCard.label}» ${resumeCard.lastReadText}.`
              : `La última vez que abriste este libro fue ${resumeCard.lastReadText}.`}
            {resumeCard.savedInRange > 0
              ? ` Guardaste ${resumeCard.savedInRange} palabra(s) en este tramo.`
              : ""}
          </span>
          {resumeCard.rereadTo ? (
            <button
              type="button"
              className="btn reader-prep-open"
              onClick={rereadChapter}
            >
              Releer el capítulo
            </button>
          ) : null}
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={() => setResumeCard(null)}
            aria-label="Seguir leyendo"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Pastilla discreta "Antes de leer" arriba del texto del capítulo (Regla 2 Zero-Friction) */}
      {prepNotice && !prep && !resumeCard && !isDeepReading && barsShown ? (
        <div className="reader-section-preview-pill-container" role="status">
          <SectionPreview
            mode="pill"
            words={Array.from({ length: prepNotice.count ?? 0 })}
            onExpand={openPrepManual}
          />
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={dismissPrepNotice}
            aria-label="Ocultar aviso de vocabulario"
            style={{ marginLeft: "0.25rem" }}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Invitación a la prueba de vocabulario: misma franja fija que
          el aviso de preparación, fuera del texto; conviven solo una
          por diseño (la de preparación tiene preferencia). Persiste
          hasta aceptar o decir «Ahora no». */}
      {calNotice && !prep && !prepNotice && !resumeCard && !isDeepReading ? (
        <div className="reader-prep" role="status">
          <span className="reader-prep-text">
            Ajusta qué palabras te sugiere Lecta antes de cada capítulo.
          </span>
          <button
            type="button"
            className="btn reader-prep-open"
            onClick={() => void acceptCalibrationNotice()}
          >
            Ajustar mi vocabulario
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={dismissCalibrationNotice}
            aria-label="Ahora no"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Pausa 20-20-20: el detector de fatiga (retrocesos tras un
          tramo largo) la dispara; se descarta al entenderla. */}
      {fatigueNotice && !resumeCard && !isDeepReading ? (
        <div className="reader-prep" role="status">
          <span className="reader-prep-text">
            Has retrocedido varias veces en el último rato. Descansa la
            vista: mira algo lejano unos 20 segundos.
          </span>
          <button
            type="button"
            className="btn reader-prep-open"
            onClick={() => setFatigueNotice(false)}
          >
            Entendido
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={() => setFatigueNotice(false)}
            aria-label="Ocultar sugerencia de descanso"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* SmartReaderDock (Track 2): Dock Inteligente Único que muta entre Lectura, Audio y Lienzo Puro */}
      {state === "ready" && !isDeepReading ? (
        <SmartReaderDock
          progressText={
            settings.layout === "pages"
              ? `Pág. ${page + 1} de ${pageCount || 1}${minutes > 0 ? ` · ~${minutes} min` : ""}`
              : `Cap. ${sectionIndex + 1} de ${sectionTotal || 1}${minutes > 0 ? ` · ~${minutes} min` : ""}`
          }
          errorText={errorText ?? undefined}
          isPureCanvas={!barsShown}
          onExitPureCanvas={() => setBarsVisible(true)}
          activePreset={detectActiveReadingPreset(settings)}
          onSelectPreset={(preset) => {
            triggerHaptic("selection");
            setStrategyPaused(false);
            updateSettings(applyReadingPreset(settings, preset));
          }}
          onOpenAdvancedSettings={() => {
            setSettingsTab("strategy");
            setSheet("settings");
          }}
          onStartAudio={onTtsRequest}
          onRecap={handleRecapClick}
          companionSlot={
            catShown && catState ? (
              <div
                className="reader-dock-cat cat-anim"
                data-out={catLeaving || undefined}
              >
                <CompanionButton
                  stage={companion.stage}
                  mood={
                    catSavedWord
                      ? "happy"
                      : catSleepy
                        ? "sleepy"
                        : "awake"
                  }
                  accessories={companion.accessories}
                  focus={
                    catSavedWord
                      ? "celebrating"
                      : isDeepReading
                        ? "deep_focus"
                        : catSleepy
                          ? "sleep"
                          : selection
                            ? "curious"
                            : catState
                  }
                  gazeProgress={
                    settings.layout === "pages"
                      ? pageCount > 1
                        ? page / (pageCount - 1)
                        : 0
                      : scrollRatio
                  }
                  pose={
                    isDeepReading
                      ? undefined
                      : catTap
                        ? "celebrate"
                        : catSavedWord
                          ? "celebrate"
                          : catGreeting
                            ? "greet"
                            : undefined
                  }
                  label={`Ver a ${companion.name}`}
                  onClick={onCatTap}
                  bubbleMessage={stallBubble}
                  onBubbleClick={onStallBubbleClick}
                />
              </div>
            ) : null
          }
          ttsSnap={ttsSnap}
          onTogglePlayPause={() => {
            const ctl = ttsRef.current;
            if (!ctl) return;
            if (ttsSnap.status === "speaking") ctl.pause("user");
            else if (ttsSnap.status === "paused") ctl.resume();
          }}
          onPrevSentence={() => ttsRef.current?.prevSentence()}
          onNextSentence={() => ttsRef.current?.nextSentence()}
          onCycleSpeed={() => void ttsRef.current?.cycleRate(TTS_PLAYER_RATES)}
          onOpenVoiceSelector={() => setTtsConsentOpen(true)}
          onCaptureWord={handleTtsCaptureWord}
          onStopAudio={() => ttsRef.current?.stop("user")}
          onOpenCatCorner={onCatTap}
        />
      ) : null}

      {/* Regla de enfoque: velo de papel con una franja clara que
          sigue al puntero; la patita del gato ancla el margen. Con
          presencia «off» o el gato suprimido por esta lectura la
          decoración también se va: no queda rastro del gato. */}
      {!strategyPaused && (settings.focusRuler || settings.focusMode === "ruler") && !settings.paragraphFocus && state === "ready" ? (
        <FocusRuler
          bandPx={rulerBandPx(
            settings.rulerSize,
            settings.size * settings.leading,
          )}
          lineHeightPx={settings.size * settings.leading}
          anchor={
            catEnabled && presenceMode !== "off" && !catSuppressed ? (
              <Companion
                stage={companion.stage}
                mood="awake"
                accessories={companion.accessories}
                focus={catState ?? "reading"}
                decorative
              />
            ) : undefined
          }
        />
      ) : null}
      {isDeepReading && deepReading ? (
        <>
          <aside
            className="reader-deep-indicator"
            aria-label="Sesión de retiro de lectura"
          >
            <span className="reader-deep-indicator-text">
              {deepReading.targetEndedAt
                ? formatRemainingTime(
                    Math.max(
                      0,
                      deepReading.targetMinutes * 60_000 - deepReading.elapsedMs,
                    ),
                  )
                : `${formatElapsedMinutes(deepReading.elapsedMs)} en retiro`}
            </span>
            <button
              type="button"
              className="reader-deep-indicator-btn"
              onClick={() => void finishDeepReading(false)}
              aria-label="Concluir retiro de lectura"
            >
              Concluir
            </button>
          </aside>
          <div
            className="reader-deep-thread"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progreso general en retiro"
          >
            <div
              className="reader-deep-thread-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </>
      ) : null}


      {sheet === "toc" ? (
        <Sheet label="Índice" onClose={closeSheet} side="left">
          <div className="sheet-head">
            <strong className="sheet-title">Índice</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar índice"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          {tocRows.length ? (
            <ul className="toc-list">
              {tocRows.map((row, i) => {
                const isCurrent =
                  (currentChapterTarget?.id ??
                    targetAt(catalog?.ranges ?? [], sectionIndex, activeIntraContext)?.id) ===
                  row.target.id;
                return (
                <li key={`${row.index}-${i}`} style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}>
                  <button
                    type="button"
                    className="toc-item"
                    data-current={isCurrent || undefined}
                    aria-current={isCurrent ? "location" : undefined}
                    onClick={() =>
                      jumpTo(
                        row.index,
                        { fragment: row.target.fragment },
                        "chapter",
                      )
                    }
                  >
                    {row.label}
                  </button>
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="meta">Este libro no trae índice.</p>
          )}
          <button
            type="button"
            className="btn--quiet toc-vocab"
            onClick={() => setSheet("marks")}
          >
            Marcadores y pasajes
            {annotations.length ? ` · ${annotations.length}` : ""}
          </button>
          <button
            type="button"
            className="btn--quiet toc-vocab"
            onClick={() => {
              closeSheet();
              setGlossaryOpen(true);
            }}
          >
            Glosario y singularidades de la obra
          </button>
        </Sheet>
      ) : null}

      {sheet === "search" ? (
        <Sheet label="Buscar en el libro" onClose={closeSheet} side="left">
          <div className="sheet-head">
            <strong className="sheet-title">Buscar en el libro</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar búsqueda"
            >
              Cerrar
            </button>
          </div>
          <input
            className="search-input"
            type="search"
            placeholder="Palabra o frase…"
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
            aria-label="Texto a buscar en el libro"
            data-autofocus
          />
          {searchQ.trim().length >= 2 ? (
            <p className="meta search-status" role="status">
              {searchDone
                ? searchHits.length
                  ? `${searchHits.length} resultado(s)${searchHits.length >= 100 ? " (primeros 100)" : ""}`
                  : "Sin resultados."
                : `Buscando… ${searchHits.length ? `${searchHits.length} hasta ahora` : ""}`}
            </p>
          ) : (
            <p className="meta search-status">
              Escribe al menos 2 letras. Los acentos y las mayúsculas no importan.
            </p>
          )}
          {searchHits.length ? (
            <ul className="search-results">
              {searchHits.map((hit, index) => (
                <li key={`${hit.sectionIndex}-${index}`}>
                  <button
                    type="button"
                    className="search-hit"
                    onClick={() => jumpTo(hit.sectionIndex, { snippet: hit.anchor })}
                  >
                    <span className="search-hit-label">{hit.label}</span>
                    <span className="search-hit-context">
                      {hit.before}
                      <mark>{hit.match}</mark>
                      {hit.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === "marks" ? (
        <Sheet label="Marcadores y pasajes" onClose={closeSheet} side="left">
          <div className="sheet-head">
            <strong className="sheet-title">Marcadores</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar marcadores"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          {bookmark ? (
            <div className="mark-bookmark">
              <p>
                Marcador en <strong>{sectionLabel(bookmark.sectionIndex)}</strong>
              </p>
              <div className="mark-actions">
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => jumpTo(bookmark.sectionIndex, { anchor: bookmark.anchor })}
                >
                  Ir al marcador
                </button>
                <button
                  type="button"
                  className="btn--quiet mark-remove"
                  onClick={() => void removeMark(bookmark.key)}
                >
                  Quitar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => void saveBookmarkHere()}>
              Guardar este lugar
            </button>
          )}
          <h3 className="sheet-subtitle">Pasajes guardados</h3>
          {passages.length ? (
            <ul className="marks-list">
              {passages.map((passage) => (
                <li key={passage.key} className="mark-item">
                  <button
                    type="button"
                    className="mark-jump"
                    onClick={() =>
                      jumpTo(passage.sectionIndex, {
                        snippet: passage.anchor ?? passage.text ?? "",
                      })
                    }
                  >
                    <span className="search-hit-label">
                      {sectionLabel(passage.sectionIndex)}
                    </span>
                    <q className="mark-text">
                      {passage.text && passage.text.length > 140
                        ? `${passage.text.slice(0, 140)}…`
                        : passage.text}
                    </q>
                  </button>
                  {passage.note ? <p className="mark-note">{passage.note}</p> : null}
                  {editingNote === passage.key ? (
                    <div className="mark-note-edit">
                      <textarea
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="Una nota sobre este pasaje…"
                        aria-label="Nota del pasaje"
                      />
                      <div className="mark-actions">
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => void saveNote(passage)}
                        >
                          Guardar nota
                        </button>
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => setEditingNote(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mark-actions">
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => {
                          setQuoteCard({
                            text: passage.text ?? "",
                            bookTitle: title,
                            author,
                            chapterTitle: sectionLabel(passage.sectionIndex),
                            alreadySaved: true,
                          });
                        }}
                      >
                        Tarjeta
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => {
                          setEditingNote(passage.key);
                          setNoteDraft(passage.note ?? "");
                        }}
                      >
                        {passage.note ? "Editar nota" : "Nota"}
                      </button>
                      <button
                        type="button"
                        className="btn--quiet mark-remove"
                        onClick={() => void removeMark(passage.key)}
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">
              Selecciona un fragmento del texto para guardarlo como pasaje.
            </p>
          )}
          {passages.length ? (
            <button
              type="button"
              className="btn--quiet"
              style={{ marginTop: "var(--s-3)", width: "100%", justifyContent: "center" }}
              onClick={() => {
                triggerHaptic("selection");
                void downloadBookMarkdown(bookHash, title);
              }}
            >
              Exportar notas y citas (.md)
            </button>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === "settings" ? (
        <Sheet label="Opciones de lectura" onClose={closeSheet}>
          <div className="sheet-head">
            <strong className="sheet-title">Opciones de lectura</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar opciones"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          <div className="sheet-tabs" role="tablist" aria-label="Categorías de opciones">
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "strategy"}
              className="sheet-tab"
              data-active={settingsTab === "strategy" || undefined}
              onClick={() => setSettingsTab("strategy")}
            >
              Estrategia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "appearance"}
              className="sheet-tab"
              data-active={settingsTab === "appearance" || undefined}
              onClick={() => setSettingsTab("appearance")}
            >
              Apariencia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "book"}
              className="sheet-tab"
              data-active={settingsTab === "book" || undefined}
              onClick={() => setSettingsTab("book")}
            >
              Libro
            </button>
          </div>

          {/* Pestaña 1: Estrategia */}
          {settingsTab === "strategy" ? (
            <div role="tabpanel" aria-label="Estrategia" className="sheet-panel">
              <div className="strategy-grid" role="radiogroup" aria-label="Modos de lectura">
                {READING_STRATEGY_PRESETS.map((preset) => {
                  const isActive = isStrategyPresetActive(preset.id, settings);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      data-active={isActive ? "true" : undefined}
                      className="strategy-card"
                      onClick={() => selectStrategyPreset(preset.id)}
                    >
                      <div className="strategy-card-header">
                        <Icon name={preset.icon} size={20} />
                        <strong className="strategy-card-title">{preset.title}</strong>
                      </div>
                      <p className="strategy-card-desc">{preset.description}</p>
                    </button>
                  );
                })}
              </div>

              <details className="strategy-accordion">
                <summary>
                  <span>Ajuste fino de estrategias</span>
                  <span className="strategy-accordion-hint">Personalizar</span>
                </summary>
                <div className="strategy-accordion-body">
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Guía Cromática (BeeLine)</span>
                      <span className="setting-subtext">Gradiente de barrido ocular para retorno de línea</span>
                    </div>
                    <Toggle
                      label="Guía Cromática"
                      checked={settings.chromaticGuide}
                      onChange={onToggleChromaticGuide}
                    />
                  </div>
                  {settings.chromaticGuide ? (
                    <div className="setting-row setting-row--sub">
                      <span className="setting-label">Paleta cromática</span>
                      <div
                        className="segmented segmented--palette"
                        role="group"
                        aria-label="Paleta cromática"
                      >
                        {CHROMATIC_PALETTES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            data-active={settings.chromaticPalette === p.id || undefined}
                            aria-pressed={settings.chromaticPalette === p.id}
                            onClick={() => onSelectChromaPalette(p.id)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          >
                            <span
                              style={{
                                display: "inline-block",
                                width: "10px",
                                height: "10px",
                                borderRadius: "50%",
                                background: `linear-gradient(135deg, ${p.preview[0]}, ${p.preview[1]})`,
                              }}
                              aria-hidden="true"
                            />
                            <span>{p.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Líneas Sintácticas</span>
                      <span className="setting-subtext">
                        Corta el texto en unidades con sentido (recomendado junto a Guía Cromática para TDAH)
                      </span>
                    </div>
                    <Toggle
                      label="Líneas Sintácticas"
                      checked={settings.syntacticLines}
                      onChange={onToggleSyntacticLines}
                    />
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Anclajes Biónicos</span>
                      <span className="setting-subtext">Resalta las letras iniciales para fijación ocular ágil</span>
                    </div>
                    <Toggle
                      label="Anclajes Biónicos"
                      checked={settings.bionicAnchors}
                      onChange={onToggleBionicAnchors}
                    />
                  </div>

                  <div className="setting-row setting-row--stack">
                    <div className="setting-info">
                      <span className="setting-label">Contraste de ayudas</span>
                      <span className="setting-subtext">Calibración de luminancia visual para Neuro-Enfoque y Guía Cromática</span>
                    </div>
                    <div
                      className="segmented segmented--contrast"
                      role="group"
                      aria-label="Contraste de ayudas"
                    >
                      <button
                        type="button"
                        data-active={settings.strategyContrast === "soft" ? true : undefined}
                        aria-pressed={settings.strategyContrast === "soft"}
                        onClick={() => updateSettings({ strategyContrast: "soft" })}
                      >
                        Suave
                      </button>
                      <button
                        type="button"
                        data-active={settings.strategyContrast === "balanced" ? true : undefined}
                        aria-pressed={settings.strategyContrast === "balanced"}
                        onClick={() => updateSettings({ strategyContrast: "balanced" })}
                      >
                        Nítido
                      </button>
                      <button
                        type="button"
                        data-active={settings.strategyContrast === "high" ? true : undefined}
                        aria-pressed={settings.strategyContrast === "high"}
                        onClick={() => updateSettings({ strategyContrast: "high" })}
                      >
                        Intenso (AAA)
                      </button>
                    </div>
                  </div>

                  <div className="setting-row setting-row--stack">
                    <div className="setting-info">
                      <span className="setting-label">Foco de Iluminación</span>
                      <span className="setting-subtext">Aísla el texto y guía la atención visual sin colisiones</span>
                    </div>
                    <div
                      className="segmented segmented--wrap segmented--illumination"
                      role="group"
                      aria-label="Foco de Iluminación"
                    >
                      <button
                        type="button"
                        data-active={
                          !settings.paragraphFocus && !settings.focusRuler
                            ? true
                            : undefined
                        }
                        aria-pressed={!settings.paragraphFocus && !settings.focusRuler}
                        onClick={() =>
                          updateSettings({
                            focusRuler: false,
                            paragraphFocus: false,
                            strategyPreset: "custom",
                          })
                        }
                      >
                        Sin máscara
                      </button>
                      <button
                        type="button"
                        data-active={
                          !settings.paragraphFocus &&
                          settings.focusRuler &&
                          settings.rulerSize === 1
                            ? true
                            : undefined
                        }
                        aria-pressed={
                          !settings.paragraphFocus &&
                          settings.focusRuler &&
                          settings.rulerSize === 1
                        }
                        onClick={() =>
                          updateSettings({
                            focusRuler: true,
                            rulerSize: 1,
                            paragraphFocus: false,
                            strategyPreset: "custom",
                          })
                        }
                      >
                        Franja 1 línea
                      </button>
                      <button
                        type="button"
                        data-active={
                          !settings.paragraphFocus &&
                          settings.focusRuler &&
                          (settings.rulerSize === 3 || (!settings.rulerSize && settings.rulerSize !== 1))
                            ? true
                            : undefined
                        }
                        aria-pressed={
                          !settings.paragraphFocus &&
                          settings.focusRuler &&
                          (settings.rulerSize === 3 || (!settings.rulerSize && settings.rulerSize !== 1))
                        }
                        onClick={() =>
                          updateSettings({
                            focusRuler: true,
                            rulerSize: 3,
                            paragraphFocus: false,
                            strategyPreset: "custom",
                          })
                        }
                      >
                        Franja 3 líneas
                      </button>
                      <button
                        type="button"
                        data-active={
                          settings.paragraphFocus ||
                          (settings.focusRuler && settings.rulerSize === "paragraph")
                            ? true
                            : undefined
                        }
                        aria-pressed={
                          settings.paragraphFocus ||
                          (settings.focusRuler && settings.rulerSize === "paragraph")
                        }
                        onClick={() =>
                          updateSettings({
                            paragraphFocus: true,
                            focusRuler: false,
                            strategyPreset: "custom",
                          })
                        }
                      >
                        Párrafo activo
                      </button>
                    </div>
                  </div>

                  <div className="setting-row setting-row--stack">
                    <div className="setting-info">
                      <span className="setting-label">Paisaje Sonoro de Concentración</span>
                      <span className="setting-subtext">Sonidos ambientales procedurales para TDAH y flujo inmersivo</span>
                    </div>
                    <div
                      className="segmented segmented--wrap segmented--soundscape"
                      role="group"
                      aria-label="Paisaje Sonoro de Concentración"
                    >
                      {[
                        { id: "none", label: "Sin sonido" },
                        { id: "purr", label: "Ronroneo" },
                        { id: "rain", label: "Lluvia" },
                        { id: "hearth", label: "Chimenea" },
                        { id: "night_library", label: "Biblioteca" },
                      ].map((item) => {
                        const currentSound =
                          settings.soundscape || (settings.ambientPurr ? "purr" : "none");
                        const active = currentSound === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-active={active ? true : undefined}
                            aria-pressed={active}
                            onClick={() => {
                              updateSettings({
                                soundscape: item.id as SoundscapeSetting,
                                ambientPurr: item.id === "purr",
                                strategyPreset: "custom",
                              });
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Ritmo Guiado (Marcapasos Visual)</span>
                      <span className="setting-subtext">
                        Acompaña la lectura saltando entre unidades sintácticas a velocidad constante (TDAH)
                      </span>
                    </div>
                    <Toggle
                      label="Ritmo Guiado"
                      checked={settings.visualPacer}
                      onChange={(checked) => {
                        updateSettings({
                          visualPacer: checked,
                          strategyPreset: "custom",
                        });
                      }}
                    />
                  </div>

                  {settings.visualPacer ? (
                    <div className="setting-row setting-row--stack">
                      <div className="setting-info">
                        <span className="setting-label">Velocidad del Ritmo Guiado</span>
                        <span className="setting-subtext">{settings.pacerWpm || 210} palabras por minuto (WPM)</span>
                      </div>
                      <div
                        className="segmented segmented--wpm"
                        role="group"
                        aria-label="Velocidad en palabras por minuto"
                      >
                        {[
                          { wpm: 160, label: "160 WPM" },
                          { wpm: 210, label: "210 WPM" },
                          { wpm: 260, label: "260 WPM" },
                          { wpm: 320, label: "320 WPM" },
                        ].map((item) => (
                          <button
                            key={item.wpm}
                            type="button"
                            data-active={(settings.pacerWpm || 210) === item.wpm ? true : undefined}
                            aria-pressed={(settings.pacerWpm || 210) === item.wpm}
                            onClick={() => {
                              updateSettings({
                                pacerWpm: item.wpm,
                                strategyPreset: "custom",
                              });
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Previsualización en vivo */}
                  <div
                    className="strategy-preview-box"
                    data-chroma-palette={settings.chromaticPalette || "editorial"}
                    data-chromatic-guide={settings.chromaticGuide ? "true" : "false"}
                    data-bionic-anchors={settings.bionicAnchors ? "true" : "false"}
                    aria-label="Previsualización de lectura"
                  >
                    {settings.syntacticLines ? (
                      <>
                        <span
                          className="syn-line lecta-syntactic-chunk"
                          data-chunk-cycle="0"
                        >
                          {settings.bionicAnchors ? (
                            <>
                              <span className="lecta-fixation-anchor">En</span> un{" "}
                              <span className="lecta-fixation-anchor">lug</span>ar de la{" "}
                              <span className="lecta-fixation-anchor">Man</span>cha,
                            </>
                          ) : (
                            "En un lugar de la Mancha,"
                          )}
                        </span>
                        <span
                          className="syn-line lecta-syntactic-chunk"
                          data-chunk-cycle="1"
                        >
                          {settings.bionicAnchors ? (
                            <>
                              de <span className="lecta-fixation-anchor">cuy</span>o{" "}
                              <span className="lecta-fixation-anchor">nom</span>bre no{" "}
                              <span className="lecta-fixation-anchor">qui</span>ero{" "}
                              <span className="lecta-fixation-anchor">acor</span>darme...
                            </>
                          ) : (
                            "de cuyo nombre no quiero acordarme..."
                          )}
                        </span>
                      </>
                    ) : (
                      <p>
                        <span
                          className="lecta-syntactic-chunk"
                          data-inline="true"
                          data-chunk-cycle="0"
                        >
                          {settings.bionicAnchors ? (
                            <>
                              <span className="lecta-fixation-anchor">En</span> un{" "}
                              <span className="lecta-fixation-anchor">lug</span>ar de la{" "}
                              <span className="lecta-fixation-anchor">Man</span>cha,{" "}
                            </>
                          ) : (
                            "En un lugar de la Mancha, "
                          )}
                        </span>
                        <span
                          className="lecta-syntactic-chunk"
                          data-inline="true"
                          data-chunk-cycle="1"
                        >
                          {settings.bionicAnchors ? (
                            <>
                              de <span className="lecta-fixation-anchor">cuy</span>o{" "}
                              <span className="lecta-fixation-anchor">nom</span>bre no{" "}
                              <span className="lecta-fixation-anchor">qui</span>ero{" "}
                              <span className="lecta-fixation-anchor">acor</span>darme...
                            </>
                          ) : (
                            "de cuyo nombre no quiero acordarme..."
                          )}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </details>

              <div className="setting-section">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Retiro de lectura</span>
                    <span className="setting-subtext">Sesión inmersiva con tiempo o páginas objetivo</span>
                  </div>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => {
                      closeSheet();
                      setDeepModal(true);
                    }}
                  >
                    Iniciar retiro
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Pestaña 2: Apariencia */}
          {settingsTab === "appearance" ? (
            <div role="tabpanel" aria-label="Apariencia" className="sheet-panel">
              <div className="setting-section">
                <span className="setting-section-label">Tema</span>
                <ThemeMenu value={theme} onChange={onThemeChange} variant="swatches" />
              </div>

              <div className="setting-section">
                <span className="setting-section-label">Tipografía</span>
                <FontCarousel
                  value={settings.font}
                  onChange={(font) => updateSettings({ font })}
                />
              </div>

              <div className="setting-section">
                <span className="setting-section-label">Tamaño y Espaciado</span>
                <StepperControl
                  label="Tamaño de letra"
                  valueText={`${settings.size} px`}
                  canDecrement={settings.size > READER_LIMITS.size.min}
                  canIncrement={settings.size < READER_LIMITS.size.max}
                  onDecrement={() => updateSettings({ size: settings.size - 1 })}
                  onIncrement={() => updateSettings({ size: settings.size + 1 })}
                  ariaDecrementLabel="Letra más pequeña"
                  ariaIncrementLabel="Letra más grande"
                />

                <StepperControl
                  label="Interlineado"
                  valueText={
                    LEADING_OPTIONS.find((o) => o.value === settings.leading)?.label ??
                    String(settings.leading)
                  }
                  canDecrement={settings.leading > LEADING_OPTIONS[0].value}
                  canIncrement={
                    settings.leading < LEADING_OPTIONS[LEADING_OPTIONS.length - 1].value
                  }
                  onDecrement={() => {
                    const idx = LEADING_OPTIONS.findIndex((o) => o.value === settings.leading);
                    if (idx > 0) updateSettings({ leading: LEADING_OPTIONS[idx - 1].value });
                    else if (idx === -1) updateSettings({ leading: LEADING_OPTIONS[0].value });
                  }}
                  onIncrement={() => {
                    const idx = LEADING_OPTIONS.findIndex((o) => o.value === settings.leading);
                    if (idx >= 0 && idx < LEADING_OPTIONS.length - 1) {
                      updateSettings({ leading: LEADING_OPTIONS[idx + 1].value });
                    } else if (idx === -1) {
                      updateSettings({ leading: LEADING_OPTIONS[LEADING_OPTIONS.length - 1].value });
                    }
                  }}
                  ariaDecrementLabel="Reducir interlineado"
                  ariaIncrementLabel="Aumentar interlineado"
                />

                <div className="setting-row">
                  <span className="setting-label">Márgenes</span>
                  <div className="segmented" role="group" aria-label="Márgenes">
                    {MARGIN_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        data-active={settings.measure === value || undefined}
                        aria-pressed={settings.measure === value}
                        onClick={() => updateSettings({ measure: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="setting-section">
                <span className="setting-section-label">Maquetación</span>
                <div className="setting-row">
                  <span className="setting-label">Modo de lectura</span>
                  <div className="segmented" role="group" aria-label="Modo de lectura">
                    <button
                      type="button"
                      data-active={settings.layout === "scroll" || undefined}
                      aria-pressed={settings.layout === "scroll"}
                      onClick={() => updateSettings({ layout: "scroll" })}
                    >
                      Desplazamiento
                    </button>
                    <button
                      type="button"
                      data-active={settings.layout === "pages" || undefined}
                      aria-pressed={settings.layout === "pages"}
                      onClick={() => updateSettings({ layout: "pages" })}
                    >
                      Por páginas
                    </button>
                  </div>
                </div>
                {settings.layout === "pages" ? (
                  <>
                    <div className="setting-row">
                      <span className="setting-label">Columnas</span>
                      <div className="segmented" role="group" aria-label="Columnas por página">
                        {(
                          [
                            [1, "Una"],
                            [2, "Dos"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            data-active={settings.pageColumns === value || undefined}
                            aria-pressed={settings.pageColumns === value}
                            onClick={() => updateSettings({ pageColumns: value })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="meta">
                      Las flechas ← → pasan página. Si algo se corta, apaga
                      «Lectura por páginas» sin perder tu lugar.
                    </p>
                  </>
                ) : null}
                <div className="setting-row">
                  <span className="setting-label">Justificar</span>
                  <Toggle
                    label="Justificar texto"
                    checked={settings.justify}
                    onChange={(on) => updateSettings({ justify: on })}
                  />
                </div>
                <div className="setting-row">
                  <span className="setting-label">Separación silábica (guiones)</span>
                  <Toggle
                    label="Separación silábica"
                    checked={settings.enableHyphenation}
                    onChange={(on) => updateSettings({ enableHyphenation: on })}
                  />
                </div>
                <div className="setting-row">
                  <span className="setting-label">Letra capital</span>
                  <Toggle
                    label="Letra capital al inicio del capítulo"
                    checked={settings.dropCap}
                    onChange={(on) => updateSettings({ dropCap: on })}
                  />
                </div>
                {isFullscreenSupported() ? (
                  <div className="setting-row">
                    <span className="setting-label">Pantalla completa</span>
                    <Toggle
                      label="Modo pantalla completa"
                      checked={isFullscreenActive}
                      onChange={() => void handleToggleFullscreen()}
                    />
                  </div>
                ) : null}
                {bookOverride ? (
                  <div className="setting-row">
                    <span className="setting-label">Este libro tiene ajustes propios</span>
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={useGlobalSettings}
                    >
                      Usar mis ajustes generales
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Pestaña 3: Libro */}
          {settingsTab === "book" ? (
            <div role="tabpanel" aria-label="Libro" className="sheet-panel">
              <ReaderMoreMenu
                isOpen={true}
                embedded={true}
                onSearch={() => {
                  closeSheet();
                  openSheet("search");
                }}
                onOpenGlossary={() => {
                  closeSheet();
                  setGlossaryOpen(true);
                }}
                onCreateQuoteCard={handleCreateQuoteCard}
                onExportBook={handleExportBook}
                bookHash={bookHash}
                language={language}
                onToggleTts={onTtsRequest}
                ttsActive={ttsSnap.status !== "idle"}
                ttsSupported={isTtsSupported()}
                onToggleFullscreen={() => void handleToggleFullscreen()}
                isFullscreen={isFullscreenActive}
                fullscreenSupported={isFullscreenSupported()}
                onOpenRetreat={() => {
                  closeSheet();
                  setDeepModal(true);
                }}
                onClose={closeSheet}
                strategyContrast={settings.strategyContrast}
                onStrategyContrastChange={(contrast) => updateSettings({ strategyContrast: contrast })}
                chapterPrimingMode={settings.chapterPrimingMode}
                onChapterPrimingModeChange={(mode) => updateSettings({ chapterPrimingMode: mode })}
                settings={settings}
                onUpdateSettings={(updated) => updateSettings(updated)}
              />

              <div className="setting-section">
                <span className="setting-section-label">Vocabulario de la Obra</span>
                <div className="setting-row setting-row--stack">
                  <span className="setting-label">Antes de leer</span>
                  <div className="theme-menu" role="group" aria-label="Preparación de vocabulario">
                    {PREPARATION_MODES.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className="theme-option"
                        data-active={settings.preparationMode === id || undefined}
                        aria-pressed={settings.preparationMode === id}
                        onClick={() => updateSettings({ preparationMode: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <span className="setting-label">Palabras de este capítulo</span>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => {
                      closeSheet();
                      openPrepManual();
                    }}
                  >
                    Revisar ahora
                  </button>
                </div>
              </div>

              {catEnabled ? (
                <div className="setting-section">
                  <span className="setting-section-label">Compañero Lector</span>
                  <div className="setting-row">
                    <span className="setting-label">Tu compañero</span>
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() => {
                        closeSheet();
                        companion.openPanel();
                      }}
                    >
                      Ver a {companion.name}
                    </button>
                  </div>
                  {presenceMode !== "off" ? (
                    <div className="setting-row">
                      <span className="setting-label">
                        Ocultar al gato en esta lectura
                      </span>
                      <Toggle
                        label="Ocultar al gato en esta lectura"
                        checked={catSuppressed}
                        onChange={setCatSuppressed}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <details className="settings-advanced">
                <summary>Atajos de lectura</summary>
                <div className="settings-advanced-body shortcuts-list">
                  <div className="shortcut-row">
                    <span>Avanzar página</span>
                    <div><kbd>Espacio</kbd> · <kbd>→</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Retroceder página</span>
                    <div><kbd>Shift</kbd> + <kbd>Espacio</kbd> · <kbd>←</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Buscar en el libro</span>
                    <div><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>F</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Índice de capítulos</span>
                    <div><kbd>T</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Marcadores y notas</span>
                    <div><kbd>M</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Definir palabra bajo el cursor</span>
                    <div><kbd>D</kbd></div>
                  </div>
                  <div className="shortcut-row">
                    <span>Mostrar controles</span>
                    <div><kbd>Tab</kbd></div>
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </Sheet>
      ) : null}

      {askStart && catalog ? (
        <BookStart
          targets={catalog.targets}
          suggestedStartId={suggestedChapterTarget(catalog, title)?.id ?? null}
          firstChapterId={
            catalog.targets.find((t) => t.kind === "chapter")?.id ?? null
          }
          bookTitle={title}
          author={author}
          language={language}
          isSecondLanguage={language !== loadNativeLanguage()}
          onStartCalibration={(lang) => {
            void onRequestCalibration(lang);
          }}
          onConfirm={confirmStart}
          onClose={onBack}
        />
      ) : null}

      {prep ? (
        <SectionPreview
          title={prep.target.label}
          chapterTitle={prep.target.label}
          bookId={bookHash}
          bookLang={language}
          analysis={prep.analysis}
          rows={prep.rows}
          uncertainRows={prep.uncertain}
          deferredRows={prep.deferred}
          onRowsPresented={recordPresented}
          answers={prep.answers}
          saving={prep.saving}
          onAnswer={answerPrep}
          onConfirm={() => void confirmPrep()}
          onSkip={skipPrep}
          onRetry={() => void retryPrep()}
          onClose={() => {
            releaseOverlay();
            closePrepLayer();
          }}
          onDiscard={discardPrep}
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
        />
      ) : null}

      {returnPoint ? (
        <div className="reader-return">
          <button
            type="button"
            className="reader-return-btn"
            onClick={goBack}
          >
            ‹ Volver a donde estaba
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={() => setReturnPoint(null)}
            aria-label="Descartar regreso"
          >
            ×
          </button>
        </div>
      ) : null}

      {selButton ? (
        <div
          className="selection-menu reader__passage-bar"
          data-placement={selButton.placement}
          style={{ left: selButton.x, top: selButton.y }}
        >
          {selButton.singleWordHit ? (
            <button
              type="button"
              className="selection-menu-btn selection-define"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                const hit = selButton.singleWordHit;
                window.getSelection()?.removeAllRanges();
                setSelButton(null);
                if (hit) openSelection(hit);
              }}
            >
              Definir
            </button>
          ) : null}

          {/* 1. Resaltar con tinta (3 tonos: Ámbar, Salvia, Azul Darío) */}
          <div className="selection-highlight-group" role="group" aria-label="Resaltar con tinta">
            <button
              type="button"
              className="selection-menu-btn selection-save"
              title="Resaltar con tinta ámbar"
              aria-label="Resaltar con tinta"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void savePassageSelection("amber")}
            >
              <Icon name="highlight" size={14} />
              <span>Tinta</span>
            </button>
            <div className="selection-tones-picker" aria-label="Elegir tono de tinta">
              <button
                type="button"
                className="tone-dot tone-dot--amber reader__passage-color reader__passage-color--amber"
                title="Tinta Ámbar"
                aria-label="Tinta Ámbar"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void savePassageSelection("amber")}
              />
              <button
                type="button"
                className="tone-dot tone-dot--salvia reader__passage-color reader__passage-color--sage"
                title="Tinta Salvia"
                aria-label="Tinta Salvia"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void savePassageSelection("salvia")}
              />
              <button
                type="button"
                className="tone-dot tone-dot--dario reader__passage-color reader__passage-color--dario-blue"
                title="Tinta Azul Darío"
                aria-label="Tinta Azul Darío"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void savePassageSelection("dario")}
              />
            </div>
          </div>

          {/* 2. Reflexión Profunda */}
          <button
            type="button"
            className="selection-menu-btn selection-deep"
            title="Reflexión Profunda"
            aria-label="Reflexión Profunda"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              setSelButton(null);
              setDeepModal(true);
            }}
          >
            <Icon name="retreat" size={14} />
            <span>Reflexión</span>
          </button>

          {/* 3. Crear Postal de Cita */}
          <button
            type="button"
            className="selection-menu-btn selection-card"
            title="Crear postal de cita"
            aria-label="Crear postal de cita"
            onPointerDown={(event) => event.preventDefault()}
            onClick={openQuoteCardFromSelection}
          >
            <Icon name="quote" size={14} />
            <span>Postal</span>
          </button>

          {/* 4. Preguntar al Gato */}
          <button
            type="button"
            className="selection-menu-btn selection-ask-cat"
            title="Preguntar al Gato"
            aria-label="Preguntar al Gato"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void askCatAboutSelection()}
          >
            <Icon name="sparkles" size={14} />
            <span>Preguntar</span>
          </button>
        </div>
      ) : null}

      {showLongPressHint ? (
        <div className="reader-hint-toast" role="status" aria-live="polite">
          Mantén presionada una palabra para ver qué significa.
        </div>
      ) : null}

      {selection ? (
        <WordPanel
          key={selection.word}
          word={selection.word}
          context={selection.context}
          phrase={selection.phrase}
          canExplain={signedIn}
          language={language}
          bookHash={bookHash}
          bookTitle={title}
          author={author}
          sections={bookSections}
          toc={catalog?.targets?.map((t) => ({ index: t.sectionIndex, label: t.label }))}
          currentSectionIndex={sectionIndex}
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
          onClose={closeSelection}
          onSaved={onWordSaved}
          onRemoved={onWordRemoved}
          onKnowledgeChanged={(row, { form, kind }) => {
            // La evidencia persiste antes de llegar aquí: al modelo
            // en memoria y al trayecto, para que la siguiente
            applyKnowledgeRow(row);
            try {
              const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
              const zipf = zipfForLemma(row.lemma);
              const beta = betaFromZipf(zipf);
              if (kind === "saved") {
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
        />
      ) : null}

      {pageRecap ? (
        <Dialog
          label="Recuperar el hilo"
          onClose={() => setPageRecap(null)}
          className="dialog--page-recap"
        >
          <div className="sheet-head">
            <h2 className="sheet-title">
              <span aria-hidden="true">🧭</span> Recuperar el hilo
            </h2>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => setPageRecap(null)}
              aria-label="Cerrar hilo"
            >
              Cerrar
            </button>
          </div>

          {pageRecap.loading ? (
            <div className="cat-passage-loading">
              <span className="cat-spinner" aria-hidden="true">🧭</span>
              <p className="meta">Reconstruyendo el hilo de atención de esta página…</p>
            </div>
          ) : pageRecap.data ? (
            <div className="page-recap-content">
              <ul className="page-recap-bullets">
                {pageRecap.data.bullets.map((b, idx) => (
                  <li key={idx} className="page-recap-bullet">
                    <span className="bullet-dot" aria-hidden="true">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {pageRecap.data.hookQuestion ? (
                <div className="page-recap-hook">
                  <span className="hook-icon" aria-hidden="true">✨</span>
                  <p className="hook-text"><em>{pageRecap.data.hookQuestion}</em></p>
                </div>
              ) : null}
              <div className="page-recap-actions" style={{ marginTop: "1rem", textAlign: "right" }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setPageRecap(null)}
                  autoFocus
                >
                  Continuar leyendo →
                </button>
              </div>
            </div>
          ) : (
            <p role="alert" className="status">{pageRecap.error ?? "No se pudo recuperar el hilo."}</p>
          )}
        </Dialog>
      ) : null}

      {catPassageExplanation ? (
        <Dialog
          label="El apunte del Gato"
          onClose={() => setCatPassageExplanation(null)}
          className="dialog--cat-explanation"
        >
          <div className="sheet-head">
            <h2 className="sheet-title">
              <span className="cat-dialog-avatar" aria-hidden="true">🐾</span> El apunte del Gato
            </h2>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => setCatPassageExplanation(null)}
              aria-label="Cerrar apunte"
            >
              Cerrar
            </button>
          </div>

          <div className="cat-passage-quote">
            “{catPassageExplanation.passage}”
          </div>

          {catPassageExplanation.loading ? (
            <div className="cat-passage-loading">
              <span className="cat-spinner" aria-hidden="true">🐾</span>
              <p className="meta">El gato está leyendo con atención el pasaje…</p>
            </div>
          ) : catPassageExplanation.data ? (
            <div className="cat-passage-result">
              <div className="passage-badge-tone-row">
                <span className="passage-badge-tone">{catPassageExplanation.data.toneAndNuance}</span>
              </div>
              <p className="passage-meaning-text">{catPassageExplanation.data.contextualMeaning}</p>
              <div className="cat-literary-tip">
                <span className="cat-tip-icon" aria-hidden="true">🐾</span>
                <p className="cat-tip-text"><em>Michi:</em> «{catPassageExplanation.data.catTip}»</p>
              </div>
            </div>
          ) : (
            <p role="alert" className="status">{catPassageExplanation.error ?? "No se pudo obtener la explicación."}</p>
          )}
        </Dialog>
      ) : null}

      {/* Marcapasos Visual: barra flotante ergonómica cuando está activo (OBJ-05) */}
      {settings.visualPacer && !strategyPaused && state === "ready" && !isDeepReading ? (
        <div
          className="reader__pacer-bar tts-chip tts-chip--expanded"
          role="status"
          aria-label="Marcapasos visual"
        >
          <span className="tts-chip-label">
            {pacerPaused ? "En pausa" : "Ritmo activo"}
          </span>
          <div className="tts-chip-actions">
            <button
              type="button"
              className="btn--quiet tts-btn-playpause"
              onClick={() => setPacerPaused((p) => !p)}
              aria-label={pacerPaused ? "Reanudar ritmo" : "Pausar ritmo"}
            >
              {pacerPaused ? "Reanudar" : "Pausar"}
            </button>
            <button
              type="button"
              className="btn--quiet tts-chip-rate"
              onClick={() => {
                const nextWpm =
                  (settings.pacerWpm || 210) >= 350
                    ? 150
                    : (settings.pacerWpm || 210) + 30;
                updateSettings({ pacerWpm: nextWpm });
              }}
              aria-label="Velocidad del ritmo"
            >
              {`${settings.pacerWpm || 210} WPM`}
            </button>
            <button
              type="button"
              className="btn--quiet tts-chip-stop"
              onClick={() => updateSettings({ visualPacer: false })}
              aria-label="Detener ritmo"
            >
              Detener
            </button>
          </div>
        </div>
      ) : null}

      {ttsCapturedToast ? (
        <div className="reader-hint-toast reader-hint-toast--captured" role="status" aria-live="polite">
          ★ Guardada en Cuaderno: <strong>{ttsCapturedToast}</strong>
        </div>
      ) : null}
      {ttsConsentOpen ? (
        <TtsConsentDialog
          onAccept={onTtsConsentAccept}
          onDismiss={() => setTtsConsentOpen(false)}
          downloadProgress={ttsDownloadProgress}
          isModelDownloaded={isKittenModelDownloaded}
          onDeleteModel={() => void handleDeleteTtsModel()}
        />
      ) : null}
      {quoteCard ? (
        <QuoteCardModal
          text={quoteCard.text}
          bookTitle={quoteCard.bookTitle}
          author={quoteCard.author}
          chapterTitle={quoteCard.chapterTitle}
          alreadySaved={quoteCard.alreadySaved}
          onClose={() => setQuoteCard(null)}
          onSavePassage={
            quoteCard.alreadySaved
              ? undefined
              : () => {
                  void savePassageDirectly(quoteCard.text);
                }
          }
        />
      ) : null}
      {deepModal ? (
        <DeepReadingModal
          onStart={(config) => void startDeepReading(config)}
          onClose={() => setDeepModal(false)}
        />
      ) : null}
      {deepSummary ? (
        <DeepReadingSummaryModal
          summary={deepSummary}
          onClose={() => setDeepSummary(null)}
        />
      ) : null}
      {glossaryOpen ? (
        <BookGlossaryModal
          bookHash={bookHash}
          bookTitle={title}
          language={language}
          onClose={() => setGlossaryOpen(false)}
          onSelectTerm={(word) => {
            setGlossaryOpen(false);
            openSelection({ word, context: "" });
          }}
          onWordSaved={onWordSaved}
        />
      ) : null}
    </div>
  );
}

export { BilingueParagraph };
