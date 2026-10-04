import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { EpubBook, EpubTocItem } from "../lib/epub";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint } from "../lib/words";
import { openEpub } from "../lib/epub";
import { extractUniqueWords } from "../lib/segmenter";
import { sanitizeSectionDocument } from "../lib/sanitize";
import { markSavedWords } from "../lib/marks";
import { listSavedWords, loadBookPosition, saveBookPosition, type SavedWord } from "../lib/idb";
import { batchLookup, enrichBatch, type LexiconEntry } from "../lib/lexicon";
import { isStopword } from "../../shared/stopwords";
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

type BookVocabulary = {
  known: { form: string; entries: LexiconEntry[] }[];
  missing: string[];
  total: number;
};

const MAX_ENRICHED_PER_CLICK = 50;

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
  const [bookVocab, setBookVocab] = useState<BookVocabulary | null>(null);
  const [showBookVocab, setShowBookVocab] = useState(false);
  const [enriching, setEnriching] = useState<{ done: number; total: number } | null>(null);
  const [defsPending, setDefsPending] = useState(false);
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
        const text = [...sanitized.childNodes]
          .map((node) => node.textContent ?? "")
          .join("\n");
        container.replaceChildren(sanitized);
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

        void (async () => {
          const seen = new Set<string>();
          for (const bookSection of book.sections) {
            if (disposed) return;
            try {
              const doc = sanitizeSectionDocument(await bookSection.createDocument());
              const text = [...doc.childNodes]
                .map((node) => node.textContent ?? "")
                .join("\n");
              const words = await extractUniqueWords(text, bookLanguage);
              for (const word of words) {
                const form = word.toLowerCase();
                if (!isStopword(form, bookLanguage)) seen.add(form);
              }
            } catch {
              // sección omitida del análisis
            }
          }
          if (disposed) return;
          const forms = [...seen].slice(0, 500);
          const result = await batchLookup(forms, bookLanguage);
          if (disposed || !result.ok) return;
          setBookVocab({
            known: forms
              .filter((form) => result.entries[form]?.length)
              .map((form) => ({ form, entries: result.entries[form] })),
            missing: forms.filter((form) => !result.entries[form]?.length),
            total: forms.length,
          });
        })();
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

  const enrichMissing = async () => {
    if (!bookVocab || enriching) return;
    const pending = bookVocab.missing.slice(0, MAX_ENRICHED_PER_CLICK);
    setEnriching({ done: 0, total: pending.length });

    const batch = await enrichBatch(pending, language);
    if (!batch.ok) {
      setEnriching(null);
      onError(batch.error ?? "No se pudo programar el lote de definiciones.");
      return;
    }
    if (batch.count === 0) {
      setEnriching(null);
      return;
    }
    setDefsPending(true);

    // El workflow corre en segundo plano: consultamos varias veces
    // hasta que las fichas nuevas empiecen a aparecer en el catálogo.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const result = await batchLookup(pending, language);
      if (!result.ok) continue;
      const foundNow = pending.filter((form) => result.entries[form]?.length);
      if (!foundNow.length && attempt < 5) continue;
      setBookVocab((vocab) =>
        vocab
          ? {
              ...vocab,
              known: [
                ...vocab.known,
                ...foundNow
                  .filter((form) => !vocab.known.some((item) => item.form === form))
                  .map((form) => ({ form, entries: result.entries[form] })),
              ],
              missing: vocab.missing.filter((form) => !foundNow.includes(form)),
            }
          : vocab,
      );
      setEnriching((progress) =>
        progress ? { done: foundNow.length, total: progress.total } : progress,
      );
      if (foundNow.length >= pending.length) break;
    }
    setEnriching(null);
    // Si todo el lote ya tiene ficha, ya no hay nada pendiente en
    // segundo plano; si no, avisamos que seguirán llegando.
    setBookVocab((vocab) => {
      if (vocab && !vocab.missing.length) setDefsPending(false);
      return vocab;
    });
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
        <button
          type="button"
          onClick={() => setShowBookVocab(true)}
          disabled={!bookVocab}
          aria-label="Palabras del libro"
        >
          {bookVocab ? `Palabras ${bookVocab.known.length}/${bookVocab.total}` : "Analizando…"}
        </button>
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

      {showBookVocab && bookVocab ? (
        <div className="word-panel" role="dialog" aria-modal="true" aria-label="Palabras del libro">
          <div className="word-panel-header">
            <strong>Palabras del libro</strong>
            <button
              type="button"
              onClick={() => setShowBookVocab(false)}
              aria-label="Cerrar palabras del libro"
            >
              Cerrar
            </button>
          </div>
          <p className="reader-meta">
            {bookVocab.known.length} con ficha · {bookVocab.missing.length} sin ficha ·{" "}
            {bookVocab.total} formas únicas
          </p>
          {bookVocab.known.length ? (
            <ul className="word-list">
              {bookVocab.known.slice(0, 60).map(({ form, entries }) => (
                <li key={form}>
                  <strong>{form}</strong>
                  {entries[0]?.pos ? <span className="reader-meta"> {entries[0].pos}</span> : null}
                  {entries[0]?.senses[0]?.definition
                    ? ` — ${entries[0].senses[0].definition}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {defsPending && bookVocab.missing.length ? (
            <p className="reader-meta">
              Las definiciones faltantes se siguen generando en segundo plano.
            </p>
          ) : null}
          {bookVocab.missing.length ? (
            <>
              <p className="reader-meta">
                Sin ficha: {bookVocab.missing.slice(0, 40).join(", ")}
                {bookVocab.missing.length > 40 ? "…" : ""}
              </p>
              <button
                type="button"
                disabled={Boolean(enriching)}
                onClick={() => void enrichMissing()}
              >
                {enriching
                  ? `Definiendo ${enriching.done} de ${enriching.total}…`
                  : `Definir ${Math.min(MAX_ENRICHED_PER_CLICK, bookVocab.missing.length)} con IA`}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

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
