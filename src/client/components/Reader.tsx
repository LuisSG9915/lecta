import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { EpubBook, EpubTocItem } from "../lib/epub";
import type { WordHit } from "../lib/words";
import { extractWordAtPoint } from "../lib/words";
import {
  openEpub,
  getBookAuthor,
  getBookLanguage,
  getBookTitle,
} from "../lib/epub";
import { extractUniqueWords } from "../lib/segmenter";
import { sanitizeSectionDocument } from "../lib/sanitize";
import { markSavedWords } from "../lib/marks";
import {
  listSavedWords,
  loadBookPosition,
  saveBookPosition,
  loadSessionValue,
  saveSessionValue,
  type SavedWord,
} from "../lib/idb";
import { batchLookup, enrichBatch, type LexiconEntry } from "../lib/lexicon";
import { isStopword } from "../../shared/stopwords";
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
  readerCssVars,
  READER_LIMITS,
  type ReaderSettings,
  type ThemeChoice,
} from "../lib/settings";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import WordPanel from "./WordPanel";
import Sheet from "./Sheet";
import ThemeMenu from "./ThemeMenu";

type ReaderState = "idle" | "opening" | "ready" | "error";
type SheetKind = "toc" | "settings" | "vocab";

type ReaderProps = {
  bookHash: string;
  file: Blob;
  fileName: string;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onBack: () => void;
  onOpenNotebook: () => void;
  statusText: string;
  theme: ThemeChoice;
  onThemeChange: (choice: ThemeChoice) => void;
  vocabVersion: number;
};

type BookVocabulary = {
  known: { form: string; entries: LexiconEntry[] }[];
  missing: string[];
  total: number;
};

type TocRow = { label: string; index: number; depth: number };

const MAX_ENRICHED_PER_CLICK = 50;
const WPM_KEY = "readingWpm";

const clampNumber = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function Reader({
  bookHash,
  file,
  fileName,
  onError,
  onStatus,
  onBack,
  onOpenNotebook,
  statusText,
  theme,
  onThemeChange,
  vocabVersion,
}: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const scrollTimer = useRef<number | undefined>(undefined);
  const rafPending = useRef(false);
  const lastScrollY = useRef(0);
  const savedForms = useRef<Set<string>>(new Set());
  const sectionTiming = useRef<{ start: number; startRatio: number; words: number } | null>(null);
  const overlayRelease = useRef<OverlayHandle | null>(null);
  const tocRowsRef = useRef<TocRow[]>([]);

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
  const [language, setLanguage] = useState("es");
  const [selection, setSelection] = useState<WordHit | null>(null);
  const [bookVocab, setBookVocab] = useState<BookVocabulary | null>(null);
  const [enriching, setEnriching] = useState<{ done: number; total: number } | null>(null);
  const [defsPending, setDefsPending] = useState(false);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [barsVisible, setBarsVisible] = useState(true);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings());
  const [seenStatus, setSeenStatus] = useState(statusText);

  if (seenStatus !== statusText) setSeenStatus(statusText);

  const releaseOverlay = () => {
    overlayRelease.current?.release();
    overlayRelease.current = null;
  };

  // Las capas del lector son mutuamente excluyentes: abrir una cierra
  // la anterior y reutiliza su entrada de historial cuando existe. Si
  // la entrada salió vía «atrás», el close deja el ref limpio para que
  // la siguiente capa empuje una entrada nueva.
  const openSelection = (hit: WordHit) => {
    const close = () => {
      overlayRelease.current = null;
      setSelection(null);
    };
    if (overlayRelease.current) overlayRelease.current.swap(close);
    else overlayRelease.current = pushOverlay(close);
    setSheet(null);
    setSelection(hit);
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

  const scrollRatioNow = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    return max > 0 ? clampNumber(window.scrollY / max, 0, 1) : 0;
  };

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

  const loadSection = useCallback(
    async (index: number, restoreRatio = 0) => {
      const book = bookRef.current;
      const section = book?.sections[index];
      const container = containerRef.current;
      if (!book || !section || !container) return;

      finalizeTiming(scrollRatioNow());
      setState("opening");
      setSelection(null);
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
        markSavedWords(sanitized, savedForms.current, getBookLanguage(book));
        const text = [...sanitized.childNodes]
          .map((node) => node.textContent ?? "")
          .join("\n");
        container.replaceChildren(sanitized);
        container.classList.remove("section-enter");
        void container.offsetWidth;
        container.classList.add("section-enter");

        const total = countWords(text);
        const tocLabel = tocRowsRef.current.find((row) => row.index === index)?.label;
        const first = sanitized.firstElementChild;
        const ownHeading = first ? /^H[1-6]$/i.test(first.tagName) : false;

        setSectionWords(total);
        setSectionIndex(index);
        setSectionTitle(tocLabel ?? `Sección ${index + 1}`);
        setShowChapterTitle(Boolean(tocLabel) && !ownHeading);
        setScrollRatio(restoreRatio);
        setState("ready");

        requestAnimationFrame(() => {
          const doc = document.documentElement;
          const max = doc.scrollHeight - window.innerHeight;
          window.scrollTo(0, restoreRatio * Math.max(0, max));
        });

        void saveBookPosition({
          bookHash,
          sectionIndex: index,
          scrollTop: 0,
          ratio: restoreRatio,
          updatedAt: Date.now(),
        });
        sectionTiming.current = { start: Date.now(), startRatio: restoreRatio, words: total };
      } catch {
        setState("error");
        onError("No pudimos abrir esta sección del libro.");
      }
    },
    [bookHash, finalizeTiming, onError],
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
        setSectionSizes(book.sections.map((section) => Math.max(0, section.size || 0)));

        const rows: TocRow[] = [];
        const walk = (items: EpubTocItem[], depth: number) => {
          for (const item of items) {
            const id = item.href?.split("#")[0];
            const index = book.sections.findIndex((section) => section.id === id);
            if (index >= 0) rows.push({ label: item.label?.trim() || `Sección ${index + 1}`, index, depth });
            if (item.subitems) walk(item.subitems, depth + 1);
          }
        };
        walk(book.toc ?? [], 0);
        tocRowsRef.current = rows;
        setTocRows(rows);

        const storedWpm = Number(await loadSessionValue(WPM_KEY));
        if (storedWpm >= 100 && storedWpm <= 600) setWpm(storedWpm);

        const saved = await loadBookPosition(bookHash);
        const startIndex = Math.min(saved?.sectionIndex ?? 0, book.sections.length - 1);
        const startRatio = saved?.sectionIndex === startIndex ? saved?.ratio ?? 0 : 0;
        await loadSection(startIndex, startRatio);
        if (!disposed && saved && startIndex > 0) {
          onStatus(`Volviste al capítulo ${startIndex + 1}.`);
        }

        // Va después del primer render y cede el hilo entre secciones
        // para que el análisis no compita con la lectura.
        void (async () => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const seen = new Set<string>();
          for (const bookSection of book.sections) {
            if (disposed) return;
            try {
              const doc = sanitizeSectionDocument(await bookSection.createDocument());
              const sectionText = [...doc.childNodes]
                .map((node) => node.textContent ?? "")
                .join("\n");
              const words = await extractUniqueWords(sectionText, bookLanguage);
              for (const word of words) {
                const form = word.toLowerCase();
                if (!isStopword(form, bookLanguage)) seen.add(form);
              }
            } catch {
              // sección omitida del análisis
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (disposed) return;
          const forms = [...seen].slice(0, 2000);
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
      releaseOverlay();
      finalizeTiming(scrollRatioNow());
      cleanup?.();
      window.clearTimeout(scrollTimer.current);
    };
    // tocRows se usa dentro de loadSection pero se calcula aquí; el
    // efecto corre una sola vez por libro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash, file]);

  // Cuando la sincronización trae palabras nuevas, remarcamos sin
  // remontar el lector (así no se pierde la posición).
  useEffect(() => {
    if (!language || state !== "ready") return;
    void listSavedWords(language).then((storedWords) => {
      savedForms.current = new Set(
        storedWords.flatMap((word) =>
          [word.form, word.lemma].filter((f): f is string => Boolean(f)).map((f) => f.toLowerCase()),
        ),
      );
      if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabVersion]);

  // Barras que se retiran al bajar y vuelven al subir, y guardado de
  // posición con la fracción leída de la sección.
  useEffect(() => {
    const onScroll = () => {
      if (rafPending.current) return;
      rafPending.current = true;
      requestAnimationFrame(() => {
        rafPending.current = false;
        const y = window.scrollY;
        const delta = y - lastScrollY.current;
        lastScrollY.current = y;
        if (y < 90 || delta < -4) setBarsVisible(true);
        else if (delta > 4 && y > 160) setBarsVisible(false);

        const ratio = scrollRatioNow();
        setScrollRatio(ratio);
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = window.setTimeout(() => {
          void saveBookPosition({
            bookHash,
            sectionIndex,
            scrollTop: window.scrollY,
            ratio,
            updatedAt: Date.now(),
          });
        }, 400);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(scrollTimer.current);
    };
  }, [bookHash, sectionIndex]);

  // ← / → cambian de sección cuando no hay hojas ni campos enfocados.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selection || sheet) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "ArrowLeft" && sectionIndex > 0) void loadSection(sectionIndex - 1);
      if (event.key === "ArrowRight" && sectionIndex + 1 < sectionTotal)
        void loadSection(sectionIndex + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selection, sheet, sectionIndex, sectionTotal, loadSection]);

  const onWordSaved = (word: SavedWord) => {
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.add(form.toLowerCase());
    }
    if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    onStatus(`«${word.form}» ya está en tu cuaderno.`);
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
    setBookVocab((vocab) => {
      if (vocab && !vocab.missing.length) setDefsPending(false);
      return vocab;
    });
  };

  const updateSettings = (patch: Partial<ReaderSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveReaderSettings(next);
      return next;
    });
  };

  const progress = bookProgress(sectionSizes, sectionIndex, scrollRatio);
  const minutes = minutesLeft(sectionWords, scrollRatio, wpm);
  const nextRow = tocRows.find((row) => row.index === sectionIndex + 1);
  const prevRow = tocRows.find((row) => row.index === sectionIndex - 1);

  return (
    <div
      className="reader"
      style={readerCssVars(settings) as CSSProperties}
      data-justify={settings.justify || undefined}
      data-dropcap={settings.dropCap || undefined}
    >
      <header className="reader-bar" data-hidden={!barsVisible || undefined}>
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
                onClick={() => void loadSection(sectionIndex, 0)}
              >
                Intentar de nuevo
              </button>
              <button type="button" className="btn--quiet" onClick={onBack}>
                Volver a la estantería
              </button>
            </div>
          </div>
        ) : null}
        {showChapterTitle ? <h1 className="chapter-title">{sectionTitle}</h1> : null}
        <div
          ref={containerRef}
          className="book-content"
          lang={language}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return;
            const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
            if (hit) openSelection(hit);
          }}
          aria-busy={state === "opening"}
          aria-label="Contenido de la sección"
        />
        <nav className="reader-end" aria-label="Navegación de secciones">
          {sectionIndex > 0 ? (
            <button
              type="button"
              className="reader-end-link"
              onClick={() => void loadSection(sectionIndex - 1)}
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
              onClick={() => void loadSection(sectionIndex + 1)}
            >
              Siguiente: {nextRow?.label ?? `Sección ${sectionIndex + 2}`} →
            </button>
          ) : (
            <span className="reader-end-done meta">Fin del libro</span>
          )}
        </nav>
      </div>

      <footer className="reader-foot" data-hidden={!barsVisible || undefined}>
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
          <span key={seenStatus} className="reader-status" role="status">
            {statusText}
          </span>
        </div>
      </footer>

      {sheet === "toc" ? (
        <Sheet label="Índice" onClose={closeSheet}>
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
              {tocRows.map((row, i) => (
                <li key={`${row.index}-${i}`} style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}>
                  <button
                    type="button"
                    className="toc-item"
                    data-current={row.index === sectionIndex || undefined}
                    onClick={() => {
                      closeSheet();
                      void loadSection(row.index);
                    }}
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">Este libro no trae índice.</p>
          )}
          {bookVocab ? (
            <button
              type="button"
              className="btn--quiet toc-vocab"
              onClick={() => setSheet("vocab")}
            >
              Palabras del libro · {bookVocab.known.length} con ficha
            </button>
          ) : state === "ready" ? (
            <p className="meta toc-vocab">Analizando el vocabulario del libro…</p>
          ) : null}
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
              <button
                type="button"
                className="theme-option"
                data-active={settings.font === "literata" || undefined}
                aria-pressed={settings.font === "literata"}
                onClick={() => updateSettings({ font: "literata" })}
              >
                Literata
              </button>
              <button
                type="button"
                className="theme-option"
                data-active={settings.font === "sans" || undefined}
                aria-pressed={settings.font === "sans"}
                onClick={() => updateSettings({ font: "sans" })}
              >
                Alegreya Sans
              </button>
            </div>
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
        </Sheet>
      ) : null}

      {sheet === "vocab" && bookVocab ? (
        <Sheet label="Palabras del libro" onClose={closeSheet}>
          <div className="sheet-head">
            <strong className="sheet-title">Palabras del libro</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar palabras del libro"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          <p className="meta">
            {bookVocab.known.length} con ficha · {bookVocab.missing.length} sin ficha ·{" "}
            {bookVocab.total} formas únicas
          </p>
          {bookVocab.known.length ? (
            <ul className="word-list">
              {bookVocab.known.slice(0, 60).map(({ form, entries }) => (
                <li key={form}>
                  <strong>{form}</strong>
                  {entries[0]?.pos ? <span className="meta"> {entries[0].pos}</span> : null}
                  {entries[0]?.senses[0]?.definition
                    ? ` — ${entries[0].senses[0].definition}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {defsPending && bookVocab.missing.length ? (
            <p className="meta">
              Las definiciones faltantes se siguen generando en segundo plano.
            </p>
          ) : null}
          {bookVocab.missing.length ? (
            <>
              <p className="meta">
                Sin ficha: {bookVocab.missing.slice(0, 40).join(", ")}
                {bookVocab.missing.length > 40 ? "…" : ""}
              </p>
              <button
                type="button"
                className="btn"
                disabled={Boolean(enriching)}
                onClick={() => void enrichMissing()}
              >
                {enriching
                  ? `Definiendo ${enriching.done} de ${enriching.total}…`
                  : `Definir ${Math.min(MAX_ENRICHED_PER_CLICK, bookVocab.missing.length)} con IA`}
              </button>
            </>
          ) : null}
        </Sheet>
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
        />
      ) : null}
    </div>
  );
}
