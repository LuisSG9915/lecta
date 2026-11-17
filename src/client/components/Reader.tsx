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
import { bookDisplayName } from "../lib/cover";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint, sameWordHit, sentenceRangeForHit, wordHitFromRange } from "../lib/words";
import { classifySelection, isTouchInput } from "../lib/tap-intent-guard";
import { useReaderShortcutsAndGestures } from "../hooks/useReaderShortcutsAndGestures";
import {
  openEpub,
  detectBookLanguage,
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
} from "../lib/epub";
import {
  applyAttentionBudget,
  bookHelpKey,
  saveBookMicroHighlightsEnabled,
} from "../lib/attention-budget";
import {
  captureDbScope,
  getStoredBook,
  listAllKnowledge,
  listReadingEvents,
  listSavedWords,
  loadBookPosition,
  saveKnowledge,
  saveWordWithKnowledge,
  updateBookMeta,
  saveSessionValue,
  loadSessionValue,
  wordKey,
  type DbScope,
  type SavedWord,
  type SavedBookPosition,
} from "../lib/idb";
import { batchLookup, enrichBatch, lookupWord } from "../lib/lexicon";
import { consolidateEpisodicWord, scheduleCapturedReview, type EpisodicOutcome } from "../lib/reviews";
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
  countSavedInRange,
  pruneReadingHistory,
  trackReadingEvent,
  type ChapterSummary,
  type VisitEventDraft,
} from "../lib/reading-events";
import { daysAgo, relativeDay } from "../lib/relative-time";
import {
  bookProgress,
  minutesLeft,
  updateWpm,
} from "../lib/progress";
import { award } from "../lib/game";
import type { KnownWord } from "../lib/idb";
import {
  resetDenseStallPage,
  recordFocusAidOutcome,
  muteBookFocusSuggestions,
  setFocusAutoSuggestEnabled,
  loadFocusTelemetryProfile,
  saveFocusTelemetryProfile,
  type FocusAidType,
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
  type ReaderSettings,
  type ReadingStrategyPreset,
  type ThemeChoice,
  isFeatureFlagEnabled,
} from "../lib/settings";
import {
  viewTopAnchor,
  charOffsetAtViewTop,
} from "../lib/reading-location";
import {
  pageLayout,
  pageAdvance,
  anchorAtPage,
  pageOfElement,
  buildFragmentPageMap,
  type PageLayout,
} from "../lib/pagination";
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
} from "../lib/calibration";
import {
  applyPreviewKnownSignal,
  applyWordPanelLookupSignal,
  calibrationBankZipf,
} from "../lib/knowledge";
import ResumeSessionOverlay, {
  extractLastSentences,
  formatSceneRecapOneLine,
} from "./ResumeSessionOverlay";
import {
  DAY_GOAL_MS,
} from "../lib/reading-goal";
import {
  getWeeklyLearnedWordsCount,
  setJourneySelectorCache,
} from "../lib/journey";
import { isReviewDueWord } from "../lib/fsrs";
import {
  setCompanionAudioSuppressed,
  startAmbientPurr,
  stopAmbientPurr,
  startSoundscape,
  stopSoundscape,
} from "../lib/companion-audio";
import {
  requestPageRecap,
  requestLastPagesRecap,
  generateZeroSpoilerSceneRecap,
  type SceneReturnRecap,
} from "../lib/page-recap";
import { type TimeInterval } from "../lib/reading-activity";
import {
  checkPassiveExposure as checkPassiveExposureEvidence,
  refreshProfile,
} from "../lib/reader-evidence";
import { useReaderBookSections } from "../hooks/useReaderBookSections";
import { translateParagraph } from "../lib/translate";
import {
  type EpisodicWordItem,
  type ConsolidationModality,
  isConsolidationActive,
} from "../lib/practice";
import { midChapterRecallKey, pickMidChapterRecall } from "../lib/mid-chapter-recall";
import { removeSavedWord, upsertSavedWord } from "../lib/episodic-cloze";
import { BilingueParagraph } from "./BilingueParagraph";
import type { FocusSuggestion } from "./SmartReaderDock";
import { ReaderTopBar } from "./reader/ReaderTopBar";
import { ReaderOverlays } from "./reader/ReaderOverlays";
import { ReaderContent } from "./reader/ReaderContent";
import { ReaderDockHost } from "./reader/ReaderDockHost";
import { ReaderFloatingBars } from "./reader/ReaderFloatingBars";
import { ReaderFloatingLane } from "./reader/ReaderFloatingLane";
import { ReaderFocusLayers } from "./reader/ReaderFocusLayers";
import { ReaderNotices } from "./reader/ReaderNotices";
import { ReaderSelectionBar, type ReaderSelectionButton } from "./reader/ReaderSelectionBar";
import ReaderSettingsSheet from "./reader/ReaderSettingsSheet";
import { ReaderSearchAndTocSheet } from "./reader/ReaderSearchAndTocSheet";
import { useReaderPersistence } from "../hooks/useReaderPersistence";
import { useReaderAnnotationsAndSearch } from "../hooks/useReaderAnnotationsAndSearch";
import { useReaderTts } from "../hooks/useReaderTts";
import { useTtsLandingMarker } from "../hooks/useTtsLandingMarker";
import { useTtsCaptureWord } from "../hooks/useTtsCaptureWord";
import { useAmbientSoundscape } from "../hooks/useAmbientSoundscape";
import { useVisualPacer } from "../hooks/useVisualPacer";
import { useReaderContext } from "../hooks/useReaderContext";
import { useReaderPositionSync } from "../hooks/useReaderPositionSync";
import { useReaderBookAward } from "../hooks/useReaderBookAward";
import { useReaderSessionStart } from "../hooks/useReaderSessionStart";
import { useReaderCalibrationOffer } from "../hooks/useReaderCalibrationOffer";
import { useReaderZenFade } from "../hooks/useReaderZenFade";
import { useReaderDenseStall } from "../hooks/useReaderDenseStall";
import { useReaderPageMetrics } from "../hooks/useReaderPageMetrics";
import { useReaderReflow } from "../hooks/useReaderReflow";
import { useReaderChapterSummary } from "../hooks/useReaderChapterSummary";
import { useReaderTargetEntered } from "../hooks/useReaderTargetEntered";
import { useReaderParagraphFocus } from "../hooks/useReaderParagraphFocus";
import { useReaderSyntacticLines } from "../hooks/useReaderSyntacticLines";
import { useReaderScrollBars } from "../hooks/useReaderScrollBars";
import { useReaderRefMirrors } from "../hooks/useReaderRefMirrors";
import { useReaderRecallStep } from "../hooks/useReaderRecallStep";
import { useReaderPhrases } from "../hooks/useReaderPhrases";
import { useReaderOverlayWiring } from "../hooks/useReaderOverlayWiring";
import { useReaderToast } from "../hooks/useReaderToast";
import { useReaderTtsStopOnNav } from "../hooks/useReaderTtsStopOnNav";
import { useReaderQuoteOverlay } from "../hooks/useReaderQuoteOverlay";
import { useReaderVisibility } from "../hooks/useReaderVisibility";
import { useReaderAppBadge } from "../hooks/useReaderAppBadge";
import { useReaderInitialWord } from "../hooks/useReaderInitialWord";
import { useReaderReducedMotion } from "../hooks/useReaderReducedMotion";
import { useReaderScrollRestoration } from "../hooks/useReaderScrollRestoration";
import { useReaderCapturePositionRef } from "../hooks/useReaderCapturePositionRef";
import { useReaderApplyCachedPredictionRef } from "../hooks/useReaderApplyCachedPredictionRef";
import { useReaderZipfForLemmaRef } from "../hooks/useReaderZipfForLemmaRef";
import { useReaderAnchoring } from "../hooks/useReaderAnchoring";
import { useReaderCheckpoint } from "../hooks/useReaderCheckpoint";
import { useReaderLongPressHint } from "../hooks/useReaderLongPressHint";
import { useReaderRecap } from "../hooks/useReaderRecap";
import { useReaderLongestToast } from "../hooks/useReaderLongestToast";
import { useReaderHelpNotice } from "../hooks/useReaderHelpNotice";
import { useReaderCompanion } from "../hooks/useReaderCompanion";
import { useReaderDeepReadingCycle } from "../hooks/useReaderDeepReadingCycle";
import { useReaderChrome } from "../hooks/useReaderChrome";
import { useReaderResizeRemeasure } from "../hooks/useReaderResizeRemeasure";
import { useReaderUiState } from "../hooks/useReaderUiState";
import { useReaderTrackMove } from "../hooks/useReaderTrackMove";
import { useReaderSelection } from "../hooks/useReaderSelection";
import {
  useReaderNavigation,
  useReaderPagination,
} from "../hooks/useReaderNavigation";
import { useReaderSectionLoader } from "../hooks/useReaderSectionLoader";
import { useReaderSettings } from "../hooks/useReaderSettings";
import { downloadBookMarkdown } from "../lib/export";
import { triggerHaptic } from "../lib/deep-reading";
import {
  isFullscreenSupported,
} from "../lib/fullscreen";
import { useCompanion } from "./CompanionProvider";
import {
  buildChapterCatalog,
  suggestedChapterTarget,
  trackCalibrationOffer,
  targetAt,
  chapterIdFor,
  type ChapterCatalog,
  type ChapterTarget,
  type IntraSectionContext,
  splitHref,
  sectionIndexOf,
} from "../lib/chapters";
import {
  loadBookStart,
  resolveEntryTarget,
  type BookStartRecord,
} from "../lib/book-start";
import {
  createChapterAnalyzer,
  chapterAnalysisCacheKey,
  deserializeChapterAnalysis,
  serializeChapterAnalysis,
  type ChapterAnalyzer,
  type ChapterAnalysis,
} from "../lib/chapter-analysis";
import {
  setBilingualMode,
  type PhraseIndex,
} from "../lib/phrases";

export type ReaderState = "idle" | "opening" | "ready" | "error";
type SheetKind = "toc" | "settings" | "search" | "marks";
export type ReaderSettingsTab = "appearance" | "book" | "strategy";

// Días sin abrir el libro para que aparezca el marcador de retomar:
// una reanudación reciente ya es continua y la tarjeta solo estorba.
const RESUME_CARD_MIN_DAYS = 3;

// Intención de navegación (coordinador T17): todo salto pasa por
// `navigate` y deja registrada de dónde vino — la preparación (T19)
// decide qué interponer según esta intención y el ajuste vigente.
export type NavIntent = "initial" | "chapter" | "resume" | "lookup" | "return";

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
  // El sync de posiciones corre detrás de la apertura. Un cambio de
  // versión pide releer la posición guardada; `resumeRequest` la aplica
  // de forma explícita (conflicto resuelto por el lector).
  positionSyncVersion?: number;
  resumeRequest?: {
    key: number;
    sectionIndex: number;
    ratio?: number;
    anchor?: string;
    anchorOffset?: number;
    resumeAudio?: boolean;
  } | null;
  // El cierre del libro lo decide quien monta el lector (App), y «atrás»
  // del navegador cierra sin pasar por `onBack`. Este hueco deja que el
  // cierre guarde la posición *antes* de desmontar y sincronizar: si el
  // guardado del desmontaje compite con el sync, este último puede leer
  // la fila vieja y devolver otra posición encima.
  positionFlushRef?: { current: (() => Promise<void>) | null };
};

// Caché por sección: la consulta al catálogo se hace una sola vez por
// sección; ajustar el perfil o registrar evidencia reclasifica con
// estos mismos datos sin otra llamada (predictSection es pura).
// Análisis «ready» de un destino: lo que la preparación y las marcas
// necesitan del cache del analizador por rango.
export type ReadyAnalysis = Extract<ChapterAnalysis, { state: "ready" }>;

// Fila del índice: derivada del catálogo de destinos, así la hoja
// navega por destino lógico (sección + fragmento), no solo sección.
export type TocRow = { label: string; index: number; depth: number; target: ChapterTarget };

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

// Título de la barra superior: capítulo o sección si los hay; si no, el
// libro por `bookDisplayName`, que nunca deja ver un hash ni el nombre
// técnico del archivo (regla «Identidad Visible Limpia»).
export function readerTopBarTitle(
  chapterLabel: string | undefined,
  sectionTitle: string | undefined,
  title: string | undefined,
  fileName: string,
): string {
  return chapterLabel || sectionTitle || bookDisplayName({ title, name: fileName });
}

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

// Espacio bajo la selección táctil para los tiradores nativos (gota de
// ~22 px + margen de agarre).
const TOUCH_HANDLE_CLEARANCE_PX = 44;

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
  positionSyncVersion = 0,
  resumeRequest = null,
  positionFlushRef,
}: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureProbeRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const rafPending = useRef(false);
  const lastScrollY = useRef(0);
  // Última fracción publicada al estado (pasos de 0,5 %).
  const lastScrollRatioRef = useRef(0);
  // ¿Hay barra de selección en pantalla? Evita el `setState(null)` por
  // frame del handler de scroll.
  const selButtonVisibleRef = useRef(false);
  // Nodo del contador del retiro: se pinta fuera del ciclo de React.
  const savedForms = useRef<Map<string, MarkLevel>>(new Map());
  // Palabras guardadas del idioma del libro: distractores reales para el
  // hueco del repaso de fin de capítulo (lib/episodic-cloze.ts).
  const savedWordsRef = useRef<SavedWord[]>([]);
  // Claves (`idioma:forma`) de las palabras que ya están en el Cuaderno.
  // Es la memoria con la que la cápsula nace «guardada» en 0 ms, sin
  // esperar a IndexedDB ni rebotar el botón.
  // Claves de las palabras ya guardadas. Es estado (no ref) porque la
  // cápsula de la ficha lo consulta al pintar: nace guardada en el
  // primer frame, sin esperar a IndexedDB.
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const sectionTiming = useRef<{ start: number; startRatio: number; words: number } | null>(null);
  const overlayReleaseRef = useRef<OverlayHandle | null>(null);
  const releaseOverlay = useCallback(() => {
    overlayReleaseRef.current?.release();
    overlayReleaseRef.current = null;
  }, []);
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
  // Refs de anclaje centralizados en useReaderAnchoring (R1 PR-A).
  const { pageAnchorRef, pendingPageRef } = useReaderAnchoring();
  // Intención del último salto — la preparación (T19) la consulta al
  // decidir qué interponer.
  const navIntentRef = useRef<NavIntent>("initial");
  // blob: URLs de las imágenes de la sección visible: se revocan al
  // cambiar de sección (en hydrateSectionImages) y al desmontar.
  const imgUrlsRef = useRef<string[]>([]);
  // loadBlob del zip del EPUB (EPUB no lo declara en su tipo público).
  const loadBlobRef = useRef<((name: string) => Promise<Blob | null>) | null>(null);
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
  // Franja de ayuda de vocabulario al abrir un libro NUEVO (sin
  // posición guardada): pregunta una sola vez por libro; la decisión
  // se guarda en `bookHelp:v1:` y solo mueve el interruptor de
  // micro-destacados — jamás escribe palabras en el Cuaderno.
  const [language, setLanguage] = useState("es");
  const [selection, setSelection] = useState<WordHit | null>(null);
  // Espejo de `selection` para el listener de `selectionchange` (que no se
  // rearma en cada render): cubre los 7 sitios que llaman setSelection.
  const selectionRef = useRef<WordHit | null>(null);
  const keepNativeSelectionRef = useRef(false);
  const reappliedRangeRef = useRef<Range | null>(null);
  useEffect(() => {
    selectionRef.current = selection;
    if (selection) return;
    if (keepNativeSelectionRef.current) {
      keepNativeSelectionRef.current = false;
      return;
    }
    // Al cerrar la ficha (×, toque, atrás, otra hoja) se suelta la
    // selección nativa de una palabra que quedó viva en táctil; la de un
    // pasaje se conserva para la barra.
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !container) return;
    if (!container.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    if (sel.toString().trim().split(/\s+/).filter(Boolean).length <= 1) sel.removeAllRanges();
  }, [selection]);
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
    prepPlanNote,
    dismissPrepPlanNote,
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

  // Palabra inicial (deep link) — extraída a useReaderInitialWord (B7).
  useReaderInitialWord({ readerInitialWord, state, setSelection });

  // La palabra consultada queda resaltada mientras su ficha está
  // abierta: el range del toque se registra con la Custom Highlight
  // API y se limpia al cerrar o al abrir otra — sin tocar el DOM del
  // EPUB ni refluir el texto.
  useEffect(() => {
    const registry =
      typeof CSS !== "undefined" && "highlights" in CSS
        ? CSS.highlights
        : null;
    if (!registry) return;
    const range = selection?.range;
    if (!range) {
      registry.delete("lecta-consulted");
      return;
    }
    try {
      registry.set("lecta-consulted", new Highlight(range));
      return () => {
        registry.delete("lecta-consulted");
      };
    } catch {
      registry.delete("lecta-consulted");
    }
  }, [selection]);

  // Limpieza del badge de la app — extraído a useReaderAppBadge (B7).
  useReaderAppBadge();
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
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings(bookHash));
  const pacerIndexRef = useRef<number>(0);

  // Hook del chrome del lector (R1b): barras, scroll, zen, stall, pacer.
  const {
    barsVisible,
    setBarsVisible,
    scrollRatio,
    setScrollRatio,
    wpm,
    setWpm,
    strategyPaused,
    setStrategyPaused,
    pacerPaused,
    setPacerPaused,
    isZenFaded,
    setIsZenFaded,
    stallBubble,
    setStallBubble,
    toastMessage,
    setToastMessage,
    zenFadeTimerRef,
    denseStallDetectorRef,
    stallBubbleTimerRef,
    lastActivityAtRef,
    lastPointerCheckRef,
  } = useReaderChrome();

  // Hook de estado UI simple (R3i, subconjunto bajo riesgo).
  const {
    calNotice,
    setCalNotice,
    helpNotice,
    setHelpNotice,
    helpIsCalibrated,
    setHelpIsCalibrated,
    showLongPressHint,
    setShowLongPressHint,
    recordToast,
    setRecordToast,
    ttsCapturedToast,
    setTtsCapturedToast,
    glossaryOpen,
    setGlossaryOpen,
    settingsTab,
    setSettingsTab,
    activeBilingualParagraph,
    setActiveBilingualParagraph,
  } = useReaderUiState();

  const focusTelemetryRef = useRef({
    pageEnteredAt: 0,
    lastFlaggedAt: 0,
    recordPageTurn: function(_wordsOnPage = 100, dwellMs?: number) {
      const now = Date.now();
      if (this.pageEnteredAt === 0) this.pageEnteredAt = now;
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

  const [bookOverride, setBookOverride] = useState(() => hasBookReaderSettings(bookHash));
  const [seenStatus, setSeenStatus] = useState(statusText);

  // Track 5: Burbuja "¿En qué me quedé?" tras > 6 horas de inactividad
  const [recapBubbleVisible, setRecapBubbleVisible] = useState(false);
  const [recapBubbleBullets, setRecapBubbleBullets] = useState<string[]>([]);
  const [recapBubbleLoading, setRecapBubbleLoading] = useState(false);
  // Track 12: Ensamblaje Maestro de Ciclo de Vida del Capítulo
  const currentChapterLookups = useRef<EpisodicWordItem[]>([]);
  const chapterStartedAtRef = useRef<number>(0);
  const pendingNextChapterRef = useRef<number | null>(null);
  const [postChapterQueue, setPostChapterQueue] = useState<
    Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>
  >([]);
  const [fatigueSuggestion, setFatigueSuggestion] = useState<FocusSuggestion | null>(null);
  const [sceneRecap, setSceneRecap] = useState<SceneReturnRecap | null>(null);
  const sectionTextRef = useRef<string>("");
  const sessionStartRef = useRef<number>(0);
  const pageTurnTimeRef = useRef<number>(0);
  const longestToastFiredRef = useRef<boolean>(false);
  const intervalsRef = useRef<TimeInterval[]>([]);
  const [dailyGoalMs, setDailyGoalMs] = useState<number>(DAY_GOAL_MS);
  const weeklyWordsCount = getWeeklyLearnedWordsCount();
  const [resumeOverlayData, setResumeOverlayData] = useState<{
    recapLine: string;
    lastReadSentences: string;
    hasPendingReviewsDosing: boolean;
  } | null>(null);

  // Inicialización de refs de tiempo al montar — extraído a useReaderSessionStart (B7).
  useReaderSessionStart({
    sessionStartRef,
    chapterStartedAtRef,
    pageTurnTimeRef,
    focusTelemetryRef,
    setDailyGoalMs,
  });
  // Track 5: Doble toque para traducir párrafo
  const lastTapRef = useRef<{ time: number; element: HTMLElement | null }>({ time: 0, element: null });
  const [returnPoint, setReturnPoint] = useState<{
    sectionIndex: number;
    ratio: number;
    anchor?: string;
    anchorOffset?: number;
  } | null>(null);
  const [selButton, setSelButton] = useState<ReaderSelectionButton | null>(null);
  // Espejo de `selButton` para el handler de scroll (no re-suscribe).
  useEffect(() => {
    selButtonVisibleRef.current = selButton !== null;
  }, [selButton]);
  const lastPointerTypeRef = useRef<string>("mouse");

  // Hook del Retiro de lectura (R1c): estado deep reading + derivados.
  // La lógica de ciclo (finish/start/timer) sigue en Reader.tsx.
  const deepCycle = useReaderDeepReadingCycle({
    sectionIndexRef,
    setBarsVisible,
  });
  const {
    deepModal,
    setDeepModal,
    pageRecap,
    setPageRecap,
    deepReading,
    deepSummary,
    setDeepSummary,
    returnPositions,
    setReturnPositions,
    isDeepReading,
    finishDeepReading,
    startDeepReading,
    deepIndicatorRef,
  } = deepCycle;
  // Nodo de la franja flotante para la cápsula de palabra (portal).
  // Aviso de estado (toast) — extraído a useReaderToast (B7).
  useReaderToast({ statusText, setToastMessage });

  const glossaryReleaseRef = useRef<OverlayHandle | null>(null);
  const quoteReleaseRef = useRef<OverlayHandle | null>(null);
  const summaryReleaseRef = useRef<OverlayHandle | null>(null);

  // Cableado de overlays (glosario, resumen) — extraído a useReaderOverlayWiring (B7).
  useReaderOverlayWiring({
    glossaryOpen,
    setGlossaryOpen,
    deepSummary,
    setDeepSummary,
    glossaryReleaseRef,
    summaryReleaseRef,
  });

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      glossaryReleaseRef.current?.release();
      quoteReleaseRef.current?.release();
      summaryReleaseRef.current?.release();
    };
  }, []);
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
  // Identidad del capítulo en el que está el lector. Sin entrada del
  // índice (libro sin TOC útil) cae a la sección física: la
  // autoevaluación y el repaso a mitad de capítulo siguen existiendo y
  // comparten la misma clave.
  const currentChapterId = chapterIdFor(currentChapterTarget, sectionIndex);

  const [midChapterRecall, setMidChapterRecall] = useState<{ section: number; item: EpisodicWordItem } | null>(null);
  const previousRecallSectionRef = useRef(-1);
  const pendingRecallSectionRef = useRef<number | null>(null);
  // Espejo del paso de sección para recall — extraído a useReaderRecallStep (B7).
  useReaderRecallStep({ sectionIndex, previousRecallSectionRef, pendingRecallSectionRef });
  useEffect(() => {
    if (state !== "ready" || pendingRecallSectionRef.current !== sectionIndex) return;
    pendingRecallSectionRef.current = null;
    if (!isFeatureFlagEnabled("vocabGames") || !isConsolidationActive(bookHash)) return;
    const chapterId = currentChapterId;
    const chapterTitle = currentChapterTarget?.label ?? "";
    const scope = captureDbScope();
    void (async () => {
      const flagKey = midChapterRecallKey(bookHash, chapterId);
      if ((await Promise.resolve(loadSessionValue(flagKey, scope)).catch(() => null)) === "1") return;
      const words = await Promise.resolve(listSavedWords(undefined, scope)).catch(() => []);
      const item = pickMidChapterRecall(words, sectionTextRef.current, language);
      if (!item || sectionIndexRef.current !== sectionIndex) return;
      // La tarjeta no espera a la persistencia: se muestra ya y la marca
      // de «una vez por capítulo» se guarda en segundo plano.
      setMidChapterRecall({ section: sectionIndex, item: { ...item, chapterTitle } });
      void Promise.resolve(saveSessionValue(flagKey, "1", scope)).catch(() => undefined);
    })().catch(() => undefined);
  }, [state, sectionIndex, bookHash, language, currentChapterId, currentChapterTarget]);
  const visibleMidChapterRecall =
    midChapterRecall && midChapterRecall.section === sectionIndex ? midChapterRecall.item : null;
  const solveMidChapterRecall = (outcome?: EpisodicOutcome) => {
    setMidChapterRecall(null);
    if (visibleMidChapterRecall)
      void consolidateEpisodicWord(visibleMidChapterRecall, bookHash, undefined, outcome).catch(() => undefined);
  };
  const skipMidChapterRecall = () => setMidChapterRecall(null);

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
    savePassageRange,
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

  const isQuoteAlreadySaved = useCallback(
    (text?: string | null) => {
      if (!text) return false;
      const clean = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!clean) return false;
      return passages.some((p) => {
        if (p.deleted || !p.text) return false;
        const pClean = p.text.replace(/\s+/g, " ").trim().toLowerCase();
        return (
          pClean === clean ||
          (clean.length >= 10 && (pClean.includes(clean) || clean.includes(pClean)))
        );
      });
    },
    [passages],
  );

  // Cableado del overlay de cita (quoteCard) — extraído a useReaderQuoteOverlay (B7).
  useReaderQuoteOverlay({ quoteCard, setQuoteCard, quoteReleaseRef });
  // Gato acompañante en el lector: el aspecto (etapa, accesorios,
  // nombre, presencia) viene del CompanionProvider único — aquí solo
  // queda el estado visible de la máquina local de lectura.
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
  // El sistema puede pedir movimiento reducido: se trata como ahorro
  // térmico aunque el ajuste esté apagado (mismas reglas de CSS).
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  // Escucha de prefers-reduced-motion — extraído a useReaderReducedMotion (B7).
  useReaderReducedMotion({ setSystemReducedMotion });
  const thermalSaver = settings.thermalSaver || systemReducedMotion;

  const [docHidden, setDocHidden] = useState(() => document.hidden);
  // Espejo de document.hidden — extraído a useReaderVisibility (B7).
  useReaderVisibility({ setDocHidden });

  // Precarga del índice de locuciones: asset estático, una vez por
  // montaje del lector; si no estaba listo para el primer toque el
  // match se omite sin bloquear la ficha.
  // Precarga del índice de locuciones — extraído a useReaderPhrases (B7).
  useReaderPhrases({ phrasesRef });

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

  // Burbuja «¿En qué me quedé?»: callback consumido por el hook del
  // compañero.
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
  }, [settings, bookHash, setStallBubble, stallBubbleTimerRef]);

  // Hook del compañero (R1a): encapsula la máquina local, la presencia,
  // el ajuste de render al ocultar, los timers de toque/guardado y las
  // señales. Ver src/client/hooks/useReaderCompanion.ts.
  const {
    catState,
    catSleepy,
    setCatSleepy,
    catShown,
    catLeaving,
    catTap,
    catSavedWord,
    signalCompanion,
    catGreeting,
    catSuppressed,
    setCatSuppressed,
    presenceActivity,
    presenceIdle,
    presenceReact,
    onCatTap,
    flashCatSavedWord,
    fatigueNotice,
    setFatigueNotice,
  } = useReaderCompanion({
    companion,
    catEnabled,
    presenceMode,
    state,
    presenceOverlay,
    docHidden,
    stallBubble,
    onStallBubbleClick,
    focusTrackerRef,
  });

  // Barra Zen auto-desvanecible (B.1): a los 3s de lectura activa o tras cambiar de página,
  // la barra superior se desvanece suavemente a opacidad 0.15. Un movimiento de ratón o
  // toque en el tercio superior la restaura al 100%.
  const resetZenFadeTimer = useCallback(() => {
    setIsZenFaded(false);
    if (zenFadeTimerRef.current) clearTimeout(zenFadeTimerRef.current);
    zenFadeTimerRef.current = setTimeout(() => {
      setIsZenFaded(true);
    }, 3000);
  }, [setIsZenFaded, zenFadeTimerRef]);

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
  }, [navKey, zenFadeTimerRef, setIsZenFaded, denseStallDetectorRef, stallBubbleTimerRef]);

  // Escucha de actividad de puntero/toques — extraído a useReaderZenFade (B7).
  useReaderZenFade({
    isZenFaded,
    resetZenFadeTimer,
    lastActivityAtRef,
    lastPointerCheckRef,
    zenFadeTimerRef,
  });

  // Chequeo periódico de pasajes densos — extraído a useReaderDenseStall (B7).
  useReaderDenseStall({
    state,
    isDeepReading,
    sectionWords,
    pageCount,
    strategyPreset: settings.strategyPreset,
    denseStallDetectorRef,
    lastActivityAtRef,
    setStallBubble,
    stallBubbleTimerRef,
  });

  if (seenStatus !== statusText) setSeenStatus(statusText);

  const capturePositionRef = useRef<() => SavedBookPosition | null>(() => null);
  // Identidad estable: `useReaderPersistence` la usa como dependencia de su
  // limpieza de desmontaje. Con una flecha nueva en cada render, esa
  // limpieza corría en cada render y escribía la posición en IndexedDB sin
  // parar (verificado en el arnés e2e: decenas de escrituras por segundo).
  const capturePositionForHook = useCallback(
    () => capturePositionRef.current(),
    [],
  );

  const {
    latestPositionRef,
    noteActivity,
    closeActivity,
    saveSoon,
    saveLatest,
  } = useReaderPersistence({
    bookHash,
    isReady: state === "ready",
    capturePosition: capturePositionForHook,
    signalCompanion,
    awardReading: (input, scope, receipt) => award(input, scope, receipt),
    presenceActivity,
    presenceIdle,
    setCatSleepy,
    paused: readingPaused,
    dailyGoalMs,
  });

  // El scroll de lectura vive en el documento (ver reader.css). Al volver
  // con «atrás», el navegador restaura el scroll de la entrada anterior (la
  // estantería, en 0) *antes* de despachar popstate: el cierre medía el tope
  // del capítulo y lo guardaba encima del punto leído. Con la restauración
  // manual el navegador no toca el scroll y el cierre guarda lo que había.
  // Restauración manual del scroll — extraída a useReaderScrollRestoration (B7).
  useReaderScrollRestoration();

  // Quien cierra el libro (App) puede pedir el guardado antes de
  // desmontar. Se guarda la última posición conocida y no una medición
  // nueva: con el gesto de retroceso el historial ya restauró el scroll
  // de la estantería (0) y medir aquí guardaba el principio del capítulo
  // encima del punto leído.
  useEffect(() => {
    if (!positionFlushRef) return;
    positionFlushRef.current = () => saveLatest();
    return () => {
      positionFlushRef.current = null;
    };
  }, [positionFlushRef, saveLatest]);

  const handleBack = useCallback(() => {
    void saveLatest().finally(() => {
      onBack();
    });
  }, [saveLatest, onBack]);

  // Detección de récord mensual (>10 min y supera récord de 30 días) (Fase 1 Anti-Abandono)
  // Aviso de récord mensual de lectura — extraído a useReaderLongestToast (B7).
  useReaderLongestToast({
    state,
    signalCompanion,
    setRecordToast,
    sessionStartRef,
    intervalsRef,
    longestToastFiredRef,
  });

  // Detección de inactividad > 6h — extraído a useReaderRecap (B7).
  useReaderRecap({
    bookHash,
    language,
    containerRef,
    sectionTextRef,
    intervalsRef,
    setJourneySelectorCache,
    setSceneRecap,
    setRecapBubbleVisible,
  });

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

  // Registrar secciones en book-search — extraído a useReaderBookSections (B7).
  useReaderBookSections({ bookHash, state, bookRef, tocRowsRef });

  // Track 5: Contexto de lectura para el gato (personajes sin spoilers en la
  // página visible) — extraído a useReaderContext (B7).
  useReaderContext({
    companion,
    containerRef,
    settingsLayout: settings.layout,
    pageMetrics,
    page,
    sectionIndex,
    bookHash,
    language,
    bookRef,
    tocRowsRef,
    state,
  });

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

  const closeSheet = useCallback(() => {
    releaseOverlay();
    setSheet(null);
  }, [releaseOverlay, setSheet]);

  const openSettings = (tab: ReaderSettingsTab = "appearance") => {
    const resolvedTab = tab === "strategy" ? "appearance" : tab;
    setSettingsTab(resolvedTab);
    openSheet("settings");
  };



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
    let anchorOffset: number | undefined;
    let scrollTop = 0;
    if (layoutRef.current === "pages") {
      const metrics = metricsRef.current;
      ratio = currentRatioNow();
      anchor = metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : undefined;
    } else {
      ratio = scrollRatioNow();
      // Texto del bloque visible + cuánto de él ya pasó por arriba: sin
      // la fracción, restaurar plantaría el inicio del párrafo.
      const viewTop = viewTopAnchor(container);
      anchor = viewTop?.text;
      anchorOffset = viewTop?.offset;
      scrollTop = window.scrollY;
    }
    const pos: SavedBookPosition = {
      bookHash,
      sectionIndex: index,
      scrollTop,
      ratio,
      progress: bookProgress(sizes, index, ratio),
      anchor,
      anchorOffset,
      updatedAt: Date.now(),
    };
    latestPositionRef.current = pos;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          "lecta_active_book_context",
          JSON.stringify({
            bookHash,
            lastOpenedTimestampMs: pos.updatedAt,
            textBeforeCursor: pos.anchor,
          }),
        );
      }
    } catch {
      // Ignore
    }
    return pos;
  }, [bookHash, currentRatioNow, latestPositionRef]);
  // Espejo de capturePosition en ref estable — extraído a
  // useReaderCapturePositionRef (B7).
  useReaderCapturePositionRef({ capturePosition, capturePositionRef });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    [wpm, setWpm],
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
    [classifyCached, setPrediction, bookHash],
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
    [rangeFor, analysisFor, applyCachedPrediction, setEnriching],
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
    [analysisFor, language],
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
  // Las capas del lector son mutuamente excluyentes: abrir una cierra la
  // anterior y reutiliza su entrada de historial cuando existe. La lógica vive
  // en hooks/useReaderSelection.ts.
  const { openSelection, closeSelection } = useReaderSelection({
    language,
    setSelection,
    setSheet,
    setCharOffsetInChapter,
    analyzerRef,
    bookRef,
    catalogRef,
    consultedInPageRef,
    containerRef,
    currentChapterLookups,
    overlayReleaseRef,
    phrasesRef,
    sectionIndexRef,
    sectionTextRef,
    tocRowsRef,
    analysisFor,
    recordConsult,
    signalCompanion,
    trackEvent,
    releaseOverlay,
    noteActivity,
  });

  // Avance o retroceso de navegación hacia la ventana de fatiga; el
  // retroceso queda además en el trayecto. Si la tasa de regresiones
  // supera el umbral: bostezo del gato, aviso por retrocesos y la
  // muestra que lo provocó en el trayecto.
  // Hook de telemetría de movimiento (R3a).
  const { trackMove } = useReaderTrackMove({
    focusTrackerRef,
    sectionIndexRef,
    trackEvent,
    signalCompanion,
    setFatigueNotice,
    bookHash,
  });

  // Cargador de sección: parsea, mide, marca y restaura. La lógica vive en
  // hooks/useReaderSectionLoader.ts.
  const { loadSection } = useReaderSectionLoader({
    onError,
    language,
    setState,
    setSelection,
    setActiveScrollFragment,
    setPage,
    setPageCount,
    setPrediction,
    setScrollRatio,
    setSectionHasImages,
    setSectionIndex,
    setSectionTitle,
    setSectionWords,
    setShowChapterTitle,
    setAnalyzing,
    activeScrollFragRef,
    analyzingTargets,
    bookRef,
    catalogRef,
    chapterStartedAtRef,
    containerRef,
    currentChapterLookups,
    imgUrlsRef,
    layoutRef,
    loadBlobRef,
    pageAnchorRef,
    pageCountRef,
    pageRef,
    pendingPageRef,
    savedForms,
    sectionIndexRef,
    sectionTextRef,
    sectionTiming,
    settingsRef,
    tocRowsRef,
    capturePosition,
    classifyCached,
    computeMetrics,
    currentRatioNow,
    finalizeTiming,
    trackEvent,
    analyzeSection,
    triggerL2Precache,
  });

  // Coordinador de navegación: todo salto registra su intención para
  // que la preparación (T19) sepa si debe interponerse. El destino
  // físico sigue siendo sección + restauración. La lógica vive en
  // hooks/useReaderNavigation.ts.
  const { navigate } = useReaderNavigation({
    loadSection,
    evaluatePreparation,
    setPageIdx,
    setActiveScrollFragment,
    activeScrollFragRef,
    catalogRef,
    containerRef,
    layoutRef,
    metricsRef,
    navIntentRef,
    sectionIndexRef,
    stateRef,
    ttsStopOnNavRef,
  });

  // Sincronización de posición remota sobre el libro ya montado — extraída a
  // useReaderPositionSync (B7).
  useReaderPositionSync({
    resumeRequest,
    positionSyncVersion,
    state,
    bookHash,
    navigate,
    capturePosition,
    captureDbScope,
    onStatus,
    sectionIndexRef,
  });

  // ---------- «Leer en voz alta» ----------
  const {
    ttsRef,
    ttsSnap,
    ttsConsentOpen,
    setTtsConsentOpen,
    voiceSelectorOpen,
    openVoiceSelector,
    closeVoiceSelector,
    selectSystemVoice,
    selectNeuralVoice,
    ttsDownloadProgress,
    isKittenModelDownloaded,
    handleDeleteTtsModel,
    onTtsRequest,
    onTtsConsentAccept,
    togglePlayPause,
    prevSentence,
    nextSentence,
    cycleSpeed,
    setSleepTimer,
    autoAdvanceChapter,
    backgroundAudio,
    setBackgroundAudio,
    setAutoAdvanceChapter,
    stopTts,
    handleStartAudio5Min,
  } = useReaderTts({
    bookHash,
    bookTitle: bookDisplayName({ title, name: fileName }),
    state,
    language,
    sectionIndex,
    sectionIndexRef,
    stateRef,
    containerRef,
    pendingAudioResume: resumeRequest?.resumeAudio
      ? { key: resumeRequest.key, sectionIndex: resumeRequest.sectionIndex }
      : null,
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
    capturePosition,
    setFatigueNotice,
    setFatigueSuggestion,
  });

  // Espejo del stop de TTS al navegar — extraído a useReaderTtsStopOnNav (B7).
  useReaderTtsStopOnNav({ ttsRef, ttsStopOnNavRef });

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
        savedWordsRef.current = storedWords;
        savedForms.current = savedFormLevels(storedWords);
        setSavedKeys(
          new Set(storedWords.map((word) => wordKey(word.language, word.form))),
        );
        recordDominated(storedWords, bookLanguage, scope);
        setLanguage(bookLanguage);
        // Diccionario local: se descarga solo en segundo plano la
        // primera vez que se abre un libro del idioma (ver
        // lib/dictionaryPack.ts); fallos silenciosos a propósito.
        if (bookLanguage === "es" || bookLanguage === "en") {
          const ensure = () =>
            import("../lib/dictionaryPack")
              .then((m) => m.ensureDictionaryPack(bookLanguage))
              .catch(() => undefined);
          if (typeof requestIdleCallback === "function")
            requestIdleCallback(() => void ensure());
          else setTimeout(() => void ensure(), 4000);
        }
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
            const raw = await loadSessionValue(chapterAnalysisCacheKey(bookHash, targetId), scope);
            return raw ? deserializeChapterAnalysis(raw) : null;
          },
          saveCached: async (targetId, result) => {
            const raw = serializeChapterAnalysis(result);
            if (raw) await saveSessionValue(chapterAnalysisCacheKey(bookHash, targetId), raw, scope);
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
          onStatus("");
          return;
        }
        if (entry.kind === "resume") {
          await navigate("resume", {
            index: entry.sectionIndex,
            restore: {
              ratio: entry.ratio,
              anchor: entry.anchor,
              anchorOffset: entry.anchorOffset,
            },
          });

          // Pantalla Única de Reentrada >48h (Fase 1 Anti-Abandono)
          if (saved?.updatedAt && Date.now() - saved.updatedAt > 48 * 3600 * 1000 && !disposed) {
            void (async () => {
              try {
                const offset = containerRef.current
                  ? charOffsetAtViewTop(containerRef.current, sectionTextRef.current)
                  : sectionTextRef.current.length;
                const textBefore = sectionTextRef.current.slice(0, offset) || title;
                const recap = generateZeroSpoilerSceneRecap(
                  textBefore,
                  saved.updatedAt,
                  Date.now(),
                  bookLanguage || "es",
                );
                const recapLine = formatSceneRecapOneLine(recap);
                const lastReadSentences = extractLastSentences(textBefore, 2);
                const allWords = await listSavedWords(undefined, scope).catch(() => []);
                const pendingDueCount = allWords.filter((w) => isReviewDueWord(w, new Date())).length;
                const hasPendingReviewsDosing = pendingDueCount > 25;
                setResumeOverlayData({ recapLine, lastReadSentences, hasPendingReviewsDosing });
              } catch {
                // Silencioso
              }
            })();
          }
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
      savedWordsRef.current = storedWords;
      savedForms.current = savedFormLevels(storedWords);
      setSavedKeys(
        new Set(storedWords.map((word) => wordKey(word.language, word.form))),
      );
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
  // Registra target_entered al entrar a un capítulo — extraído a
  // useReaderTargetEntered (B7).
  useReaderTargetEntered({
    state,
    sectionIndex,
    catalog,
    currentChapterTarget,
    lastTargetEnteredRef,
    trackEvent,
  });

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
      // Táctil: Android dibuja su barra «Copiar / Seleccionar todo» sobre la
      // selección nativa y no hay API para quitarla. Reaplicar la misma
      // selección por código la oculta (y también sus tiradores: el menú
      // pinta tiradores propios). Una vez por rango: el siguiente
      // selectionchange llega con el rango ya aplicado.
      if (isTouchInput(lastPointerTypeRef.current)) {
        const applied = reappliedRangeRef.current;
        const same =
          applied &&
          applied.startContainer === range.startContainer &&
          applied.startOffset === range.startOffset &&
          applied.endContainer === range.endContainer &&
          applied.endOffset === range.endOffset;
        if (!same) {
          const clone = range.cloneRange();
          reappliedRangeRef.current = clone;
          sel.removeAllRanges();
          sel.addRange(clone);
          return;
        }
      }

      const rawText = sel.toString().trim();
      const words = rawText.split(/\s+/).filter(Boolean);
      const singleWordHit = wordHitFromRange(range, container, language);
      const hit: WordHit | null =
        words.length <= 1
          ? singleWordHit ||
            (words[0] ? { word: words[0].replace(/[.,;:!?¡¿"«»()]/g, ""), context: rawText } : null)
          : null;
      const card = selectionRef.current;
      const isTouch = isTouchInput(lastPointerTypeRef.current);
      // Una palabra = ficha directa (Track 4, sin menú intermedio); dos o
      // más = barra de pasajes, cerrando antes la ficha. En táctil la
      // selección nativa queda viva para poder arrastrar los tiradores.
      const intent = classifySelection({
        words: words.length,
        emptyWord: !hit?.word,
        cardOpen: card !== null,
        sheetOpen: card === null && overlayReleaseRef.current !== null,
        sameWord: Boolean(card && hit && sameWordHit(card, hit)),
        isTouch,
      });
      if (intent === "ignore") {
        if (words.length >= 2) setSelButton(null);
        return;
      }
      if (intent === "open-card" && hit) {
        if (!isTouch) window.getSelection()?.removeAllRanges();
        openSelection(hit);
        return;
      }
      if (intent === "close-card-then-bar") {
        // La selección nativa sigue siendo la del menú: el efecto de
        // cierre de la ficha no debe soltarla.
        keepNativeSelectionRef.current = true;
        closeSelection();
      }

      if (words.length >= 2 || (isTouch && hit)) {
        let placement: "top" | "bottom" = isTouch ? "bottom" : "top";
        // En táctil el menú baja más allá de los tiradores nativos (que
        // cuelgan bajo la selección): encima los taparía y el arrastre caería
        // en el menú (visto por adb el 2026-11-11). Arriba queda la barra
        // «Copiar / Seleccionar todo» del sistema.
        const handleClearance = isTouch ? TOUCH_HANDLE_CLEARANCE_PX : 0;
        let y = isTouch ? rect.bottom + handleClearance : rect.top;
        // Reserva para la franja flotante + dock: el menú no debe caer
        // encima de la cápsula ni de las acciones de lectura.
        const bottomReserve = isTouch ? 190 : 96;

        if (
          placement === "bottom" &&
          rect.bottom + handleClearance + bottomReserve > window.innerHeight &&
          rect.top > bottomReserve
        ) {
          placement = "top";
          // En táctil, por encima de la barra del sistema.
          y = rect.top - (isTouch ? TOUCH_HANDLE_CLEARANCE_PX : 0);
        } else if (
          placement === "top" &&
          rect.top < bottomReserve &&
          rect.bottom + bottomReserve <= window.innerHeight
        ) {
          placement = "bottom";
          y = rect.bottom;
        }

        const centerX = rect.left + rect.width / 2;
        const menuHalfW = 170;
        const clampedX = Math.max(menuHalfW + 12, Math.min(centerX, window.innerWidth - menuHalfW - 12));

        setSelButton({
          x: clampedX,
          y,
          placement,
          word: words.length <= 1 && hit ? hit : undefined,
          touch: isTouch,
        });
      } else {
        setSelButton(null);
      }
    };
    const onSelection = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
    // `scroll` dispara en cada frame: sin esta guarda se pedía un
    // `setState(null)` por frame aunque no hubiera nada que ocultar.
    const hide = () => {
      if (!selButtonVisibleRef.current) return;
      selButtonVisibleRef.current = false;
      setSelButton(null);
    };
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", hide);
      window.clearTimeout(timer);
    };
  }, [language, openSelection, closeSelection]);

  // Aviso único de descubrimiento para la pulsación larga en táctil — extraído a
  // useReaderLongPressHint (B7).
  useReaderLongPressHint({ state, setShowLongPressHint });

  // Barras que se retiran al bajar y guardado por ocultar — extraído a
  // useReaderScrollBars (B7).
  useReaderScrollBars({
    saveSoon,
    capturePosition,
    captureDbScope,
    closeActivity,
    noteActivity,
    setBarsVisible,
    setScrollRatio,
    setActiveScrollFragment,
    rafPending,
    lastScrollY,
    lastScrollRatioRef,
    activeScrollFragRef,
    settingsRef,
    containerRef,
    currentSectionTargetsRef,
  });

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
  // Recuento de páginas y resolución del destino pendiente — extraído a
  // useReaderPageMetrics (B7).
  useReaderPageMetrics({
    pageMetrics,
    layoutRef,
    containerRef,
    pageCountRef,
    pendingPageRef,
    pageAnchorRef,
    pageRef,
    setPageCount,
    setPageIdx,
    capturePosition,
    captureDbScope,
  });

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
  // Reflujo al cambiar modo/fuente/tamaño — extraído a useReaderReflow (B7).
  useReaderReflow({
    state,
    settingsLayout: settings.layout,
    settingsFont: settings.font,
    settingsSize: settings.size,
    settingsMeasure: settings.measure,
    settingsLeading: settings.leading,
    layoutRef,
    containerRef,
    latestPositionRef,
    pageAnchorRef,
    remeasure,
  });

  // «Líneas sintácticas» + reubicación del ancla tras el reflujo — extraído a
  // useReaderSyntacticLines (B7).
  useReaderSyntacticLines({
    state,
    strategyPaused,
    focusMode: settings.focusMode,
    syntacticLines: settings.syntacticLines,
    chromaticGuide: Boolean(settings.chromaticGuide),
    chromaticPalette: settings.chromaticPalette,
    bionicAnchors: settings.bionicAnchors,
    paragraphFocus: settings.paragraphFocus,
    visualPacer: Boolean(settings.visualPacer),
    layoutRef,
    containerRef,
    latestPositionRef,
    ttsRef,
    remeasure,
  });

  // Reenfoque del párrafo en modo foco — extraído a useReaderParagraphFocus (B7).
  useReaderParagraphFocus({
    state,
    strategyPaused,
    paragraphFocus: settings.paragraphFocus,
    focusMode: settings.focusMode,
    page,
    sectionIndex,
    containerRef,
  });

  useReaderResizeRemeasure({
    settings: { layout: settings.layout },
    state,
    sectionIndex,
    viewportRef,
    remeasure,
  });

  // Exposición pasiva: la lógica vive en lib/reader-evidence.ts; aquí solo se
  // le pasan los refs y el estado que lee.
  const checkPassiveExposure = useCallback(
    (forward = true) =>
      checkPassiveExposureEvidence(
        { bookRef, consultedInPageRef, pageCountRef, pageEnteredAtRef, pageRef, sectionIndexRef, savedForms, savedWordsRef },
        { language, sectionWords, analysisFor, forward },
      ),
    [analysisFor, sectionWords, language],
  );

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso). La lógica vive en hooks/useReaderNavigation.ts.
  const { goPage, completeChapterTo } = useReaderPagination({
    navigate,
    checkPassiveExposure,
    noteActivity,
    saveSoon,
    trackMove,
    showNotice,
    signalCompanion,
    setPageIdx,
    setBarsVisible,
    setDeepSummary,
    setFatigueSuggestion,
    setPostChapterQueue,
    bookHash,
    language,
    sectionWords,
    sectionTotal,
    bookRef,
    pageRef,
    pageCountRef,
    sectionIndexRef,
    pageTurnTimeRef,
    sessionStartRef,
    chapterStartedAtRef,
    pendingNextChapterRef,
    currentChapterLookups,
    currentChapterPrimedWordsRef,
    savedWordsRef,
    focusTelemetryRef,
    settingsRef,
  });

  // Avanzar a la sección siguiente habiendo llegado casi al final
  // cuenta como tramo terminado: el gato celebra y el capítulo se
  // cierra igual que en modo páginas (consolidación incluida). Saltar
  // por el índice o el buscador no celebra — no es «terminar».
  const navNextSection = (index: number, fragment?: string) => {
    trackMove(false);
    if (currentRatioNow() >= 0.85) {
      void completeChapterTo(index, fragment);
      return;
    }
    void navigate("chapter", { index, fragment });
  };

  const navPrevSection = (index: number, fragment?: string) => {
    trackMove(true);
    void navigate("chapter", { index, fragment });
  };


  // Espejos de ref (layoutRef, pageEnteredAtRef) — extraídos a useReaderRefMirrors (B7).
  useReaderRefMirrors({
    layout: settings.layout,
    layoutRef,
    page,
    sectionIndex,
    pageEnteredAtRef,
    settings,
    settingsRef,
    currentSectionTargets,
    currentSectionTargetsRef,
  });



  // Modo Retiro de lectura: ciclo de sesión inmersiva, bloqueo de pantalla y cierre
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
    // La marca del texto sigue la etapa real de la tarjeta: una palabra
    // asentada no vuelve a «nueva» porque el lector la reencuentre.
    const level = markLevel(word.card);
    savedWordsRef.current = upsertSavedWord(savedWordsRef.current, word);
    const savedKey = wordKey(word.language || language, word.form);
    setSavedKeys((prev) => {
      if (prev.has(savedKey)) return prev;
      const next = new Set(prev);
      next.add(savedKey);
      return next;
    });
    for (const form of [word.form, word.lemma]) {
      if (!form) continue;
      const key = form.toLowerCase();
      if (level) savedForms.current.set(key, level);
      else savedForms.current.delete(key);
    }
    // Reacción afectuosa y alegre del gato al guardar una joya léxica
    flashCatSavedWord();
    // Reclasifica la sección visible: la palabra pasa a «guardada»
    // tanto en la tarjeta como en las marcas del texto.
    applyPrediction(sectionIndexRef.current, language);
    onStatus(`«${word.form}» ya está en tu cuaderno.`);
  }, [language, applyPrediction, onStatus, bookHash, ttsRef, flashCatSavedWord]);

  const handleTtsCaptureWord = useTtsCaptureWord({
    language,
    bookHash,
    ttsRef,
    onWordSaved,
    setTtsCapturedToast,
  });

  const onWordRemoved = (word: SavedWord) => {
    savedWordsRef.current = removeSavedWord(savedWordsRef.current, word.key);
    const removedKey = wordKey(word.language || language, word.form);
    setSavedKeys((prev) => {
      if (!prev.has(removedKey)) return prev;
      const next = new Set(prev);
      next.delete(removedKey);
      return next;
    });
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
  const jumpTo = useCallback((
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
        anchorOffset: pos.anchorOffset,
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
  }, [setReturnPoint, closeSheet, trackMove, navigate, latestPositionRef]);

  const goBack = () => {
    const point = returnPoint;
    setReturnPoint(null);
    if (point) {
      trackMove(point.sectionIndex < sectionIndexRef.current);
      navigate("return", {
        index: point.sectionIndex,
        restore: {
          ratio: point.ratio,
          anchor: point.anchor,
          anchorOffset: point.anchorOffset,
        },
      });
    }
  };

  const handleInternalLinkClick = useCallback((href: string) => {
    const currentPos = capturePosition();
    if (currentPos) {
      setReturnPositions((prev) => [
        ...prev,
        {
          sectionIndex: currentPos.sectionIndex,
          anchor: currentPos.anchor,
          anchorOffset: currentPos.anchorOffset,
          ratio: currentPos.ratio ?? 0,
          scrollTop: currentPos.scrollTop,
          page: settings.layout === "pages" ? page : undefined,
        },
      ]);
    }

    if (href.startsWith("#")) {
      const fragment = href.slice(1);
      void navigate("chapter", { index: sectionIndexRef.current, fragment });
    } else {
      const currSection = bookRef.current?.sections?.[sectionIndexRef.current];
      const resolved = currSection?.resolveHref ? currSection.resolveHref(href) : href;
      const { path, fragment } = splitHref(resolved);
      let targetSectionIdx = bookRef.current ? sectionIndexOf(bookRef.current, path) : -1;
      if (targetSectionIdx < 0 && bookRef.current?.sections) {
        targetSectionIdx = bookRef.current.sections.findIndex((s) => s.id.endsWith(path));
      }
      if (targetSectionIdx >= 0) {
        void navigate("chapter", { index: targetSectionIdx, fragment });
      } else if (fragment) {
        void navigate("chapter", { index: sectionIndexRef.current, fragment });
      }
    }
  }, [capturePosition, settings.layout, page, navigate, setReturnPositions]);

  const handleReturnFromFootnote = useCallback(() => {
    setReturnPositions((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      void navigate("return", {
        index: target.sectionIndex,
        restore: {
          anchor: target.anchor,
          ratio: target.ratio,
        },
      }).then(() => {
        if (
          target.sectionIndex === sectionIndexRef.current &&
          target.page !== undefined &&
          settings.layout === "pages"
        ) {
          setPage(target.page);
        }
      });
      return prev.slice(0, -1);
    });
  }, [navigate, settings.layout, setReturnPositions]);

  // «Releer el capítulo» del marcador de retomar: salta al inicio del
  // destino con jumpTo — eso deja «Volver a donde estaba» armado para
  // regresar a la posición exacta tras el repaso.
  const rereadChapter = useCallback(() => {
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
  }, [resumeCard, setResumeCard, trackEvent, jumpTo]);

  // El modo de preparación lo leen los callbacks de navegación sin
  // Ajustes del lector: la lógica vive en hooks/useReaderSettings.ts.
  const { updateSettings } = useReaderSettings({ bookHash, setSettings, setBookOverride });

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
  const handleActivateFocusRule = useCallback(() => {
    const updatedSettings: ReaderSettings = {
      ...settings,
      paragraphFocus: true,
      focusMode: "paragraph",
    };
    setSettings(updatedSettings);
    saveReaderSettings(updatedSettings, bookHash);
    setFatigueNotice(false);
    setFatigueSuggestion(null);
    triggerHaptic("success");
  }, [settings, bookHash, setFatigueNotice]);

  // Marcador de Aterrizaje Auditivo (Fase 3: Anti-pérdida de posición)
  useTtsLandingMarker(containerRef, bookHash, ttsSnap.status);

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
        alreadySaved: isQuoteAlreadySaved(sel),
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
      alreadySaved: isQuoteAlreadySaved(fallbackText),
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
  // Crédito por libro terminado — extraído a useReaderBookAward (B7).
  useReaderBookAward({ progress, bookHash, signalCompanion });

  // Micro-hitos de página — extraído a useReaderCheckpoint (B7).
  useReaderCheckpoint({ viewRatio, sectionIndex, state, presenceReact });

  // Paisajes sonoros procedurales Web Audio y ronroneo ambiental («Body Doubling» acústico)
  useAmbientSoundscape({
    soundscape: settings.soundscape,
    ambientPurr: settings.ambientPurr,
    strategyPaused,
    state,
    readingPaused,
    ttsStatus: ttsSnap.status,
    startAmbientPurr,
    startSoundscape,
    stopAmbientPurr,
    stopSoundscape,
  });

  // Marcapasos Visual ("Ritmo Guiado" para TDAH)
  useVisualPacer({
    containerRef,
    pacerIndexRef,
    visualPacer: settings.visualPacer,
    pacerWpm: settings.pacerWpm,
    strategyPaused,
    pacerPaused,
    state,
    readingPaused,
  });

  // Invitación a la prueba de vocabulario, una vez por apertura del
  // libro: se ofrece al terminar el primer tramo que el lector leyó
  // (su última sección con la vista casi completa, o ya más allá).
  // Todo lo que decide corre en el dispositivo — sin red hasta que la
  // persona acepta y App descarga la muestra.
  // Oferta automática de calibración — extraído a useReaderCalibrationOffer (B7).
  useReaderCalibrationOffer({
    state,
    sectionIndex,
    viewRatio,
    language,
    rangeFor,
    pendingPageRef,
    setCalNotice,
    trackCalibrationOffer,
  });

  // «Ajustar mi vocabulario»: la descarga corre por App; si la hoja no
  // llegó a abrirse (sin conexión o muestra vacía) el aviso se conserva
  // para reintentar.
  const acceptCalibrationNotice = useCallback(async () => {
    if (await onRequestCalibration(language)) setCalNotice(false);
  }, [onRequestCalibration, language, setCalNotice]);

  // «Ahora no»: cierra la oferta automática — la prueba queda a mano
  // desde Cuenta, con el borrador si se empezó.
  const dismissCalibrationNotice = useCallback(() => {
    setCalNotice(false);
    void saveSessionValue(calibrationDoneKey(language), "1", captureDbScope()).catch(
      () => undefined,
    );
  }, [language, setCalNotice]);

  // Franja de ayuda de vocabulario: se evalúa una vez por apertura,
  // solo entrando por el inicio de un libro nuevo (sin posición
  // guardada o apenas empezado) y solo en es/en — los idiomas con
  // banco y catálogo. Una decisión guardada manda sobre el default
  // del interruptor y no vuelve a preguntar.
  // Aviso de ayuda de vocabulario al abrir — extraído a useReaderHelpNotice (B7).
  useReaderHelpNotice({
    state,
    sectionIndex,
    language,
    bookHash,
    setHelpIsCalibrated,
    setHelpNotice,
  });

  const saveHelpDecision = useCallback((value: "on" | "off" | "dismissed") => {
    void saveSessionValue(bookHelpKey(bookHash), value, captureDbScope()).catch(
      () => undefined,
    );
  }, [bookHash]);

  // «Sí, prepárame» / «Activar ayudas»: enciende la ayuda del libro.
  const acceptHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveBookMicroHighlightsEnabled(bookHash, true);
    saveHelpDecision("on");
  }, [bookHash, saveHelpDecision, setHelpNotice]);

  // «Medir mi nivel en 15 s»: abre la prueba; al aceptar la ayuda
  // queda encendida y la franja se cierra. Si la hoja no abrió, el
  // aviso se conserva para reintentar, igual que el de calibración.
  const calibrateHelpNotice = useCallback(async () => {
    if (await onRequestCalibration(language)) {
      setHelpNotice(false);
      saveBookMicroHighlightsEnabled(bookHash, true);
      saveHelpDecision("on");
    }
  }, [onRequestCalibration, language, bookHash, saveHelpDecision, setHelpNotice]);

  // «No, gracias»: apaga los micro-destacados de este libro y no
  // vuelve a preguntar.
  const declineHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveBookMicroHighlightsEnabled(bookHash, false);
    saveHelpDecision("off");
  }, [bookHash, saveHelpDecision, setHelpNotice]);

  // «Ahora no» (×): cierra sin apagar nada — la preferencia queda
  // registrada para no insistir en cada apertura.
  const dismissHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveHelpDecision("dismissed");
  }, [saveHelpDecision, setHelpNotice]);

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
  // Resumen de capítulo al final del tramo — extraído a useReaderChapterSummary (B7).
  useReaderChapterSummary({
    atChapterEnd,
    endTarget,
    endRange,
    bookHash,
    visitIdRef,
    setEndSummary,
  });

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

  // Variables calculadas para el JSX (R3h Fase 1): estabilizar identidades.
  const isSavedInitial =
    selection != null && savedKeys.has(wordKey(language, selection.word));
  const currentChapterTitle =
    currentChapterTarget?.label ??
    catalog?.targets?.find((t) => t.sectionIndex === sectionIndex)?.label ??
    sectionTitle;
  const featuredQuote =
    postChapterQueue.find((q) => q.item.chapterSentence?.trim())?.item.chapterSentence?.trim() ||
    passages.find((p) => !p.deleted && p.sectionIndex === sectionIndex && p.text?.trim())?.text?.trim();

  const handleKnowledgeChanged = useCallback((row: KnownWord, { form, kind }: { form: string; kind: "saved" | "declared" }) => {
    applyKnowledgeRow(row);
    try {
      const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
      if (kind === "saved") {
        void scheduleCapturedReview(form, bookHash, undefined, currentLang).catch(() => {});
      }
    } catch {
      // Ignorar fallo al programar el repaso
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
  }, [applyKnowledgeRow, language, bookHash, trackEvent, sectionIndexRef]);

  const wordPassageActions = useMemo(() => {
    if (!selection) return undefined;
    return {
      onHighlight: selection.range
        ? (tone: "amber" | "salvia" | "dario") => {
            // La tinta de la ficha subraya la oración entera, no solo la
            // palabra tocada; sin oración medible cae a la palabra.
            const range = sentenceRangeForHit(selection, language) ?? selection.range;
            closeSelection();
            if (range) void savePassageRange(range, tone);
          }
        : undefined,
      onQuoteCard: () => {
        const text = selection.context || selection.word;
        closeSelection();
        openQuoteCardFromSelection(text);
      },
      onAsk: () => {
        const word = selection.word;
        const passage = selection.context || selection.word;
        closeSelection();
        void askCatAboutSelection({ word, passage });
      },
      onDeepRead: () => {
        closeSelection();
        setDeepModal(true);
      },
    };
  }, [selection, language, closeSelection, savePassageRange, openQuoteCardFromSelection, askCatAboutSelection, setDeepModal]);

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
      data-thermal-saver={thermalSaver ? "true" : undefined}
    >
      <div
        ref={measureProbeRef}
        aria-hidden="true"
        className="measure-probe"
      />
      <ReaderTopBar
        onBack={handleBack}
        title={readerTopBarTitle(currentChapterTarget?.label, sectionTitle, title, fileName)}
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
        onCloseSelection={closeSelection}
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
        selButton={selButton}
        setSelButton={setSelButton}
        extractWordAtPoint={extractWordAtPoint}
        handleContainerDoubleClick={handleContainerDoubleClick}
        handleTriggerReturnRecap={handleTriggerReturnRecap}
        toggleParagraphTranslation={toggleParagraphTranslation}
        lastPointRef={lastPoint}
        lastTapRef={lastTapRef}
        lastPointerTypeRef={lastPointerTypeRef}
        pacerIndexRef={pacerIndexRef}
        midChapterRecall={visibleMidChapterRecall}
        onMidChapterRecallSolve={solveMidChapterRecall}
        onMidChapterRecallSkip={skipMidChapterRecall}
        onInternalLinkClick={handleInternalLinkClick}
        onBack={handleBack}
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
        prepPlanNote={prepPlanNote}
        dismissPrepPlanNote={dismissPrepPlanNote}
        calNotice={calNotice}
        prep={prep}
        prepNotice={prepNotice}
        isDeepReading={isDeepReading}
        acceptCalibrationNotice={acceptCalibrationNotice}
        dismissCalibrationNotice={dismissCalibrationNotice}
        helpNotice={helpNotice}
        helpIsCalibrated={helpIsCalibrated}
        acceptHelpNotice={acceptHelpNotice}
        calibrateHelpNotice={calibrateHelpNotice}
        declineHelpNotice={declineHelpNotice}
        dismissHelpNotice={dismissHelpNotice}
        fatigueNotice={fatigueNotice}
        setFatigueNotice={setFatigueNotice}
        onActivateFocusRule={handleActivateFocusRule}
        onStartAudio5Min={handleStartAudio5Min}
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
          openVoiceSelector={openVoiceSelector}
          ttsSnap={ttsSnap}
          onTtsRequest={onTtsRequest}
          togglePlayPause={togglePlayPause}
          prevSentence={prevSentence}
          nextSentence={nextSentence}
          cycleSpeed={cycleSpeed}
          setSleepTimer={setSleepTimer}
          autoAdvanceChapter={autoAdvanceChapter}
          setAutoAdvanceChapter={setAutoAdvanceChapter}
          backgroundAudio={backgroundAudio}
          setBackgroundAudio={setBackgroundAudio}
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
          progress={progress}
          weeklyWordsCount={weeklyWordsCount}
          recordToast={recordToast}
          onDismissRecordToast={() => setRecordToast(null)}
          isReadingActive={!readingPaused && !barsShown}
          onStartAudio5Min={handleStartAudio5Min}
        />
      ) : null}

      {resumeOverlayData && (
        <div className="resume-session-overlay-wrapper">
          <ResumeSessionOverlay
            recapLine={resumeOverlayData.recapLine}
            lastReadSentences={resumeOverlayData.lastReadSentences}
            hasPendingReviewsDosing={resumeOverlayData.hasPendingReviewsDosing}
            onResumeReading={() => setResumeOverlayData(null)}
          />
        </div>
      )}

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
        deepIndicatorRef={deepIndicatorRef}
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
        selButton={selButton}
        setSelButton={setSelButton}
        savePassageSelection={savePassageSelection}
        openQuoteCardFromSelection={openQuoteCardFromSelection}
        askCatAboutSelection={askCatAboutSelection}
        setDeepModal={setDeepModal}
        onDefine={openSelection}
        containerRef={containerRef}
      />

      <ReaderFloatingLane>
        {toastMessage ? (
          <div role="status" aria-live="polite" className="reader-status-toast">
            {toastMessage}
          </div>
        ) : (
          <div role="status" aria-live="polite" className="sr-only">
            {statusText || ""}
          </div>
        )}

        {showLongPressHint && !toastMessage ? (
          <div className="reader-hint-toast" role="status" aria-live="polite">
            Mantén presionada una palabra para ver su significado o subrayar.
          </div>
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

        {returnPositions.length > 0 ? (
          <div className="reader-return">
            <button
              type="button"
              className="reader-return-btn"
              onClick={handleReturnFromFootnote}
            >
              ← Volver a la lectura
            </button>
            <button
              type="button"
              className="reader-return-dismiss"
              onClick={() => setReturnPositions([])}
              aria-label="Descartar retorno"
            >
              ×
            </button>
          </div>
        ) : null}

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
      </ReaderFloatingLane>
      <ReaderOverlays
        bookHash={bookHash}
        bookTitle={title}
        author={author}
        language={language}
        sectionIndex={sectionIndex}
        signedIn={signedIn}
        selection={selection}
        zipfForForm={zipfForForm}
        // La ficha nace con el estado real del Cuaderno: sin esto el
        // primer toque podía re-guardar una palabra ya guardada.
        isSavedInitial={isSavedInitial}
        onCloseSelection={closeSelection}
        // Acciones de pasaje en la ficha de palabra: cada una cierra la
        // ficha y ejecuta la acción sobre su palabra o su frase.
        wordPassageActions={wordPassageActions}
        onWordSaved={onWordSaved}
        onWordRemoved={onWordRemoved}
        onKnowledgeChanged={handleKnowledgeChanged}
        bookSections={bookSections}
        toc={catalog?.targets?.map((t) => ({ index: t.sectionIndex, label: t.label }))}
        charOffsetInChapter={charOffsetInChapter}
        currentChapterId={currentChapterId}
        currentChapterTitle={currentChapterTitle}
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
          // Misma regla que «Ya la sé» en la ficha: una sola forma de mover θ.
          applyPreviewKnownSignal(currentLang, beta);
          const scope = captureDbScope();
          void saveKnowledge({ language: currentLang, lemma, known: true, source: "inferred" }, scope);
        }}
        onSaveToPractice={(lemma, beta) => {
          const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
          // «Quiero aprenderla» = no la conocía: la misma señal que consultarla.
          applyWordPanelLookupSignal(currentLang, beta);
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
          )
            .then(({ word }) => {
              savedWordsRef.current = upsertSavedWord(savedWordsRef.current, word);
            })
            .catch(() => {});
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
        quoteCard={
          quoteCard
            ? {
                ...quoteCard,
                alreadySaved:
                  quoteCard.alreadySaved ??
                  isQuoteAlreadySaved(quoteCard.text),
              }
            : null
        }
        onCloseQuoteCard={() => setQuoteCard(null)}
        onSaveQuoteCardPassage={(text) => void savePassageDirectly(text)}
        featuredQuote={featuredQuote}
        deepModal={deepModal}
        onStartDeepReading={(config) => void startDeepReading(config)}
        onCloseDeepModal={() => setDeepModal(false)}
        deepSummary={deepSummary}
        postChapterQueue={postChapterQueue}
        onShareDeepSummaryQuote={(quote) => {
          if (summaryReleaseRef.current) {
            quoteReleaseRef.current?.release();
            quoteReleaseRef.current = summaryReleaseRef.current;
            summaryReleaseRef.current = null;
            quoteReleaseRef.current.swap(() => setQuoteCard(null));
          }
          setDeepSummary(null);

          const chosenQuote =
            quote?.trim() ||
            postChapterQueue.find((q) => q.item.chapterSentence?.trim())?.item.chapterSentence?.trim() ||
            "La lectura profunda transforma el tiempo en memoria viva.";

          setQuoteCard({
            text: chosenQuote,
            bookTitle: title,
            author,
            chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
            alreadySaved: isQuoteAlreadySaved(chosenQuote),
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
        onWordConsolidated={onWordSaved}
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
        ttsVoiceSelectorOpen={voiceSelectorOpen}
        ttsSnap={ttsSnap}
        onSelectSystemVoice={selectSystemVoice}
        onSelectNeuralVoice={selectNeuralVoice}
        onCloseVoiceSelector={closeVoiceSelector}
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
