import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { EpubBook } from "../lib/epub";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint } from "../lib/words";
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
  hasAnyLearningHistory,
  listAllKnowledge,
  listReadingEvents,
  listKnowledge,
  listSavedWords,
  loadBookPosition,
  saveBookPosition,
  saveKnowledge,
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
import { batchLookup, enrichBatch, lookupWord } from "../lib/lexicon";
import {
  selectEnrichmentCandidates,
  selectSavedForEnrichment,
} from "../lib/enrichment-candidates";
import { hasUsableDefinition, measuredZipf } from "../../shared/lexicon";
import {
  cliticBasesFor,
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
  newFocusTracker,
  recordMove,
  type FocusTracker,
} from "../lib/focus-telemetry";
import {
  loadReaderSettings,
  saveReaderSettings,
  hasBookReaderSettings,
  clearBookReaderSettings,
  hasExplicitPreparationMode,
  readerCssVars,
  READER_LIMITS,
  READER_FONTS,
  LEADING_OPTIONS,
  MARGIN_OPTIONS,
  PREPARATION_MODES,
  type ReaderSettings,
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
import { makeBookmark, makePassage } from "../lib/annotations";
import { applyPassageMarks } from "../lib/passage-marks";
import {
  pageLayout,
  pageAdvance,
  totalPages,
  anchorAtPage,
  pageForFragment,
  pageForText,
  pageOfElement,
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
  type TtsSnapshot,
} from "../lib/ttsTypes";
import { setCompanionAudioSuppressed } from "../lib/companion-audio";
import TtsMenuItem from "./TtsMenuItem";
import TtsConsentDialog from "./TtsConsentDialog";
import TtsNowPlaying from "./TtsNowPlaying";
import WordPanel from "./WordPanel";
import SectionPreview, { type SectionPreviewRow } from "./SectionPreview";
import Sheet from "./Sheet";
import QuoteCardModal from "./QuoteCardModal";
import OfflineDictionaryControl from "./OfflineDictionaryControl";
import DeepReadingModal from "./DeepReadingModal";
import DeepReadingSummaryModal from "./DeepReadingSummaryModal";
import BookGlossaryModal from "./BookGlossaryModal";
import { downloadBookMarkdown } from "../lib/export";
import {
  formatRemainingTime,
  formatElapsedMinutes,
  requestScreenWakeLock,
  releaseScreenWakeLock,
  toggleFullscreen,
  triggerHaptic,
  type DeepReadingConfig,
  type DeepReadingState,
  type DeepReadingSummary,
} from "../lib/deep-reading";
import { playCompanionSound } from "../lib/companion-audio";
import ThemeMenu, { FocusModeMenu } from "./ThemeMenu";
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
  // Ajuste manual del umbral (session: profileAdjust).
  const adjustRef = useRef(0);
  // Evidencia por lema que alimenta estimateProfile; crece con cada
  // «Ya la conocía» y cada guardado.
  const evidenceRef = useRef(new Map<string, KnowledgeEvidence>());
  // Evidencia explícita por lema para predictSection.
  const knowledgeMapRef = useRef(new Map<string, { lemma: string; known: boolean }>());
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
  const [analyzing, setAnalyzing] = useState(false);
  const [enriching, setEnriching] = useState<{
    index: number;
    done: number;
    total: number;
  } | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [settingsTab, setSettingsTab] = useState<"appearance" | "layout" | "tools">("appearance");
  const [barsVisible, setBarsVisible] = useState(true);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings(bookHash));
  const [bookOverride, setBookOverride] = useState(() => hasBookReaderSettings(bookHash));
  const [seenStatus, setSeenStatus] = useState(statusText);
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchDone, setSearchDone] = useState(true);
  const [returnPoint, setReturnPoint] = useState<{
    sectionIndex: number;
    ratio: number;
    anchor?: string;
  } | null>(null);
  const [selButton, setSelButton] = useState<{ x: number; y: number } | null>(null);
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
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [deepReading, setDeepReading] = useState<DeepReadingState | null>(null);
  const [deepSummary, setDeepSummary] = useState<DeepReadingSummary | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageMetrics, setPageMetrics] = useState<PageLayout | null>(null);
  // Gato acompañante en el lector: el aspecto (etapa, accesorios,
  // nombre, presencia) viene del CompanionProvider único — aquí solo
  // queda el estado visible de la máquina local de lectura.
  const [catState, setCatState] = useState<CompanionState | null>(null);
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
  const onCatTap = () => {
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
    },
    [],
  );

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
    const timer = window.setInterval(
      () => signalCompanion({ kind: "tick", at: Date.now() }),
      10_000,
    );
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
  const zipfForLemma = (lemma: string): number | null => {
    const cached = analysisFor(sectionIndexRef.current);
    if (!cached) return calibrationBankZipf(lemma, language);
    const matches = [];
    for (const entries of Object.values(cached.entries))
      for (const entry of entries) if (entry.lemma === lemma) matches.push(entry);
    return measuredZipf(matches, lemma) ?? calibrationBankZipf(lemma, language);
  };

  // Evidencia recién escrita entra al modelo en memoria y queda
  // marcada como pendiente: refreshProfile no la pisa si el store aún
  // no la refleja al releer.
  const ingestKnowledgeRow = (row: { lemma: string; known: boolean }) => {
    const lemma = row.lemma.toLowerCase();
    knowledgeMapRef.current.set(lemma, { lemma, known: row.known });
    const prev = evidenceRef.current.get(lemma);
    evidenceRef.current.set(lemma, {
      zipf: prev?.zipf ?? zipfForLemma(lemma),
      known: row.known,
    });
    pendingKnowledgeRef.current.add(lemma);
  };

  // Evidencia nueva aplicada de inmediato: perfil reestimado y la
  // sección visible reclasificada sin esperar otra recarga.
  const applyKnowledgeRow = (row: { lemma: string; known: boolean }) => {
    ingestKnowledgeRow(row);
    profileRef.current = estimateProfile(
      [...evidenceRef.current.values()],
      adjustRef.current,
    );
    applyPrediction(sectionIndexRef.current, language);
  };

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
  const navNextSection = (index: number) => {
    if (currentRatioNow() >= 0.85)
      signalCompanion({ kind: "goal_completed" });
    trackMove(false);
    void navigate("chapter", { index });
  };

  const navPrevSection = (index: number) => {
    trackMove(true);
    void navigate("chapter", { index });
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
          estimateProfile([...evidenceRef.current.values()], adjustRef.current)
            .threshold,
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
      const lang = getBookLanguage(book);
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
    [bookHash, prepRowsFor],
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
        setPrepNotice(null);
        void openPrepSheet(target, record);
        return;
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
              ? prepRowsFor(cached, getBookLanguage(book)).rows.length
              : null,
        });
        return;
      }
      setPrepNotice((cur) => (cur?.target.id === target.id ? null : cur));
    },
    [bookHash, openPrepSheet, prepRowsFor],
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
      const lang = getBookLanguage(book);
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
    [rangeFor, setAnalyzingFor, applyPrediction, evaluatePreparation],
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
    const target = prepNotice?.target ?? targetAt(
      catalogRef.current?.ranges ?? [],
      sectionIndexRef.current,
    );
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
    pendingKnowledgeRef.current.clear();
    const map = new Map<string, { lemma: string; known: boolean }>();
    const nextEvidence = new Map<string, KnowledgeEvidence>();
    for (const [lemma, item] of resolved) {
      map.set(lemma, { lemma, known: item.known });
      nextEvidence.set(lemma, { zipf: item.zipf, known: item.known });
    }
    knowledgeMapRef.current = map;
    evidenceRef.current = nextEvidence;
    const next = estimateProfile([...nextEvidence.values()], adjustRef.current);
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
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
        // Guiones blandos fuera antes de marcar, medir o anclar: el
        // texto que queda es el mismo con guionado activo o no.
        stripSoftHyphens(sanitized);
        const lang = getBookLanguage(book);
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
        if (
          settingsRef.current?.focusMode === "syntactic" ||
          settingsRef.current?.focusMode === "chromatic"
        )
          applySyntacticLines(sanitized);
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

  const onTtsConsentAccept = () => {
    consentTts();
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
      adjustRef.current = 0;
      // Poda perezosa del trayecto: conserva el historial reciente.
      void pruneReadingHistory(undefined, scope);
      setPrediction(null);
      setPrep(null);
      setPrepNotice(null);
      setAnalyzing(false);
      setEnriching(null);
      try {
        const { book, close, loadBlob } = await openEpub(file);
        if (disposed) {
          void close();
          return;
        }
        cleanup = close;
        bookRef.current = book;
        loadBlobRef.current = loadBlob;
        const bookLanguage = await detectBookLanguage(book).catch(() => getBookLanguage(book));
        const storedWords = await listSavedWords(bookLanguage, scope);
        savedForms.current = savedFormLevels(storedWords);
        recordDominated(storedWords, bookLanguage, scope);
        setLanguage(bookLanguage);
        setTitle(getBookTitle(book));
        setAuthor(getBookAuthor(book));
        setSectionTotal(book.sections.length);
        setSectionSizes(book.sections.map((section) => Math.max(0, section.size || 0)));

        // Catálogo de destinos (T10): semántica landmarks→índice,
        // fragmentos conservados. El índice viejo se reconstruye como
        // filas sobre los targets — la posición sigue siendo física.
        const catalog = buildChapterCatalog(book);
        setCatalog(catalog);
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
    const target = targetAt(catalog?.ranges ?? [], sectionIndex);
    if (!target || lastTargetEnteredRef.current === target.id) return;
    lastTargetEnteredRef.current = target.id;
    trackEvent({
      kind: "target_entered",
      targetId: target.id,
      sectionIndex,
    });
  }, [state, sectionIndex, catalog, trackEvent]);

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

  // Botón flotante «Guardar pasaje» sobre la selección del usuario.
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
      setSelButton({ x: rect.left + rect.width / 2, y: rect.top });
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
  }, []);

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
        if (
          settingsRef.current?.focusMode === "paragraph" &&
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
      const needsLines =
        settings.focusMode === "syntactic" ||
        settings.focusMode === "chromatic";
      if (needsLines) applySyntacticLines(container);
      else clearSyntacticLines(container);

      if (settings.focusMode === "paragraph") updateParagraphFocus(container);
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
  }, [settings.focusMode, state, remeasure]);

  // En modo foco de párrafo, reenfocar al cambiar de sección o de página.
  useEffect(() => {
    if (state !== "ready" || settings.focusMode !== "paragraph") return;
    const container = containerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      updateParagraphFocus(container);
    });
    return () => cancelAnimationFrame(raf);
  }, [settings.focusMode, state, page, sectionIndex]);

  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(remeasure, 120);
    });
    observer.observe(viewport);
    void document.fonts?.ready.then(remeasure);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [settings.layout, state, sectionIndex, remeasure]);

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso).
  const goPage = useCallback(
    (delta: number) => {
      noteActivity();
      trackMove(delta < 0);
      const next = pageRef.current + delta;
      if (next < 0) {
        if (sectionIndexRef.current > 0)
          void navigate("chapter", {
            index: sectionIndexRef.current - 1,
            restore: { at: "end" },
          });
        return;
      }
      if (next >= pageCountRef.current) {
        // En la última página el ratio ya es ~1: pasar a la sección
        // siguiente cuenta como tramo terminado (el gato celebra).
        if (sectionIndexRef.current + 1 < sectionTotal) {
          signalCompanion({ kind: "goal_completed", at: Date.now() });
          void navigate("chapter", { index: sectionIndexRef.current + 1 });
        }
        return;
      }
      setPageIdx(next);
      saveSoon();
    },
    [navigate, saveSoon, sectionTotal, setPageIdx, noteActivity, trackMove, signalCompanion],
  );

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
  const isDeepReading = Boolean(deepReading?.active);
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
        const summary: DeepReadingSummary = {
          durationMinutes,
          targetMinutes: current.targetMinutes,
          sectionsRead,
          completedNaturally: natural,
        };
        setDeepSummary(summary);
      }
    }

    setDeepReading(null);
  }, []);

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

  // Limpieza de pantalla completa y wake lock al desmontar el lector
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        void releaseScreenWakeLock(wakeLockRef.current);
      }
      void toggleFullscreen(false);
    };
  }, []);

  // Atajos de lectura: ← / → / Espacio / AvPág / RePág pasan página o sección.
  // Ctrl+F abre búsqueda; T abre índice; M abre marcadores; D consulta palabra;
  // Tab siempre trae las barras de vuelta.
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
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        noteActivity();
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
  }, [selection, sheet, panelsOpen, sectionIndex, sectionTotal, navigate, goPage, noteActivity, language]);

  const onWordSaved = (word: SavedWord) => {
    ttsRef.current?.noteSavedWord();
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.set(form.toLowerCase(), "new");
    }
    // Reclasifica la sección visible: la palabra pasa a «guardada»
    // tanto en la tarjeta como en las marcas del texto.
    applyPrediction(sectionIndexRef.current, language);
    onStatus(`«${word.form}» ya está en tu cuaderno.`);
  };

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
  const savePassageSelection = async () => {
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
    );
    sel.removeAllRanges();
    setSelButton(null);
    if (!input) return;
    const scope = captureDbScope();
    pushAnnotation(await saveAnnotation(input, scope), scope);
    onStatus("Pasaje guardado en Marcadores.");
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
      chapterTitle: sectionTitle ?? sectionLabel(sectionIndex),
      alreadySaved: false,
    });
    setSelButton(null);
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
      const next = { ...current, ...patch };
      saveReaderSettings(next, bookHash);
      setBookOverride(true);
      return next;
    });
  };

  // El libro vuelve a heredar los ajustes generales del lector.
  const useGlobalSettings = () => {
    clearBookReaderSettings(bookHash);
    setSettings(loadReaderSettings());
    setBookOverride(false);
  };

  // En modo paginado el documento no hace scroll: sin scroll-up no hay
  // forma de recuperar barras ocultas, así que siempre se muestran.
  // En Retiro de lectura las barras siempre se ocultan para máxima inmersión.
  const barsShown = !isDeepReading && (barsVisible || settings.layout === "pages");

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

  const nextRow = tocRows.find((row) => row.index === sectionIndex + 1);
  const prevRow = tocRows.find((row) => row.index === sectionIndex - 1);

  // ---------- Resumen de cierre de capítulo ----------

  // ¿El lector llegó al final del capítulo? En la última sección del
  // tramo y con la vista casi completa: en desplazamiento, cerca del
  // pie (una sección sola ocuparía toda la vista sin este umbral); en
  // páginas, en la última página. «uncertain» también cuenta: es un
  // destino del índice sin clasificar — la mayoría de los EPUB no
  // traen landmarks y sin ellos casi todo cae ahí. Solo se excluyen
  // preliminares y ajenos.
  const endTarget = targetAt(catalog?.ranges ?? [], sectionIndex);
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
      data-justify={settings.justify || undefined}
      data-dropcap={settings.dropCap || undefined}
      data-layout={settings.layout === "pages" ? "pages" : undefined}
      data-hyphens={settings.enableHyphenation || undefined}
    >
      <div
        ref={measureProbeRef}
        aria-hidden="true"
        className="measure-probe"
      />
      <header className="reader-bar" data-hidden={!barsShown || undefined}>
        <button
          type="button"
          className="btn--quiet reader-back"
          onClick={onBack}
          aria-label="Volver a la estantería"
        >
          <span className="reader-back-icon" aria-hidden="true">‹</span>
          <span className="reader-back-label"> Estantería</span>
        </button>
        <p className="reader-bar-title" title={title || fileName}>
          {title || fileName}
          {author ? <span className="reader-bar-author"> · {author}</span> : null}
        </p>
        <div className="reader-bar-actions">
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={() => openSheet("search")}
            aria-label="Buscar en el libro"
            title="Buscar"
          >
            <span className="reader-btn-icon" aria-hidden="true">🔍</span>
            <span className="reader-btn-text">Buscar</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={() => openSheet("toc")}
            aria-label="Índice del libro"
            title="Índice"
          >
            <span className="reader-btn-icon" aria-hidden="true">☰</span>
            <span className="reader-btn-text">Índice</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn reader-bar-btn--settings"
            onClick={() => openSheet("settings")}
            aria-label="Ajustes de lectura"
            title="Ajustes de lectura (Aa)"
          >
            <span className="reader-btn-icon reader-btn-icon--aa" aria-hidden="true">Aa</span>
            <span className="reader-btn-text">Ajustes</span>
          </button>
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={() => setDeepModal(true)}
            aria-label="Iniciar modo retiro de lectura"
            title="Retiro de lectura"
          >
            <span className="reader-btn-icon" aria-hidden="true">🕯️</span>
            <span className="reader-btn-text">Retiro</span>
          </button>
          {/* Acceso directo a la voz: un toque desde la barra, sin
              entrar a ajustes. Solo existe donde hay voces del
              dispositivo (Web Speech API). */}
          {isTtsSupported() ? (
            <button
              type="button"
              className="btn--quiet reader-bar-btn"
              onClick={onTtsRequest}
              aria-label={
                ttsSnap.status !== "idle"
                  ? "Detener lectura en voz alta"
                  : "Leer en voz alta"
              }
              aria-pressed={ttsSnap.status !== "idle"}
              title={ttsSnap.status !== "idle" ? "Detener voz" : "Escuchar"}
            >
              <span className="reader-btn-icon" aria-hidden="true">
                {ttsSnap.status !== "idle" ? "⏹️" : "🎧"}
              </span>
              <span className="reader-btn-text">
                {ttsSnap.status !== "idle" ? "Detener" : "Escuchar"}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="btn--quiet reader-bar-btn"
            onClick={onOpenNotebook}
            aria-label="Abrir Cuaderno de vocabulario"
            title="Cuaderno"
          >
            <span className="reader-btn-icon" aria-hidden="true">📓</span>
            <span className="reader-btn-text">Cuaderno</span>
          </button>
        </div>
      </header>

      <div className="reader-body">
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
        <div className="page-viewport" ref={viewportRef}>
          <div
            ref={containerRef}
            className="book-content"
            data-focus-mode={settings.focusMode}
            style={
              settings.layout === "pages" && pageMetrics
                ? ({
                    inlineSize: `${pageMetrics.boxW}px`,
                    blockSize: "100%",
                    columnWidth: `${pageMetrics.colW}px`,
                    columnGap: `${pageMetrics.gap}px`,
                    columnFill: "auto",
                    transform: `translateX(${-page * pageAdvance(pageMetrics.boxW, pageMetrics.gap)}px)`,
                  } as CSSProperties)
                : undefined
            }
            lang={language}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return;
            if (settings.focusMode === "paragraph") {
              const block = (event.target as HTMLElement).closest("p, blockquote, li");
              if (block && container.contains(block)) {
                focusBlock(container, block);
              }
            }
            // Los enlaces internos del EPUB (notas al pie, índice)
            // apuntan a rutas que no existen en la app: no navegar.
            if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
            if (hit) {
              openSelection(hit);
            } else {
              // Tocar fuera de una palabra: en lectura por páginas los márgenes
              // izquierdo y derecho avanzan o retroceden página, y el centro
              // conmuta las barras del lector. En desplazamiento muestra barras.
              if (settings.layout === "pages") {
                const w = window.innerWidth;
                if (event.clientX > w * 0.78) {
                  goPage(1);
                } else if (event.clientX < w * 0.22) {
                  goPage(-1);
                } else {
                  setBarsVisible((v) => !v);
                }
              } else {
                setBarsVisible(true);
              }
            }
          }}
          onPointerMove={(event) => {
            lastPoint.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerDown={noteActivity}
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
              className="reader-end-link"
              disabled={sectionIndex === 0 && page === 0}
              onClick={() => goPage(-1)}
            >
              ← Anterior
            </button>
            <span className="page-nav-count meta" aria-live="polite">
              {pageCount ? `Página ${page + 1} de ${pageCount}` : ""}
            </span>
            <button
              type="button"
              className="reader-end-link"
              disabled={sectionIndex + 1 >= sectionTotal && page + 1 >= pageCount}
              onClick={() => goPage(1)}
            >
              Siguiente →
            </button>
          </nav>
          </>
        ) : (
          <>
            {chapterEndCard}
          <nav className="reader-end" aria-label="Navegación de secciones">
            {sectionIndex > 0 ? (
              <button
                type="button"
                className="reader-end-link"
                onClick={() => navPrevSection(sectionIndex - 1)}
              >
                ← {prevRow?.label ?? "Anterior"}
              </button>
            ) : (
              <span />
            )}
            {sectionIndex + 1 < sectionTotal ? (
              <button
                type="button"
                className="reader-end-link"
                onClick={() => navNextSection(sectionIndex + 1)}
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

      {/* Aviso/acceso «Palabras del capítulo»: franja fija en la zona
          de controles, fuera del texto — persiste hasta atenderla o
          descartarla; nunca empuja la lectura porque vive aquí desde
          la entrada al capítulo. */}
      {prepNotice && !prep && !resumeCard && !isDeepReading ? (
        <div className="reader-prep" role="status">
          <span className="reader-prep-text">
            {prepNotice.summary
              ? `Ya preparaste el vocabulario de ${prepNotice.target.label}.`
              : prepNotice.count != null
                ? `${prepNotice.count} palabra(s) por revisar en ${prepNotice.target.label}.`
                : analyzing
                  ? `Preparando vocabulario de ${prepNotice.target.label}…`
                  : `Vocabulario por preparar en ${prepNotice.target.label}.`}
            {enriching && enriching.index === sectionIndex
              ? ` Definiendo ${enriching.done} de ${enriching.total}…`
              : ""}
          </span>
          <button
            type="button"
            className="btn reader-prep-open"
            onClick={openPrepManual}
          >
            {prepNotice.summary ? "Ver palabras" : "Preparar"}
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={dismissPrepNotice}
            aria-label="Ocultar aviso de vocabulario"
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

      {/* Gato acompañante: esquina baja fija y solo cuando el
          planificador de presencia lo dice (modo de la cuenta +
          supresión por libro). Es un botón real «Ver a [nombre]» que
          abre la hoja del proveedor — el único punto del área que
          recibe toques; el resto sigue transparente al texto. */}
      {catShown && catState ? (
        <div
          className="reader-cat cat-anim"
          data-out={catLeaving || undefined}
        >
          <CompanionButton
            stage={companion.stage}
            mood="awake"
            accessories={companion.accessories}
            focus={isDeepReading ? "deep_focus" : catState}
            pose={isDeepReading ? undefined : catTap ? "celebrate" : catGreeting ? "greet" : undefined}
            label={`Ver a ${companion.name}`}
            onClick={onCatTap}
          />
        </div>
      ) : null}

      {/* Regla de enfoque: velo de papel con una franja clara que
          sigue al puntero; la patita del gato ancla el margen. Con
          presencia «off» o el gato suprimido por esta lectura la
          decoración también se va: no queda rastro del gato. */}
      {settings.focusMode === "ruler" && state === "ready" ? (
        <FocusRuler
          bandPx={rulerBandPx(
            settings.rulerSize,
            settings.size * settings.leading,
          )}
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

      <footer className="reader-foot" data-hidden={!barsShown || undefined}>
        <div
          className="thread"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${Math.round(progress * 100)}% del libro`}
        >
          <div
            className="thread-fill"
            style={{ "--thread-value": `${progress * 100}%` } as CSSProperties}
          />
        </div>
        <div className="reader-foot-meta">
          <span>
            {sectionTotal
              ? sectionTitle
                ? `${sectionTitle} · ${sectionIndex + 1} de ${sectionTotal}`
                : `${sectionIndex + 1} de ${sectionTotal}`
              : "Abriendo…"}
            {minutes > 1
              ? ` · ${minutes} min restantes`
              : minutes === 1
                ? " · 1 min restante"
                : ""}
          </span>
          {errorText ? (
            <span className="reader-error-text" role="alert">
              {errorText}
            </span>
          ) : null}
          <span key={seenStatus} className="reader-status" role="status">
            {statusText}
          </span>
        </div>
      </footer>

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
                  targetAt(catalog?.ranges ?? [], sectionIndex)?.id ===
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
        <Sheet label="Ajustes de lectura" onClose={closeSheet}>
          <div className="sheet-head">
            <strong className="sheet-title">Ajustes de lectura</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar ajustes"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          <div className="sheet-tabs" role="tablist" aria-label="Categorías de ajustes">
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
              aria-selected={settingsTab === "layout"}
              className="sheet-tab"
              data-active={settingsTab === "layout" || undefined}
              onClick={() => setSettingsTab("layout")}
            >
              Maquetación
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "tools"}
              className="sheet-tab"
              data-active={settingsTab === "tools" || undefined}
              onClick={() => setSettingsTab("tools")}
            >
              Herramientas
            </button>
          </div>

          {settingsTab === "appearance" ? (
            <div role="tabpanel" aria-label="Apariencia">
              <div className="setting-row setting-row--stack">
                <span className="setting-label">Tema</span>
                <ThemeMenu value={theme} onChange={onThemeChange} variant="swatches" />
              </div>
              <div className="setting-row setting-row--stack">
                <span className="setting-label">Letra</span>
                <div className="font-options" role="group" aria-label="Letra">
                  {READER_FONTS.map(({ id, label, family }) => (
                    <button
                      key={id}
                      type="button"
                      className="font-option"
                      style={{ fontFamily: family }}
                      data-active={settings.font === id || undefined}
                      aria-pressed={settings.font === id}
                      onClick={() => updateSettings({ font: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span className="setting-label">Tamaño</span>
                <div className="setting-stepper">
                  <button
                    type="button"
                    className="btn stepper-down"
                    aria-label="Letra más pequeña"
                    disabled={settings.size <= READER_LIMITS.size.min}
                    onClick={() => updateSettings({ size: settings.size - 1 })}
                  >
                    A
                  </button>
                  <span className="setting-value">{settings.size}</span>
                  <button
                    type="button"
                    className="btn stepper-up"
                    aria-label="Letra más grande"
                    disabled={settings.size >= READER_LIMITS.size.max}
                    onClick={() => updateSettings({ size: settings.size + 1 })}
                  >
                    A
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <span className="setting-label">Interlineado</span>
                <div className="segmented" role="group" aria-label="Interlineado">
                  {LEADING_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      data-active={settings.leading === value || undefined}
                      aria-pressed={settings.leading === value}
                      onClick={() => updateSettings({ leading: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {settingsTab === "layout" ? (
            <div role="tabpanel" aria-label="Maquetación">
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
          ) : null}

          {settingsTab === "tools" ? (
            <div role="tabpanel" aria-label="Herramientas">
              <h3 className="settings-group-title">Inmersión y Enfoque</h3>
              <div className="setting-row setting-row--stack">
                <span className="setting-label">Concentración</span>
                <FocusModeMenu
                  value={settings.focusMode}
                  rulerSize={settings.rulerSize}
                  onChange={(focusMode) => updateSettings({ focusMode })}
                  onRulerSize={(rulerSize) => updateSettings({ rulerSize })}
                />
              </div>
              <div className="setting-row">
                <span className="setting-label">Retiro de lectura</span>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    closeSheet();
                    setDeepModal(true);
                  }}
                >
                  Iniciar sesión
                </button>
              </div>

              <h3 className="settings-group-title">Audio y Asistencia</h3>
              {/* «Leer en voz alta» solo existe donde hay voces del
                  dispositivo (Web Speech API): sin speechSynthesis el
                  ítem ni se ofrece — la función jamás se sugiere sola. */}
              {isTtsSupported() ? (
                <TtsMenuItem
                  active={ttsSnap.status !== "idle"}
                  onRequest={onTtsRequest}
                />
              ) : null}
              <div className="setting-row setting-row--stack">
                <span className="setting-label">Lectura sin conexión</span>
                <OfflineDictionaryControl
                  bookHash={bookHash}
                  language={language}
                />
              </div>

              <h3 className="settings-group-title">Vocabulario de la Obra</h3>
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
              <div className="setting-row">
                <span className="setting-label">Glosario de la obra</span>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    closeSheet();
                    setGlossaryOpen(true);
                  }}
                >
                  Explorar léxico
                </button>
              </div>

              {catEnabled ? (
                <>
                  <h3 className="settings-group-title">Compañero Lector</h3>
                  <div className="setting-row">
                    <span className="setting-label">Tu compañero</span>
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={companion.openPanel}
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
                </>
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
          onConfirm={confirmStart}
          onClose={onBack}
        />
      ) : null}

      {prep ? (
        <SectionPreview
          title={prep.target.label}
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
          className="selection-menu"
          style={{ left: selButton.x, top: selButton.y }}
        >
          <button
            type="button"
            className="selection-save"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection()}
          >
            Guardar pasaje
          </button>
          <button
            type="button"
            className="selection-card"
            onPointerDown={(event) => event.preventDefault()}
            onClick={openQuoteCardFromSelection}
          >
            Tarjeta de cita
          </button>
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
          onClose={closeSelection}
          onSaved={onWordSaved}
          onRemoved={onWordRemoved}
          onKnowledgeChanged={(row, { form, kind }) => {
            // La evidencia persiste antes de llegar aquí: al modelo
            // en memoria y al trayecto, para que la siguiente
            // sección ya sugiera con esta respuesta aplicada.
            applyKnowledgeRow(row);
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

      {/* Chip discreto de la sesión de voz: no captura la lectura y
          en foco profundo se reduce a la etiqueta de estado. */}
      <TtsNowPlaying
        snap={ttsSnap}
        minimal={catState === "deep_focus"}
        onPauseResume={() => {
          const ctl = ttsRef.current;
          if (!ctl) return;
          if (ttsSnap.status === "speaking") ctl.pause("user");
          else if (ttsSnap.status === "paused") ctl.resume();
        }}
        onCycleRate={() => void ttsRef.current?.cycleRate()}
        onStop={() => ttsRef.current?.stop("user")}
      />
      {ttsConsentOpen ? (
        <TtsConsentDialog
          onAccept={onTtsConsentAccept}
          onDismiss={() => setTtsConsentOpen(false)}
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
