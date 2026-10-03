import { useEffect, useRef, useState } from "react";
import Reader from "./components/Reader";
import Vocabulary from "./components/Vocabulary";
import { sha256Hex } from "./lib/hash";
import { loadLatestBook, saveBook } from "./lib/idb";

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

  useEffect(() => {
    let cancelled = false;
    void loadLatestBook()
      .then(async (stored) => {
        if (cancelled || !stored) return;
        setBook({
          hash: stored.hash,
          name: stored.name,
          file: new File([stored.data], stored.name, { type: "application/epub+zip" }),
        });
        setMessage("Libro restaurado desde este dispositivo.");
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos recuperar el libro guardado en este dispositivo.");
      })
      .finally(() => {
        if (!cancelled) setCheckingLibrary(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectBook = async (file: File) => {
    setError("");
    setMessage("Comprobando el archivo…");
    try {
      const hash = await sha256Hex(file);
      const selection = { hash, name: file.name, file };
      setBook(selection);
      void saveBook({ hash, name: file.name, data: file, addedAt: Date.now() })
        .then(() => setMessage("Libro guardado en este dispositivo."))
        .catch(() => setError("El libro se abrió, pero no se pudo guardar en este dispositivo."));
    } catch {
      setBook(null);
      setError("No pudimos leer el archivo elegido.");
    }
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
      </div>

      <p role="status">{checkingLibrary ? "Preparando tu biblioteca…" : message}</p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {book ? (
        <Reader
          key={book.hash}
          bookHash={book.hash}
          file={book.file}
          fileName={book.name}
          onError={setError}
          onStatus={setMessage}
        />
      ) : null}

      {showVocabulary ? <Vocabulary onClose={() => setShowVocabulary(false)} /> : null}
    </main>
  );
}
