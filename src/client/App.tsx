import {
  Activity,
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
} from "react";
// El Lector y el Cuaderno se cargan diferidos para no inflar la descarga inicial de la estantería.
const Reader = lazy(() => import("./components/Reader"));
const Vocabulary = lazy(() => import("./components/Vocabulary"));
const Journey = lazy(() => import("./components/Journey"));
const PaperReading = lazy(() => import("./components/PaperReading"));
const CommunityShelf = lazy(() => import("./components/CommunityShelf"));
const TrialEndSheet = lazy(() => import("./components/TrialEndSheet"));
const CarneSheet = lazy(() => import("./components/CarneSheet"));
const SubtitleShelf = lazy(() => import("./components/SubtitleShelf"));
const Account = lazy(() => import("./components/Account"));
const Calibration = lazy(() => import("./components/Calibration"));
const RestoreBackupDialog = lazy(() => import("./components/RestoreBackupDialog"));
// Modales que solo se montan a petición: fuera del arranque (Fase 3).
const DiagnosticsModal = lazy(() => import("./components/DiagnosticsModal"));
const LegalNotice = lazy(() => import("./components/LegalNotice"));
const Welcome = lazy(() => import("./components/Welcome"));
const AttachBookSheet = lazy(() => import("./components/AttachBookSheet"));
import { CompanionProvider } from "./components/CompanionProvider";
import Shelf, { type ShelfItem, type BookLike } from "./components/Shelf";
import BookCover from "./components/BookCover";
import Dialog from "./components/Dialog";
import AppNav, { type NavDestination } from "./components/AppNav";
import Notice from "./components/Notice";
import { startSafeViewTransition } from "./lib/view-transition";
import {
  applyTheme,
  loadTheme,
  saveTheme,
  type ThemeChoice,
} from "./lib/settings";
import { decidePendingDelete, PENDING_DELETE_KEY, clearSyncCursors } from "./lib/account-cleanup";
import { pushOverlay, type OverlayHandle } from "./lib/history";
import { sha256Hex } from "./lib/hash";
import { loadTtsLandingPosition } from "./lib/tts-landing";
import type { CatalogBook } from "./lib/catalog";
import { parseTrialBook, type TrialBook } from "./lib/trial";
import { isReviewDueWord } from "./lib/fsrs-light";
import {
  COMPANION_LETTERS_KEY,
  parseCompanionLetters,
} from "./lib/companion-inbox";
import { CALIBRATION_DONE_KEY, calibrationDoneKey } from "./lib/calibration-keys";
import type { CalibrationWord } from "./lib/calibration";
import { LoadingScreen } from "./components/LoadingScreen";
import {
  captureDbScope,
  classifyDbError,
  deleteAccountDb,
  deleteStoredBook,
  getStoredBook,
  isDbScopeActive,
  listBookOps,
  listSavedWords,
  listStoredBooks,
  markBookOpened,
  loadBookPosition,
  loadSessionValue,
  loadShelfBootstrap,
  resetDbConnection,
  saveBook,
  saveBookPosition,
  saveSessionValue,
  setDbUser,
  updateBookMeta,
  type DbScope,
  type DbStorageError,
  type StoredBook,
} from "./lib/idb";
import {
  clearSessionExpired,
  recordCollectionSyncFailure,
  recordCollectionSyncSuccess,
  registerSyncRetryRunner,
  setPendingChangesCount,
  setCollectionPendingCount,
} from "./lib/sync-state";
import { resetGameCache } from "./lib/game";
import { hydrateRetentionHorizon } from "./lib/fsrs-light";
import {
  clearLastUserId,
  loadLastUserId,
  saveLastUserId,
} from "./lib/last-user";
import {
  bookDisplayName,
  displayTitle,
  humanizeFilename,
  isHashLikeIdentifier,
} from "../shared/book-display";
import { genreFromSubjects } from "../shared/book-genres";
import { paperGuideSessionKey, sanitizePaperBookGuide } from "../shared/paper-guide";
import type {
  SubtitleWorkRef,
} from "./lib/subtitle-works";
import type { SubtitleGuide } from "./components/SubtitleShelf";
import { findDeepLinkItem, parseOpenBookParam } from "./lib/deep-link";
import { shouldShowTrialEnd } from "./lib/trial-notice";
import type { PositionConflict } from "./lib/positions-sync";
import {
  claimStarterCoat,
  loadPlan,
  planStore,
  pollPlanUntilPlus,
  rememberLandingSource,
  rememberStarterCoat,
  useUserPlan,
} from "./lib/account-plan";
import { hasLectaPlus } from "../shared/plan";
import { authClient } from "./lib/auth";
import { SCREEN_ZONE_ENABLED } from "./lib/screen-zone";

type BookFileSelection = {
  hash: string;
  name: string;
  file: File;
};

// El libro abierto recuerda de qué cuenta es. Sin esto, un cambio de
// sesión en otra pestaña dejaba el EPUB privado de la cuenta anterior
// montado sobre la base nueva.
type BookSelection = BookFileSelection & {
  ownerUserId: string | null;
};

const LOCAL_ONLY_NOTICE_KEY = "lecta:local-only-notice:v1";
const RESUME_TRIAL_BOOK_KEY = "lecta:resume-trial-book";
/** true si aún no se mostró (sin storage no se muestra). */
function localOnlyNoticePending(): boolean {
  try {
    return !localStorage.getItem(LOCAL_ONLY_NOTICE_KEY);
  } catch {
    return false;
  }
}
/** Se marca al pintarse de verdad, no al armarse: ver `localOnlyNotice`. */
function markLocalOnlyNoticeSeen(): void {
  try {
    localStorage.setItem(LOCAL_ONLY_NOTICE_KEY, "1");
  } catch {
    /* sin storage: no se vuelve a mostrar de todos modos */
  }
}

export default function App() {
  // Enlace de restablecer contraseña (o error de enlace) leído una vez
  // al montar; la URL queda limpia desde el inicio.
  // Parser único de la URL (docs/designs/2026-11-12-planes-y-landing.md):
  // también el pelaje del landing (?gato=, se guarda antes de limpiar la
  // URL para sobrevivir al magic link) y la vuelta de Checkout (?carne=1).
  const [authLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? undefined;
    const urlError = params.get("error") ?? undefined;
    const deleted = params.get("cuenta") === "eliminada";
    const gato = params.get("gato");
    const src = params.get("src");
    // 1 = abrir el Carné; gracias / cancelado = vuelta de Checkout.
    const carneParam = params.get("carne");
    const carne =
      carneParam === "1" || carneParam === "gracias" || carneParam === "cancelado"
        ? carneParam
        : null;
    const carneRaw = carneParam !== null;
    const probar = params.get("probar");
    // ?abrir=<sha256>: enlace directo a un libro (correo de regreso).
    const abrir = params.get("abrir");
    if (gato) rememberStarterCoat(gato);
    rememberLandingSource(src);
    if (
      token || urlError || deleted || gato !== null || src !== null || carneRaw || probar !== null ||
      abrir !== null
    ) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return {
      token,
      urlError,
      deleted,
      carne,
      trial: parseTrialBook(probar),
      openHash: parseOpenBookParam(abrir),
    };
  });
  const [book, setBook] = useState<BookSelection | null>(null);
  // «Probar con un clásico» (lib/trial.ts): loading → reading → ended.
  // Mientras no esté `ended`, la falta de sesión no manda a Welcome.
  const [trial, setTrial] = useState<"loading" | "reading" | "ended" | null>(
    authLink.trial ? "loading" : null,
  );
  const trialBookSeen = useRef(false);
  const [message, setMessage] = useState("");
  // Aviso del primer EPUB propio en cuenta gratis. Con el libro abierto el
  // estado llega a una región solo para lectores de pantalla, así que espera
  // aquí y se pinta (y se marca como visto) cuando el libro se cierra.
  const [localOnlyNotice, setLocalOnlyNotice] = useState("");
  const [error, setError] = useState(
    authLink.urlError ? "El enlace ya venció o fue usado. Pide uno nuevo." : "",
  );
  const [checkingLibrary, setCheckingLibrary] = useState(true);
  const retrofilledCoversRef = useRef<Set<string>>(new Set());
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showJourney, setShowJourney] = useState(false);
  const [showAccount, setShowAccount] = useState(
    Boolean(authLink.token || authLink.urlError || authLink.deleted || authLink.carne),
  );
  const [showCarneOverlay, setShowCarneOverlay] = useState(false);
  const [hasVisitedVocab, setHasVisitedVocab] = useState(false);
  const scrollPositions = useRef<Partial<Record<NavDestination, number>>>({});
  const journeyOrigin = useRef<"shelf" | "vocab" | "account">("shelf");
  const journeyRelease = useRef<OverlayHandle | null>(null);
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  const [library, setLibrary] = useState<ShelfItem[]>([]);
  const [vocabVersion, setVocabVersion] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  // Aviso cuando la posición remota pisó una local que apuntaba a otro
  // lugar: se resuelve antes de abrir el libro.
  const [positionPrompt, setPositionPrompt] = useState<{
    conflict: PositionConflict;
    open: () => void;
    resume?: () => void;
  } | null>(null);
  // El sync corre por detrás de la apertura. Si trae una posición remota
  // más nueva, el lector la aplica sin desmontar el libro.
  const [positionSync, setPositionSync] = useState<{ hash: string; version: number } | null>(null);
  // Clave propia (contador) de los reintentos de «Continuar escuchando».
  const resumeAudioKeyRef = useRef(0);
  const [resumeRequest, setResumeRequest] = useState<{
    hash: string;
    key: number;
    sectionIndex: number;
    ratio?: number;
    anchor?: string;
    anchorOffset?: number;
    resumeAudio?: boolean;
  } | null>(null);
  // Hash del libro que está delante, para no aplicar un sync que llega
  // después de que la persona volvió a la estantería.
  const openBookHashRef = useRef<string | null>(null);
  const [resetToken, setResetToken] = useState<string | undefined>(authLink.token);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  // Calibración inicial de vocabulario: se interpone una vez antes del
  // primer libro; desde Cuenta se reabre sin libro pendiente.
  const [calibrationWords, setCalibrationWords] = useState<CalibrationWord[] | null>(null);
  const [calibrationLang, setCalibrationLang] = useState("es");
  // Espejo en estado del libro pendiente (vive en una ref para los
  // handlers): solo decide el texto del botón de la pantalla final.
  const [calibrationHasPending, setCalibrationHasPending] = useState(false);
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [readerInitialWord, setReaderInitialWord] = useState<string | undefined>(undefined);
  const bookRelease = useRef<OverlayHandle | null>(null);
  const panelRelease = useRef<OverlayHandle | null>(null);
  // «Leo este libro en papel»: la pantalla es una capa del historial
  // como el Cuaderno — «atrás» la cierra (y su hoja de capítulo va
  // encima, con autoguardado propio).
  const [paperBook, setPaperBook] = useState<ShelfItem | null>(null);
  const paperRelease = useRef<OverlayHandle | null>(null);
  const [vocabFilterRequest, setVocabFilterRequest] = useState<
    { bookHash: string; nonce: number } | undefined
  >(undefined);
  const calibrationRelease = useRef<OverlayHandle | null>(null);
  const positionRelease = useRef<OverlayHandle | null>(null);
  // Guardado de posición que el lector registra mientras está montado.
  // El cierre lo espera antes de desmontar y de sincronizar.
  const positionFlushRef = useRef<(() => Promise<void>) | null>(null);
  // El libro que esperaba entrar cuando se ofreció la calibración.
  // Ref y no estado: el cierre puede venir de «atrás» (popstate) con
  // un callback viejo, y la ref siempre tiene el pendiente actual.
  const calibrationPending = useRef<BookFileSelection | null>(null);
  // La base donde vive la hoja abierta: la marca «calibrationDone» al
  // cerrar cae con la evidencia de la misma cuenta aunque la sesión
  // haya cambiado mientras la prueba estaba abierta.
  const calibrationScope = useRef<DbScope | null>(null);
  // Identidad confirmada en la pasada anterior del efecto de sesión.
  // undefined = todavía no hay veredicto; null = modo anónimo.
  const prevSessionUserIdRef = useRef<string | null | undefined>(undefined);
  const { data: session, isPending: sessionLoading, error: sessionError } =
    authClient.useSession();
  // «Pendiente» solo hasta el primer veredicto. Sin sesión, better-auth
  // vuelve a poner isPending: true en cada refetch por foco (máx. uno
  // cada 5 s) y la bienvenida parpadeaba hacia la estantería.
  const [sessionSettled, setSessionSettled] = useState(false);
  if (!sessionLoading && !sessionSettled) setSessionSettled(true);
  const sessionPending = sessionLoading && !sessionSettled;
  const sessionUserId = session?.user?.id;
  // Hashes ya en la estantería: la pestaña Comunidad los usa para
  // marcar «En tu estantería» sin otra consulta.
  const ownedBookHashes = useMemo(
    () => new Set(library.map((book) => book.hash)),
    [library],
  );
  // Obras audiovisuales ya preparadas (mediaKind) — alimentan «Tus
  // títulos» dentro de la pestaña Series y películas de Explora y NO
  // se pintan en la estantería de libros.
  const screenWorks = useMemo(
    () => library.filter((book) => book.mediaKind),
    [library],
  );
  const shelfBooks = useMemo(
    () => library.filter((book) => !book.mediaKind),
    [library],
  );
  // Arranque optimista: la última cuenta confirmada abre su base
  // local sin esperar a que resuelva la sesión. Si la sesión llega
  // con otra identidad (o sin sesión), el efecto principal hace la
  // transición con las mismas protecciones de scope de siempre.
  const [optimisticUserId] = useState(() => loadLastUserId());
  // La cuenta cuya base local ya quedó activa (se fija tras setDbUser,
  // nunca antes): el compañero solo ve datos de la base vigente — un
  // cambio de cuenta lo limpia y recarga con el contexto nuevo.
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  // La base activa ya es la que dictó la sesión (no la optimista de
  // `lastUserId`): el libro de prueba se importa recién entonces.
  const [sessionDbReady, setSessionDbReady] = useState(false);
  const [dbStorageError, setDbStorageError] = useState<DbStorageError | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showLegal, setShowLegal] = useState<"privacy" | "terms" | null>(null);
  // Hoja «Adjunta tu archivo o pasa a Lecta+» (libro propio sin archivo).
  const [attachFor, setAttachFor] = useState<ShelfItem | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    // Precarga el Lector durante la holgura del navegador para que abrir un libro sea inmediato.
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as unknown as { requestIdleCallback: (cb: () => void) => number })
        .requestIdleCallback(() => void import("./components/Reader"));
      return () => {
        if ("cancelIdleCallback" in window) {
          (window as unknown as { cancelIdleCallback: (id: number) => void })
            .cancelIdleCallback(id);
        }
      };
    }
    const timer = setTimeout(() => void import("./components/Reader"), 2500);
    return () => clearTimeout(timer);
  }, []);

  const changeTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    saveTheme(choice);
    applyTheme(choice);
  };

  const releaseBook = () => {
    bookRelease.current?.release();
    bookRelease.current = null;
  };

  const closeReader = () => {
    const flush = positionFlushRef.current;
    positionFlushRef.current = null;
    openBookHashRef.current = null;
    setReaderInitialWord(undefined);
    setResumeRequest(null);
    setPositionSync(null);
    setMessage("");
    const teardown = () => {
      startSafeViewTransition(() => {
        panelRelease.current?.release();
        panelRelease.current = null;
        setShowVocabulary(false);
        setShowAccount(false);
        setShowCarneOverlay(false);
        setShowJourney(false);
        releaseBook();
        setBook(null);
      });
      // La posición final de la sesión de lectura sale aquí hacia la
      // cuenta, para que los demás dispositivos continúen donde quedó.
      void import("./lib/positions-sync")
        .then(({ syncPositions }) => syncPositions())
        .catch(() => null);
    };
    // Guardar antes de cerrar. Con «atrás» del navegador (gesto o botón)
    // el cierre no pasa por el guardado del lector: el desmontaje escribe
    // en segundo plano y `syncPositions` alcanzaba a leer la fila vieja y
    // devolvía otra posición encima de la recién leída. El botón de la
    // barra sí guardaba antes; el gesto no.
    if (!flush) {
      teardown();
      return;
    }
    void flush()
      .catch(() => undefined)
      .then(teardown);
  };

  const [lastReadBook, setLastReadBook] = useState<{
    hash: string;
    name: string;
    file?: File;
    title?: string;
    author?: string;
    cover?: Blob;
    progress?: number;
    ownerUserId: string | null;
  } | null>(null);

  const openBook = (
    selection: BookFileSelection,
    meta?: { title?: string; author?: string; cover?: Blob },
  ) => {
    const ownedSelection: BookSelection = {
      ...selection,
      ownerUserId: sessionUserId ?? null,
    };
    openBookHashRef.current = selection.hash;
    // Sin esto la estantería destaca el último libro importado, no el abierto.
    void markBookOpened(selection.hash, captureDbScope()).catch(() => {});
    startSafeViewTransition(() => {
      setShowVocabulary(false);
      setShowAccount(false);
      setShowJourney(false);
      if (!bookRelease.current) {
        // «Atrás» del navegador (gesto o botón) cierra por aquí: tiene
        // que pasar por closeReader para guardar la posición y empujarla
        // a la cuenta antes de desmontar. Antes solo hacía setBook(null)
        // y el punto leído se quedaba sin viajar al servidor.
        bookRelease.current = pushOverlay(() => {
          bookRelease.current = null;
          closeReader();
        });
      }
      setBook(ownedSelection);
    });
    const libItem = library.find((item) => item.hash === selection.hash);
    setLastReadBook({
      hash: selection.hash,
      name: selection.name,
      file: selection.file,
      ownerUserId: ownedSelection.ownerUserId,
      title: meta?.title ?? libItem?.title ?? selection.name,
      author: meta?.author ?? libItem?.author,
      cover: meta?.cover ?? libItem?.cover,
      progress: 0,
    });
  };

  // Termina el flujo de calibración. Con marca («Listo»/«Saltar») la
  // prueba queda hecha y no se vuelve a ofrecer; sin marca («Cerrar»
  // o «atrás») puede reaparecer en la próxima apertura. Si había un
  // libro esperando entrar, abre al cerrar.
  const closeCalibration = (markDone: boolean) => {
    const selection = calibrationPending.current;
    calibrationPending.current = null;
    const release = calibrationRelease.current;
    calibrationRelease.current = null;
    const scope = calibrationScope.current ?? captureDbScope();
    calibrationScope.current = null;
    setCalibrationWords(null);
    setCalibrationHasPending(false);
    if (markDone) {
      setCalibrationDone(true);
      void saveSessionValue(calibrationDoneKey(calibrationLang), "1", scope).catch(
        () => undefined,
      );
      if (calibrationLang === "es") {
        void saveSessionValue(CALIBRATION_DONE_KEY, "1", scope).catch(
          () => undefined,
        );
      }
      // Si el lector está montado detrás (la prueba se abrió desde su
      // aviso al final del capítulo), recarga perfil y Cuaderno con
      // lo que acaba de escribirse, sin perder la posición.
      setVocabVersion((v) => v + 1);
    }
    if (selection) {
      // Si la entrada de la calibración sigue en la pila pasa a ser la
      // del libro: «atrás» desde el lector vuelve a la estantería, no
      // a la prueba. Si ya salió vía popstate, openBook empuja otra.
      if (release) {
        bookRelease.current = release;
        release.swap(() => {
          bookRelease.current = null;
          closeReader();
        });
      }
      openBook(selection);
    } else {
      release?.release();
    }
  };

  // Cierre por «atrás»: la entrada ya salió de la pila, así que la
  // ref se libera antes — el cierre no debe intentar soltarla otra
  // vez y el libro pendiente abre con su propia entrada.
  const onCalibrationBack = () => {
    calibrationRelease.current = null;
    closeCalibration(false);
  };

  const showCalibration = (
    words: CalibrationWord[],
    selection: BookSelection | null,
    language = "es",
  ) => {
    calibrationPending.current = selection;
    calibrationRelease.current ??= pushOverlay(onCalibrationBack);
    calibrationScope.current = captureDbScope();
    setCalibrationLang(language);
    setCalibrationHasPending(Boolean(selection));
    setCalibrationWords(words);
  };

  // Abre la prueba de vocabulario desde el aviso del lector (al
  // terminar el primer capítulo leído) o desde Cuenta. La prueba usa
  // el banco local empaquetado, así que abre al instante y también
  // sin conexión. Devuelve si la hoja quedó abierta — el aviso se
  // mantiene para reintentar cuando no.
  const requestCalibration = async (language = "es"): Promise<boolean> => {
    if (calibrationWords) return true;
    const { getCalibrationBankByLang } = await import("../shared/calibration-bank");
    const words: CalibrationWord[] = getCalibrationBankByLang(language).map(
      (item) => ({
        lemma: item.word,
        definition: null,
        sampleContext: item.posHint,
      }),
    );
    if (!words.length) return false;
    showCalibration(words, null, language);
    return true;
  };

  // Corte limpio al cambiar de identidad: el libro abierto, la última
  // lectura, las hojas modales y la entrada del lector en el historial
  // pertenecen a la cuenta anterior y no pueden sobrevivir a la nueva.
  const resetForIdentityChange = useCallback(() => {
    calibrationPending.current = null;
    calibrationRelease.current?.release();
    calibrationRelease.current = null;
    setCalibrationWords(null);
    setCalibrationHasPending(false);
    positionRelease.current?.release();
    positionRelease.current = null;
    setPositionPrompt(null);
    journeyRelease.current?.release();
    journeyRelease.current = null;
    panelRelease.current?.release();
    panelRelease.current = null;
    bookRelease.current?.release();
    bookRelease.current = null;
    openBookHashRef.current = null;
    setBook(null);
    setLastReadBook(null);
    setReaderInitialWord(undefined);
    setShowVocabulary(false);
    setShowAccount(false);
    setShowCarneOverlay(false);
    setShowJourney(false);
    setShowDiagnostics(false);
    setShowLegal(null);
  }, []);

  const [dueReviewsCount, setDueReviewsCount] = useState(0);
  const [hasJourneyAlert, setHasJourneyAlert] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void Promise.all([
      listSavedWords(undefined, scope),
      loadSessionValue(COMPANION_LETTERS_KEY, scope).catch(() => null),
      loadSessionValue(CALIBRATION_DONE_KEY, scope).catch(() => null),
    ]).then(([savedWords, rawLetters, rawCalibration]) => {
      if (cancelled) return;
      let count = 0;
      for (const w of savedWords) {
        if (isReviewDueWord(w)) count++;
      }
      setDueReviewsCount(count);
      const letters = parseCompanionLetters(rawLetters);
      setHasJourneyAlert(letters.some((l) => !l.read));
      setCalibrationDone(rawCalibration === "1");
    }).catch((err) => {
      if (!cancelled && isDbScopeActive(scope)) {
        setDbStorageError(classifyDbError(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vocabVersion, activityVersion, dbUserId]);

  useEffect(() => {
    // La base activa debe ser ya la de esta identidad: tras un cambio de
    // cuenta, el estado dbUserId sigue apuntando a la base anterior
    // hasta que setDbUser termina. Sin esta guarda, el bootstrap podría
    // leer la última lectura de A y publicarla como si fuera de B.
    if (dbUserId !== (sessionUserId ?? null)) return;
    if (lastReadBook || library.length === 0) return;
    const scope = captureDbScope();
    let cancelled = false;
    void loadShelfBootstrap(scope).then(({ positions, latestHash }) => {
      if (cancelled) return;
      const targetHash = latestHash || positions[0]?.bookHash;
      if (!targetHash) return;
      const item = library.find((b) => b.hash === targetHash);
      if (!item) return;
      const pos = positions.find((p) => p.bookHash === targetHash);
      const prog = pos && item.sectionCount
        ? (pos.progress ?? Math.min(1, pos.sectionIndex / item.sectionCount))
        : (pos?.progress ?? 0);
      setLastReadBook({
        hash: item.hash,
        name: item.name,
        title: item.title,
        author: item.author,
        cover: item.cover,
        progress: prog,
        ownerUserId: sessionUserId ?? null,
      });
    }).catch((err) => {
      if (!cancelled && isDbScopeActive(scope)) {
        setDbStorageError(classifyDbError(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [library, lastReadBook, sessionUserId, dbUserId]);

  // «Ver Lecta+» de PlanNote: abre el Carné sobre el lector (sin desmontarlo)
  // o navega a Cuenta («Tú») cuando está en la estantería.
  useEffect(() => {
    const open = () => {
      setShowVocabulary(false);
      setShowJourney(false);
      setAttachFor(null);
      setPaperBook(null);
      if (book !== null) {
        setShowCarneOverlay(true);
      } else {
        setShowCarneOverlay(false);
        setShowAccount(true);
      }
    };
    window.addEventListener("lecta:open-carne", open);
    return () => window.removeEventListener("lecta:open-carne", open);
  }, [book]);

  const activeNav: NavDestination = showJourney
    ? "journey"
    : showVocabulary
      ? "vocabulary"
      : showAccount
        ? "account"
        : "shelf";

  useLayoutEffect(() => {
    if (book) return;
    const targetY = scrollPositions.current[activeNav] ?? 0;
    window.scrollTo(0, targetY);
  }, [activeNav, book]);

  const navigateTo = (dest: NavDestination) => {
    if (dest === "vocab" || dest === "vocabulary") {
      setHasVisitedVocab(true);
    }
    if (dest === activeNav) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollPositions.current[activeNav] = window.scrollY;

    startSafeViewTransition(() => {
      startTransition(() => {
        if (dest === "shelf") {
          panelRelease.current?.release();
          panelRelease.current = null;
          setShowVocabulary(false);
          setShowAccount(false);
          setShowJourney(false);
          return;
        }

        if (!panelRelease.current) {
          panelRelease.current = pushOverlay(() => {
            startSafeViewTransition(() => {
              startTransition(() => {
                panelRelease.current = null;
                setShowVocabulary(false);
                setShowAccount(false);
                setShowJourney(false);
              });
            });
          });
        }

        if (dest === "vocab" || dest === "vocabulary") {
          setHasVisitedVocab(true);
          setShowVocabulary(true);
          setShowAccount(false);
          setShowJourney(false);
        } else if (dest === "journey") {
          setShowJourney(true);
          setShowVocabulary(false);
          setShowAccount(false);
        } else if (dest === "account") {
          setShowAccount(true);
          setShowVocabulary(false);
          setShowJourney(false);
        }
      });
    });
  };

  const openNotebookOverlay = () => {
    setHasVisitedVocab(true);
    if (!panelRelease.current) {
      panelRelease.current = pushOverlay(() => {
        panelRelease.current = null;
        setShowVocabulary(false);
      });
    }
    setShowVocabulary(true);
  };

  const closeNotebookOverlay = () => {
    panelRelease.current?.release();
    panelRelease.current = null;
    setShowVocabulary(false);
  };

  const openJourneyFrom = (origin: "shelf" | "vocab" | "account") => {
    journeyOrigin.current = origin;
    if (!journeyRelease.current) {
      journeyRelease.current = pushOverlay(() => {
        journeyRelease.current = null;
        setShowJourney(false);
      });
    }
    setShowJourney(true);
  };

  const closeJourney = () => {
    journeyRelease.current?.release();
    journeyRelease.current = null;
    setShowJourney(false);
  };

  // La estantería mezcla los libros del dispositivo con los que solo
  // están en la cuenta: locales primero (recientes arriba) y los
  // remotos sin copia local después (recién subidos arriba).
  // useCallback: captura sessionUserId y se usa dentro de efectos.
  const refreshLibrary = useCallback(async () => {
    // Todo el refresco corre bajo el contexto capturado al entrar: si
    // la cuenta cambia a mitad, las lecturas son de la base dueña y el
    // resultado no se publica — jamás se pinta la biblioteca de otra
    // cuenta.
    const bound = captureDbScope();
    let books: StoredBook[];
    let ops: Awaited<ReturnType<typeof listBookOps>>;
    let remote: Awaited<ReturnType<typeof import("./lib/books").listRemoteBooks>>;
    try {
      [books, ops, remote] = await Promise.all([
        listStoredBooks(bound),
        listBookOps(bound),
        sessionUserId
          ? import("./lib/books")
              .then(({ listRemoteBooks }) => listRemoteBooks(bound))
              .catch(() => [])
          : Promise.resolve([]),
      ]);
    } catch (err) {
      if (isDbScopeActive(bound)) {
        setCheckingLibrary(false);
        setDbStorageError(classifyDbError(err));
      }
      return;
    }
    if (!isDbScopeActive(bound)) {
      setCheckingLibrary(false);
      return;
    }
    setDbStorageError(null);
    const pendingUploads = new Set(
      ops.filter((op) => op.kind === "upload").map((op) => op.hash),
    );
    // Un borrado encolado significa «este libro se está quitando»: si el
    // servidor todavía lo lista (el DELETE corre en la cola, o reintenta
    // tras un corte de red) no se pinta otra vez como «En la nube».
    const pendingDeletes = new Set(
      ops.filter((op) => op.kind === "delete").map((op) => op.hash),
    );
    const localHashes = new Set(books.map((book) => book.hash));
    // Flags comunitarios de la fila remota: `paperOnly` se conserva en
    // el registro local al descargar; `shared` viaja solo por la lista
    // (compartir siempre requiere red, así que perderlo offline no abre
    // nada indebido).
    const remoteByHash = new Map(remote.map((r) => [r.hash, r]));
    const localItems: ShelfItem[] = books
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((book) => ({
        hash: book.hash,
        name: book.name,
        addedAt: book.addedAt,
        title: book.title,
        author: book.author,
        cover: book.cover,
        sectionCount: book.sectionCount,
        language: book.language,
        pendingUpload: pendingUploads.has(book.hash) || undefined,
        paperOnly: book.paperOnly || remoteByHash.get(book.hash)?.paperOnly || undefined,
        mediaKind: book.mediaKind,
        imdbId: book.imdbId,
        shared: remoteByHash.get(book.hash)?.shared || undefined,
        // El género de la fila remota manda: es la elección real al
        // compartir; el detectado local del EPUB solo rellena huecos.
        genre: remoteByHash.get(book.hash)?.genre || book.genre || undefined,
        hasFile: remoteByHash.get(book.hash)?.hasFile,
      }));
    for (const r of remote) {
      if (!r.hasCover && !retrofilledCoversRef.current.has(r.hash)) {
        const local = books.find((b) => b.hash === r.hash);
        if (local?.cover) {
          retrofilledCoversRef.current.add(r.hash);
          const bound = captureDbScope();
          void Promise.all([import("./lib/cover"), import("./lib/books")])
            .then(async ([{ coverToJpegBlob }, { uploadBookCover }]) => {
              const jpeg = await coverToJpegBlob(local.cover!);
              return uploadBookCover(r.hash, jpeg, bound);
            })
            .catch(() => {});
        }
      }
    }

    const remoteItems: ShelfItem[] = remote
      .filter(
        (item) => !localHashes.has(item.hash) && !pendingDeletes.has(item.hash),
      )
      .sort((a, b) => +new Date(b.uploaded) - +new Date(a.uploaded))
      .map((item) => {
        const resolvedTitle = bookDisplayName({
          title: item.title,
          name: item.name,
          author: item.author,
          isRemoteOnly: true,
        });
        return {
          hash: item.hash,
          name: item.name && !isHashLikeIdentifier(item.name) ? item.name : resolvedTitle,
          addedAt: +new Date(item.uploaded) || 0,
          remoteOnly: true,
          title: resolvedTitle,
          author:
            item.author ||
            (resolvedTitle !== "Libro en la nube" ? undefined : "Toca para descargar"),
          sectionCount: item.sections || undefined,
          language: item.language,
          hasCover: item.hasCover,
          // Biblioteca comunitaria: lo ofrecí a otros lectores, o es una
          // copia adjunta que solo abre el modo papel.
          shared: item.shared || undefined,
          paperOnly: item.paperOnly || undefined,
          genre: item.genre || undefined,
          hasFile: item.hasFile,
        };
      });
    setLibrary([...localItems, ...remoteItems]);
    setCheckingLibrary(false);
  }, [sessionUserId]);

  // Paso a Lecta+: los libros locales cuya fila remota no tiene archivo se
  // suben solos, una vez, cuando el plan cambia de algo que no es Lecta+.
  const userPlan = useUserPlan();
  const hadPlusRef = useRef<boolean | null>(null);
  useEffect(() => {
    const plus = hasLectaPlus(userPlan?.plan);
    const before = hadPlusRef.current;
    hadPlusRef.current = userPlan ? plus : before;
    if (!plus || before === true || !userPlan) return;
    const scope = captureDbScope();
    void (async () => {
      const [{ listRemoteBooks }, { queueBookUpload, runBookQueue }] = await Promise.all([
        import("./lib/books"),
        import("./lib/book-queue"),
      ]);
      const remote = await listRemoteBooks(scope).catch(() => []);
      const local = new Set((await listStoredBooks(scope).catch(() => [])).map((b) => b.hash));
      const pending = remote.filter((r) => r.hasFile === false && local.has(r.hash));
      for (const row of pending) await queueBookUpload(row.hash, row.name, scope);
      if (pending.length) {
        await runBookQueue(scope).catch(() => 0);
        void refreshLibrary();
      }
    })();
  }, [userPlan, refreshLibrary]);

  // El panel abierto por el enlace también es una capa del historial:
  // el botón atrás lo cierra como a cualquier otro panel.
  useEffect(() => {
    if (!authLink.token && !authLink.urlError) return;
    panelRelease.current = pushOverlay(() => {
      panelRelease.current = null;
      setShowVocabulary(false);
      setShowAccount(false);
      setShowJourney(false);
    });
  }, [authLink]);

  // Apertura optimista con marcador: la base local de la última
  // cuenta confirmada se muestra al instante. La sesión se confirma
  // después en el efecto de abajo, que reconcilia identidad, syncs
  // y marcador — este efecto solo pinta lo local.
  useEffect(() => {
    if (!optimisticUserId) return;
    let cancelled = false;
    void setDbUser(optimisticUserId)
      .then(async () => {
        if (cancelled) return;
        resetGameCache();
        const scope = captureDbScope();
        // El ritmo de repaso se carga antes de publicar la cuenta: así
        // la interfaz nunca muestra el de la cuenta anterior.
        await hydrateRetentionHorizon(scope);
        if (cancelled) return;
        setDbUserId(scope.userId);
        setCheckingLibrary(false);
        void refreshLibrary();
      })
      .catch((err) => {
        if (!cancelled) {
          setCheckingLibrary(false);
          setDbStorageError(classifyDbError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [optimisticUserId, refreshLibrary]);

  useEffect(() => {
    // Mientras la sesión no resuelve, no sabemos si hay cuenta: tocar
    // bases locales o marcadores de borrado en ese momento es inseguro.
    // Salvo que el arranque optimista ya haya abierto una base (arriba):
    // en ese caso este efecto reconcilia cuando la sesión responde.
    if (sessionPending) return;
    let cancelled = false;
    // Error de sesión no autenticada (red caída, 5xx) sin identidad
    // disponible: no hay veredicto — se conserva la base que ya estaba
    // abierta (la del marcador optimista, si la hubo) y el marcador
    // queda intacto para el próximo arranque. Un 401 o una sesión nula
    // sin error SÍ son veredicto de «sin sesión».
    const inconclusive =
      Boolean(sessionError) && sessionError?.status !== 401 && !sessionUserId;
    const nextSessionUserId = sessionUserId ?? null;
    if (!inconclusive) {
      const prevSessionUserId = prevSessionUserIdRef.current;
      prevSessionUserIdRef.current = nextSessionUserId;
      if (
        prevSessionUserId !== undefined &&
        prevSessionUserId !== nextSessionUserId
      ) {
        // La marca «sesión vencida» es de la identidad que sale; la
        // sesión nueva parte limpia y el primer sync exitoso confirma.
        clearSessionExpired();
        if (prevSessionUserId === null && nextSessionUserId !== null) {
          // Inicio de sesión sobre la propia sesión anónima: el libro
          // abierto se adopta en la cuenta nueva en vez de cerrarse.
          setBook((current) =>
            current && current.ownerUserId === null
              ? { ...current, ownerUserId: nextSessionUserId }
              : current,
          );
          setLastReadBook((current) =>
            current && current.ownerUserId === null
              ? { ...current, ownerUserId: nextSessionUserId }
              : current,
          );
        } else if (prevSessionUserId !== null) {
          // Otra cuenta (o cierre de sesión): nada de la identidad
          // anterior puede quedar montado sobre la base nueva.
          resetForIdentityChange();
        }
      }
    }
    void (async () => {
      try {
        if (!inconclusive) await setDbUser(sessionUserId ?? null);
      } catch (error) {
        // Sin la base local no hay estantería que preparar: soltar el
        // spinner y decir por qué (p. ej. otra pestaña reteniendo una
        // versión vieja de IndexedDB) — cargar eterno escondería el
        // fallo real.
        if (!cancelled) {
          setCheckingLibrary(false);
          setDbStorageError(classifyDbError(error));
        }
        return;
      }
      // El marcador sigue el veredicto de la sesión: identidad
      // confirmada lo graba, «sin sesión» claro lo borra y un error
      // de red no lo toca.
      if (sessionUserId) saveLastUserId(sessionUserId);
      else if (!inconclusive) clearLastUserId();
      // La cuenta cambió: el estado del juego en memoria pertenece a
      // la base anterior — se suelta para no mostrar ni persistir lo
      // ajeno (las tareas encoladas llevan su contexto y abortan solas).
      resetGameCache();
      // Contexto de esta transición: todo lo que sigue (syncs, cola,
      // refresco) corre bajo él. Si la sesión vuelve a cambiar, las
      // escrituras aterrizan en la base dueña y la red aborta.
      let scope = captureDbScope();
      if (cancelled) return;
      await hydrateRetentionHorizon(scope);
      if (cancelled) return;
      // Ya es seguro: la base activa es la de esta cuenta — el
      // compañero recarga con ella (y limpia lo de la cuenta previa).
      setDbUserId(scope.userId);
      setSessionDbReady(true);

      // La base local solo se limpia si el correo de confirmación
      // redirigió aquí; cerrar sesión o un enlace vencido no bastan.
      const pendingDelete = localStorage.getItem(PENDING_DELETE_KEY);
      if (pendingDelete) {
        const decision = decidePendingDelete({
          confirmed: authLink.deleted,
          urlError: authLink.urlError,
          pendingUserId: pendingDelete,
          sessionUserId,
        });
        // Un enlace vencido/con error no autoriza a borrar datos, pero sí
        // descarta el marcador: no hay nada que reintentar.
        if (decision.clearMarker && !decision.cleanupUserId) {
          localStorage.removeItem(PENDING_DELETE_KEY);
        }
        if (decision.cleanupUserId) {
          try {
            const removed = await deleteAccountDb(decision.cleanupUserId);
            if (removed) {
              // Solo el borrado confirmado consume el marcador: si
              // IndexedDB queda bloqueado por otra pestaña, se conserva
              // para reintentar en el próximo arranque.
              localStorage.removeItem(PENDING_DELETE_KEY);
              clearSyncCursors(decision.cleanupUserId);
              if (!cancelled) {
                setMessage("Tu cuenta y sus datos en este dispositivo fueron eliminados.");
              }
            } else if (!cancelled) {
              setError(
                "Tu cuenta se eliminó, pero no se pudo limpiar este dispositivo. Se reintentará al abrir de nuevo.",
              );
            }
          } catch {
            if (!cancelled) {
              setError(
                "Tu cuenta se eliminó, pero no se pudo limpiar este dispositivo. Se reintentará al abrir de nuevo.",
              );
            }
          }
        }
      }

      setCheckingLibrary(false);
      void refreshLibrary();
      if (!sessionUserId) return;

      // Plan de la cuenta: la caché local primero (sirve offline);
      // checkRemoteReset trae el plan fresco en el mismo cuerpo.
      await loadPlan(sessionUserId, scope);

      const [
        accountResetMod,
        vocabMod,
        readingSyncMod,
        companionSyncMod,
        positionsSyncMod,
        dailySummaryMod,
        booksMod,
        bookQueueMod,
      ] = await Promise.all([
        import("./lib/account-reset"),
        import("./lib/vocab"),
        import("./lib/reading-sync"),
        import("./lib/companion-sync"),
        import("./lib/positions-sync"),
        import("./lib/daily-summary"),
        import("./lib/books"),
        import("./lib/book-queue"),
      ]);
      if (cancelled) return;

      // Antes de empujar nada: si la cuenta se reinició en otro
      // dispositivo, esta copia local quedó obsoleta — el chequeo la
      // vacía y devuelve true, y el contexto se recaptura sobre la base
      // limpia. Sin este paso la copia vieja resucitaría lo borrado.
      if (await accountResetMod.checkRemoteReset(scope, { force: true })) {
        scope = captureDbScope();
        void refreshLibrary();
      }
      if (!isDbScopeActive(scope)) return;

      // Pelaje elegido en el landing (?gato= / lecta:gato): se reclama una
      // sola vez. Al volver de Stripe Checkout (?carne=1) el webhook puede
      // llegar tarde: se consulta el plan unos segundos.
      void claimStarterCoat(sessionUserId, scope);
      if (authLink.carne === "gracias") void pollPlanUntilPlus(sessionUserId, scope);

      const pulled = await vocabMod
        .syncSavedWords(scope)
        .then((res) => {
          if (res !== null) {
            recordCollectionSyncSuccess("words");
          } else {
            recordCollectionSyncFailure("words", "Sync parcial o interrumpido");
          }
          return res;
        })
        .catch((err) => {
          recordCollectionSyncFailure("words", err);
          return null;
        });
      if (!cancelled && pulled) {
        setMessage(`Herbario sincronizado: ${pulled} palabra(s) nueva(s) en este dispositivo.`);
        setVocabVersion((v) => v + 1);
      }
      // Marcadores y pasajes: mismo ciclo, sin bloquear la estantería.
      const pulledMarks = await readingSyncMod
        .syncAnnotations(scope)
        .then((res) => {
          if (res !== null) {
            recordCollectionSyncSuccess("annotations");
          } else {
            recordCollectionSyncFailure("annotations", "Sync parcial o interrumpido");
          }
          return res;
        })
        .catch((err) => {
          recordCollectionSyncFailure("annotations", err);
          return null;
        });
      if (!cancelled && pulledMarks) {
        setMessage(`Marcadores sincronizados: ${pulledMarks} nuevo(s) en este dispositivo.`);
      }
      // Actividad de lectura: mismas reglas, anexable por id. Si
      // llegaron intervalos el panel del Cuaderno relee su progreso.
      void readingSyncMod
        .syncActivity(scope)
        .then((pulledAct) => {
          if (pulledAct !== null) {
            recordCollectionSyncSuccess("activity");
            if (pulledAct && !cancelled) setActivityVersion((v) => v + 1);
          } else {
            recordCollectionSyncFailure("activity", "Sync parcial o interrumpido");
          }
        })
        .catch((err) => {
          recordCollectionSyncFailure("activity", err);
        });
      // Repasos del cuaderno: anexables por id, mismo ciclo.
      void readingSyncMod
        .syncReviews(scope)
        .then((res) => {
          if (res !== null) {
            recordCollectionSyncSuccess("reviews");
          } else {
            recordCollectionSyncFailure("reviews", "Sync parcial o interrumpido");
          }
        })
        .catch((err) => {
          recordCollectionSyncFailure("reviews", err);
        });
      // El compañero: baja lo que otros dispositivos escribieron y
      // sube journal, registros y recepciones pendientes.
      void companionSyncMod
        .syncCompanion(scope)
        .then((res) => {
          if (res !== null) {
            recordCollectionSyncSuccess("companion");
          } else {
            recordCollectionSyncFailure("companion", "Sync parcial o interrumpido");
          }
        })
        .catch((err) => {
          recordCollectionSyncFailure("companion", err);
        });
      // Conocimiento del lector: misma fusión por clave con updatedAt
      // como árbitro, lápidas incluidas. Si bajó algo, el lector
      // recarga su perfil como cuando llegan palabras nuevas.
      void readingSyncMod
        .syncKnowledge(scope)
        .then((pulledKnow) => {
          if (pulledKnow !== null) {
            recordCollectionSyncSuccess("knowledge");
            if (pulledKnow && !cancelled) setVocabVersion((v) => v + 1);
          } else {
            recordCollectionSyncFailure("knowledge", "Sync parcial o interrumpido");
          }
        })
        .catch((err) => {
          recordCollectionSyncFailure("knowledge", err);
        });
      // Posiciones de lectura: misma fusión por libro, empuja lo local
      // y baja lo que otros dispositivos dejaron más reciente.
      void positionsSyncMod
        .syncPositions(scope)
        .then((res) => {
          if (res !== null) {
            recordCollectionSyncSuccess("positions");
          } else {
            recordCollectionSyncFailure("positions", "Sync parcial o interrumpido");
          }
        })
        .catch((err) => {
          recordCollectionSyncFailure("positions", err);
        });
      // Resumen diario del dispositivo: sube la telemetría del ciclo
      // (foco, ritmo, repasos) sellada por huella — sin cambios no sube
      // nada, y un fallo se reintenta en el siguiente ciclo.
      void dailySummaryMod.pushDailySummaries(scope).catch(() => null);
      try {
        const bookOps = await listBookOps(scope).catch(() => []);
        setPendingChangesCount(bookOps.length + positionsSyncMod.getPendingPositionsCount());
      } catch {
        // Ignore
      }
      let remote: Awaited<ReturnType<typeof import("./lib/books").listRemoteBooks>>;
      let localBooks: StoredBook[];
      try {
        [remote, localBooks] = await Promise.all([
          booksMod.listRemoteBooks(scope).catch(() => []),
          listStoredBooks(scope),
        ]);
      } catch (err) {
        if (!cancelled && isDbScopeActive(scope)) {
          setDbStorageError(classifyDbError(err));
        }
        return;
      }
      if (cancelled || !isDbScopeActive(scope)) return;
      const remoteHashes = new Set(remote.map((item) => item.hash));

      // Lo que falta en la nube entra a la cola persistente: si la
      // subida falla queda «Pendiente de subir» y se reintenta solo.
      // Guarda estricta: jamás encolar libros con data vacía o de 0 bytes.
      for (const storedBook of localBooks) {
        if (!remoteHashes.has(storedBook.hash)) {
          if (storedBook.data && storedBook.data.size > 0) {
            // Free: solo metadatos; Lecta+: también el archivo (027).
            await bookQueueMod.queueBookSync(
              storedBook.hash,
              storedBook.name,
              hasLectaPlus(planStore.get()?.plan),
              scope,
            );
          }
        }
      }
      // La estantería repinta ya con los remotos y las insignias de
      // pendiente: las subidas corren detrás — son archivos completos
      // y en datos móviles pueden tardar, no deben retener la lista.
      if (!cancelled) void refreshLibrary();
      // La recuperación de libros de la era user-books/ no espera a la
      // cola: un EPUB subiendo en red lenta no debe retrasar bajar la
      // biblioteca de la cuenta.
      void readingSyncMod
        .pullMissingUserBooksFromCloud(scope)
        .then((downloaded) => {
          if (downloaded > 0 && !cancelled) void refreshLibrary();
        })
        .catch(() => null);
      await bookQueueMod
        .runBookQueue(scope)
        .then(() => {
          setCollectionPendingCount("books", 0);
        })
        .catch(() => {
          setCollectionPendingCount("books", 1);
        })
        .finally(async () => {
          try {
            const bookOps = await listBookOps(scope).catch(() => []);
            setPendingChangesCount(bookOps.length + positionsSyncMod.getPendingPositionsCount());
          } catch {
            // Ignore
          }
        });
      // Lo que solo está en la nube ya no baja en automático: aparece
      // en la estantería como «En la nube» y se descarga al tocarlo.
      if (!cancelled) void refreshLibrary();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionUserId,
    sessionPending,
    sessionError,
    authLink,
    refreshLibrary,
    resetForIdentityChange,
  ]);

  // Si la sesión sigue abierta y vuelve la conexión, re-sincroniza todo
  // (los cambios hechos sin conexión —palabras, posiciones, subidas de
  // libros encoladas— se suben aquí).
  useEffect(() => {
    if (!sessionUserId) return;

    const runFullSync = async () => {
      let scope = captureDbScope();
      if (!scope.userId) return;
      const [
        accountResetMod,
        syncChangesMod,
        vocabMod,
        readingSyncMod,
        companionSyncMod,
        positionsSyncMod,
        bookQueueMod,
      ] = await Promise.all([
        import("./lib/account-reset"),
        import("./lib/sync-changes"),
        import("./lib/vocab"),
        import("./lib/reading-sync"),
        import("./lib/companion-sync"),
        import("./lib/positions-sync"),
        import("./lib/book-queue"),
      ]);
      if (!isDbScopeActive(scope)) return;
      // Igual que en el arranque: un reset hecho en otro dispositivo
      // vacía esta copia antes de que cualquier colección empuje datos.
      if (await accountResetMod.checkRemoteReset(scope)) {
        scope = captureDbScope();
        void refreshLibrary();
      }
      if (!isDbScopeActive(scope)) return;
      const fullSyncUserId = scope.userId;
      if (fullSyncUserId) void claimStarterCoat(fullSyncUserId, scope);
      // Sonda de cambios (docs/designs/2026-11-24-sonda-de-cambios-sync.md): cada
      // colección salta su pull si el servidor no tiene nada nuevo. Van en serie
      // para que sus escrituras no compitan por el candado de withResetGuard.
      if (fullSyncUserId) await syncChangesMod.primeSyncChanges(fullSyncUserId, scope);
      await vocabMod
        .syncSavedWords(scope)
        .then((res) => {
          if (res !== null) recordCollectionSyncSuccess("words");
          else recordCollectionSyncFailure("words", "Sync parcial o interrumpido");
        })
        .catch((e) => recordCollectionSyncFailure("words", e));
      await readingSyncMod
        .syncAnnotations(scope)
        .then((res) => {
          if (res !== null) recordCollectionSyncSuccess("annotations");
          else recordCollectionSyncFailure("annotations", "Sync parcial o interrumpido");
        })
        .catch((e) => recordCollectionSyncFailure("annotations", e));
      await readingSyncMod
        .syncActivity(scope)
        .then((pulled) => {
          if (pulled !== null) {
            recordCollectionSyncSuccess("activity");
            if (pulled) setActivityVersion((v) => v + 1);
          } else {
            recordCollectionSyncFailure("activity", "Sync parcial o interrumpido");
          }
        })
        .catch((e) => recordCollectionSyncFailure("activity", e));
      await readingSyncMod
        .syncReviews(scope)
        .then((res) => {
          if (res !== null) recordCollectionSyncSuccess("reviews");
          else recordCollectionSyncFailure("reviews", "Sync parcial o interrumpido");
        })
        .catch((e) => recordCollectionSyncFailure("reviews", e));
      await companionSyncMod
        .syncCompanion(scope)
        .then((res) => {
          if (res !== null) recordCollectionSyncSuccess("companion");
          else recordCollectionSyncFailure("companion", "Sync parcial o interrumpido");
        })
        .catch((e) => recordCollectionSyncFailure("companion", e));
      await readingSyncMod
        .syncKnowledge(scope)
        .then((pulled) => {
          if (pulled !== null) {
            recordCollectionSyncSuccess("knowledge");
            if (pulled) setVocabVersion((v) => v + 1);
          } else {
            recordCollectionSyncFailure("knowledge", "Sync parcial o interrumpido");
          }
        })
        .catch((e) => recordCollectionSyncFailure("knowledge", e));
      await positionsSyncMod
        .syncPositions(scope)
        .then((res) => {
          if (res !== null) recordCollectionSyncSuccess("positions");
          else recordCollectionSyncFailure("positions", "Sync parcial o interrumpido");
        })
        .catch((e) => recordCollectionSyncFailure("positions", e));
      void bookQueueMod
        .runBookQueue(scope)
        .then(() => {
          setCollectionPendingCount("books", 0);
          return refreshLibrary();
        })
        .catch(() => {
          setCollectionPendingCount("books", 1);
        })
        .finally(async () => {
          try {
            const bookOps = await listBookOps(scope).catch(() => []);
            setPendingChangesCount(bookOps.length + positionsSyncMod.getPendingPositionsCount());
          } catch {
            // Ignore
          }
        });
    };

    let runnerCancelled = false;
    void import("./lib/reading-sync")
      .then(({ registerReadingSyncRunner }) => {
        if (!runnerCancelled) registerReadingSyncRunner(runFullSync);
      })
      .catch(() => {});
    registerSyncRetryRunner(runFullSync);

    const onOnline = () => {
      void runFullSync();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void import("./lib/reading-sync").then(({ flushPendingReadingSync }) =>
          flushPendingReadingSync(),
        );
      }
    };

    const onPageHide = () => {
      void import("./lib/reading-sync").then(({ flushPendingReadingSync }) =>
        flushPendingReadingSync(),
      );
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      runnerCancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sessionUserId, refreshLibrary]);

  const selectBook = async (
    file: File,
    metaOverride?: { language?: string; catalog?: boolean },
  ) => {
    setError("");
    setMessage("Comprobando el archivo…");
    try {
      // Comprobación mínima antes de guardar: tamaño, firma ZIP y
      // mimetype, sin cargar el libro completo todavía.
      const { checkEpubFile, epubCheckMessage } = await import("./lib/epub-intake");
      const check = await checkEpubFile(file);
      if (!check.ok) {
        setMessage("");
        setError(epubCheckMessage(check));
        return;
      }
      const hash = await sha256Hex(file);
      const scope = captureDbScope();
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const { extractEpubMeta } = await import("../shared/epub-meta");
      const quickMeta = await extractEpubMeta(fileBytes).catch(() => null);
      const initialMeta = {
        title: quickMeta?.title,
        author: quickMeta?.author,
        // El catálogo conoce el idioma (RDF oficial): manda sobre el
        // metadato del EPUB para los libros de «Obtener».
        language: metaOverride?.language ?? quickMeta?.language,
        sectionCount: quickMeta?.sections,
        genre: genreFromSubjects(quickMeta?.subjects ?? []) || undefined,
        metaVersion: quickMeta ? 1 : undefined,
      };
      openBook({ hash, name: file.name, file }, initialMeta);
      void saveBook(
        {
          hash,
          name: file.name,
          data: fileBytes,
          addedAt: Date.now(),
          ...initialMeta,
        },
        scope,
      )
        .then(async () => {
          const { readBookMeta } = await import("./lib/cover");
          const fullMeta = await readBookMeta(file).catch(() => null);
          if (fullMeta) {
            await updateBookMeta(
              hash,
              {
                title: fullMeta.title || initialMeta.title,
                author: fullMeta.author || initialMeta.author,
                language:
                  metaOverride?.language ??
                  (fullMeta.language || initialMeta.language),
                sectionCount: fullMeta.sectionCount || initialMeta.sectionCount,
                cover: fullMeta.cover ?? undefined,
                genre: fullMeta.genre || initialMeta.genre,
                metaVersion: 1,
              },
              scope,
            ).catch(() => null);
          }
          if (
            sessionUserId &&
            !metaOverride?.catalog &&
            planStore.get() &&
            !hasLectaPlus(planStore.get()?.plan) &&
            localOnlyNoticePending()
          ) {
            setLocalOnlyNotice(
              "Libro guardado. Este libro vive solo en este dispositivo. Con Lecta+ te sigue al celular y al Kindle.",
            );
          }
          setMessage("Libro guardado en este dispositivo.");
          void refreshLibrary();
          // Análisis de vocabulario en segundo plano: alimenta la
          // insignia ~% de la tarjeta. Sin red sale con null y la
          // estantería lo reintenta en el próximo montaje.
          void import("./lib/book-vocab")
            .then((m) => m.analyzeStoredBook(hash, scope))
            .catch(() => null);
        })
        .catch(() => {
          setError("El libro se abrió, pero no se pudo guardar en este dispositivo.");
        });
      // La subida pasa por la cola persistente: sin conexión queda
      // encolada y la tarjeta se marca «Pendiente de subir».
      if (sessionUserId) {
        // Free: solo metadatos (el libro aparece en otro dispositivo y ahí
        // se adjunta); Lecta+: también el archivo a R2. Los EPUB del
        // catálogo nunca suben: llevan la marca Project Gutenberg y la
        // sync es de pago (docs/designs/2026-11-15-explora-derechos.md,
        // R4/M13); otro dispositivo los vuelve a obtener del catálogo.
        const withFile =
          !metaOverride?.catalog && hasLectaPlus(planStore.get()?.plan);
        void import("./lib/book-queue")
          .then((bookQueueMod) =>
            bookQueueMod
              .queueBookSync(hash, file.name, withFile, scope)
              .then(() => bookQueueMod.runBookQueue(scope)),
          )
          .then(() => refreshLibrary());
        if (withFile) void file.arrayBuffer().then(async (buf) => {
          const { syncUserBookUpload } = await import("./lib/reading-sync");
          void syncUserBookUpload({
            id: hash,
            title: initialMeta.title || file.name,
            author: initialMeta.author,
            language: initialMeta.language,
            data: buf,
          });
        }).catch(() => null);
      }
    } catch {
      setBook(null);
      setError("No pudimos leer el archivo elegido.");
    }
  };

  // «Obtener» del riel Descubre y de «Más clásicos»: el EPUB del
  // catálogo entra por el mismo tubo que un archivo elegido a mano —
  // validación, dedup por hash (si ya está, abre el existente) y subida
  // a la cuenta. Devuelve el hash del libro guardado para que la
  // tarjeta sepa ofrecer «Abrir» sin volver a descargarlo.
  const getCatalogBook = async (
    item: Pick<CatalogBook, "id" | "title" | "author" | "language">,
  ) => {
    const { downloadCatalogEpub } = await import("./lib/catalog");
    const file = await downloadCatalogEpub(item);
    if (!file) throw new Error("catalog download failed");
    const hash = await sha256Hex(file);
    // El idioma del índice del catálogo es el que el lector vio en la
    // tarjeta: se impone sobre el que declare el EPUB.
    await selectBook(file, { language: item.language, catalog: true });
    return hash;
  };

  // «Probar con un clásico»: con la base de la sesión ya activa (anónima
  // o de cuenta) se descarga el libro y entra por el tubo normal. Con
  // cuenta no hay modo prueba: el libro queda en su estantería.
  const trialBook = authLink.trial;
  const trialStarted = useRef(false);
  // Título real del índice (el de la allowlist o el id solo son provisionales).
  const [trialTitle, setTrialTitle] = useState<string | null>(null);
  const openTrialBook = useEffectEvent(async (item: TrialBook) => {
    // La validez del id se comprueba aquí contra el índice del catálogo
    // (nunca contra el seed local); sin índice (offline) se intenta igual y
    // getCatalogBook falla con 404 si no existe.
    const { listCatalog } = await import("./lib/catalog");
    const index = await listCatalog(captureDbScope()).catch(() => null);
    if (!index) return getCatalogBook(item);
    const found = index.books.find((b) => b.id === item.id);
    if (!found) throw new Error("trial book not in catalog");
    setTrialTitle(found.title);
    return getCatalogBook(found);
  });
  useEffect(() => {
    if (trial !== "loading" || !sessionDbReady || !trialBook) return;
    if (trialStarted.current) return;
    trialStarted.current = true;
    const withAccount = Boolean(sessionUserId);
    openTrialBook(trialBook)
      .then(() => setTrial(withAccount ? null : "reading"))
      .catch(() => {
        setError(`No pudimos abrir «${trialBook.title}». Revisa tu conexión.`);
        setTrial(withAccount ? null : "ended");
      });
  }, [trial, sessionDbReady, trialBook, sessionUserId]);
  // Al cerrar el libro de prueba (flecha, «atrás» o gesto) termina el
  // modo prueba y vuelve Welcome, con el aviso de crear cuenta. Se anota
  // el libro probado en sessionStorage para reabrirlo tras crear cuenta.
  useEffect(() => {
    if (trial !== "reading") return;
    if (book) trialBookSeen.current = true;
    else if (trialBookSeen.current) {
      if (trialBook?.id) {
        try {
          sessionStorage.setItem(RESUME_TRIAL_BOOK_KEY, trialBook.id);
        } catch {
          // Sin almacenamiento: vuelve a la estantería tras crear cuenta
        }
      }
      setTrial("ended");
    }
  }, [trial, book, trialBook]);

  const openStoredBook = async (item: ShelfItem) => {
    setError("");
    const scope = captureDbScope();
    const stored = await getStoredBook(item.hash, scope).catch(() => undefined);
    if (!stored) {
      setError("Este libro ya no está en este dispositivo.");
      void refreshLibrary();
      return;
    }
    const open = () => {
      openBook({
        hash: stored.hash,
        name: stored.name,
        file: new File([stored.data], stored.name, { type: "application/epub+zip" }),
      });
      setMessage(`Abriendo «${stored.title ?? stored.name}»…`);
    };
    // Lectura en 0 segundos también con cuenta: el libro abre desde
    // IndexedDB y la fusión con el servidor termina por detrás. Si la
    // nube trae un avance más nuevo, se aplica sin recargar; si hay
    // conflicto, el aviso llega sobre el libro ya abierto.
    open();
    void import("./lib/positions-sync")
      .then(({ syncPositions }) => syncPositions(scope))
      .then((sync) => {
        if (!sync || openBookHashRef.current !== item.hash) return;
        const conflict = sync.conflicts.find((entry) => entry.bookHash === item.hash);
        if (conflict) {
          showPositionPrompt(conflict, () => undefined, () => {
            setResumeRequest({
              hash: item.hash,
              key: Date.now(),
              sectionIndex: conflict.merged.sectionIndex,
              ratio: conflict.merged.ratio,
              anchor: conflict.merged.anchor,
              anchorOffset: conflict.merged.anchorOffset,
            });
          });
          return;
        }
        if (sync.pulled > 0) {
          setPositionSync((prev) => ({
            hash: item.hash,
            version: (prev?.hash === item.hash ? prev.version : 0) + 1,
          }));
        }
      })
      .catch(() => null);
  };

  // Libro solo en la nube: se descarga, se guarda y se abre. La posición
  // remota baja con el mismo sync; el aviso solo aplica si el dispositivo
  // ya guardaba una posición de este libro (si no, no hay conflicto).
  const openRemoteBook = async (
    item: ShelfItem,
    openAfter = true,
  ): Promise<boolean> => {
    // Guard de seguridad: una copia comunitaria nunca abre el lector.
    // handlePaperBook la descarga con openAfter=false y va al índice.
    if (item.paperOnly && openAfter) {
      handlePaperBook(item);
      return true;
    }
    setError("");
    setDownloadingHash(item.hash);
    setMessage(`Descargando «${displayTitle(item.name, item.title)}»…`);
    try {
      const scope = captureDbScope();
      const [booksMod, coverMod, positionsSyncMod] = await Promise.all([
        import("./lib/books"),
        import("./lib/cover"),
        import("./lib/positions-sync"),
      ]);
      const { file, status } = await booksMod.downloadBookWithStatus(
        { hash: item.hash, uploaded: "", name: item.name },
        scope,
      ).catch(() => ({ file: null, status: 0 }));
      if (!file && status === 402) {
        // La nube de EPUB es de Lecta+: se ofrece adjuntar el archivo.
        setMessage("");
        setAttachFor(item);
        return false;
      }
      if (!file) {
        setMessage("");
        setError(`No se pudo descargar «${displayTitle(item.name, item.title)}». Revisa tu conexión e inténtalo de nuevo.`);
        return false;
      }
      const hadLocalPosition = Boolean(
        await loadBookPosition(item.hash, scope).catch(() => undefined),
      );
      await saveBook(
        {
          hash: item.hash,
          name: file.name,
          data: file,
          addedAt: Date.now(),
          // La copia comunitaria conserva su restricción tras bajar a
          // IndexedDB — sin el flag local se volvería legible.
          paperOnly: item.paperOnly || undefined,
        },
        scope,
      );

      const meta = await coverMod.readBookMeta(file).catch(() => null);
      const resolvedTitle = (!meta?.title || isHashLikeIdentifier(meta.title))
        ? (item.title && !isHashLikeIdentifier(item.title) ? item.title : humanizeFilename(file.name) || undefined)
        : meta.title;
      if (meta || resolvedTitle) {
        await updateBookMeta(
          item.hash,
          {
            title: resolvedTitle || meta?.title,
            author: meta?.author || item.author,
            language: meta?.language || item.language,
            sectionCount: meta?.sectionCount ?? item.sectionCount,
            cover: meta?.cover ?? undefined,
            metaVersion: 1,
          },
          scope,
        ).catch(() => null);
      }

      await refreshLibrary();

      if (openAfter) {
        const open = () => {
          openBook({ hash: item.hash, name: file.name, file });
          setMessage(`Abriendo «${meta?.title ?? item.title ?? item.name}»…`);
        };
        const sync = await positionsSyncMod.syncPositions(scope).catch(() => null);
        const conflict = hadLocalPosition
          ? sync?.conflicts.find((entry) => entry.bookHash === item.hash)
          : undefined;
        if (conflict) showPositionPrompt(conflict, open);
        else open();
      } else {
        setMessage(`«${meta?.title ?? item.title ?? item.name}» guardado en este dispositivo.`);
      }
      return true;
    } finally {
      setDownloadingHash(null);
    }
  };

  // Un libro de la estantería sin archivo cuyo hash es el de un EPUB del
  // catálogo se obtiene gratis de ahí; si no, se adjunta a mano.
  const openCatalogOrAttach = async (item: ShelfItem) => {
    try {
      const { listCatalog } = await import("./lib/catalog");
      const index = await listCatalog(captureDbScope());
      const match = index?.books.find((b) => b.epubSha256 === item.hash);
      if (match) {
        await getCatalogBook(match);
        return;
      }
    } catch {
      /* sin índice o descarga fallida: cae a adjuntar */
    }
    setAttachFor(item);
  };

  const openShelfItem = (item: ShelfItem) => {
    // Copia comunitaria «solo papel»: el toque abre el índice del modo
    // papel — jamás el lector, aunque el archivo se descargue para el
    // análisis de capítulos.
    if (item.paperOnly) {
      handlePaperBook(item);
      return;
    }
    // Libro propio sin archivo en la nube (free, 027): se adjunta aquí.
    if (item.remoteOnly && (item.hasFile === false || planStore.get()?.plan === "free")) {
      void openCatalogOrAttach(item);
      return;
    }
    if (item.remoteOnly) void openRemoteBook(item);
    else void openStoredBook(item);
  };

  // «Continuar escuchando»: abre el libro y pide al lector arrancar el audio
  // en la oración donde se dejó (landing guardado).
  const resumeAudioFromShelf = (item: ShelfItem) => {
    resumeAudioKeyRef.current += 1;
    const landing = loadTtsLandingPosition(item.hash);
    if (landing) {
      setResumeRequest({
        hash: item.hash,
        key: resumeAudioKeyRef.current,
        sectionIndex: landing.sectionIndex,
        anchor: landing.anchor,
        resumeAudio: true,
      });
    }
    openShelfItem(item);
  };

  const handleSelectBook = (
    b: BookLike,
    initialWord?: string,
  ) => {
    setReaderInitialWord(initialWord);
    startSafeViewTransition(() => {
      startTransition(() => {
        if ("file" in b && b.file) {
          openBook({ hash: b.hash ?? "", name: b.name ?? b.file.name, file: b.file });
        } else if ("hash" in b && b.hash) {
          const item = library.find((lib) => lib.hash === b.hash) ?? (b as ShelfItem);
          void openShelfItem(item);
        }
      });
    });
  };

  // Instala una entrada paper_only local: guía sanitizada en sesión +
  // StoredBook de 0 bytes con la marca — jamás abre el lector porque
  // no hay EPUB que abrir.
  const installPaperGuide = async (
    hash: string,
    guideRaw: unknown,
    scope = captureDbScope(),
  ): Promise<boolean> => {
    const guide = sanitizePaperBookGuide(guideRaw, hash);
    if (!guide) return false;
    // Defensa: si el EPUB real ya está aquí, la guía comunitaria no lo
    // reemplaza — un attach «already» sobre un libro propio borraría la
    // copia local y lo dejaría en solo-papel.
    const existing = await getStoredBook(hash, scope).catch(() => undefined);
    if (existing && existing.data.size > 0 && !existing.paperOnly) return true;
    await saveSessionValue(
      paperGuideSessionKey(hash),
      JSON.stringify(guide),
      scope,
    ).catch(() => undefined);
    await saveBook(
      {
        hash,
        name: guide.title ? `${guide.title}.epub` : `${hash}.epub`,
        title: guide.title || undefined,
        author: guide.author || undefined,
        language: guide.language || undefined,
        data: new Blob([]),
        paperOnly: true,
        addedAt: Date.now(),
      },
      scope,
    );
    return true;
  };

  // «Leo este libro en papel»: índice de capítulos con vocabulario
  // para la edición física. Libro remoto normal → se descarga (misma
  // ruta que «Descargar y abrir»). Entrada comunitaria paperOnly → se
  // instala la GUÍA (modelo A1): no hay EPUB que bajar.
  const handlePaperBook = (item: ShelfItem) => {
    const enter = () => {
      paperRelease.current ??= pushOverlay(() => {
        paperRelease.current = null;
        setPaperBook(null);
      });
      setPaperBook(item);
    };
    if (item.remoteOnly && item.paperOnly) {
      setMessage(`Preparando la guía de «${displayTitle(item.name, item.title)}»…`);
      void (async () => {
        const scope = captureDbScope();
        const { fetchBookGuide } = await import("./lib/books");
        const guideRaw = await fetchBookGuide(item.hash, scope).catch(
          () => null,
        );
        const ok = guideRaw ? await installPaperGuide(item.hash, guideRaw, scope) : false;
        setMessage("");
        if (ok) {
          await refreshLibrary();
          enter();
        } else {
          setError(`No se pudo preparar la guía de «${displayTitle(item.name, item.title)}». Revisa tu conexión e inténtalo de nuevo.`);
        }
      })();
      return;
    }
    if (item.remoteOnly) {
      void openRemoteBook(item, false).then((ok) => {
        if (ok) enter();
      });
    } else {
      enter();
    }
  };

  const closePaper = () => {
    paperRelease.current?.release();
    paperRelease.current = null;
    setPaperBook(null);
  };

  // «Series y películas» con subtítulos propios: el navegador armó la
  // guía de UN episodio/película desde el archivo del usuario (solo
  // palabras; el texto ya se descartó). Se fusiona en la PaperBookGuide
  // de la obra completa — un capítulo por episodio, «movie» para
  // películas — y se guarda en la misma clave de sesión que usa el modo
  // papel, así que usePaperReading la abre sin cambios. El StoredBook
  // es paperOnly + mediaKind, sin imdbId ni póster: nunca hay EPUB y
  // jamás se sube a la cuenta.
  const installSubtitleWork = async (
    ref: SubtitleWorkRef,
    guide: SubtitleGuide,
    cover?: Blob,
  ): Promise<ShelfItem | null> => {
    const scope = captureDbScope();
    // Import diferido: solo esta zona lo usa, sin peso en el arranque.
    const [
      { subtitleWorkHash, subtitleChapterId, subtitleChapterLabel },
      {
        mergeChapterIntoGuide,
        mergeScreenChapterPhrases,
        parseScreenPhrasesRecord,
        screenPhrasesKey,
      },
    ] = await Promise.all([
      import("./lib/subtitle-works"),
      import("./lib/screen"),
    ]);
    const hash = await subtitleWorkHash(ref);
    if (!hash) return null;
    const guideKey = paperGuideSessionKey(hash);
    const raw = await loadSessionValue(guideKey, scope).catch(() => null);
    let existing: ReturnType<typeof sanitizePaperBookGuide> = null;
    if (raw) {
      try {
        existing = sanitizePaperBookGuide(JSON.parse(raw), hash);
      } catch {
        // Sesión ilegible: se reconstruye solo con el capítulo nuevo.
      }
    }
    const chapterId = subtitleChapterId(ref);
    const merged = mergeChapterIntoGuide(
      existing,
      {
        id: chapterId,
        label: subtitleChapterLabel(ref),
        forms: guide.forms,
        capitalOnly: guide.capitalOnly,
      },
      ref.language,
      { bookHash: hash, title: ref.title, author: existing?.author },
    );
    if (!merged) return null;
    await saveSessionValue(guideKey, JSON.stringify(merged), scope).catch(
      () => undefined,
    );
    const previous = await getStoredBook(hash, scope).catch(() => undefined);
    const stored = await saveBook(
      {
        hash,
        name: ref.title || previous?.title || hash,
        title: ref.title || previous?.title || undefined,
        author: ref.type === "tv" ? "Serie" : "Película",
        language: ref.language,
        // La imagen que eligió el usuario; si no manda otra, se conserva
        // la anterior. Sin ninguna, la tarjeta pinta la portada tipográfica.
        cover: cover ?? previous?.cover,
        data: new Blob([]),
        paperOnly: true,
        mediaKind: ref.type,
        addedAt: previous?.addedAt ?? Date.now(),
      },
      scope,
    ).catch(() => undefined);
    if (!stored) return null;
    // Las frases del episodio (claves del banco, nunca texto) se
    // acumulan por capítulo en `screenPhrases:v1:<hash>` para que la
    // hoja las muestre antes que las palabras.
    if (guide.phrases.length) {
      const phrasesKey = screenPhrasesKey(hash);
      const rawPhrases = await loadSessionValue(phrasesKey, scope).catch(
        () => null,
      );
      const record = rawPhrases ? parseScreenPhrasesRecord(rawPhrases) : {};
      await saveSessionValue(
        phrasesKey,
        JSON.stringify(
          mergeScreenChapterPhrases(record, chapterId, guide.phrases),
        ),
        scope,
      ).catch(() => undefined);
    }
    await refreshLibrary();
    return {
      hash: stored.hash,
      name: stored.name,
      addedAt: stored.addedAt,
      title: stored.title,
      author: stored.author,
      cover: stored.cover,
      sectionCount: stored.sectionCount,
      language: stored.language,
      mediaKind: stored.mediaKind,
      paperOnly: true,
    };
  };

  // SubtitleShelf ya armó la guía desde el archivo del usuario; aquí
  // solo se instala y se abre el índice de la obra (episodio/película
  // recién preparada).
  const handlePrepareScreenWork = async (args: {
    ref: SubtitleWorkRef;
    guide: SubtitleGuide;
    cover?: Blob;
  }): Promise<boolean> => {
    const item = await installSubtitleWork(args.ref, args.guide, args.cover).catch(
      () => null,
    );
    if (!item) return false;
    handlePaperBook(item);
    return true;
  };

  // Borrar una obra de pantalla es solo local: la guía vive en la
  // sesión de este dispositivo y el servidor nunca conoció la obra —
  // nada que encolar. deleteStoredBook ya limpia las claves
  // paperGuide:v1: y los análisis del libro.
  const removeScreenWork = async (hash: string) => {
    const scope = captureDbScope();
    setLibrary((prev) => prev.filter((item) => item.hash !== hash));
    await deleteStoredBook(hash, scope).catch(() => undefined);
    void refreshLibrary();
  };

  // Zona OMDb/SubDL apagada (docs/designs/2026-11-15-explora-derechos.md,
  // M0/M2): las obras que vinieron de ahí (llevan imdbId) se borran del
  // dispositivo con sus guías derivadas de subtítulos de terceros. Las
  // obras armadas con los subtítulos del propio usuario (sin imdbId) se
  // conservan. Corre en cada base local en cuanto su biblioteca carga.
  useEffect(() => {
    if (SCREEN_ZONE_ENABLED) return;
    const legacy = screenWorks.filter((work) => work.imdbId);
    if (legacy.length === 0) return;
    const scope = captureDbScope();
    void Promise.all(
      legacy.map((work) => deleteStoredBook(work.hash, scope).catch(() => undefined)),
    ).then(() => refreshLibrary());
  }, [screenWorks, refreshLibrary]);

  // Compartir (o retirar) la guía de papel de un libro propio. La usa
  // la hoja de opciones de la estantería y el botón «Compartir un libro
  // tuyo» de la pestaña Comunidad — una sola ruta para ambos.
  const handleShareBook = async (
    item: ShelfItem,
    shared: boolean,
    genre?: string,
  ) => {
    const scope = captureDbScope();
    let guide: unknown;
    if (shared) {
      // Modelo A1: se comparte la GUÍA de papel (índice +
      // formas), generada aquí mismo desde el EPUB local —
      // el archivo jamás sale de esta cuenta. El import es
      // diferido para que foliate no entre al arranque.
      setMessage(`Preparando la guía de «${displayTitle(item.name, item.title)}»…`);
      const stored = await getStoredBook(item.hash, scope).catch(() => undefined);
      if (stored?.data?.size) {
        const { buildPaperBookGuide } = await import("./lib/paper-guide");
        guide = await buildPaperBookGuide(item.hash, stored.data, {
          title: stored.title ?? item.title,
          author: stored.author ?? item.author,
          language: stored.language ?? item.language,
        }).catch(() => null);
      }
      setMessage("");
      if (!guide) {
        setError(
          stored?.data?.size
            ? "No se pudo preparar la guía de este libro. Intenta de nuevo."
            : "Para compartir su guía, el libro tiene que estar descargado en este dispositivo.",
        );
        return;
      }
    }
    const { shareBook } = await import("./lib/books");
    const ok = await shareBook(item.hash, shared, scope, guide, genre);
    if (ok) {
      await refreshLibrary();
    } else {
      setError("No se pudo actualizar el estado compartido. Revisa tu conexión.");
    }
  };

  // «Repasar palabras de este libro»: el Cuaderno abre ya filtrado por
  // la obra; el nonce marca cada petición para no reanclar el filtro
  // cuando el usuario lo cambia a mano.
  const openNotebookFromPaper = (bookHash: string) => {
    setVocabFilterRequest({ bookHash, nonce: Date.now() });
    closePaper();
    navigateTo("vocabulary");
  };

  const handleOpenCalibration = () => {
    void requestCalibration();
  };

  // El aviso de conflicto es una capa del historial como las demás:
  // «atrás» lo cierra sin abrir el libro. Si elige abrir, su entrada
  // pasa a ser la del libro (swap, como la calibración): así release()
  // no dispara un history.back() que se tragaría la entrada nueva.
  const onPositionPromptBack = () => {
    positionRelease.current = null;
    setPositionPrompt(null);
  };

  const showPositionPrompt = (
    conflict: PositionConflict,
    open: () => void,
    resume?: () => void,
  ) => {
    positionRelease.current ??= pushOverlay(onPositionPromptBack);
    setPositionPrompt({ conflict, open, resume });
  };

  // El aviso se puede cerrar sin abrir (Escape o clic fuera): la
  // posición remota ya quedó fusionada, así que la próxima vez que se
  // abra el libro continuará desde ahí sin volver a preguntar.
  const dismissPositionPrompt = () => {
    positionRelease.current?.release();
    positionRelease.current = null;
    setPositionPrompt(null);
  };

  const openFromPrompt = (prompt: { open: () => void }) => {
    const release = positionRelease.current;
    positionRelease.current = null;
    setPositionPrompt(null);
    if (release) {
      bookRelease.current = release;
      release.swap(() => {
        bookRelease.current = null;
        openBookHashRef.current = null;
        setBook(null);
      });
    }
    prompt.open();
  };

  const continueFromRemote = () => {
    const prompt = positionPrompt;
    if (!prompt) return;
    if (prompt.resume) {
      // El libro ya está abierto: cerrar el aviso y saltar a la posición
      // fusionada sin pasar por openBook (no hay remontaje ni pérdida
      // de la sección que se estaba leyendo).
      positionRelease.current?.release();
      positionRelease.current = null;
      setPositionPrompt(null);
      prompt.resume();
      return;
    }
    openFromPrompt(prompt);
  };

  const keepLocalPosition = async () => {
    const prompt = positionPrompt;
    if (!prompt) return;
    // La posición local vuelve a ganar con sello nuevo: en el próximo
    // empuje también la restaura en los demás dispositivos.
    await saveBookPosition(
      { ...prompt.conflict.previous, updatedAt: Date.now() },
      captureDbScope(),
    ).catch(() => undefined);
    // Mientras se guardaba pudo llegar «atrás»: si el aviso ya se fue,
    // el libro abre con entrada propia y no se recupera la del aviso.
    openFromPrompt(prompt);
  };

  const removeBook = async (hash: string) => {
    const scope = captureDbScope();
    // Optimista: la tarjeta sale de la vista ya — el refresco de abajo no
    // la regresa porque la op de borrado encolada la filtra de la nube.
    setLibrary((prev) => prev.filter((item) => item.hash !== hash));
    await deleteStoredBook(hash, scope).catch(() => undefined);
    // El borrado remoto también pasa por la cola: un 404 o un corte de
    // red no pierden la operación, se reintenta al volver la conexión.
    if (sessionUserId) {
      // El encolado se espera antes de refrescar: así la op ya está en
      // bookOps cuando refreshLibrary la lee y el libro no reaparece
      // como «En la nube» mientras el DELETE corre en segundo plano.
      const { queueBookDelete, runBookQueue } = await import("./lib/book-queue");
      await queueBookDelete(hash, scope).catch(() => undefined);
      void runBookQueue(scope);
    }
    if (book?.hash === hash) {
      closeReader();
      setMessage("Libro eliminado. Elige otro para seguir leyendo.");
    }
    void refreshLibrary();
  };

  // Guardarraíl de renderizado: aunque el efecto de sesión aún no haya
  // corrido, un libro de otra cuenta no se monta. El libro anónimo sí
  // sobrevive a la migración null -> userId.
  const currentOwnerUserId = sessionUserId ?? null;
  const canRenderCurrentBook =
    book !== null &&
    (book.ownerUserId === currentOwnerUserId || book.ownerUserId === null);

  // El libro a medio leer que alimenta la píldora «Lectura en curso»
  // (móvil) y el ítem «Continuar» del riel lateral (escritorio).
  const miniReaderBook =
    lastReadBook &&
    (lastReadBook.ownerUserId === currentOwnerUserId ||
      lastReadBook.ownerUserId === null) &&
    !book &&
    activeNav !== "shelf"
      ? lastReadBook
      : null;

  const resumeMiniReader = () => {
    if (!miniReaderBook) return;
    if (miniReaderBook.file) {
      openBook({
        hash: miniReaderBook.hash,
        name: miniReaderBook.name,
        file: miniReaderBook.file,
      });
    } else {
      const item = library.find((b) => b.hash === miniReaderBook.hash);
      if (item) void openShelfItem(item);
    }
  };

  // Cuenta obligatoria (docs/designs/2026-11-12-planes-y-landing.md).
  // Tabla de decisión, gana la primera fila:
  //   enlace de restablecer (?token=) sin sesión → Welcome en modo reset;
  //   sesión → la app; sesión resolviendo → la app (carga, como hoy);
  //   error de red/servidor → la base local si hay lastUserId, si no Welcome;
  //   sin sesión en línea → Welcome (el efecto de sesión borra lastUserId);
  //   sin sesión y sin red → la base local si hay lastUserId, si no Welcome
  //   con el aviso de conexión única.
  // Excepción: «Probar con un clásico» (lib/trial.ts) muestra solo el
  // lector mientras dura la prueba; nunca la estantería ni el resto.
  const sessionInconclusive =
    Boolean(sessionError) && sessionError?.status !== 401 && !sessionUserId;
  // Enlace directo (?abrir=, correo de regreso): con sesión y el libro ya en
  // la estantería se abre una sola vez, por el mismo camino que un toque
  // (local, remoto, catálogo o adjuntar). Si no está, queda la estantería.
  // Va en un setTimeout: abrir cambia estado y no debe correr dentro del efecto.
  const deepLinkDone = useRef(false);
  const openDeepLink = useEffectEvent((item: ShelfItem) => {
    if (deepLinkDone.current) return;
    deepLinkDone.current = true;
    openShelfItem(item);
  });
  useEffect(() => {
    if (!sessionUserId || checkingLibrary) return;
    const item = findDeepLinkItem(library, authLink.openHash);
    if (!item) return;
    const timer = setTimeout(() => openDeepLink(item), 0);
    return () => clearTimeout(timer);
  }, [library, sessionUserId, checkingLibrary, authLink.openHash]);

  // Continuidad ?probar=<id> → cuenta creada: si el lector cerró una prueba
  // para registrarse, vuelve directo al libro que estaba leyendo (migrado en
  // `library` o desde el catálogo) en vez de quedar detenido en la estantería.
  const trialResumeDone = useRef(false);
  const resumePendingTrialBook = useEffectEvent(async (resumeId: string) => {
    try {
      const { listCatalog } = await import("./lib/catalog");
      const index = await listCatalog(captureDbScope()).catch(() => null);
      setTrial(null);
      const found = index?.books.find((b) => b.id === resumeId);
      const localMatch = library.find((item) => {
        if (item.remoteOnly) return false;
        if (found?.epubSha256 && item.hash === found.epubSha256) return true;
        if (found?.title && item.title) {
          return item.title.trim().toLowerCase() === found.title.trim().toLowerCase();
        }
        return false;
      });
      if (localMatch) {
        await openStoredBook(localMatch);
        return;
      }
      if (found) {
        await getCatalogBook(found);
        return;
      }
      const parsed = parseTrialBook(resumeId);
      if (parsed) {
        await getCatalogBook({ ...parsed, language: "es" });
      }
    } catch {
      // Sin red o error puntual: el usuario queda en la estantería sin bloqueo
    }
  });
  useEffect(() => {
    if (!sessionUserId || !sessionDbReady || checkingLibrary || book) return;
    if (authLink.trial) {
      try {
        sessionStorage.removeItem(RESUME_TRIAL_BOOK_KEY);
      } catch {
        // Ignore
      }
      return;
    }
    if (authLink.openHash || trialResumeDone.current) return;
    let resumeId: string | null;
    try {
      resumeId = sessionStorage.getItem(RESUME_TRIAL_BOOK_KEY);
    } catch {
      resumeId = null;
    }
    if (!resumeId) return;
    const timer = setTimeout(() => {
      if (trialResumeDone.current) return;
      trialResumeDone.current = true;
      try {
        sessionStorage.removeItem(RESUME_TRIAL_BOOK_KEY);
      } catch {
        // Ignore
      }
      void resumePendingTrialBook(resumeId);
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionUserId, sessionDbReady, checkingLibrary, book, authLink.openHash, authLink.trial]);

  const trialOpen = !sessionUserId && (trial === "loading" || trial === "reading");
  const showWelcome =
    !trialOpen &&
    !sessionUserId &&
    (Boolean(authLink.token) ||
      (!sessionPending &&
        (sessionInconclusive || !online ? !optimisticUserId : true)));

  if (trialOpen && !book) {
    return <LoadingScreen label={`Abriendo «${trialBook?.title ?? ""}»…`} />;
  }

  if (showWelcome) {
    const trialNotice =
      trial === "ended" && trialBook && !error
        ? `Crea tu cuenta gratis para seguir leyendo «${trialTitle ?? trialBook.title}» donde te quedaste. Lo que guardaste en esta prueba pasa a tu cuenta.`
        : undefined;
    return (
      <>
        <Suspense fallback={<LoadingScreen label="Abriendo Lecta…" />}>
          <Welcome
            resetToken={resetToken}
            onResetDone={() => setResetToken(undefined)}
            offline={!online}
            notice={trialNotice || error || message || undefined}
            onShowLegal={setShowLegal}
          />
        </Suspense>
        {showLegal ? (
          <Suspense fallback={null}>
            <LegalNotice initialTab={showLegal} onClose={() => setShowLegal(null)} />
          </Suspense>
        ) : null}
      </>
    );
  }

  return (
    // El compañero vive una sola vez aquí, sobre todo el contenido:
    // la hoja compartida puede abrirse desde el Cuaderno hoy y desde
    // Estantería o Lector después sin duplicar instancias ni estado.
    <CompanionProvider userId={dbUserId}>
    <div className="app" data-nav={activeNav}>
      {book && canRenderCurrentBook ? (
        <>
          <Suspense fallback={<LoadingScreen label="Abriendo el libro…" />}>
            <Reader
              key={`${sessionUserId ?? "anon"}:${book.hash}`}
              bookHash={book.hash}
              file={book.file}
              fileName={book.name}
              onError={setError}
              onStatus={setMessage}
              onBack={closeReader}
              positionFlushRef={positionFlushRef}
              onOpenNotebook={openNotebookOverlay}
              statusText={message}
              errorText={error}
              panelsOpen={showVocabulary || showAccount || showCarneOverlay}
              theme={theme}
              onThemeChange={changeTheme}
              vocabVersion={vocabVersion}
              onRequestCalibration={requestCalibration}
              signedIn={Boolean(sessionUserId)}
              readerInitialWord={readerInitialWord}
              positionSyncVersion={
                positionSync?.hash === book.hash ? positionSync.version : 0
              }
              resumeRequest={
                resumeRequest?.hash === book.hash ? resumeRequest : null
              }
            />
          </Suspense>

          {showVocabulary ? (
            <Suspense fallback={<LoadingScreen label="Abriendo tu cuaderno…" />}>
              <Vocabulary
                key={sessionUserId ?? "anon"}
                presentation="overlay"
                backLabel="‹ Volver al libro"
                onClose={closeNotebookOverlay}
                books={library}
                activityVersion={activityVersion}
                vocabVersion={vocabVersion}
                onVocabChange={() => setVocabVersion((v) => v + 1)}
                onOpenJourney={() => openJourneyFrom("vocab")}
              />
            </Suspense>
          ) : null}

          {showCarneOverlay ? (
            <Suspense fallback={null}>
              <CarneSheet plan={userPlan} onClose={() => setShowCarneOverlay(false)} />
            </Suspense>
          ) : null}
        </>
      ) : (
        <>
          <header className="app-header">
            <span className="brand">Lecta</span>
          </header>
          <ViewTransition name="app-main">
            <main className="app-main">
              {dbStorageError ? (
                <section className="db-error-panel" role="alert">
                  <div className="db-error-card">
                    <h2 className="db-error-title">Problema con el almacenamiento local</h2>
                    <p className="db-error-message">{dbStorageError.message}</p>
                    <div className="db-error-actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => {
                          resetDbConnection();
                          setDbStorageError(null);
                          setCheckingLibrary(true);
                          void setDbUser(sessionUserId ?? null)
                            .then(() => refreshLibrary())
                            .catch((err) => {
                              setCheckingLibrary(false);
                              setDbStorageError(classifyDbError(err));
                            });
                        }}
                      >
                        Reintentar conexión
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          void import("./lib/export")
                            .then(({ downloadBackup }) => downloadBackup())
                            .catch(() => {
                              setError("No se pudo preparar el respaldo de emergencia.");
                            });
                        }}
                      >
                        Exportar respaldo de emergencia
                      </button>
                      <Suspense fallback={null}>
                        <RestoreBackupDialog
                          onRestored={async () => {
                            setDbStorageError(null);
                            setMessage("Respaldo restaurado correctamente.");
                            await refreshLibrary();
                          }}
                          trigger={(openPicker) => (
                            <button
                              type="button"
                              className="btn"
                              onClick={openPicker}
                            >
                              Restaurar respaldo
                            </button>
                          )}
                        />
                      </Suspense>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => setShowDiagnostics(true)}
                      >
                        Diagnóstico y detalles
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                <Activity mode={activeNav === "shelf" ? "visible" : "hidden"}>
                  <Shelf
                    library={shelfBooks}
                    books={shelfBooks}
                    checking={checkingLibrary}
                    activeRead={lastReadBook}
                    vocabCount={library.length}
                    dueReviewsCount={dueReviewsCount}
                    hasCalibrated={calibrationDone || Boolean(calibrationWords)}
                    onOpen={openShelfItem}
                    onResumeAudio={resumeAudioFromShelf}
                    onSelect={handleSelectBook}
                    onPaperBook={handlePaperBook}
                    onShareBook={handleShareBook}
                    communitySection={
                      sessionUserId ? (
                        <Suspense fallback={null}>
                          <CommunityShelf
                            ownedHashes={ownedBookHashes}
                            shareableBooks={library.filter(
                              (book) => !book.paperOnly && !book.remoteOnly,
                            )}
                            onShareBook={(book, genre) =>
                              handleShareBook(book, true, genre)
                            }
                            onAttached={(hash, guide) => {
                              setMessage("Guía agregada — abre el índice desde tu estantería.");
                              void (async () => {
                                if (guide) await installPaperGuide(hash, guide);
                                await refreshLibrary();
                              })();
                            }}
                          />
                        </Suspense>
                      ) : undefined
                    }
                    screenSection={
                      sessionUserId ? (
                        <Suspense fallback={null}>
                          <SubtitleShelf
                            works={screenWorks}
                            onOpenWork={handlePaperBook}
                            onRemoveWork={(hash) => void removeScreenWork(hash)}
                            onPrepareWork={handlePrepareScreenWork}
                          />
                        </Suspense>
                      ) : undefined
                    }
                    screenCount={sessionUserId ? screenWorks.length : undefined}
                    onStartCalibration={handleOpenCalibration}
                    onRemove={removeBook}
                    onAdd={(file) => void selectBook(file)}
                    onLibraryChange={() => void refreshLibrary()}
                    onBooksChange={() => void refreshLibrary()}
                    onGetCatalogBook={getCatalogBook}
                    onDownloadBook={(item) => void openRemoteBook(item, false)}
                    downloadingHash={downloadingHash}
                    activityVersion={activityVersion}
                    dbUserId={dbUserId}
                    vocabVersion={vocabVersion}
                    onOpenVocab={openNotebookOverlay}
                    onOpenPractice={() => navigateTo("vocabulary")}
                    onOpenAccount={() => navigateTo("account")}
                    onOpenJourney={() => openJourneyFrom("shelf")}
                    onRequestCalibration={() => void requestCalibration()}
                    user={session?.user ?? null}
                    syncing={false}
                  />
                  {activeNav === "shelf" &&
                  shouldShowTrialEnd({
                    trialEndedAt: userPlan?.trialEndedAt,
                    bookOpen: book !== null,
                    deepLinkPending: authLink.openHash !== null,
                  }) ? (
                    <Suspense fallback={null}>
                      <TrialEndSheet
                        endedAt={userPlan?.trialEndedAt}
                        welcomeOfferEndsAt={userPlan?.welcomeOfferEndsAt}
                      />
                    </Suspense>
                  ) : null}
                </Activity>
              )}

              {hasVisitedVocab || activeNav === "vocabulary" || showVocabulary ? (
                <Activity mode={activeNav === "vocabulary" ? "visible" : "hidden"}>
                  <Suspense fallback={<LoadingScreen label="Abriendo tu cuaderno…" />}>
                    <Vocabulary
                      key={`${sessionUserId ?? "anon"}:${vocabFilterRequest?.nonce ?? 0}`}
                      presentation="page"
                      onClose={() => navigateTo("shelf")}
                      books={library}
                      activityVersion={activityVersion}
                      vocabVersion={vocabVersion}
                      onVocabChange={() => setVocabVersion((v) => v + 1)}
                      onOpenJourney={() => openJourneyFrom("vocab")}
                      initialBookFilter={vocabFilterRequest?.bookHash}
                    />
                  </Suspense>
                </Activity>
              ) : null}

              {showAccount ? (
                <Suspense fallback={null}>
                  <Account
                    key={sessionUserId ?? "anon"}
                    presentation="page"
                    theme={theme}
                    vocabVersion={vocabVersion}
                    onThemeChange={changeTheme}
                    onClose={() => navigateTo("shelf")}
                    onOpenJourney={() => openJourneyFrom("account")}
                    resetToken={resetToken}
                    onResetDone={() => setResetToken(undefined)}
                    onOpenCalibration={(words, lang = "es") => {
                      showCalibration(words, null, lang);
                    }}
                    onRestored={refreshLibrary}
                    carneNotice={
                      authLink.carne === "gracias" || authLink.carne === "cancelado"
                        ? authLink.carne
                        : undefined
                    }
                  />
                </Suspense>
              ) : null}
            </main>
          </ViewTransition>

          {paperBook ? (
            <Suspense fallback={<LoadingScreen label="Abriendo el libro…" />}>
              <PaperReading
                book={paperBook}
                onClose={closePaper}
                onOpenNotebook={openNotebookFromPaper}
              />
            </Suspense>
          ) : null}

          {miniReaderBook ? (
            <aside className="mini-reader-bar" aria-label="Lectura en curso">
              <div className="mini-reader-cover">
                <BookCover
                  book={{
                    hash: miniReaderBook.hash,
                    name: miniReaderBook.name,
                    title: miniReaderBook.title,
                    author: miniReaderBook.author,
                    cover: miniReaderBook.cover,
                  }}
                  progress={miniReaderBook.progress}
                />
              </div>
              <div className="mini-reader-info">
                <strong className="mini-reader-title visually-hidden">
                  {miniReaderBook.title || miniReaderBook.name}
                </strong>
                <span className="mini-reader-progress">
                  {Math.round((miniReaderBook.progress ?? 0) * 100)}% leído
                </span>
              </div>
              <button
                type="button"
                className="btn btn--primary mini-reader-resume"
                aria-label={`Continuar leyendo ${miniReaderBook.title || miniReaderBook.name}`}
                onClick={resumeMiniReader}
              >
                Continuar
              </button>
            </aside>
          ) : null}
          <AppNav
            active={activeNav}
            onNavigate={navigateTo}
            dueCount={dueReviewsCount}
            hasJourneyAlert={hasJourneyAlert}
            hasAccount={Boolean(sessionUserId)}
            resume={
              miniReaderBook ? (
                <button
                  type="button"
                  className="app-nav-item mini-reader-rail"
                  aria-label={`Continuar leyendo ${miniReaderBook.title || miniReaderBook.name}`}
                  title={`Continuar leyendo · ${Math.round((miniReaderBook.progress ?? 0) * 100)}% leído`}
                  onClick={resumeMiniReader}
                >
                  <span className="mini-reader-rail-cover" aria-hidden="true">
                    <BookCover
                      book={{
                        hash: miniReaderBook.hash,
                        name: miniReaderBook.name,
                        title: miniReaderBook.title,
                        author: miniReaderBook.author,
                        cover: miniReaderBook.cover,
                      }}
                      progress={miniReaderBook.progress}
                    />
                  </span>
                  <span className="app-nav-label">Continuar</span>
                </button>
              ) : null
            }
          />
        </>
      )}

      <Notice
        // Con el lector abierto el aviso de estado ya se pinta dentro del
        // lector: duplicarlo aquí lo anuncia dos veces a lectores de pantalla
        // y lo deja detrás del dock. Fuera del lector, esta es la única capa.
        message={book ? null : localOnlyNotice || message}
        error={error}
        onDismissMessage={() => {
          if (localOnlyNotice) {
            markLocalOnlyNoticeSeen();
            setLocalOnlyNotice("");
          }
          setMessage("");
        }}
        onDismissError={() => setError("")}
      />

      {showJourney ? (
        <Suspense fallback={<LoadingScreen label="Abriendo tu recorrido…" />}>
          <Journey
            key={sessionUserId ?? "anon"}
            onClose={closeJourney}
            books={library}
          />
        </Suspense>
      ) : null}
      {calibrationWords ? (
        <Suspense fallback={null}>
          <Calibration
            key={sessionUserId ?? "anon"}
            words={calibrationWords}
            language={calibrationLang}
            hasPendingBook={calibrationHasPending}
            onComplete={({ history }) => {
              // El examen terminó: sus respuestas quedan como
              // evidencia `calibration` (cobertura, Cuenta, sync).
              const scope = calibrationScope.current ?? captureDbScope();
              void (async () => {
                const { catHistoryToCalibration, recordCalibration } = await import(
                  "./lib/calibration"
                );
                const { words: answered, answers } =
                  catHistoryToCalibration(history);
                await recordCalibration(answered, answers, calibrationLang, scope).catch(
                  () => null,
                );
                setVocabVersion((v) => v + 1);
              })();
            }}
            onDone={() => closeCalibration(true)}
            onClose={() => closeCalibration(false)}
          />
        </Suspense>
      ) : null}
      {positionPrompt ? (
        <Dialog label="Otro dispositivo avanzó más" onClose={dismissPositionPrompt}>
          <div className="sheet-head">
            <strong className="sheet-title">Otro dispositivo avanzó más</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={dismissPositionPrompt}
              aria-label="Cerrar aviso"
            >
              Cerrar
            </button>
          </div>
          <p>
            En este libro llegaste al{" "}
            {positionPrompt.conflict.merged.progress !== undefined
              ? `${Math.round(positionPrompt.conflict.merged.progress * 100)}%`
              : `capítulo ${positionPrompt.conflict.merged.sectionIndex + 1}`}{" "}
            desde otro dispositivo. ¿Continuar desde ahí o quedarte donde estabas aquí?
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              data-autofocus
              onClick={continueFromRemote}
            >
              Continuar desde ahí
            </button>
            <button type="button" className="btn" onClick={() => void keepLocalPosition()}>
              Quedarme donde estaba
            </button>
          </div>
        </Dialog>
      ) : null}

      {showDiagnostics ? (
        <Suspense fallback={null}>
          <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />
        </Suspense>
      ) : null}

      {showLegal ? (
        <Suspense fallback={null}>
          <LegalNotice
            initialTab={showLegal}
            onClose={() => setShowLegal(null)}
          />
        </Suspense>
      ) : null}
      {attachFor ? (
        <Suspense fallback={null}>
          <AttachBookSheet
            item={attachFor}
            onClose={() => setAttachFor(null)}
            onAttached={async (item) => {
              setAttachFor(null);
              await refreshLibrary();
              await openStoredBook(item);
            }}
            onOpenCarne={() => {
              setAttachFor(null);
              setShowAccount(true);
            }}
          />
        </Suspense>
      ) : null}
    </div>
    </CompanionProvider>
  );
}
