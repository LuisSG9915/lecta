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
  saveReadingInterval,
  loadSessionValue,
  saveSessionValue,
  type SavedWord,
  type SavedBookPosition,
  type SavedInterval,
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
  hasBookReaderSettings,
  clearBookReaderSettings,
  readerCssVars,
  READER_LIMITS,
  READER_FONTS,
  type ReaderSettings,
  type ThemeChoice,
} from "../lib/settings";
import {
  anchorAtViewTop,
  scrollToAnchor,
  scrollToSnippet,
} from "../lib/reading-location";
import { searchBookSections, type SearchHit } from "../lib/book-search";
import {
  listAnnotations,
  saveAnnotation,
  removeAnnotation,
  updateAnnotation,
  type SavedAnnotation,
} from "../lib/idb";
import { makeBookmark, makePassage } from "../lib/annotations";
import { applyPassageMarks } from "../lib/passage-marks";
import {
  pageLayout,
  pageAdvance,
  totalPages,
  anchorAtPage,
  pageForText,
  type PageLayout,
} from "../lib/pagination";
import { pushAnnotationsToServer, pushActivityToServer } from "../lib/reading-sync";
import { IDLE_MS, MIN_INTERVAL_MS, ROLL_MS } from "../lib/reading-activity";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import { savedFormLevels, type MarkLevel } from "../lib/word-level";
import WordPanel from "./WordPanel";
import Sheet from "./Sheet";
import ThemeMenu from "./ThemeMenu";

type ReaderState = "idle" | "opening" | "ready" | "error";
type SheetKind = "toc" | "settings" | "vocab" | "search" | "marks";

type ReaderProps = {
  bookHash: string;
  file: Blob;
  fileName: string;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onBack: () => void;
  onOpenNotebook: () => void;
  statusText: string;
  errorText: string;
  // Verdadero cuando un panel global (Cuaderno, Cuenta) está abierto
  // encima: las flechas del lector no deben responder detrás de él.
  panelsOpen: boolean;
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
  errorText,
  panelsOpen,
  theme,
  onThemeChange,
  vocabVersion,
}: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureProbeRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const scrollTimer = useRef<number | undefined>(undefined);
  const rafPending = useRef(false);
  const lastScrollY = useRef(0);
  const savedForms = useRef<Map<string, MarkLevel>>(new Map());
  const sectionTiming = useRef<{ start: number; startRatio: number; words: number } | null>(null);
  const overlayRelease = useRef<OverlayHandle | null>(null);
  const tocRowsRef = useRef<TocRow[]>([]);
  // Última posición capturada en vida: la usa el guardado al desmontar,
  // cuando el contenedor ya está fuera del DOM y no puede medirse.
  const latestPosition = useRef<SavedBookPosition | null>(null);
  // Última posición del puntero sobre el texto: la tecla D consulta la
  // palabra bajo el cursor sin necesidad de hacer clic.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  // Espejos en ref de los valores que cambian con cada página: así los
  // callbacks estables (guardado, teclado, restauración) no dependen
  // de re-render ni cierran sobre estado viejo.
  const layoutRef = useRef<"scroll" | "pages">("scroll");
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const metricsRef = useRef<PageLayout | null>(null);
  const sectionIndexRef = useRef(0);
  const pageAnchorRef = useRef<string | null>(null);
  // Destino pendiente de una carga de sección: lo resuelve el recuento
  // de páginas, que corre cuando los estilos de columna ya aplicaron.
  const pendingPageRef = useRef<{
    ratio?: number;
    anchor?: string;
    snippet?: string;
    at?: "end";
  } | null>(null);

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
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings(bookHash));
  const [bookOverride, setBookOverride] = useState(() => hasBookReaderSettings(bookHash));
  const [seenStatus, setSeenStatus] = useState(statusText);
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchDone, setSearchDone] = useState(true);
  const [returnPoint, setReturnPoint] = useState<{
    sectionIndex: number;
    ratio: number;
    anchor?: string;
  } | null>(null);
  const [selButton, setSelButton] = useState<{ x: number; y: number } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageMetrics, setPageMetrics] = useState<PageLayout | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  // Segmento de lectura abierto: empieza con la primera señal real y
  // termina donde quedó la última — el rato que sigue sin señales no
  // cuenta. `paused` lo cierran las hojas, los paneles y la pestaña
  // oculta: hojas/repaso/inactividad no son lectura.
  const activityRef = useRef<{ startedAt: number; lastActiveAt: number } | null>(null);
  const pausedRef = useRef(true);

  if (seenStatus !== statusText) setSeenStatus(statusText);

  const releaseOverlay = () => {
    overlayRelease.current?.release();
    overlayRelease.current = null;
  };

  // Cierra el segmento abierto y, si duró lo bastante, lo guarda como
  // intervalo inmutable. Termina en la última señal, no en «ahora»:
  // los segundos quietos antes de la pausa tampoco cuentan.
  const closeActivity = useCallback(() => {
    const seg = activityRef.current;
    activityRef.current = null;
    if (!seg) return;
    const endedAt = Math.min(seg.lastActiveAt, Date.now());
    if (endedAt - seg.startedAt < MIN_INTERVAL_MS) return;
    const interval: SavedInterval = {
      id: crypto.randomUUID(),
      bookHash,
      startedAt: seg.startedAt,
      endedAt,
    };
    void saveReadingInterval(interval).then(() =>
      pushActivityToServer([interval]),
    );
  }, [bookHash]);

  // Toda señal de lectura real pasa por aquí: scroll, cambio de página,
  // flechas, toques en el texto y consultas de palabra. Con hoja,
  // panel o pestaña oculta la señal se ignora.
  const noteActivity = useCallback(() => {
    if (pausedRef.current || document.hidden) return;
    const now = Date.now();
    const seg = activityRef.current;
    if (!seg) activityRef.current = { startedAt: now, lastActiveAt: now };
    else seg.lastActiveAt = now;
  }, []);

  // Las capas del lector son mutuamente excluyentes: abrir una cierra
  // la anterior y reutiliza su entrada de historial cuando existe. Si
  // la entrada salió vía «atrás», el close deja el ref limpio para que
  // la siguiente capa empuje una entrada nueva.
  const openSelection = (hit: WordHit) => {
    noteActivity();
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

  // Las pausas cierran el segmento en su última señal; al volver, la
  // siguiente señal abre uno nuevo sin arrastrar el tiempo de pausa.
  useEffect(() => {
    pausedRef.current = sheet !== null || panelsOpen || state !== "ready";
    if (pausedRef.current) closeActivity();
  }, [sheet, panelsOpen, state, closeActivity]);

  // Latido del segmento: si pasó el umbral sin señales cierra donde
  // quedó la última; si sigue vivo pero ya es largo lo «rueda» para
  // que una caída de la pestaña no se lleve la sesión entera.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const seg = activityRef.current;
      if (!seg) return;
      const now = Date.now();
      if (now - seg.lastActiveAt > IDLE_MS) {
        closeActivity();
        return;
      }
      if (now - seg.startedAt >= ROLL_MS) {
        const restartAt = seg.lastActiveAt;
        closeActivity();
        if (!pausedRef.current && !document.hidden) {
          activityRef.current = { startedAt: restartAt, lastActiveAt: restartAt };
        }
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [closeActivity]);

  const scrollRatioNow = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    return max > 0 ? clampNumber(window.scrollY / max, 0, 1) : 0;
  };

  const PAGE_GAP = 48;

  // La fracción leída en el modo actual: scroll vertical o página.
  const currentRatioNow = useCallback(() => {
    if (layoutRef.current === "pages") {
      const total = pageCountRef.current;
      return total > 1 ? pageRef.current / (total - 1) : 0;
    }
    return scrollRatioNow();
  }, []);

  // Posición actual completa según el modo de lectura. Lee refs, no
  // estado, para servir también desde callbacks estables (guardado al
  // ocultar, al desmontar, restauración tras pintar).
  const capturePosition = useCallback((): SavedBookPosition | null => {
    const container = containerRef.current;
    const book = bookRef.current;
    if (!container || !book) return null;
    const sizes = book.sections.map((s) => Math.max(0, s.size || 0));
    const index = sectionIndexRef.current;
    let ratio: number;
    let anchor: string | undefined;
    let scrollTop = 0;
    if (layoutRef.current === "pages") {
      const metrics = metricsRef.current;
      ratio = currentRatioNow();
      anchor = metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : undefined;
    } else {
      ratio = scrollRatioNow();
      anchor = anchorAtViewTop(container) ?? undefined;
      scrollTop = window.scrollY;
    }
    const pos: SavedBookPosition = {
      bookHash,
      sectionIndex: index,
      scrollTop,
      ratio,
      progress: bookProgress(sizes, index, ratio),
      anchor,
      updatedAt: Date.now(),
    };
    latestPosition.current = pos;
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash]);

  // Guardado con debounce: igual que al hacer scroll, también sirve al
  // pasar de página.
  const saveSoon = useCallback(() => {
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos);
    }, 400);
  }, [capturePosition]);

  // Mide la caja útil y reparte las columnas. La medida (ch) se toma
  // de una sonda real para respetar la fuente elegida. El recuento de
  // páginas NO va aquí: scrollWidth solo es válido después de que los
  // estilos de columna aplican, lo mide el efecto de pageMetrics.
  const computeMetrics = useCallback((): PageLayout | null => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container) return null;
    const availW = viewport.clientWidth;
    const measurePx =
      measureProbeRef.current?.getBoundingClientRect().width || 624;
    const one = settings.pageColumns === 1;
    const boxW = one ? Math.min(availW, measurePx) : availW;
    const metrics = pageLayout(boxW, one ? boxW : measurePx, PAGE_GAP);
    metricsRef.current = metrics;
    setPageMetrics(metrics);
    return metrics;
  }, [settings.pageColumns]);

  // anchor=false en aterrizajes de remeasure: el ancla rastreada solo
  // cambia por navegación real o restauración pendiente, nunca por un
  // aterrizaje intermedio con métricas aún falsas.
  const setPageIdx = useCallback((next: number, updateAnchor = true) => {
    const clamped = Math.max(0, Math.min(pageCountRef.current - 1, next));
    pageRef.current = clamped;
    setPage(clamped);
    // El rectángulo de la selección queda viejo al mover la página:
    // el botón «Guardar pasaje» no debe flotar fuera de lugar.
    setSelButton(null);
    const metrics = metricsRef.current;
    const container = containerRef.current;
    if (updateAnchor && metrics && container)
      pageAnchorRef.current = anchorAtPage(container, metrics, clamped);
  }, []);

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
    async (
      index: number,
      restore: { ratio?: number; anchor?: string; snippet?: string; at?: "end" } = {},
    ) => {
      const book = bookRef.current;
      const section = book?.sections[index];
      const container = containerRef.current;
      if (!book || !section || !container) return;

      finalizeTiming(currentRatioNow());
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

        // Estado de paginación de la sección anterior fuera: sin el
        // reinicio, un recuento puede aterrizar en la página vieja.
        pageRef.current = 0;
        pageCountRef.current = 1;
        pageAnchorRef.current = null;
        setPage(0);
        setPageCount(1);

        const total = countWords(text);
        const tocLabel = tocRowsRef.current.find((row) => row.index === index)?.label;
        const first = sanitized.firstElementChild;
        const ownHeading = first ? /^H[1-6]$/i.test(first.tagName) : false;

        setSectionWords(total);
        setSectionIndex(index);
        sectionIndexRef.current = index;
        setSectionTitle(tocLabel ?? `Sección ${index + 1}`);
        setShowChapterTitle(Boolean(tocLabel) && !ownHeading);
        setScrollRatio(restore.ratio ?? 0);
        setState("ready");

        // En pestaña oculta el rAF no corre: el fallback con timer
        // evita que la restauración y el guardado queden muertos.
        const paint = (cb: () => void) =>
          document.hidden ? window.setTimeout(cb, 50) : requestAnimationFrame(cb);
        paint(() => {
          if (layoutRef.current === "pages") {
            // En modo paginado la medida decide las columnas; el
            // destino exacto lo resuelve el recuento, cuando ya hay
            // estilos de columna aplicados y scrollWidth es real.
            computeMetrics();
            pendingPageRef.current = restore;
          } else {
            const doc = document.documentElement;
            const max = doc.scrollHeight - window.innerHeight;
            // Primero el ancla de texto (exacta aunque cambie la letra);
            // si no está en esta sección, la fracción guardada.
            const anchored = restore.snippet
              ? scrollToSnippet(container, restore.snippet)
              : restore.anchor
                ? scrollToAnchor(container, restore.anchor)
                : false;
            if (anchored) {
              // listo
            } else if (restore.at === "end") window.scrollTo(0, Math.max(0, max));
            else window.scrollTo(0, (restore.ratio ?? 0) * Math.max(0, max));
          }
          sectionTiming.current = {
            start: Date.now(),
            startRatio: currentRatioNow(),
            words: total,
          };
          // Guardar después de restaurar: el ancla debe describir el
          // bloque que efectivamente quedó visible.
          const pos = capturePosition();
          if (pos) void saveBookPosition(pos);
        });
      } catch {
        setState("error");
        onError("No pudimos abrir esta sección del libro.");
      }
    },
    [finalizeTiming, onError, computeMetrics, capturePosition, currentRatioNow],
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
        savedForms.current = savedFormLevels(storedWords);
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
        const startAnchor = saved?.sectionIndex === startIndex ? saved?.anchor : undefined;
        await loadSection(startIndex, { ratio: startRatio, anchor: startAnchor });
        if (!disposed) {
          onStatus(saved && startIndex > 0 ? `Volviste al capítulo ${startIndex + 1}.` : "");
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
      finalizeTiming(currentRatioNow());
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
      savedForms.current = savedFormLevels(storedWords);
      if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabVersion]);

  // Marcadores y pasajes del libro (una sola lectura por apertura).
  useEffect(() => {
    void listAnnotations(bookHash).then(setAnnotations);
  }, [bookHash]);

  // Marcas de pasajes guardados en la sección actual. Va después del
  // efecto de remarcar vocabulario: el fallback envuelve nodos vivos.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || state !== "ready") return;
    applyPassageMarks(
      container,
      annotations.filter((a) => a.kind === "passage" && a.sectionIndex === sectionIndex),
    );
  }, [annotations, sectionIndex, state, vocabVersion]);

  // Búsqueda progresiva dentro del libro: entrega resultados conforme
  // avanza, se cancela al cambiar la consulta o cerrar la hoja.
  useEffect(() => {
    searchAbort.current?.abort();
    const query = searchQ.trim();
    if (query.length < 2 || !bookRef.current) return;
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    const timer = window.setTimeout(() => {
      void (async () => {
        const book = bookRef.current;
        if (!book) return;
        setSearchHits([]);
        setSearchDone(false);
        for await (const hit of searchBookSections(
          book.sections,
          tocRowsRef.current,
          query,
          { signal: ctrl.signal, limit: 100 },
        )) {
          setSearchHits((prev) => [...prev, hit]);
        }
        if (!ctrl.signal.aborted) setSearchDone(true);
      })();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [searchQ]);

  // Botón flotante «Guardar pasaje» sobre la selección del usuario.
  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      const sel = window.getSelection();
      const container = containerRef.current;
      if (!sel || sel.isCollapsed || !container || !sel.rangeCount) {
        setSelButton(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelButton(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelButton(null);
        return;
      }
      setSelButton({ x: rect.left + rect.width / 2, y: rect.top });
    };
    const onSelection = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
    const hide = () => setSelButton(null);
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", hide);
      window.clearTimeout(timer);
    };
  }, []);

  // Barras que se retiran al bajar y vuelven al subir, y guardado de
  // posición con la fracción leída de la sección. En modo paginado el
  // documento no hace scroll, pero el guardado por ocultar sigue vivo.
  useEffect(() => {
    const onScroll = () => {
      noteActivity();
      saveSoon();
      if (rafPending.current) return;
      rafPending.current = true;
      const paint = document.hidden
        ? (cb: FrameRequestCallback) => window.setTimeout(cb, 50)
        : requestAnimationFrame;
      paint(() => {
        rafPending.current = false;
        const y = window.scrollY;
        const delta = y - lastScrollY.current;
        lastScrollY.current = y;
        if (y < 90 || delta < -4) setBarsVisible(true);
        else if (delta > 4 && y > 160) setBarsVisible(false);
        setScrollRatio(scrollRatioNow());
      });
    };
    // Al salir de la página no hay debounce que esperar: guardar ya.
    const onHide = () => {
      if (document.visibilityState === "hidden") closeActivity();
      if (document.visibilityState !== "hidden") return;
      const pos = capturePosition();
      if (pos) void saveBookPosition(pos);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(scrollTimer.current);
    };
  }, [saveSoon, capturePosition, closeActivity, noteActivity]);

  // Recomponer la paginación conservando el ancla: al cambiar modo,
  // columnas, fuente, tamaño, sección — y cuando la ventana o las
  // fuentes terminan de cargar (ResizeObserver + document.fonts.ready).
  // Solo reparte columnas: el recuento y el ancla los resuelve el
  // efecto de pageMetrics, con los estilos de columna ya aplicados.
  const remeasure = useCallback(() => {
    if (layoutRef.current !== "pages") return;
    computeMetrics();
  }, [computeMetrics]);

  // Recuento real de páginas: corre tras el pintado de las columnas
  // (doble rAF; scrollWidth a medio reflujo da conteos fantasma). Con
  // pestaña oculta el rAF no corre y se usa el mismo fallback por
  // timer que en la carga de sección.
  useEffect(() => {
    const metrics = pageMetrics;
    if (!metrics || layoutRef.current !== "pages") return;
    let live = true;
    const run = () => {
      if (!live || layoutRef.current !== "pages") return;
      const container = containerRef.current;
      if (!container) return;
      const total = totalPages(container.scrollWidth, metrics);
      pageCountRef.current = total;
      setPageCount(total);
      const pending = pendingPageRef.current;
      pendingPageRef.current = null;
      let next = pageRef.current;
      let intent = false;
      if (pending) {
        intent = true;
        if (pending.snippet)
          next = pageForText(container, pending.snippet, metrics, "snippet") ?? 0;
        else if (pending.anchor)
          next = pageForText(container, pending.anchor, metrics, "anchor") ?? 0;
        else if (pending.at === "end") next = total - 1;
        else if (pending.ratio) next = Math.round(pending.ratio * (total - 1));
        else next = 0;
      } else if (pageAnchorRef.current) {
        next =
          pageForText(container, pageAnchorRef.current, metrics, "anchor", false) ??
          pageRef.current;
      }
      setPageIdx(Math.min(next, total - 1), intent);
    };
    const handle = document.hidden
      ? window.setTimeout(run, 60)
      : requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      live = false;
      if (document.hidden) window.clearTimeout(handle);
      else cancelAnimationFrame(handle);
    };
  }, [pageMetrics, setPageIdx]);

  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    remeasure();
  }, [settings.layout, settings.pageColumns, settings.size, settings.font, settings.measure, state, sectionIndex, remeasure]);

  // Al cambiar el modo (scroll↔páginas) o lo que refluye el texto
  // (fuente, tamaño, medida, interlineado), el ancla devuelve al mismo
  // punto: página nueva en paginado, scroll restaurado en continuo.
  // `layoutRef` todavía guarda el modo anterior dentro de este efecto
  // (su espejo corre después): así se distingue la transición de un
  // refluje dentro del mismo modo.
  useEffect(() => {
    if (state !== "ready") return;
    const wasPages = layoutRef.current === "pages";
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      const saved = latestPosition.current;
      if (!container) return;
      if (settings.layout === "scroll") {
        if (saved?.anchor) {
          const scrolled = scrollToAnchor(container, saved.anchor);
          if (!scrolled) {
            const ratio = saved?.ratio ?? 0;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, ratio * Math.max(0, max));
          }
        }
      } else {
        // Venir del scroll: el ancla visible manda sobre la página
        // recordada; dentro del modo ya manda pageAnchorRef.
        if (!wasPages && saved?.anchor) pageAnchorRef.current = saved.anchor;
        remeasure();
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layout, settings.font, settings.size, settings.measure, settings.leading, state]);

  useEffect(() => {
    if (settings.layout !== "pages" || state !== "ready") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(remeasure, 120);
    });
    observer.observe(viewport);
    void document.fonts?.ready.then(remeasure);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [settings.layout, state, sectionIndex, remeasure]);

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso).
  const goPage = useCallback(
    (delta: number) => {
      noteActivity();
      const next = pageRef.current + delta;
      if (next < 0) {
        if (sectionIndexRef.current > 0)
          void loadSection(sectionIndexRef.current - 1, { at: "end" });
        return;
      }
      if (next >= pageCountRef.current) {
        if (sectionIndexRef.current + 1 < sectionTotal)
          void loadSection(sectionIndexRef.current + 1);
        return;
      }
      setPageIdx(next);
      saveSoon();
    },
    [loadSection, saveSoon, sectionTotal, setPageIdx, noteActivity],
  );

  // Espejo del modo para callbacks estables (guardado, teclado,
  // restauración): leen refs, no estado que cierra viejo.
  useEffect(() => {
    layoutRef.current = settings.layout;
  }, [settings.layout]);

  // Referencia fresca para el guardado al desmontar: si el lector se
  // cierra sin más scroll (ajustó la letra y salió, sección corta), el
  // debounce pudo no correr y la posición quedaría vieja. Al desmontar el
  // contenedor ya está desconectado del DOM (los rectángulos dan 0), así
  // que se escribe la última posición capturada en vida, no una nueva.
  // `ready` evita guardar el estado inicial: en StrictMode el cleanup
  // corre una vez al montar y pisaría la posición guardada.
  const latest = useRef({ ready: state === "ready" });
  useEffect(() => {
    latest.current = { ready: state === "ready" };
  });
  useEffect(() => {
    return () => {
      closeActivity();
      if (!latest.current.ready) return;
      const pos = latestPosition.current;
      if (!pos) return;
      void saveBookPosition({ ...pos, updatedAt: Date.now() });
    };
  }, [bookHash, closeActivity]);

  // ← / → cambian de sección cuando no hay hojas, paneles ni campos
  // enfocados. Tab siempre trae las barras de vuelta.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") setBarsVisible(true);
      if (selection || sheet || panelsOpen) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") noteActivity();
      if (event.key === "ArrowLeft") {
        if (layoutRef.current === "pages") goPage(-1);
        else if (sectionIndex > 0) void loadSection(sectionIndex - 1);
      }
      if (event.key === "ArrowRight") {
        if (layoutRef.current === "pages") goPage(1);
        else if (sectionIndex + 1 < sectionTotal) void loadSection(sectionIndex + 1);
      }
      if (
        (event.key === "d" || event.key === "D") &&
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        lastPoint.current &&
        containerRef.current
      ) {
        const hit = extractWordAtPoint(
          lastPoint.current.x,
          lastPoint.current.y,
          containerRef.current,
          language,
        );
        if (hit) openSelection(hit);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, sheet, panelsOpen, sectionIndex, sectionTotal, loadSection, goPage, noteActivity]);

  const onWordSaved = (word: SavedWord) => {
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.set(form.toLowerCase(), "new");
    }
    if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    onStatus(`«${word.form}» ya está en tu cuaderno.`);
  };

  const onWordRemoved = (word: SavedWord) => {
    for (const form of [word.form, word.lemma]) {
      if (form) savedForms.current.delete(form.toLowerCase());
    }
    if (containerRef.current) markSavedWords(containerRef.current, savedForms.current, language);
    onStatus(`«${word.form}» se quitó del cuaderno.`);
  };

  // Saltos desde hojas (índice, búsqueda, marcadores): guardan el punto
  // de partida para «Volver a donde estaba».
  const jumpTo = (index: number, locate?: { anchor?: string; snippet?: string }) => {
    const pos = latestPosition.current;
    if (pos) {
      setReturnPoint({
        sectionIndex: pos.sectionIndex,
        ratio: pos.ratio ?? 0,
        anchor: pos.anchor,
      });
    }
    closeSheet();
    void loadSection(index, { anchor: locate?.anchor, snippet: locate?.snippet });
  };

  const goBack = () => {
    const point = returnPoint;
    setReturnPoint(null);
    if (point)
      void loadSection(point.sectionIndex, {
        ratio: point.ratio,
        anchor: point.anchor,
      });
  };

  const refreshAnnotations = async () => {
    setAnnotations(await listAnnotations(bookHash));
  };

  const pushAnnotation = (entry: SavedAnnotation) => {
    setAnnotations((prev) => [...prev.filter((a) => a.key !== entry.key), entry]);
    void pushAnnotationsToServer([entry]);
  };

  const bookmark = annotations.find((a) => a.kind === "bookmark");

  const saveBookmarkHere = async () => {
    const container = containerRef.current;
    const metrics = metricsRef.current;
    const anchor = container
      ? layoutRef.current === "pages" && metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : (anchorAtViewTop(container) ?? undefined)
      : undefined;
    pushAnnotation(await saveAnnotation(makeBookmark(bookHash, sectionIndex, anchor)));
    onStatus("Marcador guardado en este lugar.");
  };

  const removeMark = async (key: string) => {
    const tombstone = await removeAnnotation(key);
    if (tombstone) void pushAnnotationsToServer([tombstone]);
    await refreshAnnotations();
    onStatus("Marcado eliminado.");
  };

  const saveNote = async (annotation: SavedAnnotation) => {
    const updated = await updateAnnotation({
      ...annotation,
      note: noteDraft.trim() || undefined,
    });
    pushAnnotation(updated);
    setEditingNote(null);
  };

  // La selección del usuario se convierte en pasaje con su contexto
  // para reubicarlo aunque cambie la letra o el ancho.
  const savePassageSelection = async () => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.isCollapsed || !container || !sel.rangeCount) {
      setSelButton(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelButton(null);
      return;
    }
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);
    const input = makePassage(
      bookHash,
      sectionIndex,
      sel.toString(),
      before.toString(),
      after.toString(),
    );
    sel.removeAllRanges();
    setSelButton(null);
    if (!input) return;
    pushAnnotation(await saveAnnotation(input));
    onStatus("Pasaje guardado en Marcadores.");
  };

  const sectionLabel = (index: number) =>
    tocRows.find((row) => row.index === index)?.label ?? `Sección ${index + 1}`;

  const passages = annotations.filter((a) => a.kind === "passage");

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
      saveReaderSettings(next, bookHash);
      setBookOverride(true);
      return next;
    });
  };

  // El libro vuelve a heredar los ajustes generales del lector.
  const useGlobalSettings = () => {
    clearBookReaderSettings(bookHash);
    setSettings(loadReaderSettings());
    setBookOverride(false);
  };

  // En modo paginado el documento no hace scroll: sin scroll-up no hay
  // forma de recuperar barras ocultas, así que siempre se muestran.
  const barsShown = barsVisible || settings.layout === "pages";

  const viewRatio =
    settings.layout === "pages"
      ? pageCount > 1
        ? page / (pageCount - 1)
        : 0
      : scrollRatio;
  const progress = bookProgress(sectionSizes, sectionIndex, viewRatio);
  const minutes = minutesLeft(sectionWords, viewRatio, wpm);
  const nextRow = tocRows.find((row) => row.index === sectionIndex + 1);
  const prevRow = tocRows.find((row) => row.index === sectionIndex - 1);

  return (
    <div
      className="reader"
      style={readerCssVars(settings) as CSSProperties}
      data-justify={settings.justify || undefined}
      data-dropcap={settings.dropCap || undefined}
      data-layout={settings.layout === "pages" ? "pages" : undefined}
    >
      <div
        ref={measureProbeRef}
        aria-hidden="true"
        className="measure-probe"
      />
      <header className="reader-bar" data-hidden={!barsShown || undefined}>
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
            onClick={() => openSheet("search")}
            aria-label="Buscar en el libro"
          >
            Buscar
          </button>
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
                onClick={() => void loadSection(sectionIndex, { ratio: 0 })}
              >
                Intentar de nuevo
              </button>
              <button type="button" className="btn--quiet" onClick={onBack}>
                Volver a la estantería
              </button>
            </div>
          </div>
        ) : null}
        {state === "ready" && sectionWords === 0 ? (
          <p className="reader-empty meta">
            Esta sección no tiene texto legible (puede ser una portada o una imagen).
          </p>
        ) : null}
        {showChapterTitle ? <h1 className="chapter-title">{sectionTitle}</h1> : null}
        <div className="page-viewport" ref={viewportRef}>
          <div
            ref={containerRef}
            className="book-content"
            style={
              settings.layout === "pages" && pageMetrics
                ? ({
                    inlineSize: `${pageMetrics.boxW}px`,
                    blockSize: "100%",
                    columnWidth: `${pageMetrics.colW}px`,
                    columnGap: `${pageMetrics.gap}px`,
                    columnFill: "auto",
                    transform: `translateX(${-page * pageAdvance(pageMetrics.boxW, pageMetrics.gap)}px)`,
                  } as CSSProperties)
                : undefined
            }
            lang={language}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return;
            // Los enlaces internos del EPUB (notas al pie, índice)
            // apuntan a rutas que no existen en la app: no navegar.
            if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
            if (hit) openSelection(hit);
            // Tocar el texto fuera de una palabra también trae las
            // barras de vuelta, como en los lectores de libro físico.
            else setBarsVisible(true);
          }}
          onPointerMove={(event) => {
            lastPoint.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerDown={noteActivity}
          aria-busy={state === "opening"}
          aria-label="Contenido de la sección"
        />
        </div>
        {settings.layout === "pages" ? (
          <nav className="page-nav" aria-label="Navegación de páginas">
            <button
              type="button"
              className="reader-end-link"
              disabled={sectionIndex === 0 && page === 0}
              onClick={() => goPage(-1)}
            >
              ← Anterior
            </button>
            <span className="page-nav-count meta" aria-live="polite">
              {pageCount ? `Página ${page + 1} de ${pageCount}` : ""}
            </span>
            <button
              type="button"
              className="reader-end-link"
              disabled={sectionIndex + 1 >= sectionTotal && page + 1 >= pageCount}
              onClick={() => goPage(1)}
            >
              Siguiente →
            </button>
          </nav>
        ) : (
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
        )}
      </div>

      <footer className="reader-foot" data-hidden={!barsShown || undefined}>
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
          {errorText ? (
            <span className="reader-error-text" role="alert">
              {errorText}
            </span>
          ) : null}
          <span key={seenStatus} className="reader-status" role="status">
            {statusText}
          </span>
        </div>
      </footer>

      {sheet === "toc" ? (
        <Sheet label="Índice" onClose={closeSheet} side="left">
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
                    aria-current={row.index === sectionIndex ? "location" : undefined}
                    onClick={() => jumpTo(row.index)}
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
          <button
            type="button"
            className="btn--quiet toc-vocab"
            onClick={() => setSheet("marks")}
          >
            Marcadores y pasajes
            {annotations.length ? ` · ${annotations.length}` : ""}
          </button>
        </Sheet>
      ) : null}

      {sheet === "search" ? (
        <Sheet label="Buscar en el libro" onClose={closeSheet} side="left">
          <div className="sheet-head">
            <strong className="sheet-title">Buscar en el libro</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar búsqueda"
            >
              Cerrar
            </button>
          </div>
          <input
            className="search-input"
            type="search"
            placeholder="Palabra o frase…"
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
            aria-label="Texto a buscar en el libro"
            data-autofocus
          />
          {searchQ.trim().length >= 2 ? (
            <p className="meta search-status" role="status">
              {searchDone
                ? searchHits.length
                  ? `${searchHits.length} resultado(s)${searchHits.length >= 100 ? " (primeros 100)" : ""}`
                  : "Sin resultados."
                : `Buscando… ${searchHits.length ? `${searchHits.length} hasta ahora` : ""}`}
            </p>
          ) : (
            <p className="meta search-status">
              Escribe al menos 2 letras. Los acentos y las mayúsculas no importan.
            </p>
          )}
          {searchHits.length ? (
            <ul className="search-results">
              {searchHits.map((hit, index) => (
                <li key={`${hit.sectionIndex}-${index}`}>
                  <button
                    type="button"
                    className="search-hit"
                    onClick={() => jumpTo(hit.sectionIndex, { snippet: hit.anchor })}
                  >
                    <span className="search-hit-label">{hit.label}</span>
                    <span className="search-hit-context">
                      {hit.before}
                      <mark>{hit.match}</mark>
                      {hit.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === "marks" ? (
        <Sheet label="Marcadores y pasajes" onClose={closeSheet} side="left">
          <div className="sheet-head">
            <strong className="sheet-title">Marcadores</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={closeSheet}
              aria-label="Cerrar marcadores"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
          {bookmark ? (
            <div className="mark-bookmark">
              <p>
                Marcador en <strong>{sectionLabel(bookmark.sectionIndex)}</strong>
              </p>
              <div className="mark-actions">
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => jumpTo(bookmark.sectionIndex, { anchor: bookmark.anchor })}
                >
                  Ir al marcador
                </button>
                <button
                  type="button"
                  className="btn--quiet mark-remove"
                  onClick={() => void removeMark(bookmark.key)}
                >
                  Quitar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => void saveBookmarkHere()}>
              Guardar este lugar
            </button>
          )}
          <h3 className="sheet-subtitle">Pasajes guardados</h3>
          {passages.length ? (
            <ul className="marks-list">
              {passages.map((passage) => (
                <li key={passage.key} className="mark-item">
                  <button
                    type="button"
                    className="mark-jump"
                    onClick={() =>
                      jumpTo(passage.sectionIndex, {
                        snippet: passage.anchor ?? passage.text ?? "",
                      })
                    }
                  >
                    <span className="search-hit-label">
                      {sectionLabel(passage.sectionIndex)}
                    </span>
                    <q className="mark-text">
                      {passage.text && passage.text.length > 140
                        ? `${passage.text.slice(0, 140)}…`
                        : passage.text}
                    </q>
                  </button>
                  {passage.note ? <p className="mark-note">{passage.note}</p> : null}
                  {editingNote === passage.key ? (
                    <div className="mark-note-edit">
                      <textarea
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="Una nota sobre este pasaje…"
                        aria-label="Nota del pasaje"
                      />
                      <div className="mark-actions">
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => void saveNote(passage)}
                        >
                          Guardar nota
                        </button>
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => setEditingNote(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mark-actions">
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => {
                          setEditingNote(passage.key);
                          setNoteDraft(passage.note ?? "");
                        }}
                      >
                        {passage.note ? "Editar nota" : "Nota"}
                      </button>
                      <button
                        type="button"
                        className="btn--quiet mark-remove"
                        onClick={() => void removeMark(passage.key)}
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">
              Selecciona un fragmento del texto para guardarlo como pasaje.
            </p>
          )}
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
              {READER_FONTS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className="theme-option"
                  data-active={settings.font === id || undefined}
                  aria-pressed={settings.font === id}
                  onClick={() => updateSettings({ font: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {bookOverride ? (
            <div className="setting-row">
              <span className="setting-label">Este libro tiene ajustes propios</span>
              <button
                type="button"
                className="btn--quiet"
                onClick={useGlobalSettings}
              >
                Usar mis ajustes generales
              </button>
            </div>
          ) : null}
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
            <span className="setting-label">Modo</span>
            <div className="theme-menu" role="group" aria-label="Modo de lectura">
              {(
                [
                  ["scroll", "Desplazamiento"],
                  ["pages", "Páginas"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="theme-option"
                  data-active={settings.layout === value || undefined}
                  aria-pressed={settings.layout === value}
                  onClick={() => updateSettings({ layout: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {settings.layout === "pages" ? (
            <>
              <div className="setting-row">
                <span className="setting-label">Columnas</span>
                <div className="theme-menu" role="group" aria-label="Columnas por página">
                  {(
                    [
                      [1, "Una"],
                      [2, "Dos"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="theme-option"
                      data-active={settings.pageColumns === value || undefined}
                      aria-pressed={settings.pageColumns === value}
                      onClick={() => updateSettings({ pageColumns: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="meta">
                Las flechas ← → pasan página. Si algo se corta, vuelve a
                Desplazamiento sin perder tu lugar.
              </p>
            </>
          ) : null}
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
          <p className="meta">Pista: con el cursor sobre una palabra, pulsa D para abrir su ficha. Con Tab vuelven las barras.</p>
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

      {returnPoint ? (
        <div className="reader-return">
          <button
            type="button"
            className="reader-return-btn"
            onClick={goBack}
          >
            ‹ Volver a donde estaba
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={() => setReturnPoint(null)}
            aria-label="Descartar regreso"
          >
            ×
          </button>
        </div>
      ) : null}

      {selButton ? (
        <button
          type="button"
          className="selection-save"
          style={{ left: selButton.x, top: selButton.y }}
          // Evita que el botón robe el foco y borre la selección antes
          // de leerla.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void savePassageSelection()}
        >
          Guardar pasaje
        </button>
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
          onRemoved={onWordRemoved}
        />
      ) : null}
    </div>
  );
}
