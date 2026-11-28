import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  captureDbScope,
  loadShelfBootstrap,
  loadSessionValue,
  listStoredBooks,
  updateBookMeta,
  type SavedBookPosition,
  type StoredBook,
} from "../lib/idb";
import { CALIBRATION_DONE_KEY } from "../lib/calibration-keys";
import { triggerHaptic } from "../lib/haptics";
import {
  displayTitle,
  isHashLikeIdentifier,
  languageName,
} from "../../shared/book-display";
import type { BookMeta } from "../lib/cover";
import { normalizeSearchText } from "../lib/search-text";
import type { CatalogBook } from "../lib/catalog";
import {
  affinityBadgeLabel,
  affinityTierOf,
  coverageIsReliable,
  COVERAGE_UNMEASURED_LABEL,
  type BookCoverage,
} from "../lib/coverage-display";
import { playCompanionSound } from "../lib/companion-audio";
import { catMotionReduced } from "../lib/cat-motion";
import { relativeDay } from "../lib/relative-time";
import {
  parseReadingGoal,
  weeklyGoalProgress,
  type WeeklyGoalProgress,
} from "../lib/reading-goal";
import { dayKeyOf } from "../lib/reading-activity";
import { loadDailyTip, type TipAction, type TipOutcome } from "../lib/tips";
import { trackReadingEvent } from "../lib/reading-events";
import {
  applyStrategyPreset,
  loadActivityHidden,
  loadReaderSettings,
  saveReaderSettings,
  type StrategyPreset,
} from "../lib/settings";
import { BOOK_GENRES } from "../../shared/book-genres";
import { levelProgress } from "../lib/gamification";
import { isReviewDueWord } from "../lib/fsrs-light";
import BookCover from "./BookCover";

// Explora y sus piezas cargan diferidas: están debajo de la
// estantería y sus chunks (~13 kB gzip) no deben pagarse en el
// arranque. La precarga en tiempo muerto (abajo) evita que la
// primera visita a la pestaña parpadee. El contexto vive en
// explore-context.ts para que CommunityShelf no arrastre esto.
const ExploreShelf = lazy(() => import("./ExploreShelf"));
const DiscoverRail = lazy(() => import("./DiscoverRail"));
// «Más clásicos»: la búsqueda en el índice propio de Gutenberg carga
// diferida — solo la pestaña «Libros gratuitos» la usa.
const GutenbergSearch = lazy(() => import("./GutenbergSearch"));
const TrialWarningNote = lazy(() => import("./TrialWarningNote"));
const TrialStatusLine = lazy(() => import("./TrialStatusLine"));
import Icon from "./Icon";
import { CompanionButton } from "./CompanionButton";
import { CompanionStage } from "./CompanionStage";
import type { NotificationPayload } from "../lib/companionNotification";
import { useCompanion } from "./CompanionProvider";
const CoatChoice = lazy(() => import("./CoatChoice"));
const Sheet = lazy(() => import("./Sheet"));
const ArticleImportSheet = lazy(() => import("./ArticleImportSheet"));
import type { ArticleImportMeta } from "./ArticleImportSheet";
import { hasLectaPlus } from "../../shared/plan";
import { needsCoatChoice, useUserPlan } from "../lib/account-plan";
import { loadTtsLandingPosition } from "../lib/tts-landing";
import { loadTtsSettings } from "../lib/ttsSettings";
import { startSilentKeepAlive } from "../lib/ttsMediaSession";
import { SUBTITLE_ZONE_ENABLED } from "../lib/screen-zone";

// Ítem de la estantería: lo que hace falta para dibujar la tarjeta,
// sin el archivo. remoteOnly marca los que existen en la cuenta pero
// no en este dispositivo (se descargan al abrirlos); pendingUpload
// marca los que aún tienen una subida encolada.
export type ShelfItem = Pick<
  StoredBook,
  "hash" | "name" | "addedAt" | "title" | "author" | "cover" | "sectionCount" | "language" | "genre" | "mediaKind" | "imdbId" | "localOnly"
> & {
  remoteOnly?: boolean;
  pendingUpload?: boolean;
  hasCover?: boolean;
  // Biblioteca comunitaria: `shared` = lo ofrecí a otros lectores;
  // `paperOnly` = copia adjunta que solo abre el índice del modo papel.
  shared?: boolean;
  paperOnly?: boolean;
  // Migración 027: false = libro propio sin archivo en la nube (plan free).
  hasFile?: boolean;
};

export type ActiveRead = {
  hash: string;
  name: string;
  file?: File;
  title?: string;
  author?: string;
  cover?: Blob;
  progress?: number;
};

export type BookLike = ShelfItem | (BookMeta & { hash?: string; name?: string; file?: File });

export type ShelfSortBy = "recent" | "title" | "progress";

export type ShelfProps = {
  books?: (BookMeta | ShelfItem)[];
  activeRead?: ActiveRead | null;
  vocabCount?: number;
  dueReviewsCount?: number;
  hasCalibrated?: boolean;
  onSelect?: (book: BookLike, initialWord?: string) => void;
  // «Leo este libro en papel»: índice de capítulos con palabras para
  // quien lee la edición física. El contenedor decide si primero hay
  // que descargar el libro (remoteOnly).
  onPaperBook?: (book: ShelfItem) => void;
  onStartCalibration?: () => void;
  onBooksChange?: () => Promise<void> | void;
  onOpenVocab?: () => void;
  onOpenPractice?: () => void;
  onOpenAccount?: () => void;
  onOpenJourney?: () => void;
  user?: unknown;
  syncing?: boolean;

  library?: ShelfItem[];
  checking?: boolean;
  onOpen?: (book: ShelfItem) => void;
  /** «Continuar escuchando»: abre el libro y retoma el audio donde se dejó. */
  onResumeAudio?: (book: ShelfItem) => void;
  onRemove?: (hash: string) => void;
  onAdd?: (file: File) => void;
  onLibraryChange?: () => void;
  // Compartir (o retirar) un EPUB propio en la biblioteca comunitaria
  // «solo papel». El padre pega contra la API y refresca la estantería.
  // `genre` viaja solo al compartir: la elección de los chips (o ""
  // si se desmarcó) pisa al género detectado del EPUB.
  onShareBook?: (book: ShelfItem, shared: boolean, genre?: string) => Promise<void> | void;
  // Contenido de la pestaña «Comunidad» de la sección Explora:
  // la monta App con su propio fetch diferido (solo con sesión).
  communitySection?: React.ReactNode;
  // Contenido de la pestaña «Series y películas» de Explora: obras
  // audiovisuales preparadas + buscador OMDb/SubDL (solo con sesión).
  screenSection?: React.ReactNode;
  /** Obras de pantalla instaladas → contador de la pestaña. */
  screenCount?: number;
  // «Obtener» del riel Descubre y de «Más clásicos»: el padre baja el
  // EPUB y lo pasa al flujo normal de añadir libro. Puede resolver con
  // el hash del libro guardado (GutenbergSearch lo usa para «Abrir»).
  onGetCatalogBook?: (item: CatalogBook) => Promise<unknown> | void;
  // Descarga un libro remoto a IndexedDB sin necesidad de abrirlo
  onDownloadBook?: (item: ShelfItem) => Promise<void> | void;
  // Hash del libro que se está descargando actualmente
  downloadingHash?: string | null;
  // Sube cuando la sincronización trae intervalos nuevos: la meta de
  // la semana relee su progreso sin recargar la estantería.
  activityVersion?: number;
  // Cuenta cuya base local ya está activa (App la fija tras setDbUser).
  // El consejo del día se recalcula cuando cambia.
  dbUserId?: string | null;
  // Sube al cerrar la calibración: la cobertura se recalcula con la
  // evidencia recién guardada sin remontar la estantería.
  vocabVersion?: number;
  onRequestCalibration?: () => void;
  onImportArticle?: (file: File, meta: ArticleImportMeta) => void;
  initialArticleUrl?: string | null;
  onClearInitialArticleUrl?: () => void;
};

export type Props = ShelfProps;

const DAY_MS = 86_400_000;
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// El saludo del gato ocurre una sola vez por sesión visible de la
// app: la estantería se desmonta al abrir un libro, así que la marca
// vive en el módulo — sobrevive a ese remontaje y muere con la app.
const SHELF_GREET_MS = 4_000;
let shelfGreetedThisSession = false;
export function takeShelfGreeting(): boolean {
  if (shelfGreetedThisSession || catMotionReduced()) return false;
  shelfGreetedThisSession = true;
  return true;
}

// Libro de muestra incluido con la app (dominio público, ver
// docs/muestra-azul.md): entra por la tubería normal de «Añadir
// libro» — se guarda, se sube y se borra como cualquier otro.
const SAMPLE_BOOK_URL = "/libros/azul-ruben-dario.epub";
const SAMPLE_BOOK_NAME = "Azul… — Rubén Darío.epub";

type StarterPick = CatalogBook & { tag: string };

const STARTER_PICKS: StarterPick[] = [
  {
    id: "christmas-carol",
    gutenbergId: 46,
    title: "A Christmas Carol",
    author: "Charles Dickens",
    language: "en",
    cover: true,
    tag: "Relato en inglés",
  },
  {
    id: "alice-wonderland",
    gutenbergId: 11,
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    language: "en",
    cover: true,
    tag: "Novela en inglés",
  },
  {
    id: "marianela",
    gutenbergId: 17013,
    title: "Marianela",
    author: "Benito Pérez Galdós",
    language: "es",
    cover: true,
    tag: "Clásico en español",
  },
];

export function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// La misma fracción que guarda el lector; posiciones antiguas sin
// «progress» caen al índice de sección, sin mínimos inventados.
const progressOf = (position: SavedBookPosition | undefined, sectionCount: number | undefined) =>
  position && sectionCount
    ? (position.progress ?? Math.min(1, position.sectionIndex / sectionCount))
    : 0;

export default function Shelf({
  library: rawLibrary = [],
  books,
  checking = false,
  dueReviewsCount: propDueReviewsCount,
  hasCalibrated,
  onSelect,
  onPaperBook,
  onStartCalibration,
  onBooksChange,
  onOpen = () => {},
  onResumeAudio,
  onRemove = () => {},
  onAdd = () => {},
  onLibraryChange = () => {},
  onShareBook,
  communitySection,
  screenSection,
  screenCount,
  onGetCatalogBook,
  onDownloadBook,
  downloadingHash,
  activityVersion = 0,
  dbUserId = null,
  vocabVersion = 0,
  onOpenAccount,
  onOpenJourney,
  onOpenPractice,
  onRequestCalibration,
  onImportArticle,
  initialArticleUrl = null,
  onClearInitialArticleUrl,
  user,
}: ShelfProps) {
  const library = (books as ShelfItem[]) ?? rawLibrary;
  const handleLibraryChange = onBooksChange ?? onLibraryChange;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [wordCounts, setWordCounts] = useState<Map<string, number>>(new Map());
  const [dueWordsCount, setDueWordsCount] = useState(0);
  const effectiveDueWordsCount = propDueReviewsCount ?? dueWordsCount;
  const [latestHash, setLatestHash] = useState<string | undefined>(undefined);
  // Hasta el primer bootstrap no se sabe cuál es el libro destacado: se
  // muestra el esqueleto para que el hero no aparezca de golpe.
  const [bootReady, setBootReady] = useState(false);
  const [weekDays, setWeekDays] = useState<{ day: number; read: boolean }[]>([]);
  const [goalProgress, setGoalProgress] = useState<WeeklyGoalProgress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [optionsBook, setOptionsBook] = useState<ShelfItem | null>(null);
  // Género elegido en los chips al compartir: se siembra con el
  // detectado del EPUB y puede desmarcarse ("" = sin clasificar).
  const [shareGenre, setShareGenre] = useState("");
  const openOptions = (book: ShelfItem | null) => {
    setOptionsBook(book);
    setShareGenre(book?.genre ?? "");
  };
  const [dragging, setDragging] = useState(false);
  const [articleSheetOpen, setArticleSheetOpen] = useState(false);
  const showArticleSheet = articleSheetOpen || Boolean(initialArticleUrl);
  const closeArticleSheet = () => {
    setArticleSheetOpen(false);
    onClearInitialArticleUrl?.();
  };
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [starterLoadingId, setStarterLoadingId] = useState<string | null>(null);
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [calibrationDismissed, setCalibrationDismissed] = useState(() => {
    try {
      return (
        localStorage.getItem("lecta:calibration-banner-dismissed") === "1" ||
        localStorage.getItem("lecta_onboarding_dismissed") === "1"
      );
    } catch {
      return false;
    }
  });

  const dismissCalibrationBanner = () => {
    setCalibrationDismissed(true);
    try {
      localStorage.setItem("lecta:calibration-banner-dismissed", "1");
    } catch {
      // ignore storage errors
    }
  };

  const handleBookClick = async (book: ShelfItem) => {
    // Copia comunitaria «solo papel»: el toque en la portada abre el
    // índice del modo papel, nunca el lector ni la hoja de descarga.
    if (book.paperOnly) {
      if (onPaperBook) {
        onPaperBook(book);
        return;
      }
      openOptions(book);
      return;
    }
    if (
      book.remoteOnly &&
      (book.title === "Libro en la nube" || !book.title || isHashLikeIdentifier(book.title))
    ) {
      try {
        const { repairRemoteBook } = await import("../lib/books");
        const repaired = await repairRemoteBook(book.hash);
        if (repaired?.title) {
          book.title = repaired.title;
          if (repaired.author) book.author = repaired.author;
          if (repaired.hasCover) book.hasCover = true;
          handleLibraryChange();
        }
      } catch {
        // Fallback suave
      }
      openOptions(book);
      return;
    }

    if (onSelect) {
      onSelect(book);
    } else {
      onOpen(book);
    }
  };
  // La preferencia se lee una vez: cambiarla en el Cuaderno se aplica
  // la próxima vez que la estantería se monta.
  const [activityHidden] = useState(() => loadActivityHidden());
  // Consejo diario local (reglas y plantillas, sin IA): a lo más uno
  // por día en este dispositivo (la cadencia vive en tips.ts). Se
  // calcula al montar la estantería —breakpoint de inicio de sesión—
  // y queda registrado con tip_shown/tip_accepted.
  const [tip, setTip] = useState<TipOutcome | null>(null);
  const [todayKey, setTodayKey] = useState<string>("");
  // Compañero del proveedor único: la tarjeta compacta muestra su
  // etapa, ropa equipada, nombre y nivel, y su botón abre la hoja de
  // cuidado compartida — nada se carga aquí.
  const companion = useCompanion();
  const userPlan = useUserPlan();
  const [pastDueHidden, setPastDueHidden] = useState(false);
  const showCompanion = companion.enabled === true && companion.state !== null;
  // Saludo una vez por sesión: la primera vez que la estantería
  // muestra al gato, saluda con la pata unos segundos. Marca en
  // memoria de módulo — abrir/cerrar el panel no lo repite.
  const [greeting, setGreeting] = useState(false);
  // Ajuste durante el render: el primer render que muestra la
  // tarjeta consume el saludo de la sesión.
  if (showCompanion && !greeting && takeShelfGreeting()) {
    setGreeting(true);
  }
  // El temporizador solo lo apaga; la marca ya quedó tomada.
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(
      () => setGreeting(false),
      SHELF_GREET_MS,
    );
    return () => window.clearTimeout(timer);
  }, [greeting]);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void loadShelfBootstrap(scope).then(
      ({
        positions: positionList,
        savedWords: words,
        latestHash: hash,
        readingDays: readDayList,
        intervals: intervalList,
        rawGoal,
      }) => {
        if (cancelled) return;
        setPositions(positionList);
        const counts = new Map<string, number>();
        let dueTotal = 0;
        for (const word of words) {
          if (word.bookHash) {
            counts.set(word.bookHash, (counts.get(word.bookHash) ?? 0) + 1);
          }
          if (isReviewDueWord(word)) {
            dueTotal += 1;
          }
        }
        setWordCounts(counts);
        setDueWordsCount(dueTotal);
        setLatestHash(hash);
        setBootReady(true);
        // Días donde hubo lectura real (registrada al guardar posición),
        // no deducidos de la última posición de cada libro.
        const readDays = new Set(readDayList);
        const now = Date.now();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setTodayKey(dayKeyOf(now, tz));
        const today = startOfDay(now);
        setWeekDays(
          Array.from({ length: 7 }, (_, i) => {
            const day = today - (6 - i) * DAY_MS;
            return { day, read: readDays.has(day) };
          }),
        );
        // La meta semanal se deriva de los intervalos (locales + los
        // que llegaron por sync); «readingDays» sigue siendo solo el
        // registro histórico de los puntos de arriba.
        const goal = parseReadingGoal(rawGoal);
        setGoalProgress(
          goal?.daysPerWeek != null
            ? weeklyGoalProgress(
                intervalList,
                now,
                tz,
                goal.daysPerWeek,
              )
            : null,
        );
        void loadSessionValue(CALIBRATION_DONE_KEY, scope)
          .then((val) => {
            if (!cancelled) setCalibrationDone(val === "1");
          })
          .catch(() => null);
      },
    ).catch(() => {
      if (!cancelled) setBootReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [library, activityVersion]);

  // Rellena título, autor y portada de los libros que aún no los tienen.
  // Uno a la vez para no competir con la lectura. Se leen los registros
  // completos del almacén (ShelfItem no carga el archivo); los ítems
  // «solo en la nube» no están guardados aquí y quedan fuera solos —
  // sus metadatos se leen cuando se descargan.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const stored = await listStoredBooks(scope).catch(() => []);
      const pending = stored.filter((book) => !book.metaVersion).slice(0, 5);
      if (!pending.length || cancelled) return;
      const { readBookMeta } = await import("../lib/cover");
      for (const book of pending) {
        const meta = await readBookMeta(book.data);
        if (cancelled) return;
        await updateBookMeta(
          book.hash,
          {
            title: meta?.title,
            author: meta?.author,
            language: meta?.language,
            sectionCount: meta?.sectionCount,
            cover: meta?.cover ?? undefined,
            genre: meta?.genre,
            metaVersion: 1,
          },
          scope,
        );
        handleLibraryChange();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library, handleLibraryChange]);

  // Cobertura de vocabulario por libro propio: mismo manifiesto que el
  // catálogo (bookVocab:v1:{hash}). Primero lo ya analizado; los que
  // falten se analizan de uno en uno y solo con red — nunca compite
  // con abrir un libro.
  const [bookCoverages, setBookCoverages] = useState<
    Map<string, BookCoverage>
  >(new Map());
  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData || navigator.onLine === false) return;
    const targets = library
      .filter((book) => !book.remoteOnly)
      .map((book) => ({ hash: book.hash, language: book.language }));
    if (!targets.length) return;

    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const [
        { createCoverageInputsLoader, coverageOfBook },
        { manifestBookForms, entriesByFormOf },
      ] = await Promise.all([
        import("../lib/coverage"),
        import("../lib/catalog"),
      ]);
      if (cancelled) return;
      // El perfil necesita el catálogo (zipfs de la evidencia): si no
      // hay red no se puede medir nada y el lote entero se omite. Se
      // lee una vez por idioma: cada libro se mide con el suyo.
      const inputsFor = createCoverageInputsLoader(scope);
      const firstInputs = await inputsFor(targets[0].language);
      if (!firstInputs || cancelled) return;
      // El manifiesto y su análisis viven en un chunk diferido: la
      // estantería solo lo carga cuando hay red y libros que medir.
      const { loadBookVocab, analyzeStoredBook } = await import(
        "../lib/book-vocab"
      );
      for (const target of targets) {
        if (cancelled) return;
        const inputs = await inputsFor(target.language);
        if (!inputs || cancelled) continue;
        let manifest = await loadBookVocab(target.hash, scope, target.language);
        if (!manifest) {
          manifest = await analyzeStoredBook(target.hash, scope);
        }
        if (!manifest || cancelled) continue;
        const coverage = coverageOfBook(
          manifestBookForms(manifest),
          entriesByFormOf(manifest),
          inputs,
          manifest.occurrences,
        );
        setBookCoverages((prev) => {
          const next = new Map(prev);
          next.set(target.hash, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library, vocabVersion]);

  // Consejo del día: un cálculo por montaje y otro cada vez que queda
  // activa otra base local (al abrir la app la estantería se monta
  // antes de que setDbUser termine y leería la base anónima). Las
  // puertas de tips.ts (datos mínimos, cadencia) y sus reglas deciden
  // si hay tarjeta. La tarjeta vive hasta aceptar o cerrar.
  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void loadDailyTip(scope).then((outcome) => {
      if (cancelled) return;
      // La tarjeta de otra cuenta nunca sobrevive al cambio.
      if (!outcome) {
        setTip(null);
        return;
      }
      // Si la pestaña quedó oculta mientras se leía el historial, el
      // tip se descarta entero: una tarjeta que nadie vio no cuenta
      // como impresión y reaparecer de la nada al volver confunde.
      if (document.hidden) return;
      setTip(outcome);
      void trackReadingEvent(
        {
          kind: "tip_shown",
          tipDay: outcome.tipDay,
          action: outcome.action,
          promptVersion: outcome.version,
          visitId: null,
          bookHash: null,
        },
        scope,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [dbUserId]);

  const acceptTip = () => {
    if (!tip) return;
    // Las acciones del enum aplican el ajuste de verdad: la
    // sugerencia deja de ser texto y se vuelve conducta medible.
    if (tip.action === "focus_ruler" || tip.action === "syntactic") {
      const settings = loadReaderSettings();
      saveReaderSettings({
        ...settings,
        focusMode: tip.action === "focus_ruler" ? "ruler" : "syntactic",
      });
    }
    void trackReadingEvent(
      {
        kind: "tip_accepted",
        tipDay: tip.tipDay,
        action: tip.action,
        visitId: null,
        bookHash: null,
      },
      captureDbScope(),
    );
    setTip(null);
  };

  const tipActionLabel: Record<TipAction, string> = {
    none: "Me sirve",
    focus_ruler: "Activar la regla de foco",
    syntactic: "Activar las líneas sintácticas",
  };

  const positionByHash = useMemo(
    () => new Map(positions.map((position) => [position.bookHash, position])),
    [positions],
  );

  const current = useMemo(() => {
    const hero = latestHash ? library.find((book) => book.hash === latestHash) : undefined;
    if (hero) return hero;
    const [freshest] = [...positions].sort((a, b) => b.updatedAt - a.updatedAt);
    return freshest ? library.find((book) => book.hash === freshest.bookHash) : undefined;
  }, [latestHash, library, positions]);

  // Solo con consentimiento de voz y un punto de escucha guardado.
  const listenLanding = useMemo(() => {
    if (!current || !onResumeAudio || current.paperOnly || current.remoteOnly) return null;
    const settings = loadTtsSettings();
    if (settings.consentedAt === null) return null;
    return loadTtsLandingPosition(current.hash);
  }, [current, onResumeAudio]);

  const [habitReminder, setHabitReminder] = useState<NotificationPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!current) {
        setHabitReminder(null);
        return;
      }
      const pos = positions.find((p) => p.bookHash === current.hash);
      const lastOpened = pos?.updatedAt ?? current.addedAt ?? 0;
      const nowMs = Date.now();
      const daysSince = (nowMs - lastOpened) / (24 * 3600 * 1000);
      if (daysSince < 2) {
        setHabitReminder(null);
        return;
      }

      void import("../lib/localNotificationScheduler").then(({ evaluateHabitReminder, updateAppBadge }) => {
      if (cancelled) return;
      const res = evaluateHabitReminder(
        {
          bookHash: current.hash,
          title: displayTitle(current.name, current.title),
          lastOpenedTimestampMs: lastOpened,
          textBeforeCursor: pos?.anchor,
        },
        {
          companion: {
            streakShieldUsedRecently: Boolean(companion.state?.stats?.lastDayKey),
          },
        },
      );

      if (res.eligible && res.payload) {
        void updateAppBadge(true);
        setHabitReminder(res.payload);
      } else {
        setHabitReminder(null);
      }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [current, positions, companion.state?.stats?.lastDayKey]);

  // Precarga en tiempo muerto de los chunks de Explora: cuando el
  // lector baje hasta la pestaña (o la abra vacía) ya están en caché.
  // Mismo patrón que CompanionProvider; sin setState.
  useEffect(() => {
    const prefetch = () => {
      void import("./ExploreShelf");
      void import("./DiscoverRail");
    };
    const idle = (
      globalThis as typeof globalThis & {
        requestIdleCallback?: (
          cb: () => void,
          options?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(prefetch, { timeout: 3000 });
      return () => {
        (
          globalThis as typeof globalThis & {
            cancelIdleCallback?: (h: number) => void;
          }
        ).cancelIdleCallback?.(handle);
      };
    }
    const timer = setTimeout(prefetch, 2500);
    return () => clearTimeout(timer);
  }, []);

  const [heroStrategy, setHeroStrategy] = useState<StrategyPreset | null>(null);
  const [catPetQuote, setCatPetQuote] = useState<string | null>(null);
  type ShelfFilter = "all" | "reading" | "unread" | "finished";
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Buscador único de «Libros gratuitos»: `freeQuery` es el texto en
  // vivo que filtra el riel curado; `catalogQuery` es el texto ya
  // enviado (Enter), que es el que busca Gutenberg — así el catálogo
  // completo no dispara una búsqueda por cada tecla.
  const [freeQuery, setFreeQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [sortBy, setSortBy] = useState<ShelfSortBy>("recent");

  const activeStrategy: StrategyPreset = useMemo(() => {
    if (heroStrategy) return heroStrategy;
    if (!current) return "focus";
    const s = loadReaderSettings(current.hash);
    return s.strategyPreset ?? "focus";
  }, [heroStrategy, current]);

  const activeModeLabel = useMemo(() => {
    if (activeStrategy === "focus") return "Modo Enfoque";
    if (activeStrategy === "lexical") return "Modo Léxico";
    if (activeStrategy === "audio") return "Modo Audio";
    if (activeStrategy === "immersive") return "Lectura Inmersiva";
    if (!current) return "Modo Estándar";
    const settings = loadReaderSettings(current.hash);
    if (settings.focusMode === "ruler") return "Regla de Foco";
    if (settings.focusMode === "syntactic") return "Líneas Sintácticas";
    return "Modo Estándar";
  }, [activeStrategy, current]);

  const filteredLibrary = useMemo(() => {
    let result = library;
    if (shelfFilter !== "all") {
      result = result.filter((book) => {
        const pos = positionByHash.get(book.hash);
        const total = book.sectionCount ?? 0;
        const progress = progressOf(pos, total);
        if (shelfFilter === "reading") {
          return pos && progress > 0 && progress < 0.99;
        }
        if (shelfFilter === "unread") {
          return !pos || progress === 0;
        }
        if (shelfFilter === "finished") {
          return progress >= 0.99;
        }
        return true;
      });
    }

    const q = normalizeSearchText(searchQuery);
    if (q) {
      result = result.filter((book) => {
        const title = normalizeSearchText(book.title || book.name || "");
        const author = normalizeSearchText(book.author || "");
        return title.includes(q) || author.includes(q);
      });
    }

    const sorted = [...result];
    if (sortBy === "title") {
      sorted.sort((a, b) => {
        const titleA = (a.title || a.name || "").toLowerCase();
        const titleB = (b.title || b.name || "").toLowerCase();
        return titleA.localeCompare(titleB);
      });
    } else if (sortBy === "progress") {
      sorted.sort((a, b) => {
        const progA = progressOf(positionByHash.get(a.hash), a.sectionCount);
        const progB = progressOf(positionByHash.get(b.hash), b.sectionCount);
        if (progB !== progA) return progB - progA;
        const recentA = positionByHash.get(a.hash)?.updatedAt ?? a.addedAt ?? 0;
        const recentB = positionByHash.get(b.hash)?.updatedAt ?? b.addedAt ?? 0;
        return recentB - recentA;
      });
    } else {
      // "recent"
      sorted.sort((a, b) => {
        const recentA = positionByHash.get(a.hash)?.updatedAt ?? a.addedAt ?? 0;
        const recentB = positionByHash.get(b.hash)?.updatedAt ?? b.addedAt ?? 0;
        return recentB - recentA;
      });
    }

    return sorted;
  }, [library, shelfFilter, searchQuery, sortBy, positionByHash]);

  const pickFile = () => fileInputRef.current?.click();

  const openSample = async () => {
    if (sampleState === "loading") return;
    setSampleState("loading");
    try {
      const response = await fetch(SAMPLE_BOOK_URL);
      if (!response.ok) throw new Error("sample fetch");
      const data = await response.blob();
      setSampleState("idle");
      onAdd(new File([data], SAMPLE_BOOK_NAME, { type: "application/epub+zip" }));
    } catch {
      setSampleState("error");
    }
  };

  const openStarter = async (pick: StarterPick) => {
    if (!onGetCatalogBook) {
      await openSample();
      return;
    }
    if (starterLoadingId) return;
    setSampleState("idle");
    setStarterLoadingId(pick.id);
    try {
      await onGetCatalogBook(pick);
    } catch {
      setSampleState("error");
    } finally {
      setStarterLoadingId(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".epub") || file.type === "application/epub+zip")) {
      onAdd(file);
    }
  };

  const remove = (hash: string) => {
    setConfirmDelete(null);
    setOptionsBook(null);
    onRemove(hash);
  };

  const changeBookLanguage = async (hash: string, language: string) => {
    const scope = captureDbScope();
    await updateBookMeta(hash, { language }, scope);
    setOptionsBook((prev) => (prev && prev.hash === hash ? { ...prev, language } : prev));
    handleLibraryChange();
  };

  if (checking || !bootReady) {
    return (
      <div className="shelf shelf-main shelf-loading" role="status" aria-live="polite" aria-busy="true">
        <span className="visually-hidden">Preparando tu estantería…</span>
        <div className="skeleton skeleton--hero" aria-hidden="true" />
        <div className="skeleton-row" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton skeleton--cover" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  const heroPosition = current ? positionByHash.get(current.hash) : undefined;
  const heroCoverage = current ? bookCoverages.get(current.hash) : undefined;

  const isFirstTimeReader =
    library.length === 0 ||
    (library.length === 1 &&
      (!positions.length ||
        progressOf(
          positionByHash.get(library[0].hash),
          library[0].sectionCount,
        ) === 0));

  return (
    <div className="shelf shelf-main shelf-enter" onDragOver={(e) => e.preventDefault()}>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".epub,application/epub+zip"
        aria-label="Elige un libro EPUB"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAdd(file);
          event.currentTarget.value = "";
        }}
      />

      <Suspense fallback={null}>
        <TrialWarningNote />
        <TrialStatusLine />
      </Suspense>

      {userPlan?.pastDue === true && !pastDueHidden ? (
        <div className="trial-note" role="status" data-testid="past-due-note">
          <span className="trial-note__text">
            No pudimos renovar tu pago de Lecta+. Actualiza tu tarjeta para conservar tu acceso.
          </span>
          <button
            type="button"
            className="btn trial-note__cta"
            onClick={() => window.dispatchEvent(new CustomEvent("lecta:open-carne"))}
          >
            Actualizar tarjeta
          </button>
          <button
            type="button"
            className="btn--quiet trial-note__close"
            aria-label="Cerrar aviso de pago"
            onClick={() => setPastDueHidden(true)}
          >
            ×
          </button>
        </div>
      ) : null}

      {isFirstTimeReader ? (
        <section className="shelf-welcome-hero" aria-label="Primera lectura en 1 toque">
          <div className="shelf-welcome-hero-content">
            {showCompanion && companion.state ? (
              <div className="shelf-welcome-cat">
                <CompanionButton
                  stage={companion.stage}
                  mood={companion.mood}
                  accessories={companion.accessories}
                  name={companion.name}
                  label={`Ver a ${companion.name}`}
                  onClick={() => companion.openPanel()}
                />
                <span className="shelf-welcome-hero-badge">
                  {companion.name} te acompaña
                </span>
              </div>
            ) : (
              <span className="shelf-welcome-hero-badge">Primera lectura</span>
            )}
            <h2 className="shelf-welcome-hero-title">
              ¿Con qué quieres empezar hoy?
            </h2>
            <p className="shelf-welcome-hero-subtitle">
              Toca un libro y entra directo a la página. Si una palabra se atraviesa, la entiendes en un toque sin perder el hilo.
            </p>
            {library.length > 0 ? (
              <div className="shelf-welcome-hero-actions">
                <button
                  type="button"
                  className="btn btn--primary shelf-welcome-hero-btn"
                  onClick={() => {
                    triggerHaptic(12);
                    handleBookClick(library[0]);
                  }}
                >
                  Empezar «{displayTitle(library[0].name, library[0].title)}»
                </button>
                <button
                  type="button"
                  className="btn btn--secondary shelf-welcome-hero-btn-secondary"
                  onClick={pickFile}
                >
                  Traer mi archivo EPUB
                </button>
              </div>
            ) : (
              <>
                <div className="shelf-welcome-picks">
                  {STARTER_PICKS.map((pick, idx) => {
                    const isBusy =
                      starterLoadingId === pick.id ||
                      (!onGetCatalogBook && sampleState === "loading");
                    return (
                      <button
                        key={pick.id}
                        type="button"
                        className={`shelf-welcome-pick-btn${idx === 0 ? " btn btn--primary shelf-welcome-hero-btn" : " btn"}`}
                        onClick={() => {
                          triggerHaptic(12);
                          void openStarter(pick);
                        }}
                        disabled={Boolean(starterLoadingId) || sampleState === "loading"}
                      >
                        <span className="shelf-welcome-pick-tag">{pick.tag}</span>
                        <span className="shelf-welcome-pick-title">
                          {isBusy ? "Preparando el libro…" : pick.title}
                        </span>
                        <span className="shelf-welcome-pick-author">{pick.author}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="shelf-welcome-hero-actions">
                  <button
                    type="button"
                    className="btn btn--secondary shelf-welcome-hero-btn-secondary"
                    onClick={pickFile}
                  >
                    Traer mi archivo EPUB
                  </button>
                </div>
              </>
            )}
            {sampleState === "error" ? (
              <p className="meta" role="alert">
                No pude traer el libro. Revisa tu conexión e inténtalo de nuevo.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {needsCoatChoice(userPlan) ? (
        <Suspense fallback={null}>
          <CoatChoice />
        </Suspense>
      ) : null}

      {/* Tarjeta compacta del compañero (fase 5): el gato con su
          etapa y ropa equipada, nombre y nivel breve; el botón abre
          la hoja de cuidado del proveedor. Solo si el juego está
          encendido — nunca desplaza ni rompe la estantería. */}
      {showCompanion && companion.state && !current && !isFirstTimeReader ? (
        <section
          className="shelf-companion shelf__desk-companion"
          aria-label={`Tu compañero ${companion.name}`}
        >
          <CompanionButton
            stage={companion.stage}
            mood={companion.mood}
            accessories={companion.accessories}
            pose={greeting ? "greet" : undefined}
            label={`Ver a ${companion.name}`}
            onClick={companion.openPanel}
          />
          <div className="shelf-companion-info">
            <p className="shelf-companion-name">{companion.name}</p>
            <p className="meta">
              Nivel {levelProgress(companion.state.xp).level + 1} ·{" "}
              {levelProgress(companion.state.xp).name}
            </p>
          </div>
        </section>
      ) : null}

      {library.length === 0 ? (
        <section className="shelf-empty">
          <div className="shelf-import-zone">
            <p className="shelf-import-label">O añade tus propios libros</p>
            <button
              type="button"
              className="add-slot add-slot--wide"
              onClick={pickFile}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-dragging={dragging || undefined}
            >
              <span className="add-slot-mark" aria-hidden="true" />
              <span>Arrastra un archivo EPUB o pulsa para elegirlo</span>
            </button>
            {onImportArticle ? (
              <button
                type="button"
                className="add-slot add-slot--wide"
                style={{ marginTop: "var(--s-2)" }}
                onClick={() => setArticleSheetOpen(true)}
              >
                <Icon name="book" size={16} />
                <span>Leer artículo por enlace</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          {/* Consejo del día (local): tarjeta transitoria de sesión.
              Aceptar aplica la acción si la hay y cierra; × solo
              cierra. Sin consejo la estantería no cambia nada. */}
          {tip ? (
            <section className="shelf-tip" role="status">
              <p className="shelf-tip-text">{tip.tip}</p>
              <div className="shelf-tip-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={acceptTip}
                >
                  {tipActionLabel[tip.action]}
                </button>
                <button
                  type="button"
                  className="reader-return-dismiss"
                  onClick={() => setTip(null)}
                  aria-label="Descartar consejo"
                >
                  ×
                </button>
              </div>
            </section>
          ) : null}
          {current && !isFirstTimeReader ? (
            <section className="shelf-hero shelf-reading-table shelf__desk-hero" aria-label="Tu Mesa de Lectura">
              <div className="shelf-hero-left">
                <button
                  type="button"
                  className="shelf-hero-cover shelf-book-spine"
                  onClick={() => {
                    triggerHaptic(10);
                    handleBookClick(current);
                  }}
                  aria-label={`Continuar ${displayTitle(current.name, current.title)}`}
                >
                  <BookCover
                    book={current}
                    progress={progressOf(heroPosition, current.sectionCount)}
                    showRibbon={Boolean(heroPosition)}
                  />
                  <span className="shelf-lang-badge" title={`Idioma: ${languageName(current.language || "es")}`}>
                    {(current.language || "es").toUpperCase()}
                  </span>
                </button>
                <div className="shelf-hero-info">
                  <div className="shelf-hero-summary">
                    <div className="shelf-hero-eyebrow-row">
                      <p className="eyebrow">Tu Mesa de Lectura</p>
                      {heroCoverage ? (
                        coverageIsReliable(heroCoverage) ? (
                          <span
                            className={`shelf-affinity-badge shelf-affinity-badge--${affinityTierOf(heroCoverage.percent)}`}
                            title={`Afinidad léxica: ${heroCoverage.percent}%${
                              heroCoverage.reencuentrosCount
                                ? ` · Repite ${heroCoverage.reencuentrosCount} de tu Herbario`
                                : ""
                            }`}
                          >
                            {heroCoverage.percent}% vocabulario conocido
                          </span>
                        ) : (
                          <span
                            className="shelf-affinity-badge"
                            title="El catálogo aún no puede medir la mayoría de las palabras de este libro"
                          >
                            {COVERAGE_UNMEASURED_LABEL}
                          </span>
                        )
                      ) : null}
                    </div>
                    <h2 className="shelf-hero-title">{displayTitle(current.name, current.title)}</h2>
                    {current.author ? <p className="meta">{current.author}</p> : null}
                    {habitReminder && (
                      <div
                        className="shelf-companion-habit-card"
                        role="region"
                        aria-label="Recordatorio respetuoso del compañero"
                      >
                        <div className="shelf-companion-habit-head">
                          <strong className="shelf-companion-habit-title">
                            {habitReminder.title}
                          </strong>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void import("../lib/localNotificationScheduler").then((m) => m.updateAppBadge(false));
                              onOpen(current);
                            }}
                            className="btn btn--primary shelf-companion-habit-cta"
                          >
                            Leer 3 min
                          </button>
                        </div>
                        <p className="shelf-companion-habit-body">
                          {habitReminder.body}
                        </p>
                        {habitReminder.subtitle && (
                          <span className="shelf-companion-habit-subtitle">
                            {habitReminder.subtitle}
                          </span>
                        )}
                      </div>
                    )}
                    {heroPosition ? (
                      <p className="meta shelf-hero-progress">
                        {current.sectionCount
                          ? `Capítulo ${heroPosition.sectionIndex + 1} de ${current.sectionCount} · ${Math.round(progressOf(heroPosition, current.sectionCount) * 100)}% leído`
                          : "Lectura en curso"}
                        {" · "}
                        te quedaste aquí {relativeDay(heroPosition.updatedAt)}
                      </p>
                    ) : null}
                    {current.sectionCount && heroPosition ? (
                      <div
                        className="thread shelf-hero-thread"
                        role="progressbar"
                        aria-valuenow={Math.round(progressOf(heroPosition, current.sectionCount) * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="thread-fill"
                          style={
                            {
                              "--thread-value": `${progressOf(heroPosition, current.sectionCount) * 100}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* Selector Rápido de Estrategia en la Tarjeta */}
                  <div className="shelf-strategy-selector shelf-hero-strategies" role="group" aria-label="Estrategia para entrar hoy">
                    {[
                      { id: "focus", label: "Enfoque Profundo" },
                      { id: "lexical", label: "Explorador Léxico" },
                      { id: "audio", label: "Audio-Lectura" },
                      { id: "immersive", label: "Lectura Limpia" },
                    ].map((strat) => (
                      <button
                        key={strat.id}
                        type="button"
                        className={`shelf-strategy-pill${activeStrategy === strat.id ? " shelf-strategy-pill--active" : ""}`}
                        aria-pressed={activeStrategy === strat.id}
                        onClick={() => {
                          triggerHaptic(8);
                          setHeroStrategy(strat.id as StrategyPreset);
                          const curSettings = loadReaderSettings(current.hash);
                          saveReaderSettings(applyStrategyPreset(strat.id as StrategyPreset, curSettings), current.hash);
                        }}
                      >
                        {strat.label}
                      </button>
                    ))}
                  </div>

                  <div className="actions shelf-hero-actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--hero-continue"
                      onClick={() => {
                        triggerHaptic(10);
                        handleBookClick(current);
                      }}
                    >
                      Continuar leyendo · {activeModeLabel}
                    </button>
                    {listenLanding && onResumeAudio ? (
                      <button
                        type="button"
                        className="btn btn--quiet btn--resume-audio"
                        onClick={() => {
                          triggerHaptic(10);
                          // Dentro del gesto: el autoplay no deja hacerlo después.
                          if (loadTtsSettings().backgroundAudio) startSilentKeepAlive();
                          onResumeAudio(current);
                        }}
                      >
                        {listenLanding.chapterLabel
                          ? `Continuar escuchando · ${listenLanding.chapterLabel}`
                          : "Continuar escuchando"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--quiet btn--pre-train"
                      onClick={() => {
                        triggerHaptic(10);
                        if (onOpenPractice) onOpenPractice();
                        else handleBookClick(current);
                      }}
                    >
                      Pre-entrenar 3 palabras del capítulo
                    </button>
                    {(wordCounts.get(current.hash) ?? 0) > 0 ? (
                      <span className="meta">
                        {wordCounts.get(current.hash) === 1
                          ? "1 palabra de este libro en tu Herbario"
                          : `${wordCounts.get(current.hash)} palabras de este libro en tu Herbario`}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="shelf-hero-right">
                <div className="shelf-hero-lamp" aria-hidden="true" title="Rincón cálido con el gato">
                  <span className="shelf-lamp-icon"><Icon name="sparkles" size={16} /></span>
                </div>
                {showCompanion && companion.state ? (
                  <div
                    className="shelf-hero-companion shelf__desk-companion"
                    onClick={() => {
                      triggerHaptic(12);
                      playCompanionSound("purr");
                      setCatPetQuote("¡Nos quedamos en la mejor parte del capítulo! ¿Leemos 5 minutos?");
                      window.setTimeout(() => setCatPetQuote(null), 6000);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        triggerHaptic(12);
                        playCompanionSound("purr");
                        setCatPetQuote("¡Nos quedamos en la mejor parte del capítulo! ¿Leemos 5 minutos?");
                        window.setTimeout(() => setCatPetQuote(null), 6000);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Acariciar a ${companion.name}`}
                  >
                    <CompanionStage
                      name={companion.name}
                      stage={companion.stage}
                      mood={companion.mood}
                      accessories={companion.accessories}
                      activeCare={companion.activeCare}
                      onCare={(k) => void companion.care(k)}
                      reducedMotion={companion.reducedMotion}
                      streakDays={companion.state.stats.streakDays ?? 0}
                      hasReadToday={
                        Boolean(todayKey) &&
                        companion.state.stats.lastDayKey === todayKey
                      }
                      greetingText={catPetQuote ?? (greeting ? timeOfDayGreeting() : null)}
                      careStatusText={null}
                      tryOnArticle={null}
                      tryOnLevel={null}
                      onClearTryOn={() => {}}
                      bookTitle={displayTitle(current.name, current.title)}
                    />
                  </div>
                ) : null}

                {effectiveDueWordsCount > 0 ? (
                  <div className="shelf-cat-pending-note" role="status">
                    <span className="cat-note-icon" aria-hidden="true"><Icon name="notebook" size={14} /></span>
                    <span className="cat-note-text">
                      Tienes {effectiveDueWordsCount} palabra{effectiveDueWordsCount === 1 ? "" : "s"} {effectiveDueWordsCount === 1 ? "lista" : "listas"} en tu Herbario
                    </span>
                  </div>
                ) : null}

                <div className="shelf-hero-activity-bar">
                  {goalProgress ? (
                    <div
                      className="shelf-goal-ring-widget progress-ring"
                      role="progressbar"
                      aria-label="Meta de lectura semanal"
                      aria-valuenow={Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      title={`Meta semanal: ${goalProgress.readDays} de ${goalProgress.target} días cumplidos`}
                    >
                      <svg className="shelf-goal-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
                        <path
                          className="goal-ring-bg"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="goal-ring-fill"
                          strokeDasharray={`${Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}, 100`}
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="shelf-goal-ring-info">
                        <div className="shelf-goal-ring-counts">
                          <strong>{goalProgress.readDays}/{goalProgress.target}</strong>
                          <span>días</span>
                        </div>
                        <span className="meta">{goalProgress.met ? "Meta cumplida" : "Meta semanal"}</span>
                      </div>
                    </div>
                  ) : null}

                  {effectiveDueWordsCount > 0 ? (
                    <button
                      type="button"
                      className="btn btn--quick-practice"
                      onClick={() => {
                        triggerHaptic(12);
                        if (onOpenPractice) onOpenPractice();
                        else if (onOpenJourney) onOpenJourney();
                      }}
                    >
                      <Icon name="sparkles" size={16} />
                      <span>Practicar {effectiveDueWordsCount} palabra{effectiveDueWordsCount === 1 ? "" : "s"} pendiente{effectiveDueWordsCount === 1 ? "" : "s"}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* Banner de Calibración Voluntaria (Opt-in - Zero-Friction) */}
          {!(hasCalibrated ?? calibrationDone) &&
            !calibrationDismissed &&
            !isFirstTimeReader &&
            (onStartCalibration ?? onRequestCalibration) && (
              <section
                className="shelf-calibration-callout"
                aria-label="Personalización de vocabulario"
              >
                <div className="shelf-calibration-callout-copy">
                  <span className="shelf-kicker">Personalización opcional · 1 min</span>
                  <p className="shelf-calibration-callout-title">
                    Ajusta Lecta a tu vocabulario para que sólo subraye las palabras que realmente son nuevas para ti.
                  </p>
                </div>
                <div className="shelf-calibration-callout-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn--primary"
                    onClick={onStartCalibration ?? onRequestCalibration}
                  >
                    Personalizar mi nivel
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn--quiet"
                    onClick={dismissCalibrationBanner}
                    aria-label="Ocultar sugerencia de personalización"
                  >
                    Ahora no
                  </button>
                </div>
              </section>
            )}

          <section aria-label="Tu estantería">
            <div className="shelf-header-row">
              <h2 className="eyebrow shelf-eyebrow">Tu estantería</h2>
              <div className="shelf-filters" role="tablist" aria-label="Filtrar libros">
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "all" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("all")}
                  role="tab"
                  aria-selected={shelfFilter === "all"}
                >
                  Todos ({library.length})
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "reading" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("reading")}
                  role="tab"
                  aria-selected={shelfFilter === "reading"}
                >
                  Leyendo ahora
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "unread" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("unread")}
                  role="tab"
                  aria-selected={shelfFilter === "unread"}
                >
                  Por empezar
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "finished" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("finished")}
                  role="tab"
                  aria-selected={shelfFilter === "finished"}
                >
                  Terminados
                </button>
                <button
                  type="button"
                  className="shelf-filter-pill shelf-filter-pill--import"
                  onClick={pickFile}
                >
                  + Importar EPUB
                </button>
              </div>
            </div>

            <div className="shelf-controls-bar">
              <div className="shelf-search-wrap">
                <input
                  type="search"
                  className="shelf-search-input"
                  placeholder="Buscar por título o autor…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Buscar libros por título o autor"
                />
              </div>
              <div className="shelf-sort-wrap">
                <label htmlFor="shelf-sort-select" className="shelf-sort-label">
                  Ordenar:
                </label>
                <select
                  id="shelf-sort-select"
                  className="shelf-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as ShelfSortBy)}
                  aria-label="Ordenar estantería"
                >
                  <option value="recent">Recientes</option>
                  <option value="title">Título</option>
                  <option value="progress">Progreso</option>
                </select>
              </div>
            </div>

            {filteredLibrary.length === 0 && searchQuery.trim() ? (
              <p className="shelf-empty-search">
                No se encontraron libros que coincidan con «{searchQuery}».
              </p>
            ) : null}

            <ul className="shelf-row">
              {filteredLibrary.map((book) => {
                const position = positionByHash.get(book.hash);
                const total = book.sectionCount ?? 0;
                const chapter = position ? position.sectionIndex : -1;
                const isDownloading = downloadingHash === book.hash;
                const cov = bookCoverages.get(book.hash);
                return (
                  <li
                    key={book.hash}
                    className={`shelf-book${book.remoteOnly ? " shelf-item--remote" : ""}`}
                    data-downloading={isDownloading || undefined}
                  >
                    <button
                      type="button"
                      className="shelf-book-cover"
                      disabled={isDownloading}
                      onClick={() => handleBookClick(book)}
                      aria-label={`Abrir ${displayTitle(book.name, book.title)}`}
                      title={displayTitle(book.name, book.title)}
                    >
                      <BookCover
                        book={book}
                        progress={progressOf(position, total)}
                        showRibbon={Boolean(position && progressOf(position, total) > 0)}
                      />
                      <span className="shelf-lang-badge" title={`Idioma: ${languageName(book.language || "es")}`}>
                        {(book.language || "es").toUpperCase()}
                      </span>
                      {book.remoteOnly ? (
                        <span
                          className={`shelf-cloud-badge${isDownloading ? " shelf-cloud-badge--loading" : ""}`}
                          title={isDownloading ? "Descargando libro…" : "Disponible en la nube · Toca para descargar"}
                          aria-label={isDownloading ? "Descargando" : "En la nube"}
                        >
                          <Icon name={isDownloading ? "clock" : "cloud"} size={13} />
                        </span>
                      ) : null}
                      {book.mediaKind ? (
                        <span
                          className="shelf-paperonly-badge"
                          title={
                            book.mediaKind === "tv"
                              ? "Serie · Vocabulario por episodio"
                              : "Película · Vocabulario"
                          }
                          aria-label={
                            book.mediaKind === "tv" ? "Serie" : "Película"
                          }
                        >
                          {book.mediaKind === "tv" ? "Serie" : "Película"}
                        </span>
                      ) : book.paperOnly ? (
                        <span
                          className="shelf-paperonly-badge"
                          title="Libro de la comunidad · Solo lectura en papel"
                          aria-label="Solo papel"
                        >
                          Papel
                        </span>
                      ) : null}
                      {cov ? (
                        coverageIsReliable(cov) ? (
                          <span
                            className={`shelf-affinity-badge shelf-affinity-badge--${affinityTierOf(cov.percent)}`}
                            title={`Afinidad léxica: ~${cov.percent}%${
                              cov.reencuentrosCount
                                ? ` · Repite ${cov.reencuentrosCount} de tu Herbario`
                                : ""
                            }`}
                          >
                            {affinityBadgeLabel(cov.percent)}
                          </span>
                        ) : (
                          <span
                            className="shelf-affinity-badge"
                            title="El catálogo aún no puede medir la mayoría de las palabras de este libro"
                          >
                            {COVERAGE_UNMEASURED_LABEL}
                          </span>
                        )
                      ) : null}
                    </button>
                    {total > 0 && total <= 8 ? (
                      <span className="dots shelf-book-dots" aria-hidden="true">
                        {Array.from({ length: total }, (_, i) => (
                          <span
                            key={i}
                            className={`dot${i < chapter ? " dot--done" : i === chapter ? " dot--current" : ""}`}
                          />
                        ))}
                      </span>
                    ) : total > 0 ? (
                      <span className="thread shelf-book-thread" aria-hidden="true">
                        <span
                          className="thread-fill"
                          style={
                            {
                              "--thread-value": `${Math.round(progressOf(position, total) * 100)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </span>
                    ) : null}
                    {cov ? (
                      <div className="shelf-difficulty-preflight-item">
                        <span>
                          {coverageIsReliable(cov)
                            ? `~${cov.percent}% vocabulario conocido`
                            : COVERAGE_UNMEASURED_LABEL}
                        </span>
                      </div>
                    ) : null}
                    <div className="shelf-book-footer">
                      <span className={`shelf-book-meta meta${isDownloading ? " shelf-book-meta--downloading" : ""}`}>
                        {isDownloading
                          ? "Descargando…"
                          : book.paperOnly
                            ? "Toca para ver capítulos"
                            : book.remoteOnly
                            ? "Toca para descargar"
                            : `${
                                position && total
                                  ? `${Math.round(progressOf(position, total) * 100)}% leído`
                                  : "Sin empezar"
                              }${book.pendingUpload ? " · Subiendo…" : ""}`}
                      </span>
                      <button
                        type="button"
                        className="btn--quiet shelf-book-more"
                        disabled={isDownloading}
                        aria-label={`Opciones de ${displayTitle(book.name, book.title)}`}
                        title="Opciones del libro"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOptions(book);
                        }}
                      >
                        ⋯
                      </button>
                    </div>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="add-slot"
                  onClick={pickFile}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  data-dragging={dragging || undefined}
                >
                  <span className="add-slot-mark" aria-hidden="true" />
                  Añadir libro
                </button>
              </li>
              {onImportArticle ? (
                <li>
                  <button
                    type="button"
                    className="add-slot"
                    onClick={() => setArticleSheetOpen(true)}
                  >
                    <Icon name="book" size={16} />
                    <span>Leer artículo por enlace</span>
                  </button>
                </li>
              ) : null}
            </ul>
          </section>

          {optionsBook ? (
            <Suspense fallback={null}>
              <Sheet
                label={`Opciones de ${displayTitle(optionsBook.name, optionsBook.title)}`}
              onClose={() => {
                setOptionsBook(null);
                setConfirmDelete(null);
              }}
            >
              <div className="sheet-head">
                <strong className="sheet-title">Opciones del libro</strong>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    setOptionsBook(null);
                    setConfirmDelete(null);
                  }}
                  aria-label="Cerrar opciones"
                >
                  Cerrar
                </button>
              </div>

              <div className="shelf-options-body">
                <div className="shelf-options-summary">
                  <div className="shelf-options-cover">
                    <BookCover book={optionsBook} />
                  </div>
                  <div className="shelf-options-details">
                    <h3 className="shelf-options-title">
                      {displayTitle(optionsBook.name, optionsBook.title)}
                    </h3>
                    {optionsBook.author ? (
                      <p className="meta shelf-options-author">{optionsBook.author}</p>
                    ) : null}
                    <p className="meta shelf-options-progress">
                      {optionsBook.paperOnly
                        ? "Libro de la comunidad · Solo lectura en papel"
                        : optionsBook.remoteOnly
                        ? "Disponible en tu cuenta · Listo para descargar"
                        : (() => {
                            const pos = positionByHash.get(optionsBook.hash);
                            const tot = optionsBook.sectionCount ?? 0;
                            return pos && tot
                              ? `Capítulo ${pos.sectionIndex + 1} de ${tot} · ${Math.round(progressOf(pos, tot) * 100)}% leído`
                              : "Sin empezar";
                          })()}
                    </p>
                  </div>
                </div>

                {optionsBook.remoteOnly && !optionsBook.paperOnly ? (
                  <div className="shelf-options-section">
                    <button
                      type="button"
                      className="btn btn--primary shelf-options-download-btn"
                      disabled={downloadingHash === optionsBook.hash}
                      onClick={() => {
                        const target = optionsBook;
                        setOptionsBook(null);
                        if (onDownloadBook) {
                          void onDownloadBook(target);
                        } else if (onSelect) {
                          onSelect(target);
                        } else {
                          onOpen(target);
                        }
                      }}
                    >
                      {downloadingHash === optionsBook.hash
                        ? "Descargando libro…"
                        : "Descargar y abrir"}
                    </button>
                  </div>
                ) : null}

                {onPaperBook ? (
                  <div className="shelf-options-section">
                    <button
                      type="button"
                      className="btn shelf-options-prep-btn"
                      disabled={downloadingHash === optionsBook.hash}
                      onClick={() => {
                        const target = optionsBook;
                        setOptionsBook(null);
                        onPaperBook(target);
                      }}
                    >
                      {downloadingHash === optionsBook.hash
                        ? "Descargando libro…"
                        : "Leo este libro en papel"}
                    </button>
                  </div>
                ) : null}

                {onShareBook && !optionsBook.paperOnly && !optionsBook.localOnly ? (
                  <div className="shelf-options-section">
                    {!optionsBook.shared ? (
                      <>
                        <p className="shelf-options-label">Género de la guía</p>
                        <div className="shelf-genre-chips">
                          {BOOK_GENRES.map((genre) => (
                            <button
                              key={genre}
                              type="button"
                              className={`discover-filter-pill${shareGenre === genre ? " discover-filter-pill--active" : ""}`}
                              aria-pressed={shareGenre === genre}
                              onClick={() =>
                                setShareGenre((current) =>
                                  current === genre ? "" : genre,
                                )
                              }
                            >
                              {genre}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="btn shelf-options-share-btn"
                      onClick={() => {
                        const target = optionsBook;
                        const genre = shareGenre;
                        setOptionsBook(null);
                        void onShareBook(target, !target.shared, genre);
                      }}
                    >
                      {optionsBook.shared
                        ? "Dejar de compartir en la comunidad"
                        : "Compartir a la comunidad"}
                    </button>
                    {!optionsBook.shared ? (
                      <p className="meta shelf-options-hint">
                        Otros lectores podrán usarlo solo como ayuda en papel —
                        asegúrate de que es de dominio público o que puedes compartirlo.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="shelf-options-section">
                  <label htmlFor="shelf-book-lang-picker" className="shelf-options-label">
                    Idioma del libro
                  </label>
                  <p className="meta shelf-options-hint">
                    Determina el diccionario, lemas de palabras y enriquecimiento.
                  </p>
                  <select
                    id="shelf-book-lang-picker"
                    className="shelf-options-select"
                    value={optionsBook.language || "es"}
                    onChange={(event) => void changeBookLanguage(optionsBook.hash, event.target.value)}
                  >
                    <option value="es">Español (ES)</option>
                    <option value="en">Inglés (EN)</option>
                    <option value="fr">Francés (FR)</option>
                    <option value="de">Alemán (DE)</option>
                    <option value="it">Italiano (IT)</option>
                    <option value="pt">Portugués (PT)</option>
                  </select>
                </div>

                <div className="shelf-options-danger-zone">
                  {confirmDelete === optionsBook.hash ? (
                    <div className="shelf-options-confirm" role="alert">
                      <p className="meta">
                        ¿Seguro que quieres quitar «{displayTitle(optionsBook.name, optionsBook.title)}»? Tus palabras guardadas en tu Herbario se conservan.
                      </p>
                      <div className="shelf-options-confirm-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => remove(optionsBook.hash)}
                        >
                          Sí, quitar libro
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn--quiet shelf-book-remove"
                      onClick={() => setConfirmDelete(optionsBook.hash)}
                    >
                      Quitar de la estantería…
                    </button>
                  )}
                </div>
              </div>
            </Sheet>
            </Suspense>
          ) : null}

          {activityHidden ? null : (
          <section aria-label="Días con lectura esta semana">
            <h2 className="eyebrow shelf-eyebrow">Días con lectura</h2>
            <div className="dots shelf-week">
              {weekDays.map(({ day, read }) => (
                <span
                  key={day}
                  className={`dot dot--day${read ? " dot--done" : ""}`}
                  title={new Date(day).toLocaleDateString("es-MX", { weekday: "long" })}
                  aria-label={`${new Date(day).toLocaleDateString("es-MX", { weekday: "long" })}: ${read ? "con lectura" : "sin lectura"}`}
                  role="img"
                />
              ))}
            </div>
            {goalProgress ? (
              <p className="meta shelf-goal">
                Meta de la semana: {goalProgress.readDays} de{" "}
                {goalProgress.target} días
                {goalProgress.met ? " · cumplida" : ""}
              </p>
            ) : null}
            {onOpenJourney ? (
              <div className="shelf-journey-access" style={{ marginTop: "var(--s-2)" }}>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={onOpenJourney}
                >
                  Ver tu Camino completo…
                </button>
              </div>
            ) : null}
          </section>
          )}
        </>
      )}

      {/* «Explora»: Comunidad + Libros gratuitos en pestañas, bajo la
          retícula y también con la estantería vacía — es la respuesta a
          «no sé qué leer». Cada pestaña mantiene su propia búsqueda;
          el catálogo se oculta solo si no hay índice. El contenido
          carga diferido: el chunk no se paga en el arranque. */}
      {communitySection || onGetCatalogBook || screenSection ? (
        <Suspense
          fallback={
            <section className="shelf-explore" aria-busy="true">
              <h2 className="eyebrow shelf-eyebrow">Explora</h2>
            </section>
          }
        >
          <ExploreShelf
            community={communitySection}
            screen={screenSection}
            screenCount={screenCount}
            screenEnabled={SUBTITLE_ZONE_ENABLED}
            onOpenAccount={onOpenAccount}
            catalog={
              onGetCatalogBook ? (
                <div className="free-books">
                  <label
                    className="gutenberg-search-label"
                    htmlFor="free-books-search"
                  >
                    Busca por título o autor
                  </label>
                  <form
                    role="search"
                    className="free-books-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setCatalogQuery(freeQuery.trim());
                    }}
                  >
                    <input
                      id="free-books-search"
                      type="search"
                      className="shelf-community-search"
                      value={freeQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFreeQuery(value);
                        // Al borrar el campo Gutenberg vuelve de
                        // inmediato a los más descargados.
                        if (!value.trim()) setCatalogQuery("");
                      }}
                      placeholder="Título o autor"
                    />
                    <button type="submit" className="btn">
                      Buscar
                    </button>
                  </form>
                  {/* El riel curado también es lazy: sus ~11 kB no
                      pesan en el arranque. */}
                  <Suspense fallback={null}>
                    <DiscoverRail
                      library={library}
                      onOpen={onOpen}
                      onGet={onGetCatalogBook}
                      vocabVersion={vocabVersion}
                      query={freeQuery}
                    />
                  </Suspense>
                  {/* Debajo del riel curado: los clásicos de Gutenberg
                      (libros pg- bajo demanda) responden a la búsqueda
                      enviada — Enter en el campo o el botón de la
                      fila «Buscar en todos los clásicos». */}
                  <Suspense fallback={null}>
                    <GutenbergSearch
                      onGet={onGetCatalogBook}
                      onOpenAccount={onOpenAccount}
                      query={catalogQuery}
                      pendingQuery={
                        freeQuery.trim() !== catalogQuery
                          ? freeQuery.trim()
                          : ""
                      }
                      onSubmitPending={() =>
                        setCatalogQuery(freeQuery.trim())
                      }
                      library={library}
                      onOpen={onOpen}
                    />
                  </Suspense>
                </div>
              ) : undefined
            }
          />
        </Suspense>
      ) : null}

      {showArticleSheet && onImportArticle ? (
        <Suspense fallback={null}>
          <ArticleImportSheet
            initialUrl={initialArticleUrl}
            isPlus={hasLectaPlus(userPlan?.plan)}
            planLoading={Boolean(user || dbUserId) && userPlan === null}
            onImported={onImportArticle}
            onClose={closeArticleSheet}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
