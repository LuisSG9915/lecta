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
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
} from "../lib/epub";
import { sanitizeSectionDocument } from "../lib/sanitize";
import { markWords } from "../lib/marks";
import {
  getActiveUserId,
  listAllKnowledge,
  listKnowledge,
  listSavedWords,
  loadBookPosition,
  saveBookPosition,
  saveKnowledge,
  saveReadingInterval,
  saveSessionValue,
  loadSessionValue,
  type KnownWord,
  type SavedWord,
  type SavedBookPosition,
  type SavedInterval,
} from "../lib/idb";
import { batchLookup, enrichBatch } from "../lib/lexicon";
import {
  selectEnrichmentCandidates,
  selectSavedForEnrichment,
} from "../lib/enrichment-candidates";
import { hasUsableDefinition } from "../../shared/lexicon";
import {
  estimateProfile,
  isCredibleKnowledge,
  knowledgeEvidence,
  predictSection,
  type KnowledgeEvidence,
  type SectionPrediction,
  type VocabProfile,
} from "../lib/knowledge";
import {
  buildSuggestionRows,
  toKnowledgeMap,
  type SuggestionRows,
} from "../lib/section-words";
import {
  pruneReadingHistory,
  trackReadingEvent,
  type VisitEventDraft,
} from "../lib/reading-events";
import {
  countWords,
  bookProgress,
  minutesLeft,
  updateWpm,
  DEFAULT_WPM,
} from "../lib/progress";
import {
  loadReaderSettings,
  saveReaderSettings,
  hasBookReaderSettings,
  clearBookReaderSettings,
  hasExplicitPreparationMode,
  readerCssVars,
  READER_LIMITS,
  READER_FONTS,
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
  type PageLayout,
} from "../lib/pagination";
import {
  pushAnnotationsToServer,
  pushActivityToServer,
} from "../lib/reading-sync";
import { IDLE_MS, MIN_INTERVAL_MS, ROLL_MS } from "../lib/reading-activity";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import {
  dominatedLemmas,
  markLevel,
  savedFormLevels,
  type MarkLevel,
} from "../lib/word-level";
import { loadUseAi } from "../lib/ai-pref";
import WordPanel from "./WordPanel";
import SectionPreview, { type SectionPreviewRow } from "./SectionPreview";
import Sheet from "./Sheet";
import ThemeMenu from "./ThemeMenu";
import {
  buildChapterCatalog,
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
  type ChapterAnalyzer,
  type ChapterAnalysis,
} from "../lib/chapter-analysis";
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
const PROFILE_ADJUST_KEY = "profileAdjust";
const previewHiddenKey = (hash: string) => `previewHidden:${hash}`;
// Tope del lote automático de definiciones con IA por sección.
const AUTO_ENRICH_CAP = 20;

const clampNumber = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Registra las palabras dominadas (repasadas, con ≥90 días de
// estabilidad) como evidencia «conocida» inferida: alimenta el
// modelo de conocimiento sin que el lector declare nada. Solo rellena
// huecos — una respuesta explícita del lector jamás se reescribe y una
// lápida no se revive. Es auxiliar: corre suelta y un fallo no
// interrumpe la carga.
export const recordDominated = (words: SavedWord[], lang: string) =>
  (async () => {
    const lemmas = dominatedLemmas(words);
    if (!lemmas.length) return;
    const existing = new Set(
      (await listAllKnowledge(lang)).map((row) => row.lemma),
    );
    for (const lemma of lemmas)
      if (!existing.has(lemma))
        await saveKnowledge({
          language: lang,
          lemma,
          known: true,
          source: "inferred",
        });
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

  const [state, setState] = useState<ReaderState>("idle");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [sectionTotal, setSectionTotal] = useState(0);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionSizes, setSectionSizes] = useState<number[]>([]);
  const [sectionWords, setSectionWords] = useState(0);
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
  const [language, setLanguage] = useState("es");
  const [selection, setSelection] = useState<WordHit | null>(null);
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
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageMetrics, setPageMetrics] = useState<PageLayout | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  // Segmento de lectura abierto: empieza con la primera señal real y
  // termina donde quedó la última — el rato que sigue sin señales no
  // cuenta. `paused` lo cierran las hojas, los paneles y la pestaña
  // oculta: hojas/repaso/inactividad no son lectura.
  const activityRef = useRef<{ startedAt: number; lastActiveAt: number } | null>(null);
  const pausedRef = useRef(true);

  if (seenStatus !== statusText) setSeenStatus(statusText);

  const releaseOverlay = () => {
    overlayRelease.current?.release();
    overlayRelease.current = null;
  };

  // Cierra el segmento abierto y, si duró lo bastante, lo guarda como
  // intervalo inmutable. Termina en la última señal, no en «ahora»:
  // los segundos quietos antes de la pausa tampoco cuentan.
  const closeActivity = useCallback(() => {
    const seg = activityRef.current;
    activityRef.current = null;
    if (!seg) return;
    const endedAt = Math.min(seg.lastActiveAt, Date.now());
    if (endedAt - seg.startedAt < MIN_INTERVAL_MS) return;
    const interval: SavedInterval = {
      id: crypto.randomUUID(),
      bookHash,
      startedAt: seg.startedAt,
      endedAt,
    };
    void saveReadingInterval(interval).then(() =>
      pushActivityToServer([interval]),
    );
  }, [bookHash]);

  // Toda señal de lectura real pasa por aquí: scroll, cambio de página,
  // flechas, toques en el texto y consultas de palabra. Con hoja,
  // panel o pestaña oculta la señal se ignora.
  const noteActivity = useCallback(() => {
    if (pausedRef.current || document.hidden) return;
    const now = Date.now();
    const seg = activityRef.current;
    if (!seg) activityRef.current = { startedAt: now, lastActiveAt: now };
    else seg.lastActiveAt = now;
  }, []);

  // Las capas del lector son mutuamente excluyentes: abrir una cierra
  // la anterior y reutiliza su entrada de historial cuando existe. Si
  // la entrada salió vía «atrás», el close deja el ref limpio para que
  // la siguiente capa empuje una entrada nueva.
  const openSelection = (hit: WordHit) => {
    noteActivity();
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
  useEffect(() => {
    pausedRef.current =
      sheet !== null || panelsOpen || state !== "ready" || prep !== null;
    if (pausedRef.current) closeActivity();
  }, [sheet, panelsOpen, state, prep, closeActivity]);

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
        }
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [closeActivity]);

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
      // eslint-disable-next-line react-hooks/purity -- captura bajo evento/scroll, no corre en render
      updatedAt: Date.now(),
    };
    latestPosition.current = pos;
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash]);

  // Guardado con debounce: igual que al hacer scroll, también sirve al
  // pasar de página.
  const saveSoon = useCallback(() => {
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos);
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
  const finalizeTiming = useCallback(
    (endRatio: number) => {
      const timing = sectionTiming.current;
      if (!timing) return;
      sectionTiming.current = null;
      const wordsRead = Math.max(0, (endRatio - timing.startRatio) * timing.words);
      const spent = Date.now() - timing.start;
      const next = updateWpm(wpm, wordsRead, spent);
      if (next !== null && next !== wpm) {
        setWpm(next);
        void saveSessionValue(WPM_KEY, String(next));
      }
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
      const book = bookRef.current;
      const range = rangeFor(index);
      const analysis = analysisFor(index);
      if (!book || !range || !analysis) return;
      if (enrichedTargets.current.has(range.target.id)) return;
      if (!useAiRef.current || !getActiveUserId()) return;
      const candidates = selectEnrichmentCandidates(
        prediction,
        analysis.capitalOnly,
        knowledgeMapRef.current,
        AUTO_ENRICH_CAP,
      );
      if (!candidates.length) return;
      enrichedTargets.current.add(range.target.id);
      setEnriching({ index, done: 0, total: candidates.length });
      const batch = await enrichBatch(candidates, lang);
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
        const result = await batchLookup(candidates, lang);
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
      void trackReadingEvent({ ...draft, visitId, bookHash });
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
    if (!cached) return null;
    for (const entries of Object.values(cached.entries)) {
      const hit = entries.find((entry) => entry.lemma === lemma);
      if (hit) return hit.zipf;
    }
    return null;
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
      void savePreparationRecord({
        ...current.record,
        // eslint-disable-next-line react-hooks/purity -- cierre por acción del lector, no corre en render
        updatedAt: Date.now(),
      }).catch(() => undefined);
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
      const cat = catalogRef.current;
      const analyzer = analyzerRef.current;
      const book = bookRef.current;
      const range = cat?.ranges.find((r) => r.target.id === target.id);
      if (!cat || !analyzer || !book || !range) return;
      const lang = getBookLanguage(book);
      const base =
        record ??
        (await loadPreparationRecord(bookHash, target.id).catch(() => null)) ??
        // eslint-disable-next-line react-hooks/purity -- apertura por clic, no corre en render
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
      if (via === "enter") {
        // Entrar a otra sección del mismo destino no reevalúa: solo
        // la primera evaluación del libro o un cambio real de destino
        // disparan la decisión. `prevTargetId` viene de navigate y
        // distingue «intro → cap1» de «cap1 §2 → cap1 §3».
        const first = prepEvaluated.current == null;
        if (!first && prevTargetId === target.id) return;
        prepEvaluated.current = target.id;
      }
      const record = await loadPreparationRecord(bookHash, target.id).catch(
        () => null,
      );
      if (bookRef.current !== book) return;
      const decision = decidePreparation({
        mode: settingsRef.current?.preparationMode ?? "auto",
        intent: via,
        record,
        noticeDismissed: prepDismissed.current.has(target.id),
      });
      if (decision.opening === "prepare") {
        setPrepNotice(null);
        void openPrepSheet(target, record);
        return;
      }
      if (decision.opening === "notice" || decision.opening === "summary") {
        if (decision.opening === "summary" && record)
          void savePreparationRecord(
            acknowledgePreparationEntry(record, Date.now()),
          ).catch(() => undefined);
        const cached = analyzerRef.current?.cached(target.id);
        setPrepNotice({
          target,
          summary: decision.opening === "summary",
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
      // eslint-disable-next-line react-hooks/purity -- respuesta por clic, no corre en render
      updatedAt: Date.now(),
    };
    const next = { ...current, answers, record };
    prepRef.current = next;
    setPrep(next);
    void savePreparationRecord(record).catch(() => undefined);
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
    const rows: PreparationRow[] = [...current.rows, ...current.uncertain].map(
      (row) => lex.get(row.key) ?? { form: row.form, lemma: row.lemma },
    );
    const record: PreparationRecord = {
      ...current.record,
      answers: current.answers,
      disposition: "reviewed",
      // eslint-disable-next-line react-hooks/purity -- handler async de clic, no corre en render
      updatedAt: Date.now(),
    };
    // La disposición final queda en prepRef antes de cerrar: el
    // persist de closePrepLayer guarda este registro, no el borrador.
    prepRef.current = { ...withSaving, record };
    const result = await confirmPreparation({
      record,
      recordKey: preparationRecordKey(bookHash, current.target.id),
      knowledge: buildPreparationEvidence(language, rows, current.answers),
      words: buildPreparationWords(language, rows, current.answers, bookHash),
    });
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
      // eslint-disable-next-line react-hooks/purity -- handler de clic, no corre en render
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
    void savePreparationRecord(record).catch(() => undefined);
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
  const refreshProfile = useCallback(async (lang: string) => {
    const [rows, words] = await Promise.all([
      listKnowledge(lang).catch(() => [] as KnownWord[]),
      listSavedWords(lang).catch(() => [] as SavedWord[]),
    ]);
    const savedLemmas = new Set<string>();
    for (const word of words)
      for (const term of [word.form, word.lemma])
        if (term) savedLemmas.add(term.toLowerCase());
    for (const form of savedForms.current.keys()) savedLemmas.add(form);
    const credible = rows.filter((row) =>
      isCredibleKnowledge(row, savedLemmas),
    );
    const map = toKnowledgeMap(credible);
    // Lo escrito esta sesión y todavía no visible en la lectura del
    // store no se pierde al recargar (el lote de preparación corre
    // antes de que el put sea observable).
    const fetched = new Set(credible.map((row) => row.lemma));
    const localOnly = [...pendingKnowledgeRef.current].filter(
      (lemma) => !fetched.has(lemma),
    );
    for (const lemma of localOnly) {
      const local = knowledgeMapRef.current.get(lemma);
      if (local) map.set(lemma, local);
    }
    pendingKnowledgeRef.current.clear();
    knowledgeMapRef.current = map;
    const items = [...map.values()];
    const result = items.length
      ? await batchLookup(
          items.map((item) => item.lemma),
          lang,
        )
      : null;
    // Catálogo caído: se conservan los lemas sin medición — el umbral
    // queda en su default, pero el mapa no pierde las respuestas. La
    // medición ya resuelta localmente (p. ej. por la respuesta de
    // preparación) sobrevive aunque el catálogo no la traiga aún.
    const prevEvidence = evidenceRef.current;
    const nextEvidence = knowledgeEvidence(
      items,
      result?.ok ? result.entries : {},
    );
    for (const lemma of localOnly) {
      const prev = prevEvidence.get(lemma);
      if (prev && nextEvidence.get(lemma)?.zipf == null)
        nextEvidence.set(lemma, prev);
    }
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

      finalizeTiming(currentRatioNow());
      setState("opening");
      setSelection(null);
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
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

        const total = countWords(text);
        const tocLabel = tocRowsRef.current.find((row) => row.index === index)?.label;

        setSectionWords(total);
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
            pendingPageRef.current = restore;
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
                  ? scrollToAnchor(container, restore.anchor)
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
            if (pos) void saveBookPosition(pos);
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

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const loadBook = async () => {
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
      void pruneReadingHistory();
      setPrediction(null);
      setPrep(null);
      setPrepNotice(null);
      setAnalyzing(false);
      setEnriching(null);
      try {
        const { book, close } = await openEpub(file);
        if (disposed) {
          void close();
          return;
        }
        cleanup = close;
        bookRef.current = book;
        const bookLanguage = getBookLanguage(book);
        const storedWords = await listSavedWords(bookLanguage);
        savedForms.current = savedFormLevels(storedWords);
        recordDominated(storedWords, bookLanguage);
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
        });
        const rows: TocRow[] = catalog.targets.map((target) => ({
          label: target.label,
          index: target.sectionIndex,
          depth: target.depth,
          target,
        }));
        tocRowsRef.current = rows;
        setTocRows(rows);

        const storedWpm = Number(await loadSessionValue(WPM_KEY));
        if (storedWpm >= 100 && storedWpm <= 600) setWpm(storedWpm);

        // Perfil del lector: evidencia por lema + zipf medido. Corre en
        // paralelo con la primera sección; al llegar, reclasifica lo
        // que haya pintado (y marca las predichas). La preferencia de
        // la tarjeta es por libro; el ajuste del umbral, por sesión.
        const storedAdjust = Number(await loadSessionValue(PROFILE_ADJUST_KEY));
        adjustRef.current = Number.isFinite(storedAdjust) ? storedAdjust : 0;
        const previewPref = await loadSessionValue(previewHiddenKey(bookHash));
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
        const profileReady = refreshProfile(bookLanguage);

        // Entrada única (T18): posición → reanudar; registro previo →
        // destino elegido; ninguno → preguntar sin renderizar la
        // sección cero. La elección se guarda como `bookStart:v1`,
        // separada del avance.
        const saved = await loadBookPosition(bookHash);
        const start = await loadBookStart(bookHash).catch(() => null);
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
      const storedWords = await listSavedWords(language);
      savedForms.current = savedFormLevels(storedWords);
      recordDominated(storedWords, language);
      await refreshProfile(language);
      // Guardadas sin definición: un solo lote por apertura del
      // libro — el lector ya dijo que no las sabe, completarlas vale
      // más que perseguir candidatas del análisis.
      if (!savedEnrichSentRef.current) {
        savedEnrichSentRef.current = true;
        const aiOn = await loadUseAi().catch(() => true);
        if (aiOn && getActiveUserId()) {
          const forms = selectSavedForEnrichment(
            storedWords,
            new Set(),
            AUTO_ENRICH_CAP,
          );
          if (forms.length) void enrichBatch(forms, language);
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
    void listAnnotations(bookHash).then(setAnnotations);
  }, [bookHash]);

  // Preferencia «Usar IA» (una sola lectura por apertura del libro).
  // Con ella apagada, el enriquecimiento automático ni se ofrece ni se
  // llama; la tarjeta igual muestra las predichas sin definición.
  useEffect(() => {
    let cancelled = false;
    void loadUseAi().then((on) => {
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
      noteActivity();
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
      });
    };
    // Al salir de la página no hay debounce que esperar: guardar ya.
    const onHide = () => {
      if (document.visibilityState === "hidden") closeActivity();
      if (document.visibilityState !== "hidden") return;
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos);
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
        if (pos) void saveBookPosition(pos);
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
        if (sectionIndexRef.current + 1 < sectionTotal)
          void navigate("chapter", { index: sectionIndexRef.current + 1 });
        return;
      }
      setPageIdx(next);
      saveSoon();
    },
    [navigate, saveSoon, sectionTotal, setPageIdx, noteActivity],
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
      void saveBookPosition({ ...pos, updatedAt: Date.now() });
    };
  }, [bookHash, closeActivity]);

  // ← / → cambian de sección cuando no hay hojas, paneles ni campos
  // enfocados. Tab siempre trae las barras de vuelta.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") setBarsVisible(true);
      if (selection || sheet || panelsOpen) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") noteActivity();
      if (event.key === "ArrowLeft") {
        if (layoutRef.current === "pages") goPage(-1);
        else if (sectionIndex > 0) void navigate("chapter", { index: sectionIndex - 1 });
      }
      if (event.key === "ArrowRight") {
        if (layoutRef.current === "pages") goPage(1);
        else if (sectionIndex + 1 < sectionTotal) void navigate("chapter", { index: sectionIndex + 1 });
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
  }, [selection, sheet, panelsOpen, sectionIndex, sectionTotal, navigate, goPage, noteActivity]);

  const onWordSaved = (word: SavedWord) => {
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
    void saveBookStart(bookHash, choice).catch(() => undefined);
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
    if (point)
      navigate("return", {
        index: point.sectionIndex,
        restore: { ratio: point.ratio, anchor: point.anchor },
      });
  };

  const refreshAnnotations = async () => {
    setAnnotations(await listAnnotations(bookHash));
  };

  const pushAnnotation = (entry: SavedAnnotation) => {
    setAnnotations((prev) => [...prev.filter((a) => a.key !== entry.key), entry]);
    void pushAnnotationsToServer([entry]);
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
    pushAnnotation(await saveAnnotation(makeBookmark(bookHash, sectionIndex, anchor)));
    onStatus("Marcador guardado en este lugar.");
  };

  const removeMark = async (key: string) => {
    const tombstone = await removeAnnotation(key);
    if (tombstone) void pushAnnotationsToServer([tombstone]);
    await refreshAnnotations();
    onStatus("Marcado eliminado.");
  };

  const saveNote = async (annotation: SavedAnnotation) => {
    const updated = await updateAnnotation({
      ...annotation,
      note: noteDraft.trim() || undefined,
    });
    pushAnnotation(updated);
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
    pushAnnotation(await saveAnnotation(input));
    onStatus("Pasaje guardado en Marcadores.");
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
  const barsShown = barsVisible || settings.layout === "pages";

  const viewRatio =
    settings.layout === "pages"
      ? pageCount > 1
        ? page / (pageCount - 1)
        : 0
      : scrollRatio;
  const progress = bookProgress(sectionSizes, sectionIndex, viewRatio);
  const minutes = minutesLeft(sectionWords, viewRatio, wpm);
  const nextRow = tocRows.find((row) => row.index === sectionIndex + 1);
  const prevRow = tocRows.find((row) => row.index === sectionIndex - 1);

  return (
    <div
      className="reader"
      style={readerCssVars(settings) as CSSProperties}
      data-justify={settings.justify || undefined}
      data-dropcap={settings.dropCap || undefined}
      data-layout={settings.layout === "pages" ? "pages" : undefined}
    >
      <div
        ref={measureProbeRef}
        aria-hidden="true"
        className="measure-probe"
      />
      <header className="reader-bar" data-hidden={!barsShown || undefined}>
        <button type="button" className="btn--quiet reader-back" onClick={onBack}>
          ‹ Estantería
        </button>
        <p className="reader-bar-title" title={title || fileName}>
          {title || fileName}
          {author ? <span className="reader-bar-author"> · {author}</span> : null}
        </p>
        <div className="reader-bar-actions">
          <button
            type="button"
            className="btn--quiet"
            onClick={() => openSheet("search")}
            aria-label="Buscar en el libro"
          >
            Buscar
          </button>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => openSheet("toc")}
            aria-label="Índice del libro"
          >
            Índice
          </button>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => openSheet("settings")}
            aria-label="Ajustes de lectura"
          >
            Aa
          </button>
          <button type="button" className="btn--quiet" onClick={onOpenNotebook}>
            Cuaderno
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
        {state === "ready" && sectionWords === 0 ? (
          <p className="reader-empty meta">
            Esta sección no tiene texto legible (puede ser una portada o una imagen).
          </p>
        ) : null}
        {showChapterTitle ? <h1 className="chapter-title">{sectionTitle}</h1> : null}
        <div className="page-viewport" ref={viewportRef}>
          <div
            ref={containerRef}
            className="book-content"
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
            // Los enlaces internos del EPUB (notas al pie, índice)
            // apuntan a rutas que no existen en la app: no navegar.
            if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
            if (hit) openSelection(hit);
            // Tocar el texto fuera de una palabra también trae las
            // barras de vuelta, como en los lectores de libro físico.
            else setBarsVisible(true);
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
        ) : (
          <nav className="reader-end" aria-label="Navegación de secciones">
            {sectionIndex > 0 ? (
              <button
                type="button"
                className="reader-end-link"
                onClick={() => void navigate("chapter", { index: sectionIndex - 1 })}
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
                onClick={() => void navigate("chapter", { index: sectionIndex + 1 })}
              >
                Siguiente: {nextRow?.label ?? `Sección ${sectionIndex + 2}`} →
              </button>
            ) : (
              <span className="reader-end-done meta">Fin del libro</span>
            )}
          </nav>
        )}
      </div>

      {/* Aviso/acceso «Palabras del capítulo»: franja fija en la zona
          de controles, fuera del texto — persiste hasta atenderla o
          descartarla; nunca empuja la lectura porque vive aquí desde
          la entrada al capítulo. */}
      {prepNotice && !prep ? (
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
              ? `${sectionTitle} · ${sectionIndex + 1} de ${sectionTotal}`
              : "Abriendo…"}
            {minutes > 0 ? ` · ≈${minutes} min` : ""}
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
          <div className="setting-row">
            <span className="setting-label">Tema</span>
            <ThemeMenu value={theme} onChange={onThemeChange} />
          </div>
          <div className="setting-row">
            <span className="setting-label">Letra</span>
            <div className="theme-menu" role="group" aria-label="Letra">
              {READER_FONTS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className="theme-option"
                  data-active={settings.font === id || undefined}
                  aria-pressed={settings.font === id}
                  onClick={() => updateSettings({ font: id })}
                >
                  {label}
                </button>
              ))}
            </div>
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
          <div className="setting-row">
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
            <span className="setting-label">Tamaño</span>
            <div className="setting-stepper">
              <button
                type="button"
                className="btn"
                aria-label="Letra más pequeña"
                disabled={settings.size <= READER_LIMITS.size.min}
                onClick={() => updateSettings({ size: settings.size - 1 })}
              >
                −
              </button>
              <span className="setting-value">{settings.size}</span>
              <button
                type="button"
                className="btn"
                aria-label="Letra más grande"
                disabled={settings.size >= READER_LIMITS.size.max}
                onClick={() => updateSettings({ size: settings.size + 1 })}
              >
                +
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span className="setting-label">Interlineado</span>
            <div className="setting-stepper">
              <button
                type="button"
                className="btn"
                aria-label="Menos interlineado"
                disabled={settings.leading <= READER_LIMITS.leading.min}
                onClick={() =>
                  updateSettings({
                    leading: clampNumber(
                      Number((settings.leading - 0.05).toFixed(2)),
                      READER_LIMITS.leading.min,
                      READER_LIMITS.leading.max,
                    ),
                  })
                }
              >
                −
              </button>
              <span className="setting-value">{settings.leading.toFixed(2)}</span>
              <button
                type="button"
                className="btn"
                aria-label="Más interlineado"
                disabled={settings.leading >= READER_LIMITS.leading.max}
                onClick={() =>
                  updateSettings({
                    leading: clampNumber(
                      Number((settings.leading + 0.05).toFixed(2)),
                      READER_LIMITS.leading.min,
                      READER_LIMITS.leading.max,
                    ),
                  })
                }
              >
                +
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span className="setting-label">Ancho</span>
            <div className="theme-menu" role="group" aria-label="Ancho de columna">
              {(
                [
                  [55, "Estrecho"],
                  [65, "Normal"],
                  [75, "Amplio"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="theme-option"
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
            <span className="setting-label">Modo</span>
            <div className="theme-menu" role="group" aria-label="Modo de lectura">
              {(
                [
                  ["scroll", "Desplazamiento"],
                  ["pages", "Páginas"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="theme-option"
                  data-active={settings.layout === value || undefined}
                  aria-pressed={settings.layout === value}
                  onClick={() => updateSettings({ layout: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {settings.layout === "pages" ? (
            <>
              <div className="setting-row">
                <span className="setting-label">Columnas</span>
                <div className="theme-menu" role="group" aria-label="Columnas por página">
                  {(
                    [
                      [1, "Una"],
                      [2, "Dos"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="theme-option"
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
                Las flechas ← → pasan página. Si algo se corta, vuelve a
                Desplazamiento sin perder tu lugar.
              </p>
            </>
          ) : null}
          <div className="setting-row">
            <span className="setting-label">Justificar</span>
            <button
              type="button"
              className="theme-option"
              role="switch"
              aria-checked={settings.justify}
              data-active={settings.justify || undefined}
              onClick={() => updateSettings({ justify: !settings.justify })}
            >
              {settings.justify ? "Sí" : "No"}
            </button>
          </div>
          <div className="setting-row">
            <span className="setting-label">Letra capital</span>
            <button
              type="button"
              className="theme-option"
              role="switch"
              aria-checked={settings.dropCap}
              data-active={settings.dropCap || undefined}
              onClick={() => updateSettings({ dropCap: !settings.dropCap })}
            >
              {settings.dropCap ? "Sí" : "No"}
            </button>
          </div>
          <p className="meta">Pista: con el cursor sobre una palabra, pulsa D para abrir su ficha. Con Tab vuelven las barras.</p>
        </Sheet>
      ) : null}

      {askStart && catalog ? (
        <BookStart
          targets={catalog.targets}
          suggestedStartId={
            catalog.targets.find((t) => t.kind === "chapter")?.id ??
            catalog.targets[0]?.id ??
            null
          }
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
        <button
          type="button"
          className="selection-save"
          style={{ left: selButton.x, top: selButton.y }}
          // Evita que el botón robe el foco y borre la selección antes
          // de leerla.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void savePassageSelection()}
        >
          Guardar pasaje
        </button>
      ) : null}

      {selection ? (
        <WordPanel
          key={selection.word}
          word={selection.word}
          context={selection.context}
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
    </div>
  );
}
