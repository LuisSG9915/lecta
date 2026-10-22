import {
  Activity,
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";
// El Lector y el Cuaderno se cargan diferidos para no inflar la descarga inicial de la estantería.
const Reader = lazy(() => import("./components/Reader"));
const Vocabulary = lazy(() => import("./components/Vocabulary"));
const Journey = lazy(() => import("./components/Journey"));
const Account = lazy(() => import("./components/Account"));
const Calibration = lazy(() => import("./components/Calibration"));
const RestoreBackupDialog = lazy(() => import("./components/RestoreBackupDialog"));
import { CompanionProvider } from "./components/CompanionProvider";
import Shelf, { type ShelfItem, type BookLike } from "./components/Shelf";
import BookCover from "./components/BookCover";
import Dialog from "./components/Dialog";
import AppNav, { type NavDestination } from "./components/AppNav";
import Notice from "./components/Notice";
import { startSafeViewTransition } from "./lib/view-transition";
import {
  applyTheme,
  loadNativeLanguage,
  loadTheme,
  readerProfileFor,
  saveTheme,
  type ThemeChoice,
} from "./lib/settings";
import { decidePendingDelete, PENDING_DELETE_KEY, clearSyncCursors } from "./lib/account-cleanup";
import { pushOverlay, type OverlayHandle } from "./lib/history";
import { sha256Hex } from "./lib/hash";
import { downloadCatalogEpub, type CatalogBook } from "./lib/catalog";
import { isDue } from "./lib/fsrs";
import {
  COMPANION_LETTERS_KEY,
  parseCompanionLetters,
} from "./lib/companion-inbox";
import {
  CALIBRATION_DONE_KEY,
  calibrationDoneKey,
  fetchCalibrationSample,
  type CalibrationWord,
} from "./lib/calibration";
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
  recordCollectionSyncError,
  recordCollectionSyncSuccess,
  setPendingChangesCount,
  setCollectionPendingCount,
} from "./lib/sync-state";
import DiagnosticsModal from "./components/DiagnosticsModal";
import LegalNotice from "./components/LegalNotice";
import { resetGameCache } from "./lib/game";
import {
  clearLastUserId,
  loadLastUserId,
  saveLastUserId,
} from "./lib/last-user";
import { displayTitle, readBookMeta } from "./lib/cover";
import { downloadBook, listRemoteBooks } from "./lib/books";
import { queueBookDelete, queueBookUpload, runBookQueue } from "./lib/book-queue";
import { getPendingPositionsCount, syncPositions, type PositionConflict } from "./lib/positions-sync";
import { checkEpubHeader, EPUB_MAX_BYTES } from "../shared/epub-check";
import { extractEpubMeta } from "../shared/epub-meta";
import { syncSavedWords } from "./lib/vocab";
import {
  syncActivity,
  syncAnnotations,
  syncKnowledge,
  syncReviews,
  pullMissingUserBooksFromCloud,
  syncUserBookUpload,
} from "./lib/reading-sync";
import { syncCompanion } from "./lib/companion-sync";
import { authClient } from "./lib/auth";

type BookSelection = {
  hash: string;
  name: string;
  file: File;
};

export default function App() {
  // Enlace de restablecer contraseña (o error de enlace) leído una vez
  // al montar; la URL queda limpia desde el inicio.
  const [authLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? undefined;
    const urlError = params.get("error") ?? undefined;
    const deleted = params.get("cuenta") === "eliminada";
    if (token || urlError || deleted) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return { token, urlError, deleted };
  });
  const [book, setBook] = useState<BookSelection | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    authLink.urlError ? "El enlace ya venció o fue usado. Pide uno nuevo." : "",
  );
  const [checkingLibrary, setCheckingLibrary] = useState(true);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showJourney, setShowJourney] = useState(false);
  const [showAccount, setShowAccount] = useState(
    Boolean(authLink.token || authLink.urlError || authLink.deleted),
  );
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
  } | null>(null);
  const [resetToken, setResetToken] = useState<string | undefined>(authLink.token);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  // Calibración inicial de vocabulario: se interpone una vez antes del
  // primer libro; desde Cuenta se reabre sin libro pendiente.
  const [calibrationWords, setCalibrationWords] = useState<CalibrationWord[] | null>(null);
  const [calibrationLang, setCalibrationLang] = useState("es");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [readerInitialWord, setReaderInitialWord] = useState<string | undefined>(undefined);
  const bookRelease = useRef<OverlayHandle | null>(null);
  const panelRelease = useRef<OverlayHandle | null>(null);
  const calibrationRelease = useRef<OverlayHandle | null>(null);
  const positionRelease = useRef<OverlayHandle | null>(null);
  // El libro que esperaba entrar cuando se ofreció la calibración.
  // Ref y no estado: el cierre puede venir de «atrás» (popstate) con
  // un callback viejo, y la ref siempre tiene el pendiente actual.
  const calibrationPending = useRef<BookSelection | null>(null);
  // La base donde vive la hoja abierta: la marca «calibrationDone» al
  // cerrar cae con la evidencia de la misma cuenta aunque la sesión
  // haya cambiado mientras la prueba estaba abierta.
  const calibrationScope = useRef<DbScope | null>(null);
  const { data: session, isPending: sessionPending, error: sessionError } =
    authClient.useSession();
  const sessionUserId = session?.user?.id;
  // Arranque optimista: la última cuenta confirmada abre su base
  // local sin esperar a que resuelva la sesión. Si la sesión llega
  // con otra identidad (o sin sesión), el efecto principal hace la
  // transición con las mismas protecciones de scope de siempre.
  const [optimisticUserId] = useState(() => loadLastUserId());
  // La cuenta cuya base local ya quedó activa (se fija tras setDbUser,
  // nunca antes): el compañero solo ve datos de la base vigente — un
  // cambio de cuenta lo limpia y recarga con el contexto nuevo.
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [dbStorageError, setDbStorageError] = useState<DbStorageError | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showLegal, setShowLegal] = useState<"privacy" | "terms" | null>(null);

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

  const [lastReadBook, setLastReadBook] = useState<{
    hash: string;
    name: string;
    file?: File;
    title?: string;
    author?: string;
    cover?: Blob;
    progress?: number;
  } | null>(null);

  const openBook = (
    selection: BookSelection,
    meta?: { title?: string; author?: string; cover?: Blob },
  ) => {
    startSafeViewTransition(() => {
      setShowVocabulary(false);
      setShowAccount(false);
      setShowJourney(false);
      if (!bookRelease.current) {
        bookRelease.current = pushOverlay(() => {
          bookRelease.current = null;
          startSafeViewTransition(() => {
            setBook(null);
          });
        });
      }
      setBook(selection);
    });
    const libItem = library.find((item) => item.hash === selection.hash);
    setLastReadBook({
      hash: selection.hash,
      name: selection.name,
      file: selection.file,
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
          setBook(null);
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
    setCalibrationWords(words);
  };

  // Abre la prueba de vocabulario desde el aviso del lector (al
  // terminar el primer capítulo leído) o desde Cuenta. La muestra se
  // descarga solo aquí, cuando la persona la pide: un fallo de red
  // avisa y no marca ni bloquea nada. Devuelve si la hoja quedó
  // abierta — el aviso se mantiene para reintentar cuando no.
  const requestCalibration = async (language = "es"): Promise<boolean> => {
    if (calibrationWords) return true;
    const profile = readerProfileFor(loadNativeLanguage(), language);
    const sample = await fetchCalibrationSample(language, profile);
    let fallbackWords: CalibrationWord[] = [];
    if (!sample.ok || !sample.words?.length) {
      const { getCalibrationBankByLang } = await import("../shared/calibration-bank");
      fallbackWords = getCalibrationBankByLang(language).map((item) => ({
        lemma: item.word,
        definition: null,
        sampleContext: item.posHint,
      }));
    }
    const words: CalibrationWord[] =
      sample.ok && sample.words?.length ? sample.words : fallbackWords;
    if (!words.length) {
      setError("No se pudo cargar la lista de palabras. Intenta de nuevo con conexión.");
      return false;
    }
    showCalibration(words, null, language);
    return true;
  };

  const closeReader = () => {
    setReaderInitialWord(undefined);
    startSafeViewTransition(() => {
      panelRelease.current?.release();
      panelRelease.current = null;
      setShowVocabulary(false);
      setShowAccount(false);
      setShowJourney(false);
      releaseBook();
      setBook(null);
    });
    // La posición final de la sesión de lectura sale aquí hacia la
    // cuenta, para que los demás dispositivos continúen donde quedó.
    void syncPositions().catch(() => null);
  };

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
        if (isDue(w.card)) count++;
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
      });
    }).catch((err) => {
      if (!cancelled && isDbScopeActive(scope)) {
        setDbStorageError(classifyDbError(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [library, lastReadBook]);

  const activeNav: NavDestination = showJourney
    ? "journey"
    : showVocabulary
      ? "vocabulary"
      : showAccount
        ? "account"
        : "shelf";

  if ((activeNav === "vocabulary" || showVocabulary) && !hasVisitedVocab) {
    setHasVisitedVocab(true);
  }

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
    let remote: Awaited<ReturnType<typeof listRemoteBooks>>;
    try {
      [books, ops, remote] = await Promise.all([
        listStoredBooks(bound),
        listBookOps(bound),
        sessionUserId ? listRemoteBooks(bound).catch(() => []) : Promise.resolve([]),
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
      }));
    const remoteItems: ShelfItem[] = remote
      .filter(
        (item) => !localHashes.has(item.hash) && !pendingDeletes.has(item.hash),
      )
      .sort((a, b) => +new Date(b.uploaded) - +new Date(a.uploaded))
      .map((item) => ({
        hash: item.hash,
        name: item.name || `${item.hash.slice(0, 8)}.epub`,
        addedAt: +new Date(item.uploaded) || 0,
        remoteOnly: true,
        // Los metadatos viajan en el objeto remoto: la ficha muestra
        // título y autor sin tener que descargar el EPUB.
        title:
          item.title ||
          (!item.name || /^[a-f0-9]{8}\.epub$/i.test(item.name)
            ? "Libro en la nube"
            : undefined),
        author:
          item.author ||
          (item.title ? undefined : "Toca para descargar"),
        sectionCount: item.sections || undefined,
        language: item.language,
      }));
    setLibrary([...localItems, ...remoteItems]);
    setCheckingLibrary(false);
  }, [sessionUserId]);

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
      .then(() => {
        if (cancelled) return;
        resetGameCache();
        const scope = captureDbScope();
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
      const scope = captureDbScope();
      if (cancelled) return;
      // Ya es seguro: la base activa es la de esta cuenta — el
      // compañero recarga con ella (y limpia lo de la cuenta previa).
      setDbUserId(scope.userId);

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
        if (decision.clearMarker) localStorage.removeItem(PENDING_DELETE_KEY);
        if (decision.cleanupUserId) {
          clearSyncCursors(decision.cleanupUserId);
          const removed = await deleteAccountDb(decision.cleanupUserId);
          if (!cancelled) {
            if (removed) {
              setMessage("Tu cuenta y sus datos en este dispositivo fueron eliminados.");
            } else {
              setError("Tu cuenta se eliminó, pero no se pudo limpiar este dispositivo.");
            }
          }
        }
      }

      setCheckingLibrary(false);
      void refreshLibrary();
      if (!sessionUserId) return;

      const pulled = await syncSavedWords(scope)
        .then((res) => {
          recordCollectionSyncSuccess("words");
          return res;
        })
        .catch((err) => {
          recordCollectionSyncError("words", err);
          return null;
        });
      if (!cancelled && pulled) {
        setMessage(`Cuaderno sincronizado: ${pulled} palabra(s) nueva(s) en este dispositivo.`);
        setVocabVersion((v) => v + 1);
      }
      // Marcadores y pasajes: mismo ciclo, sin bloquear la estantería.
      const pulledMarks = await syncAnnotations(scope)
        .then((res) => {
          recordCollectionSyncSuccess("annotations");
          return res;
        })
        .catch((err) => {
          recordCollectionSyncError("annotations", err);
          return null;
        });
      if (!cancelled && pulledMarks) {
        setMessage(`Marcadores sincronizados: ${pulledMarks} nuevo(s) en este dispositivo.`);
      }
      // Actividad de lectura: mismas reglas, anexable por id. Si
      // llegaron intervalos el panel del Cuaderno relee su progreso.
      void syncActivity(scope)
        .then((pulledAct) => {
          recordCollectionSyncSuccess("activity");
          if (pulledAct && !cancelled) setActivityVersion((v) => v + 1);
        })
        .catch((err) => {
          recordCollectionSyncError("activity", err);
        });
      // Repasos del cuaderno: anexables por id, mismo ciclo.
      void syncReviews(scope)
        .then(() => {
          recordCollectionSyncSuccess("reviews");
        })
        .catch((err) => {
          recordCollectionSyncError("reviews", err);
        });
      // El compañero: baja lo que otros dispositivos escribieron y
      // sube journal, registros y recepciones pendientes.
      void syncCompanion(scope)
        .then(() => {
          recordCollectionSyncSuccess("companion");
        })
        .catch((err) => {
          recordCollectionSyncError("companion", err);
        });
      // Conocimiento del lector: misma fusión por clave con updatedAt
      // como árbitro, lápidas incluidas. Si bajó algo, el lector
      // recarga su perfil como cuando llegan palabras nuevas.
      void syncKnowledge(scope)
        .then((pulledKnow) => {
          recordCollectionSyncSuccess("knowledge");
          if (pulledKnow && !cancelled) setVocabVersion((v) => v + 1);
        })
        .catch((err) => {
          recordCollectionSyncError("knowledge", err);
        });
      // Posiciones de lectura: misma fusión por libro, empuja lo local
      // y baja lo que otros dispositivos dejaron más reciente.
      void syncPositions(scope)
        .then(() => {
          recordCollectionSyncSuccess("positions");
        })
        .catch((err) => {
          recordCollectionSyncError("positions", err);
        });
      try {
        const bookOps = await listBookOps(scope).catch(() => []);
        setPendingChangesCount(bookOps.length + getPendingPositionsCount());
      } catch {
        // Ignore
      }
      let remote: Awaited<ReturnType<typeof listRemoteBooks>>;
      let localBooks: StoredBook[];
      try {
        [remote, localBooks] = await Promise.all([
          listRemoteBooks(scope).catch(() => []),
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
            await queueBookUpload(storedBook.hash, storedBook.name, scope);
          }
        }
      }
      // La estantería repinta ya con los remotos y las insignias de
      // pendiente: las subidas corren detrás — son archivos completos
      // y en datos móviles pueden tardar, no deben retener la lista.
      if (!cancelled) void refreshLibrary();
      await runBookQueue(scope)
        .then(() => {
          setCollectionPendingCount("books", 0);
        })
        .catch(() => {
          setCollectionPendingCount("books", 1);
        })
        .finally(async () => {
          try {
            const bookOps = await listBookOps(scope).catch(() => []);
            setPendingChangesCount(bookOps.length + getPendingPositionsCount());
          } catch {
            // Ignore
          }
        });
      void pullMissingUserBooksFromCloud().then((downloaded) => {
        if (downloaded > 0 && !cancelled) void refreshLibrary();
      }).catch(() => null);
      // Lo que solo está en la nube ya no baja en automático: aparece
      // en la estantería como «En la nube» y se descarga al tocarlo.
      if (!cancelled) void refreshLibrary();
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, sessionPending, sessionError, authLink, refreshLibrary]);

  // Si la sesión sigue abierta y vuelve la conexión, re-sincroniza todo
  // (los cambios hechos sin conexión —palabras, posiciones, subidas de
  // libros encoladas— se suben aquí).
  useEffect(() => {
    if (!sessionUserId) return;
    const onOnline = () => {
      const scope = captureDbScope();
      void syncSavedWords(scope)
        .then(() => recordCollectionSyncSuccess("words"))
        .catch((e) => recordCollectionSyncError("words", e));
      void syncAnnotations(scope)
        .then(() => recordCollectionSyncSuccess("annotations"))
        .catch((e) => recordCollectionSyncError("annotations", e));
      void syncActivity(scope)
        .then((pulled) => {
          recordCollectionSyncSuccess("activity");
          if (pulled) setActivityVersion((v) => v + 1);
        })
        .catch((e) => recordCollectionSyncError("activity", e));
      void syncReviews(scope)
        .then(() => recordCollectionSyncSuccess("reviews"))
        .catch((e) => recordCollectionSyncError("reviews", e));
      void syncCompanion(scope)
        .then(() => recordCollectionSyncSuccess("companion"))
        .catch((e) => recordCollectionSyncError("companion", e));
      void syncKnowledge(scope)
        .then((pulled) => {
          recordCollectionSyncSuccess("knowledge");
          if (pulled) setVocabVersion((v) => v + 1);
        })
        .catch((e) => recordCollectionSyncError("knowledge", e));
      void syncPositions(scope)
        .then(() => recordCollectionSyncSuccess("positions"))
        .catch((e) => recordCollectionSyncError("positions", e));
      void runBookQueue(scope)
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
            setPendingChangesCount(bookOps.length + getPendingPositionsCount());
          } catch {
            // Ignore
          }
        });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sessionUserId, refreshLibrary]);

  const selectBook = async (file: File) => {
    setError("");
    if (!file.size || file.size > EPUB_MAX_BYTES) {
      setMessage("");
      setError("El archivo está vacío o pesa más de 50 MB.");
      return;
    }
    setMessage("Comprobando el archivo…");
    try {
      // Comprobación mínima antes de guardar: firma ZIP y mimetype,
      // sin cargar el libro completo todavía.
      const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
      if (!checkEpubHeader(head).ok) {
        setMessage("");
        setError("Este archivo no parece un EPUB válido. Lecta solo acepta .epub de texto adaptable y sin protección.");
        return;
      }
      const hash = await sha256Hex(file);
      const scope = captureDbScope();
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const quickMeta = await extractEpubMeta(fileBytes).catch(() => null);
      const initialMeta = {
        title: quickMeta?.title,
        author: quickMeta?.author,
        language: quickMeta?.language,
        sectionCount: quickMeta?.sections,
        metaVersion: quickMeta ? 1 : undefined,
      };
      openBook({ hash, name: file.name, file }, initialMeta);
      const bookBlob = new Blob([fileBytes], { type: "application/epub+zip" });
      void saveBook(
        {
          hash,
          name: file.name,
          data: bookBlob,
          addedAt: Date.now(),
          ...initialMeta,
        },
        scope,
      )
        .then(async () => {
          const fullMeta = await readBookMeta(file).catch(() => null);
          if (fullMeta) {
            await updateBookMeta(
              hash,
              {
                title: fullMeta.title || initialMeta.title,
                author: fullMeta.author || initialMeta.author,
                language: fullMeta.language || initialMeta.language,
                sectionCount: fullMeta.sectionCount || initialMeta.sectionCount,
                cover: fullMeta.cover ?? undefined,
                metaVersion: 1,
              },
              scope,
            ).catch(() => null);
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
        void queueBookUpload(hash, file.name, scope)
          .then(() => runBookQueue(scope))
          .then(() => refreshLibrary());
        void file.arrayBuffer().then((buf) => {
          void syncUserBookUpload({
            id: hash,
            title: initialMeta.title || file.name,
            author: initialMeta.author,
            data: buf,
          });
        }).catch(() => null);
      }
    } catch {
      setBook(null);
      setError("No pudimos leer el archivo elegido.");
    }
  };

  // «Obtener» del riel Descubre: el EPUB del catálogo entra por el
  // mismo tubo que un archivo elegido a mano — validación, dedup por
  // hash (si ya está, abre el existente) y subida a la cuenta.
  const getCatalogBook = async (item: CatalogBook) => {
    const file = await downloadCatalogEpub(item);
    if (!file) throw new Error("catalog download failed");
    await selectBook(file);
  };

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
    // Antes de abrir se fusiona la posición con la cuenta; si lo remoto
    // pisó una posición local que apuntaba a otro lugar, se pregunta.
    const sync = await syncPositions(scope).catch(() => null);
    const conflict = sync?.conflicts.find((entry) => entry.bookHash === item.hash);
    if (conflict) {
      showPositionPrompt(conflict, open);
      return;
    }
    open();
  };

  // Libro solo en la nube: se descarga, se guarda y se abre. La posición
  // remota baja con el mismo sync; el aviso solo aplica si el dispositivo
  // ya guardaba una posición de este libro (si no, no hay conflicto).
  const openRemoteBook = async (item: ShelfItem, openAfter = true) => {
    setError("");
    setDownloadingHash(item.hash);
    setMessage(`Descargando «${displayTitle(item.name, item.title)}»…`);
    try {
      const scope = captureDbScope();
      const file = await downloadBook(
        { hash: item.hash, uploaded: "", name: item.name },
        scope,
      ).catch(() => null);
      if (!file) {
        setMessage("");
        setError(`No se pudo descargar «${displayTitle(item.name, item.title)}». Revisa tu conexión e inténtalo de nuevo.`);
        return;
      }
      const hadLocalPosition = Boolean(
        await loadBookPosition(item.hash, scope).catch(() => undefined),
      );
      await saveBook({ hash: item.hash, name: file.name, data: file, addedAt: Date.now() }, scope);

      const meta = await readBookMeta(file).catch(() => null);
      if (meta) {
        await updateBookMeta(
          item.hash,
          {
            title: meta.title,
            author: meta.author,
            language: meta.language,
            sectionCount: meta.sectionCount,
            cover: meta.cover ?? undefined,
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
        const sync = await syncPositions(scope).catch(() => null);
        const conflict = hadLocalPosition
          ? sync?.conflicts.find((entry) => entry.bookHash === item.hash)
          : undefined;
        if (conflict) showPositionPrompt(conflict, open);
        else open();
      } else {
        setMessage(`«${meta?.title ?? item.title ?? item.name}» guardado en este dispositivo.`);
      }
    } finally {
      setDownloadingHash(null);
    }
  };

  const openShelfItem = (item: ShelfItem) =>
    item.remoteOnly ? void openRemoteBook(item) : void openStoredBook(item);

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

  const handleOpenBookPrep = (b: BookLike) => {
    if ("hash" in b && b.hash) {
      const item = library.find((lib) => lib.hash === b.hash) ?? (b as ShelfItem);
      void openShelfItem(item);
    }
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

  const showPositionPrompt = (conflict: PositionConflict, open: () => void) => {
    positionRelease.current ??= pushOverlay(onPositionPromptBack);
    setPositionPrompt({ conflict, open });
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
        setBook(null);
      });
    }
    prompt.open();
  };

  const continueFromRemote = () => {
    const prompt = positionPrompt;
    if (prompt) openFromPrompt(prompt);
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
      await queueBookDelete(hash, scope).catch(() => undefined);
      void runBookQueue(scope);
    }
    if (book?.hash === hash) {
      closeReader();
      setMessage("Libro eliminado. Elige otro para seguir leyendo.");
    }
    void refreshLibrary();
  };

  return (
    // El compañero vive una sola vez aquí, sobre todo el contenido:
    // la hoja compartida puede abrirse desde el Cuaderno hoy y desde
    // Estantería o Lector después sin duplicar instancias ni estado.
    <CompanionProvider userId={dbUserId}>
    <div className="app">
      {book ? (
        <>
          <Suspense fallback={<p className="status">Abriendo el libro…</p>}>
            <Reader
              key={`${sessionUserId ?? "anon"}:${book.hash}`}
              bookHash={book.hash}
              file={book.file}
              fileName={book.name}
              onError={setError}
              onStatus={setMessage}
              onBack={closeReader}
              onOpenNotebook={openNotebookOverlay}
              statusText={message}
              errorText={error}
              panelsOpen={showVocabulary || showAccount}
              theme={theme}
              onThemeChange={changeTheme}
              vocabVersion={vocabVersion}
              onRequestCalibration={requestCalibration}
              signedIn={Boolean(sessionUserId)}
              readerInitialWord={readerInitialWord}
            />
          </Suspense>

          {showVocabulary ? (
            <Suspense fallback={<p className="status">Abriendo tu cuaderno…</p>}>
              <Vocabulary
                key={sessionUserId ?? "anon"}
                presentation="overlay"
                backLabel="‹ Volver al libro"
                onClose={closeNotebookOverlay}
                books={library}
                activityVersion={activityVersion}
                onOpenJourney={() => openJourneyFrom("vocab")}
              />
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
                    library={library}
                    books={library}
                    checking={checkingLibrary}
                    activeRead={lastReadBook}
                    vocabCount={library.length}
                    dueReviewsCount={dueReviewsCount}
                    hasCalibrated={calibrationDone || Boolean(calibrationWords)}
                    onOpen={openShelfItem}
                    onSelect={handleSelectBook}
                    onPrepareBook={handleOpenBookPrep}
                    onStartCalibration={handleOpenCalibration}
                    onRemove={removeBook}
                    onAdd={(file) => void selectBook(file)}
                    onLibraryChange={() => void refreshLibrary()}
                    onBooksChange={() => void refreshLibrary()}
                    onGetCatalogBook={getCatalogBook}
                    onDownloadBook={(item) => void openRemoteBook(item, false)}
                    downloadingHash={downloadingHash}
                    activityVersion={activityVersion}
                    onOpenVocab={openNotebookOverlay}
                    onOpenPractice={() => navigateTo("vocabulary")}
                    onOpenAccount={() => navigateTo("account")}
                    onOpenJourney={() => openJourneyFrom("shelf")}
                    onRequestCalibration={() => void requestCalibration()}
                    user={session?.user ?? null}
                    syncing={false}
                  />
                </Activity>
              )}

              {hasVisitedVocab || activeNav === "vocabulary" || showVocabulary ? (
                <Activity mode={activeNav === "vocabulary" ? "visible" : "hidden"}>
                  <Suspense fallback={<p className="status">Abriendo tu cuaderno…</p>}>
                    <Vocabulary
                      key={sessionUserId ?? "anon"}
                      presentation="page"
                      onClose={() => navigateTo("shelf")}
                      books={library}
                      activityVersion={activityVersion}
                      onOpenJourney={() => openJourneyFrom("vocab")}
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
                    onThemeChange={changeTheme}
                    onClose={() => navigateTo("shelf")}
                    onOpenJourney={() => openJourneyFrom("account")}
                    resetToken={resetToken}
                    onResetDone={() => setResetToken(undefined)}
                    onOpenCalibration={(words, lang = "es") => {
                      showCalibration(words, null, lang);
                    }}
                    onRestored={refreshLibrary}
                  />
                </Suspense>
              ) : null}
            </main>
          </ViewTransition>
          {lastReadBook && !book && activeNav !== "shelf" ? (
            <aside className="mini-reader-bar" aria-label="Lectura en curso">
              <div className="mini-reader-cover">
                <BookCover
                  book={{
                    hash: lastReadBook.hash,
                    name: lastReadBook.name,
                    title: lastReadBook.title,
                    author: lastReadBook.author,
                    cover: lastReadBook.cover,
                  }}
                  progress={lastReadBook.progress}
                />
              </div>
              <div className="mini-reader-info">
                <strong className="mini-reader-title">
                  {lastReadBook.title || lastReadBook.name}
                </strong>
                <span className="mini-reader-progress">
                  {Math.round((lastReadBook.progress ?? 0) * 100)}% leído
                </span>
              </div>
              <button
                type="button"
                className="btn btn--primary mini-reader-resume"
                onClick={() => {
                  if (lastReadBook.file) {
                    openBook({
                      hash: lastReadBook.hash,
                      name: lastReadBook.name,
                      file: lastReadBook.file,
                    });
                  } else {
                    const item = library.find((b) => b.hash === lastReadBook.hash);
                    if (item) {
                      void openShelfItem(item);
                    }
                  }
                }}
              >
                Continuar leyendo →
              </button>
            </aside>
          ) : null}
          <AppNav
            active={activeNav}
            onNavigate={navigateTo}
            dueCount={dueReviewsCount}
            hasJourneyAlert={hasJourneyAlert}
            hasAccount={Boolean(sessionUserId)}
          />
          <Notice
            message={message}
            error={error}
            onDismissMessage={() => setMessage("")}
            onDismissError={() => setError("")}
          />
        </>
      )}

      {showJourney ? (
        <Suspense fallback={<p className="status">Abriendo tu recorrido…</p>}>
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
        <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />
      ) : null}

      {showLegal ? (
        <LegalNotice
          initialTab={showLegal}
          onClose={() => setShowLegal(null)}
        />
      ) : null}
    </div>
    </CompanionProvider>
  );
}
