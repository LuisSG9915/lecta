import { useEffect, useRef, useState } from "react";
import Reader from "./components/Reader";
import Vocabulary from "./components/Vocabulary";
import Account from "./components/Account";
import { sha256Hex } from "./lib/hash";
import {
  deleteStoredBook,
  listStoredBooks,
  loadLatestBook,
  saveBook,
  setDbUser,
  type StoredBook,
} from "./lib/idb";
import { deleteBook, downloadBook, listRemoteBooks, uploadBook } from "./lib/books";
import { syncSavedWords } from "./lib/vocab";
import { authClient } from "./lib/auth";

type BookSelection = {
  hash: string;
  name: string;
  file: File;
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [book, setBook] = useState<BookSelection | null>(null);
  const [message, setMessage] = useState("Elige un libro EPUB para empezar.");
  const [error, setError] = useState("");
  const [checkingLibrary, setCheckingLibrary] = useState(true);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [library, setLibrary] = useState<StoredBook[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [vocabVersion, setVocabVersion] = useState(0);
  const { data: session } = authClient.useSession();
  const sessionUserId = session?.user?.id;

  const refreshLibrary = async () => {
    const books = await listStoredBooks().catch(() => []);
    setLibrary(books.sort((a, b) => b.addedAt - a.addedAt));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await setDbUser(sessionUserId ?? null);
      if (cancelled) return;

      const stored = await loadLatestBook().catch(() => undefined);
      if (!cancelled) {
        setCheckingLibrary(false);
        setBook(
          stored
            ? {
                hash: stored.hash,
                name: stored.name,
                file: new File([stored.data], stored.name, {
                  type: "application/epub+zip",
                }),
              }
            : null,
        );
        void refreshLibrary();
      }
      if (!sessionUserId) return;

      const pulled = await syncSavedWords().catch(() => null);
      if (!cancelled && pulled) {
        setMessage(`Vocabulario sincronizado: ${pulled} palabra(s) nueva(s) en este dispositivo.`);
        setVocabVersion((v) => v + 1);
      }
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
      let first: { hash: string; file: File } | null = null;
      for (const item of missing.slice(0, 3)) {
        const file = await downloadBook(item);
        if (!file) continue;
        await saveBook({
          hash: item.hash,
          name: file.name,
          data: file,
          addedAt: new Date(item.uploaded).getTime() || Date.now(),
        });
        first ??= { hash: item.hash, file };
      }
      if (cancelled) return;
      void refreshLibrary();
      if (!first) return;
      const { hash, file } = first;
      setBook((current) => current ?? { hash, name: file.name, file });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

  // Si la sesión sigue abierta y vuelve la conexión, re-sincroniza el
  // vocabulario (los cambios hechos sin conexión se suben aquí).
  useEffect(() => {
    if (!sessionUserId) return;
    const onOnline = () => void syncSavedWords();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sessionUserId]);

  const selectBook = async (file: File) => {
    setError("");
    setMessage("Comprobando el archivo…");
    try {
      const hash = await sha256Hex(file);
      const selection = { hash, name: file.name, file };
      setBook(selection);
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
    setBook({
      hash: item.hash,
      name: item.name,
      file: new File([item.data], item.name, { type: "application/epub+zip" }),
    });
    setMessage(`Abriendo «${item.name}»…`);
  };

  const removeBook = async (hash: string) => {
    if (confirmDelete !== hash) {
      setConfirmDelete(hash);
      return;
    }
    setConfirmDelete(null);
    await deleteStoredBook(hash).catch(() => undefined);
    if (sessionUserId) void deleteBook(hash);
    if (book?.hash === hash) {
      setBook(null);
      setMessage("Libro eliminado. Elige otro para seguir leyendo.");
    }
    void refreshLibrary();
  };

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <main>
      <h1>Lecta</h1>
      <p>Un espacio para leer y aprender vocabulario.</p>

      <div className="upload-panel">
        <label htmlFor="book-file">Elige un libro EPUB</label>
        <input
          ref={fileInputRef}
          id="book-file"
          type="file"
          accept=".epub,application/epub+zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void selectBook(file);
            event.currentTarget.value = "";
          }}
        />
        <button type="button" onClick={openFilePicker}>
          Elegir archivo
        </button>
        <button type="button" onClick={() => setShowVocabulary(true)}>
          Vocabulario
        </button>
        <button type="button" onClick={() => setShowAccount(true)}>
          Cuenta
        </button>
      </div>

      {library.length ? (
        <ul className="word-list" aria-label="Tu biblioteca">
          {library.map((item) => (
            <li key={item.hash}>
              <strong>{item.name}</strong>
              <span className="reader-meta">
                {" "}
                {new Date(item.addedAt).toLocaleDateString("es-MX")}
              </span>
              <button type="button" onClick={() => openStoredBook(item)}>
                Abrir
              </button>
              <button
                type="button"
                aria-label={`Eliminar ${item.name}`}
                onClick={() => void removeBook(item.hash)}
              >
                {confirmDelete === item.hash ? "¿Seguro?" : "Eliminar"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p role="status">{checkingLibrary ? "Preparando tu biblioteca…" : message}</p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {book ? (
        <Reader
          key={`${sessionUserId ?? "anon"}:${book.hash}:${vocabVersion}`}
          bookHash={book.hash}
          file={book.file}
          fileName={book.name}
          onError={setError}
          onStatus={setMessage}
        />
      ) : null}

      {showVocabulary ? <Vocabulary onClose={() => setShowVocabulary(false)} /> : null}
      {showAccount ? <Account onClose={() => setShowAccount(false)} /> : null}
    </main>
  );
}
