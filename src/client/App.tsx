import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Reader from "./components/Reader";
// El Cuaderno lleva fsrs: carga diferida para no pagar ese costo al arrancar.
const Vocabulary = lazy(() => import("./components/Vocabulary"));
import Account from "./components/Account";
import Calibration from "./components/Calibration";
import { CompanionProvider } from "./components/CompanionProvider";
import ThemeMenu from "./components/ThemeMenu";
import Shelf, { type ShelfItem } from "./components/Shelf";
import Dialog from "./components/Dialog";
import { applyTheme, loadTheme, saveTheme, type ThemeChoice } from "./lib/settings";
import { decidePendingDelete, PENDING_DELETE_KEY } from "./lib/account-cleanup";
import { pushOverlay, type OverlayHandle } from "./lib/history";
import { sha256Hex } from "./lib/hash";
import {
  CALIBRATION_DONE_KEY,
  fetchCalibrationSample,
  type CalibrationWord,
} from "./lib/calibration";
import {
  captureDbScope,
  deleteAccountDb,
  deleteStoredBook,
  getStoredBook,
  isDbScopeActive,
  listBookOps,
  listStoredBooks,
  loadBookPosition,
  saveBook,
  saveBookPosition,
  saveSessionValue,
  setDbUser,
  type DbScope,
} from "./lib/idb";
import { resetGameCache } from "./lib/game";
import { downloadBook, listRemoteBooks } from "./lib/books";
import { queueBookDelete, queueBookUpload, runBookQueue } from "./lib/book-queue";
import { syncPositions, type PositionConflict } from "./lib/positions-sync";
import { checkEpubHeader, EPUB_MAX_BYTES } from "../shared/epub-check";
import { syncSavedWords } from "./lib/vocab";
import { syncActivity, syncAnnotations, syncKnowledge, syncReviews } from "./lib/reading-sync";
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
  const [showAccount, setShowAccount] = useState(Boolean(authLink.token || authLink.urlError));
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
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessionUserId = session?.user?.id;
  // La cuenta cuya base local ya quedó activa (se fija tras setDbUser,
  // nunca antes): el compañero solo ve datos de la base vigente — un
  // cambio de cuenta lo limpia y recarga con el contexto nuevo.
  const [dbUserId, setDbUserId] = useState<string | null>(null);

  const changeTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    saveTheme(choice);
    applyTheme(choice);
  };

  const releaseBook = () => {
    bookRelease.current?.release();
    bookRelease.current = null;
  };

  const openBook = (selection: BookSelection) => {
    if (!bookRelease.current) {
      bookRelease.current = pushOverlay(() => {
        bookRelease.current = null;
        setBook(null);
      });
    }
    setBook(selection);
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
      void saveSessionValue(CALIBRATION_DONE_KEY, "1", scope).catch(
        () => undefined,
      );
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
    const sample = await fetchCalibrationSample(language);
    if (!sample.ok || !sample.words.length) {
      setError("No se pudo cargar la lista de palabras. Intenta de nuevo con conexión.");
      return false;
    }
    showCalibration(sample.words, null, language);
    return true;
  };

  const closeReader = () => {
    releaseBook();
    setBook(null);
    // La posición final de la sesión de lectura sale aquí hacia la
    // cuenta, para que los demás dispositivos continúen donde quedó.
    void syncPositions().catch(() => null);
  };

  const openPanel = (kind: "vocab" | "account") => {
    if (!panelRelease.current) {
      panelRelease.current = pushOverlay(() => {
        panelRelease.current = null;
        setShowVocabulary(false);
        setShowAccount(false);
      });
    }
    if (kind === "vocab") {
      setShowAccount(false);
      setShowVocabulary(true);
    } else {
      setShowVocabulary(false);
      setShowAccount(true);
    }
  };

  const closePanel = () => {
    panelRelease.current?.release();
    panelRelease.current = null;
    setShowVocabulary(false);
    setShowAccount(false);
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
    const [books, ops, remote] = await Promise.all([
      listStoredBooks(bound).catch(() => []),
      listBookOps(bound).catch(() => []),
      sessionUserId ? listRemoteBooks(bound).catch(() => []) : Promise.resolve([]),
    ]);
    if (!isDbScopeActive(bound)) return;
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
      }));
    setLibrary([...localItems, ...remoteItems]);
  }, [sessionUserId]);

  // El panel abierto por el enlace también es una capa del historial:
  // el botón atrás lo cierra como a cualquier otro panel.
  useEffect(() => {
    if (!authLink.token && !authLink.urlError) return;
    panelRelease.current = pushOverlay(() => {
      panelRelease.current = null;
      setShowVocabulary(false);
      setShowAccount(false);
    });
  }, [authLink]);

  useEffect(() => {
    // Mientras la sesión no resuelve, no sabemos si hay cuenta: tocar
    // bases locales o marcadores de borrado en ese momento es inseguro.
    if (sessionPending) return;
    let cancelled = false;
    void (async () => {
      try {
        await setDbUser(sessionUserId ?? null);
      } catch (error) {
        // Sin la base local no hay estantería que preparar: soltar el
        // spinner y decir por qué (p. ej. otra pestaña reteniendo una
        // versión vieja de IndexedDB) — cargar eterno escondería el
        // fallo real.
        if (!cancelled) {
          setCheckingLibrary(false);
          setError(
            error instanceof Error && error.message
              ? error.message
              : "No se pudo abrir la biblioteca local. Recarga la página.",
          );
        }
        return;
      }
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

      const pulled = await syncSavedWords(scope).catch(() => null);
      if (!cancelled && pulled) {
        setMessage(`Cuaderno sincronizado: ${pulled} palabra(s) nueva(s) en este dispositivo.`);
        setVocabVersion((v) => v + 1);
      }
      // Marcadores y pasajes: mismo ciclo, sin bloquear la estantería.
      const pulledMarks = await syncAnnotations(scope).catch(() => null);
      if (!cancelled && pulledMarks) {
        setMessage(`Marcadores sincronizados: ${pulledMarks} nuevo(s) en este dispositivo.`);
      }
      // Actividad de lectura: mismas reglas, anexable por id. Si
      // llegaron intervalos el panel del Cuaderno relee su progreso.
      void syncActivity(scope)
        .then((pulled) => {
          if (pulled && !cancelled) setActivityVersion((v) => v + 1);
        })
        .catch(() => null);
      // Repasos del cuaderno: anexables por id, mismo ciclo.
      void syncReviews(scope).catch(() => null);
      // El compañero: baja lo que otros dispositivos escribieron y
      // sube journal, registros y recepciones pendientes.
      void syncCompanion(scope).catch(() => null);
      // Conocimiento del lector: misma fusión por clave con updatedAt
      // como árbitro, lápidas incluidas. Si bajó algo, el lector
      // recarga su perfil como cuando llegan palabras nuevas.
      void syncKnowledge(scope)
        .then((pulled) => {
          if (pulled && !cancelled) setVocabVersion((v) => v + 1);
        })
        .catch(() => null);
      // Posiciones de lectura: misma fusión por libro, empuja lo local
      // y baja lo que otros dispositivos dejaron más reciente.
      void syncPositions(scope).catch(() => null);
      const [remote, localBooks] = await Promise.all([
        listRemoteBooks(scope).catch(() => []),
        listStoredBooks(scope),
      ]);
      if (cancelled || !isDbScopeActive(scope)) return;
      const remoteHashes = new Set(remote.map((item) => item.hash));

      // Lo que falta en la nube entra a la cola persistente: si la
      // subida falla queda «Pendiente de subir» y se reintenta solo.
      for (const storedBook of localBooks) {
        if (!remoteHashes.has(storedBook.hash)) {
          await queueBookUpload(storedBook.hash, storedBook.name, scope);
        }
      }
      await runBookQueue(scope);
      // Lo que solo está en la nube ya no baja en automático: aparece
      // en la estantería como «En la nube» y se descarga al tocarlo.
      if (!cancelled) void refreshLibrary();
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, sessionPending, authLink, refreshLibrary]);

  // Si la sesión sigue abierta y vuelve la conexión, re-sincroniza todo
  // (los cambios hechos sin conexión —palabras, posiciones, subidas de
  // libros encoladas— se suben aquí).
  useEffect(() => {
    if (!sessionUserId) return;
    const onOnline = () => {
      void syncSavedWords();
      void syncAnnotations();
      void syncActivity().then((pulled) => {
        if (pulled) setActivityVersion((v) => v + 1);
      });
      void syncReviews();
      void syncCompanion();
      void syncKnowledge().then((pulled) => {
        if (pulled) setVocabVersion((v) => v + 1);
      });
      void syncPositions();
      void runBookQueue()
        .then(() => refreshLibrary())
        .catch(() => undefined);
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
      openBook({ hash, name: file.name, file });
      void saveBook({ hash, name: file.name, data: file, addedAt: Date.now() }, scope)
        .then(() => {
          setMessage("Libro guardado en este dispositivo.");
          void refreshLibrary();
        })
        .catch(() => setError("El libro se abrió, pero no se pudo guardar en este dispositivo."));
      // La subida pasa por la cola persistente: sin conexión queda
      // encolada y la tarjeta se marca «Pendiente de subir».
      if (sessionUserId) {
        void queueBookUpload(hash, file.name, scope)
          .then(() => runBookQueue(scope))
          .then(() => refreshLibrary());
      }
    } catch {
      setBook(null);
      setError("No pudimos leer el archivo elegido.");
    }
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
  const openRemoteBook = async (item: ShelfItem) => {
    setError("");
    const scope = captureDbScope();
    setMessage("Descargando…");
    const file = await downloadBook(
      { hash: item.hash, uploaded: "", name: item.name },
      scope,
    ).catch(() => null);
    if (!file) {
      setMessage("");
      setError("No se pudo descargar el libro. Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    const hadLocalPosition = Boolean(
      await loadBookPosition(item.hash, scope).catch(() => undefined),
    );
    // eslint-disable-next-line react-hooks/purity -- handler async de clic, no corre en render
    await saveBook({ hash: item.hash, name: file.name, data: file, addedAt: Date.now() }, scope);
    const open = () => {
      openBook({ hash: item.hash, name: file.name, file });
      setMessage(`Abriendo «${item.title ?? item.name}»…`);
    };
    const sync = await syncPositions(scope).catch(() => null);
    const conflict = hadLocalPosition
      ? sync?.conflicts.find((entry) => entry.bookHash === item.hash)
      : undefined;
    if (conflict) showPositionPrompt(conflict, open);
    else open();
    void refreshLibrary();
  };

  const openShelfItem = (item: ShelfItem) =>
    item.remoteOnly ? void openRemoteBook(item) : void openStoredBook(item);

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
        <Reader
          key={`${sessionUserId ?? "anon"}:${book.hash}`}
          bookHash={book.hash}
          file={book.file}
          fileName={book.name}
          onError={setError}
          onStatus={setMessage}
          onBack={closeReader}
          onOpenNotebook={() => openPanel("vocab")}
          statusText={message}
          errorText={error}
          panelsOpen={showVocabulary || showAccount}
          theme={theme}
          onThemeChange={changeTheme}
          vocabVersion={vocabVersion}
          onRequestCalibration={requestCalibration}
        />
      ) : (
        <>
          <header className="app-header">
            <span className="brand">Lecta</span>
            <nav className="app-header-nav" aria-label="Secciones">
              <button type="button" className="btn--quiet" onClick={() => openPanel("vocab")}>
                Cuaderno
              </button>
              <button type="button" className="btn--quiet" onClick={() => openPanel("account")}>
                Cuenta
              </button>
              <ThemeMenu value={theme} onChange={changeTheme} />
            </nav>
          </header>
          <main className="app-main">
            <Shelf
              library={library}
              checking={checkingLibrary}
              onOpen={openShelfItem}
              onRemove={removeBook}
              onAdd={(file) => void selectBook(file)}
              onLibraryChange={() => void refreshLibrary()}
              activityVersion={activityVersion}
            />
            {message ? (
              <p className="status" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="status">
                {error}
              </p>
            ) : null}
          </main>
        </>
      )}

      {showVocabulary ? (
        <Suspense fallback={<p className="status">Abriendo tu cuaderno…</p>}>
          {/* Remontar al cambiar de cuenta: el estado y las tareas del
              panel pertenecen a quien estaba activo al abrirlo. */}
          <Vocabulary
            key={sessionUserId ?? "anon"}
            onClose={closePanel}
            books={library}
            activityVersion={activityVersion}
          />
        </Suspense>
      ) : null}
      {showAccount ? (
        <Account
          key={sessionUserId ?? "anon"}
          onClose={closePanel}
          resetToken={resetToken}
          onResetDone={() => setResetToken(undefined)}
          onOpenCalibration={(words) => {
            // El diálogo de Cuenta quedaría por encima de la hoja:
            // se cierra el panel y su entrada del historial pasa a
            // ser la de la calibración (mismo nivel, sin pushes).
            setShowAccount(false);
            if (panelRelease.current) {
              calibrationRelease.current = panelRelease.current;
              panelRelease.current = null;
              calibrationRelease.current.swap(onCalibrationBack);
            }
            showCalibration(words, null);
          }}
        />
      ) : null}
      {calibrationWords ? (
        <Calibration
          key={sessionUserId ?? "anon"}
          words={calibrationWords}
          language={calibrationLang}
          onDone={() => closeCalibration(true)}
          onClose={() => closeCalibration(false)}
        />
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
    </div>
    </CompanionProvider>
  );
}
