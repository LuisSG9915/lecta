import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Reader from "./components/Reader";
// El Cuaderno lleva fsrs: carga diferida para no pagar ese costo al arrancar.
const Vocabulary = lazy(() => import("./components/Vocabulary"));
import Account from "./components/Account";
import ThemeMenu from "./components/ThemeMenu";
import Shelf from "./components/Shelf";
import { applyTheme, loadTheme, saveTheme, type ThemeChoice } from "./lib/settings";
import { decidePendingDelete, PENDING_DELETE_KEY } from "./lib/account-cleanup";
import { pushOverlay, type OverlayHandle } from "./lib/history";
import { sha256Hex } from "./lib/hash";
import {
  deleteAccountDb,
  deleteStoredBook,
  listStoredBooks,
  saveBook,
  setDbUser,
  type StoredBook,
} from "./lib/idb";
import { deleteBook, downloadBook, listRemoteBooks, uploadBook } from "./lib/books";
import { syncSavedWords } from "./lib/vocab";
import { syncActivity, syncAnnotations } from "./lib/reading-sync";
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
  const [library, setLibrary] = useState<StoredBook[]>([]);
  const [vocabVersion, setVocabVersion] = useState(0);
  const [resetToken, setResetToken] = useState<string | undefined>(authLink.token);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  const bookRelease = useRef<OverlayHandle | null>(null);
  const panelRelease = useRef<OverlayHandle | null>(null);
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessionUserId = session?.user?.id;

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

  const closeReader = () => {
    releaseBook();
    setBook(null);
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

  const refreshLibrary = async () => {
    const books = await listStoredBooks().catch(() => []);
    setLibrary(books.sort((a, b) => b.addedAt - a.addedAt));
  };

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
      await setDbUser(sessionUserId ?? null);
      if (cancelled) return;

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

      const pulled = await syncSavedWords().catch(() => null);
      if (!cancelled && pulled) {
        setMessage(`Cuaderno sincronizado: ${pulled} palabra(s) nueva(s) en este dispositivo.`);
        setVocabVersion((v) => v + 1);
      }
      // Marcadores y pasajes: mismo ciclo, sin bloquear la estantería.
      const pulledMarks = await syncAnnotations().catch(() => null);
      if (!cancelled && pulledMarks) {
        setMessage(`Marcadores sincronizados: ${pulledMarks} nuevo(s) en este dispositivo.`);
      }
      // Actividad de lectura: mismas reglas, anexable por id.
      void syncActivity().catch(() => null);
      const [remote, localBooks] = await Promise.all([listRemoteBooks(), listStoredBooks()]);
      if (cancelled) return;
      const remoteHashes = new Set(remote.map((item) => item.hash));
      const storedHashes = new Set(localBooks.map((item) => item.hash));

      for (const storedBook of localBooks) {
        if (!remoteHashes.has(storedBook.hash)) {
          void uploadBook(
            storedBook.hash,
            new File([storedBook.data], storedBook.name, { type: "application/epub+zip" }),
          );
        }
      }

      const missing = remote
        .filter((item) => !storedHashes.has(item.hash))
        .sort((a, b) => +new Date(b.uploaded) - +new Date(a.uploaded));
      for (const item of missing.slice(0, 3)) {
        const file = await downloadBook(item);
        if (!file) continue;
        await saveBook({
          hash: item.hash,
          name: file.name,
          data: file,
          addedAt: new Date(item.uploaded).getTime() || Date.now(),
        });
      }
      if (!cancelled) void refreshLibrary();
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, sessionPending, authLink]);

  // Si la sesión sigue abierta y vuelve la conexión, re-sincroniza el
  // vocabulario (los cambios hechos sin conexión se suben aquí).
  useEffect(() => {
    if (!sessionUserId) return;
    const onOnline = () => {
      void syncSavedWords();
      void syncAnnotations();
      void syncActivity();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sessionUserId]);

  const selectBook = async (file: File) => {
    setError("");
    setMessage("Comprobando el archivo…");
    try {
      const hash = await sha256Hex(file);
      openBook({ hash, name: file.name, file });
      void saveBook({ hash, name: file.name, data: file, addedAt: Date.now() })
        .then(() => {
          setMessage("Libro guardado en este dispositivo.");
          void refreshLibrary();
        })
        .catch(() => setError("El libro se abrió, pero no se pudo guardar en este dispositivo."));
      if (sessionUserId) void uploadBook(hash, file);
    } catch {
      setBook(null);
      setError("No pudimos leer el archivo elegido.");
    }
  };

  const openStoredBook = (item: StoredBook) => {
    setError("");
    openBook({
      hash: item.hash,
      name: item.name,
      file: new File([item.data], item.name, { type: "application/epub+zip" }),
    });
    setMessage(`Abriendo «${item.title ?? item.name}»…`);
  };

  const removeBook = async (hash: string) => {
    await deleteStoredBook(hash).catch(() => undefined);
    if (sessionUserId) void deleteBook(hash);
    if (book?.hash === hash) {
      closeReader();
      setMessage("Libro eliminado. Elige otro para seguir leyendo.");
    }
    void refreshLibrary();
  };

  return (
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
              onOpen={openStoredBook}
              onRemove={removeBook}
              onAdd={(file) => void selectBook(file)}
              onLibraryChange={() => void refreshLibrary()}
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
          <Vocabulary onClose={closePanel} books={library} />
        </Suspense>
      ) : null}
      {showAccount ? (
        <Account onClose={closePanel} resetToken={resetToken} onResetDone={() => setResetToken(undefined)} />
      ) : null}
    </div>
  );
}
