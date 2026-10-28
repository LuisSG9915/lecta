import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { EpubBook } from "../lib/epub";
import type { ChapterTarget } from "../lib/chapters";
import type { PageLayout } from "../lib/pagination";
import { anchorAtPage } from "../lib/pagination";
import { anchorAtViewTop } from "../lib/reading-location";
import { searchBookSections, type SearchHit } from "../lib/book-search";
import {
  listAnnotations,
  saveAnnotation,
  removeAnnotation,
  updateAnnotation,
  type SavedAnnotation,
  type DbScope,
} from "../lib/idb";
import { makeBookmark, makePassage, type PassageTone } from "../lib/annotations";
import { applyPassageMarks } from "../lib/passage-marks";
import { pushAnnotationsToServer } from "../lib/reading-sync";
import { explainInPassage, lookupWord, lookupWordInMemory } from "../lib/lexicon";
import { recordBookConsultedWord } from "../lib/book-glossary";
import type { CatPassageExplanationState } from "../components/reader/ReaderOverlays";

export type { CatPassageExplanationState };

export interface QuoteCardState {
  text: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  alreadySaved?: boolean;
}

export interface UseReaderAnnotationsAndSearchOptions {
  bookHash: string;
  sectionIndex: number;
  state: string;
  vocabVersion: number;
  prediction: unknown;
  bookRef: MutableRefObject<EpubBook | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  metricsRef: MutableRefObject<PageLayout | null>;
  layoutRef: MutableRefObject<"scroll" | "pages">;
  pageRef: MutableRefObject<number>;
  tocRows: { label: string; index: number }[];
  tocRowsRef: MutableRefObject<{ label: string; index: number }[]>;
  currentChapterTarget: ChapterTarget | null;
  sectionTitle?: string;
  title: string;
  author: string;
  language: string;
  signedIn: boolean;
  captureDbScope: () => DbScope;
  onStatus: (msg: string) => void;
  setSelButton: (val: null) => void;
}

export function useReaderAnnotationsAndSearch({
  bookHash,
  sectionIndex,
  state,
  vocabVersion,
  prediction,
  bookRef,
  containerRef,
  metricsRef,
  layoutRef,
  pageRef,
  tocRows,
  tocRowsRef,
  currentChapterTarget,
  sectionTitle,
  title,
  author,
  language,
  signedIn,
  captureDbScope,
  onStatus,
  setSelButton,
}: UseReaderAnnotationsAndSearchOptions) {
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchDone, setSearchDone] = useState(true);
  const searchAbort = useRef<AbortController | null>(null);

  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [quoteCard, setQuoteCard] = useState<QuoteCardState | null>(null);
  const [catPassageExplanation, setCatPassageExplanation] = useState<CatPassageExplanationState | null>(null);

  const sectionLabel = useCallback(
    (index: number) =>
      tocRows.find((row) => row.index === index)?.label ?? `Sección ${index + 1}`,
    [tocRows],
  );

  const refreshAnnotations = useCallback(
    async (scope?: DbScope) => {
      setAnnotations(await listAnnotations(bookHash, scope ?? captureDbScope()));
    },
    [bookHash, captureDbScope],
  );

  const pushAnnotation = useCallback(
    (entry: SavedAnnotation, scope?: DbScope) => {
      const bound = scope ?? captureDbScope();
      setAnnotations((prev) => [...prev.filter((a) => a.key !== entry.key), entry]);
      void pushAnnotationsToServer([entry], bound);
    },
    [captureDbScope],
  );

  // Carga inicial de anotaciones del libro
  useEffect(() => {
    void listAnnotations(bookHash, captureDbScope()).then(setAnnotations);
  }, [bookHash, captureDbScope]);

  // Aplicar marcas de pasajes resaltados en el DOM del contenedor de lectura
  useEffect(() => {
    const container = containerRef.current;
    if (!container || state !== "ready") return;
    applyPassageMarks(
      container,
      annotations.filter((a) => a.kind === "passage" && a.sectionIndex === sectionIndex),
    );
  }, [containerRef, annotations, sectionIndex, state, vocabVersion, prediction]);

  // Búsqueda progresiva dentro del libro con debouncing y cancelación automática
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
  }, [searchQ, bookRef, tocRowsRef]);

  const bookmark = annotations.find((a) => a.kind === "bookmark");
  const passages = annotations.filter((a) => a.kind === "passage");

  const saveBookmarkHere = useCallback(async () => {
    const container = containerRef.current;
    const metrics = metricsRef.current;
    const anchor = container
      ? layoutRef.current === "pages" && metrics
        ? (anchorAtPage(container, metrics, pageRef.current) ?? undefined)
        : (anchorAtViewTop(container) ?? undefined)
      : undefined;
    const scope = captureDbScope();
    pushAnnotation(
      await saveAnnotation(makeBookmark(bookHash, sectionIndex, anchor), scope),
      scope,
    );
    onStatus("Marcador guardado en este lugar.");
  }, [containerRef, metricsRef, layoutRef, pageRef, captureDbScope, pushAnnotation, bookHash, sectionIndex, onStatus]);

  const removeMark = useCallback(
    async (key: string) => {
      const scope = captureDbScope();
      const tombstone = await removeAnnotation(key, scope);
      if (tombstone) void pushAnnotationsToServer([tombstone], scope);
      await refreshAnnotations(scope);
      onStatus("Marcado eliminado.");
    },
    [captureDbScope, refreshAnnotations, onStatus],
  );

  const saveNote = useCallback(
    async (annotation: SavedAnnotation) => {
      const scope = captureDbScope();
      const updated = await updateAnnotation(
        {
          ...annotation,
          note: noteDraft.trim() || undefined,
        },
        scope,
      );
      pushAnnotation(updated, scope);
      setEditingNote(null);
    },
    [captureDbScope, noteDraft, pushAnnotation],
  );

  const savePassageSelection = useCallback(
    async (color: PassageTone = "amber") => {
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
        color,
      );
      sel.removeAllRanges();
      setSelButton(null);
      if (!input) return;
      const scope = captureDbScope();
      pushAnnotation(await saveAnnotation(input, scope), scope);
      const toneName = color === "salvia" ? "Salvia" : color === "dario" ? "Azul Darío" : "Ámbar";
      onStatus(`Pasaje resaltado con tinta (${toneName}).`);
    },
    [containerRef, bookHash, sectionIndex, setSelButton, captureDbScope, pushAnnotation, onStatus],
  );

  const openQuoteCardFromSelection = useCallback(() => {
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || !sel.rangeCount) {
      setSelButton(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2) {
      setSelButton(null);
      return;
    }
    setQuoteCard({
      text,
      bookTitle: title,
      author,
      chapterTitle: currentChapterTarget?.label ?? sectionTitle ?? sectionLabel(sectionIndex),
      alreadySaved: false,
    });
    setSelButton(null);
  }, [containerRef, title, author, currentChapterTarget, sectionTitle, sectionLabel, sectionIndex, setSelButton]);

  const askCatAboutSelection = useCallback(
    async (param?: string | { word?: string; passage: string; bookId?: string }) => {
      let text = "";
      let word: string | undefined;
      let targetBookId = bookHash;

      if (typeof param === "object" && param !== null) {
        text = (param.passage || "").replace(/\s+/g, " ").trim();
        word = param.word?.trim();
        if (param.bookId) targetBookId = param.bookId;
      } else if (typeof param === "string") {
        text = param.replace(/\s+/g, " ").trim();
        if (!text.includes(" ") && text.length <= 35 && /^[\p{L}\p{M}'-]+$/u.test(text)) {
          word = text;
        }
      } else {
        const container = containerRef.current;
        const sel = window.getSelection();
        if (!container || !sel || sel.isCollapsed || !sel.rangeCount) {
          setSelButton(null);
          return;
        }
        text = sel.toString().replace(/\s+/g, " ").trim();
        if (text.length < 2) {
          setSelButton(null);
          return;
        }
        if (!text.includes(" ") && text.length <= 35 && /^[\p{L}\p{M}'-]+$/u.test(text)) {
          word = text;
        }
        sel.removeAllRanges();
      }

      setSelButton(null);

      if (!text && !word) return;
      if (!text && word) text = word;

      const scope = captureDbScope();
      let dictEntry: { lemma: string; pos?: string | null; definition: string } | null = null;

      if (word) {
        // 1. Intento síncrono en memoria (<50 ms / 0 ms)
        const mem = lookupWordInMemory(word, language);
        if (mem?.ok && mem.found) {
          dictEntry = {
            lemma: mem.lemma ?? word,
            pos: mem.partOfSpeech ?? null,
            definition: mem.definitions?.[0] || mem.entries?.[0]?.senses?.[0]?.definition || "",
          };
        }

        // Auto-registro en glosario del libro sin bloquear
        if (targetBookId) {
          void recordBookConsultedWord(targetBookId, word, scope);
        }
      }

      // Inyección inmediata en UI: Bloque 1 presente con dictEntry o skeleton
      setCatPassageExplanation({
        passage: text,
        word,
        dictEntry,
        loading: true,
        data: null,
        error: null,
      });

      // Si había palabra pero no estaba en memoria, la buscamos en IndexedDB/offline de inmediato
      if (word && !dictEntry) {
        try {
          const lookedUp = await lookupWord(word, language, scope);
          if (lookedUp.ok && lookedUp.found) {
            dictEntry = {
              lemma: lookedUp.lemma ?? word,
              pos: lookedUp.partOfSpeech ?? null,
              definition: lookedUp.definitions?.[0] || (lookedUp.ok && lookedUp.entries?.[0]?.senses?.[0]?.definition) || "",
            };
            setCatPassageExplanation((prev) => (prev ? { ...prev, dictEntry } : null));
          }
        } catch {
          // Fallback silencioso para el diccionario local
        }
      }

      if (!signedIn) {
        setCatPassageExplanation((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                data: {
                  contextualMeaning: `Apreciación del fragmento: «${text.slice(0, 100)}...»`,
                  toneAndNuance: "Literario",
                  catTip: "Inicia sesión para recibir lecturas profundas con IA en vivo.",
                },
                error: null,
              }
            : null,
        );
        return;
      }

      try {
        const res = await explainInPassage(
          {
            word,
            lemma: dictEntry?.lemma,
            localDefinition: dictEntry?.definition,
            passage: text,
            sentence: text,
            bookTitle: title,
            bookId: targetBookId,
            author,
            language,
          },
          scope,
        );
        if (res.ok) {
          setCatPassageExplanation((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  data: {
                    contextualMeaning: res.contextualMeaning,
                    toneAndNuance: res.toneAndNuance,
                    catTip: res.catTip,
                    directMeaning: res.directMeaning,
                  },
                  error: null,
                }
              : null,
          );
        } else {
          setCatPassageExplanation((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  data: {
                    contextualMeaning: `Apreciación del fragmento: «${text.slice(0, 120)}»`,
                    toneAndNuance: "Literario",
                    catTip: "No pudimos conectar con la IA en este momento, pero disfruta de este pasaje.",
                  },
                  error: null,
                }
              : null,
          );
        }
      } catch {
        setCatPassageExplanation((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                data: null,
                error: "No se pudo consultar al gato literario.",
              }
            : null,
        );
      }
    },
    [containerRef, signedIn, captureDbScope, title, author, language, setSelButton, bookHash],
  );

  const savePassageDirectly = useCallback(
    async (text: string) => {
      const input = makePassage(bookHash, sectionIndex, text);
      if (!input) return;
      const scope = captureDbScope();
      pushAnnotation(await saveAnnotation(input, scope), scope);
      onStatus("Pasaje guardado en Marcadores y Cuaderno.");
    },
    [bookHash, sectionIndex, captureDbScope, pushAnnotation, onStatus],
  );

  return {
    annotations,
    setAnnotations,
    bookmark,
    passages,
    searchQ,
    setSearchQ,
    searchHits,
    searchDone,
    editingNote,
    setEditingNote,
    noteDraft,
    setNoteDraft,
    quoteCard,
    setQuoteCard,
    catPassageExplanation,
    setCatPassageExplanation,
    sectionLabel,
    refreshAnnotations,
    pushAnnotation,
    saveBookmarkHere,
    removeMark,
    saveNote,
    savePassageSelection,
    openQuoteCardFromSelection,
    askCatAboutSelection,
    savePassageDirectly,
  };
}
