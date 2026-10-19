import { useCallback, useEffect, useRef, useState } from 'react';
import { type BookMeta, getBookWithData } from '../lib/idb';
import { type ReaderSettings, DEFAULT_SETTINGS } from '../lib/settings';
import {
  extractChapters,
  injectReaderStyles,
  openEpubElement,
  type TocItem,
} from '../lib/epub';
import { getBookLocation, saveBookLocation } from '../lib/reading-location';
import { pushPosition } from '../lib/positions-sync';
import type { PhrasesIndex } from '../lib/phrases';
import { runChapterDomPipeline } from '../lib/dom-pipeline';

export interface ActiveSection {
  index: number;
  doc: Document;
  label?: string;
}

export interface PageProgress {
  fraction: number;
  current: number;
  total: number;
  sectionLabel?: string;
  cfi?: string;
}

interface UseEpubViewParams {
  book: BookMeta;
  settings?: ReaderSettings;
  phrasesIndex?: PhrasesIndex | null;
  wordsToMark?: Set<string>;
  savedWords?: Set<string>;
  onSectionLoaded?: (section: ActiveSection) => void;
  onPageRelocated?: (progress: PageProgress, sectionDoc: Document | null) => void;
}

export function useEpubView({
  book,
  settings = DEFAULT_SETTINGS,
  phrasesIndex = null,
  wordsToMark = new Set(),
  savedWords = new Set(),
  onSectionLoaded,
  onPageRelocated,
}: UseEpubViewParams) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement & {
    prev?: () => void;
    next?: () => void;
    goTo?: (target: string | number) => Promise<void>;
    close?: () => void;
  } | null>(null);

  const [section, setSection] = useState<ActiveSection | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [progress, setProgress] = useState<PageProgress>({
    fraction: 0,
    current: 1,
    total: 1,
  });
  const [bookLoading, setBookLoading] = useState(true);
  const [bookError, setBookError] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Montaje y apertura del archivo EPUB en foliate-js
  useEffect(() => {
    let cancelled = false;
    let cleanupView: (() => void) | undefined;

    async function mountBook() {
      if (!hostRef.current) return;
      setBookLoading(true);
      setBookError(null);

      const bookId = book.id || book.hash || '';
      try {
        const stored = bookId ? await getBookWithData(bookId) : undefined;
        if (cancelled) return;
        if (!stored?.data) {
          setBookError('No se encontró el archivo del libro en este dispositivo.');
          setBookLoading(false);
          return;
        }

        const { view, bookObj, cleanup } = await openEpubElement(
          hostRef.current,
          stored.data,
        );
        if (cancelled) {
          cleanup();
          return;
        }

        cleanupView = cleanup;
        viewRef.current = view;
        setToc(extractChapters(bookObj));

        const onLoad = (ev: Event) => {
          const detail = (ev as CustomEvent<{ doc: Document; index: number }>).detail;
          if (!detail?.doc) return;
          injectReaderStyles(detail.doc, settingsRef.current);
          const nextSection: ActiveSection = {
            index: detail.index ?? 0,
            doc: detail.doc,
          };
          setSection(nextSection);
          onSectionLoaded?.(nextSection);
        };

        const onRelocate = (ev: Event) => {
          const d = (
            ev as CustomEvent<{
              fraction?: number;
              location?: { current?: number; next?: number; total?: number };
              tocItem?: { label?: string };
              cfi?: string;
            }>
          ).detail;
          if (!d) return;

          const nextProgress: PageProgress = {
            fraction: typeof d.fraction === 'number' ? d.fraction : 0,
            current: d.location?.current ?? 1,
            total: d.location?.total ?? 1,
            sectionLabel: d.tocItem?.label,
            cfi: d.cfi,
          };
          setProgress(nextProgress);

          if (d.cfi && bookId) {
            saveBookLocation(bookId, {
              cfi: d.cfi,
              fraction: nextProgress.fraction,
              updatedAt: Date.now(),
            });
            pushPosition(bookId, d.cfi, nextProgress.fraction).catch(() => {});
          }

          onPageRelocated?.(nextProgress, section?.doc ?? null);
        };

        view.addEventListener('load', onLoad);
        view.addEventListener('relocate', onRelocate);

        // Restaurar última posición CFI guardada
        const savedLoc = bookId ? getBookLocation(bookId) : null;
        if (savedLoc?.cfi && typeof view.goTo === 'function') {
          await view.goTo(savedLoc.cfi).catch(() => view.goTo?.(0));
        } else {
          await view.goTo?.(0);
        }

        if (!cancelled) setBookLoading(false);
      } catch (err) {
        if (!cancelled) {
          setBookError(
            err instanceof Error ? err.message : 'Error al abrir el libro EPUB',
          );
          setBookLoading(false);
        }
      }
    }

    mountBook();
    return () => {
      cancelled = true;
      cleanupView?.();
      viewRef.current = null;
    };
  }, [book.id]);

  // Re-inyectar variables CSS en caliente cuando cambian los ajustes tipográficos
  useEffect(() => {
    if (!section?.doc) return;
    injectReaderStyles(section.doc, settings);
  }, [
    section,
    settings.theme,
    settings.font,
    settings.fontSize,
    settings.lineHeight,
    settings.margins,
    settings.paragraphFocus,
  ]);

  // Ejecutar el pipeline unificado del DOM con cancelación automática
  useEffect(() => {
    if (!section?.doc) return;
    const phrasesList = phrasesIndex ? phrasesIndex.getAll() : [];
    const cancelPipeline = runChapterDomPipeline({
      doc: section.doc,
      settings: {
        syllableBreaks: settings.syllableBreaks,
        syntacticLines: settings.syntacticLines,
        bionicReading: settings.bionicReading,
      },
      phrases: phrasesList,
      wordsToMark,
      savedWords,
    });
    return cancelPipeline;
  }, [
    section,
    settings.syllableBreaks,
    settings.syntacticLines,
    settings.bionicReading,
    phrasesIndex,
    wordsToMark,
    savedWords,
  ]);

  const goPrev = useCallback(() => {
    viewRef.current?.prev?.();
  }, []);

  const goNext = useCallback(() => {
    viewRef.current?.next?.();
  }, []);

  const goToTarget = useCallback(async (target: string | number) => {
    await viewRef.current?.goTo?.(target);
  }, []);

  return {
    hostRef,
    section,
    toc,
    progress,
    bookLoading,
    bookError,
    goPrev,
    goNext,
    goToTarget,
  };
}
