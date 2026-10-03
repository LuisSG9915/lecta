import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { EpubBook, EpubTocItem } from "../lib/epub";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint } from "../lib/words";
import { openEpub } from "../lib/epub";
import { extractUniqueWords } from "../lib/segmenter";
import { sanitizeSectionDocument } from "../lib/sanitize";
import { markSavedWords } from "../lib/marks";
import { listSavedWords, loadBookPosition, saveBookPosition, type SavedWord } from "../lib/idb";
import WordPanel from "./WordPanel";

type ReaderState = "idle" | "opening" | "ready" | "error";

type ReaderProps = {
  bookHash: string;
  file: Blob;
  fileName: string;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
};

const flattenMetadataValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return flattenMetadataValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return flattenMetadataValue(record.name ?? Object.values(record)[0]);
  }
  return "";
};

const flattenToc = (items: EpubTocItem[]): EpubTocItem[] =>
  items.flatMap((item) => [item, ...(item.subitems ? flattenToc(item.subitems) : [])]);

const getBookTitle = (book: EpubBook) =>
  flattenMetadataValue(book.metadata?.title) || "Libro sin título";

const getBookAuthor = (book: EpubBook) =>
  flattenMetadataValue(book.metadata?.author) || flattenMetadataValue(book.metadata?.creator);

const getBookLanguage = (book: EpubBook) =>
  flattenMetadataValue(book.metadata?.language) || "es";

export default function Reader({ bookHash, file, fileName, onError, onStatus }: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const scrollTimer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<ReaderState>("idle");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [sectionTotal, setSectionTotal] = useState(0);
  const [sectionTitle, setSectionTitle] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [language, setLanguage] = useState("es");
  const [selection, setSelection] = useState<WordHit | null>(null);
  const savedForms = useRef<Set<string>>(new Set());

  const loadSection = useCallback(
    async (index: number, restoreScroll?: number) => {
      const book = bookRef.current;
      const section = book?.sections[index];
      const container = containerRef.current;
      if (!book || !section || !container) return;

      setState("opening");
      setSelection(null);
      onStatus("Abriendo sección…");
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
        markSavedWords(sanitized, savedForms.current, getBookLanguage(book));
        container.replaceChildren(sanitized);
        const text = sanitized.textContent ?? "";
        const words = await extractUniqueWords(text, getBookLanguage(book));
        const tocLabel = flattenToc(book.toc ?? []).find(
          (item) => item.href?.split("#")[0] === section.id,
        )?.label;
        setWordCount(words.length);
        setSectionIndex(index);
        setSectionTitle(tocLabel ?? `Sección ${index + 1}`);
        setState("ready");
        onStatus(`Sección ${index + 1} de ${book.sections.length}`);
        container.scrollTop = restoreScroll ?? 0;
        void saveBookPosition({
          bookHash,
          sectionIndex: index,
          scrollTop: restoreScroll ?? 0,
          updatedAt: Date.now(),
        });
      } catch {
        setState("error");
        onError("No pudimos abrir esta sección del libro.");
      }
    },
    [bookHash, onError, onStatus],
  );

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const loadBook = async () => {
      setState("opening");
      onStatus("Abriendo libro…");
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
        savedForms.current = new Set(
          storedWords.flatMap((word) =>
            [word.form, word.lemma].filter((f): f is string => Boolean(f)).map((f) => f.toLowerCase()),
          ),
        );
        setLanguage(bookLanguage);
        setTitle(getBookTitle(book));
        setAuthor(getBookAuthor(book));
        setSectionTotal(book.sections.length);
        const saved = await loadBookPosition(bookHash);
        await loadSection(Math.min(saved?.sectionIndex ?? 0, book.sections.length - 1), saved?.scrollTop);
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
      cleanup?.();
      window.clearTimeout(scrollTimer.current);
    };
  }, [bookHash, file, loadSection, onError, onStatus]);

  const onWordSaved = (word: SavedWord) => {
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.add(form.toLowerCase());
    }
    if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    onStatus(`«${word.form}» guardada para practicar.`);
  };

  const persistScroll = () => {
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      void saveBookPosition({
        bookHash,
        sectionIndex,
        scrollTop: containerRef.current?.scrollTop ?? 0,
        updatedAt: Date.now(),
      });
    }, 400);
  };

  return (
    <section aria-labelledby="book-title">
      <header className="reader-header">
        <div>
          <h2 id="book-title">{title || fileName}</h2>
          {author ? <p className="reader-meta">{author}</p> : null}
        </div>
        <p className="reader-meta" aria-live="polite">
          {sectionTitle} · {wordCount} formas
        </p>
      </header>

      <div
        ref={containerRef}
        className="book-content"
        tabIndex={0}
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          const container = containerRef.current;
          if (!container) return;
          const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
          if (hit) setSelection(hit);
        }}
        onScroll={persistScroll}
        aria-busy={state === "opening"}
        aria-label="Contenido de la sección"
      />

      {selection ? (
        <WordPanel
          key={selection.word}
          word={selection.word}
          context={selection.context}
          language={language}
          bookHash={bookHash}
          onClose={() => setSelection(null)}
          onSaved={onWordSaved}
        />
      ) : null}

      <nav className="reader-nav" aria-label="Navegación de secciones">
        <button type="button" disabled={sectionIndex <= 0} onClick={() => void loadSection(sectionIndex - 1)}>
          Anterior
        </button>
        <button
          type="button"
          disabled={sectionIndex + 1 >= sectionTotal}
          onClick={() => void loadSection(sectionIndex + 1)}
        >
          Siguiente
        </button>
      </nav>
    </section>
  );
}
