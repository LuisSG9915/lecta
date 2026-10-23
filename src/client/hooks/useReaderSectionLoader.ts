// Cargador de sección del lector: parsea y sanea el documento del capítulo,
// aplica marcas y líneas sintácticas, hidrata imágenes, mide, restaura la
// posición y deja el estado listo o en error.
//
// Extraído de Reader.tsx (línea de trabajo posterior a la Fase 7). Es el bloque
// más acoplado de la línea: 43 entradas, casi todas setters y refs del lector.
// La acción es estable y lee las opciones vigentes de un ref.
import { useCallback, useEffect, useRef } from "react";
import type { ChapterCatalog } from "../lib/chapters";
import { targetAt } from "../lib/chapters";
import type { EpubBook } from "../lib/epub";
import {
  getBookLanguage,
  hydrateSectionImages,
  stripSoftHyphens,
} from "../lib/epub";
import { captureDbScope, saveBookPosition, type SavedBookPosition } from "../lib/idb";
import { markWords } from "../lib/marks";
import type { PageLayout } from "../lib/pagination";
import type { EpisodicWordItem } from "../lib/practice";
import { countWords, MAX_SAMPLE_MS, MIN_SAMPLE_MS, MIN_SAMPLE_WORDS } from "../lib/progress";
import {
  scrollToAnchor,
  scrollToFragment,
  scrollToSnippet,
} from "../lib/reading-location";
import type { VisitEventDraft } from "../lib/reading-events";
import { sanitizeSectionDocument } from "../lib/sanitize";
import type { ReaderSettings } from "../lib/settings";
import { applySyntacticLines } from "../lib/syntactic-lines";
import type { WordHit } from "../lib/words";
import type { MarkLevel } from "../lib/word-level";
import type { SectionPrediction } from "../lib/knowledge";
import type { ReaderState, TocRow } from "../components/Reader";
import type { ReaderNavRestore } from "./useReaderNavigation";

/** Un ref de React visto desde el hook. */
type Ref<T> = { current: T };

export interface UseReaderSectionLoaderOptions {
  onError: (message: string) => void;
  /** Idioma del libro; vacío cae al del EPUB. */
  language: string;
  setState: (state: ReaderState) => void;
  setSelection: (hit: WordHit | null) => void;
  setActiveScrollFragment: (fragment: string | null) => void;
  setPage: (page: number) => void;
  setPageCount: (count: number) => void;
  setPrediction: (prediction: SectionPrediction | null) => void;
  setScrollRatio: (ratio: number) => void;
  setSectionHasImages: (hasImages: boolean) => void;
  setSectionIndex: (index: number) => void;
  setSectionTitle: (title: string) => void;
  setSectionWords: (words: number) => void;
  setShowChapterTitle: (show: boolean) => void;
  setAnalyzing: (analyzing: boolean) => void;
  activeScrollFragRef: Ref<string | null>;
  analyzingTargets: Ref<Set<string>>;
  bookRef: Ref<EpubBook | null>;
  catalogRef: Ref<ChapterCatalog | null>;
  chapterStartedAtRef: Ref<number>;
  containerRef: Ref<HTMLDivElement | null>;
  currentChapterLookups: Ref<EpisodicWordItem[]>;
  imgUrlsRef: Ref<string[]>;
  layoutRef: Ref<"scroll" | "pages">;
  loadBlobRef: Ref<((name: string) => Promise<Blob | null>) | null>;
  pageAnchorRef: Ref<string | null>;
  pageCountRef: Ref<number>;
  pageRef: Ref<number>;
  pendingPageRef: Ref<ReaderNavRestore | null>;
  savedForms: Ref<Map<string, MarkLevel>>;
  sectionIndexRef: Ref<number>;
  sectionTextRef: Ref<string>;
  sectionTiming: Ref<{ start: number; startRatio: number; words: number } | null>;
  settingsRef: Ref<ReaderSettings | null>;
  tocRowsRef: Ref<TocRow[]>;
  capturePosition: () => SavedBookPosition | null;
  classifyCached: (index: number) => SectionPrediction | null;
  computeMetrics: () => PageLayout | null;
  currentRatioNow: () => number;
  finalizeTiming: (endRatio: number) => { ms: number; words: number } | null;
  trackEvent: (draft: VisitEventDraft) => void;
  analyzeSection: (index: number, knownText?: string) => Promise<void>;
  triggerL2Precache: (index: number, totalSections: number, lang: string) => void;
}

export function useReaderSectionLoader(options: UseReaderSectionLoaderOptions) {
  // La acción lee las opciones vigentes de este ref: sin él tendría que
  // recrearse en cada render y rearmaría los efectos que la reciben.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const loadSection = useCallback(
    async (index: number, restore: ReaderNavRestore = {}) => {
      const {
        onError,
        language,
        setState,
        setSelection,
        setActiveScrollFragment,
        setPage,
        setPageCount,
        setPrediction,
        setScrollRatio,
        setSectionHasImages,
        setSectionIndex,
        setSectionTitle,
        setSectionWords,
        setShowChapterTitle,
        setAnalyzing,
        activeScrollFragRef,
        analyzingTargets,
        bookRef,
        catalogRef,
        chapterStartedAtRef,
        containerRef,
        currentChapterLookups,
        imgUrlsRef,
        layoutRef,
        loadBlobRef,
        pageAnchorRef,
        pageCountRef,
        pageRef,
        pendingPageRef,
        savedForms,
        sectionIndexRef,
        sectionTextRef,
        sectionTiming,
        settingsRef,
        tocRowsRef,
        capturePosition,
        classifyCached,
        computeMetrics,
        currentRatioNow,
        finalizeTiming,
        trackEvent,
        analyzeSection,
        triggerL2Precache,
      } = optionsRef.current;
      const book = bookRef.current;
      const section = book?.sections[index];
      const container = containerRef.current;
      if (!book || !section || !container) return;

      // El dwell medido queda en el trayecto atribuido a la sección
      // que se está dejando (sectionIndexRef aún no cambia). Misma
      // barra de credibilidad que la velocidad: pasadas fugaces o
      // sesiones olvidadas no cuentan como tiempo de lectura.
      const dwell = finalizeTiming(currentRatioNow());
      if (
        dwell &&
        dwell.ms >= MIN_SAMPLE_MS &&
        dwell.ms <= MAX_SAMPLE_MS &&
        dwell.words >= MIN_SAMPLE_WORDS
      )
        trackEvent({
          kind: "section_dwell",
          sectionIndex: sectionIndexRef.current,
          ms: Math.round(dwell.ms),
          words: dwell.words,
        });
      setState("opening");
      setSelection(null);
      activeScrollFragRef.current = restore.fragment ?? null;
      setActiveScrollFragment(restore.fragment ?? null);
      try {
        const source = await section.createDocument();
        const sanitized = sanitizeSectionDocument(source);
        // Guiones blandos fuera antes de marcar, medir o anclar: el
        // texto que queda es el mismo con guionado activo o no.
        stripSoftHyphens(sanitized);
        const lang = language || getBookLanguage(book);
        // Si la sección ya estaba analizada, sus marcas (guardadas +
        // predichas) entran desde el primer pintado; si no, llegan al
        // terminar el análisis sobre el contenedor ya montado.
        const prediction = classifyCached(index);
        markWords(
          sanitized,
          savedForms.current,
          new Set((prediction?.predicted ?? []).map((item) => item.form)),
          lang,
        );
        // «Líneas sintácticas» envuelve el párrafo en unidades con
        // sentido antes del primer pintado; las marcas ya puestas
        // quedan dentro de su línea.
        const isChromaInit =
          Boolean(settingsRef.current?.chromaticGuide || settingsRef.current?.focusMode === "chromatic");
        if (
          settingsRef.current?.syntacticLines ||
          settingsRef.current?.focusMode === "syntactic" ||
          isChromaInit ||
          settingsRef.current?.bionicAnchors ||
          settingsRef.current?.visualPacer
        ) {
          applySyntacticLines(sanitized, {
            syntacticLines: settingsRef.current?.syntacticLines,
            chromaticGuide: isChromaInit,
            bionicAnchors: settingsRef.current?.bionicAnchors,
          });
        }
        // Las imágenes del EPUB viajan como blob: URLs: las rutas
        // internas se quitan antes de montar (evita 404 contra el
        // origen) y se rellenan ya pintado el texto. En modo paginado
        // el recuento se repite cuando todas asientan.
        const loadBlob = loadBlobRef.current;
        if (loadBlob)
          void hydrateSectionImages(
            sanitized,
            section,
            loadBlob,
            imgUrlsRef.current,
            {
              isCurrent: () =>
                bookRef.current === book && sectionIndexRef.current === index,
              onSettled: () => {
                if (layoutRef.current === "pages") computeMetrics();
              },
            },
          );
        const first = sanitized.firstElementChild;
        const ownHeading = first ? /^H[1-6]$/i.test(first.tagName) : false;
        const text = [...sanitized.childNodes]
          .map((node) => node.textContent ?? "")
          .join("\n");
        sectionTextRef.current = text;
        if (sectionIndexRef.current >= 0 && index !== sectionIndexRef.current) {
          currentChapterLookups.current = [];
          chapterStartedAtRef.current = Date.now();
        }
        triggerL2Precache(index, book.sections.length, lang);
        const enterFrom =
          sectionIndexRef.current >= 0 && index !== sectionIndexRef.current
            ? index > sectionIndexRef.current
              ? "next"
              : "prev"
            : null;
        if (enterFrom) {
          container.dataset.enterFrom = enterFrom;
        } else {
          delete container.dataset.enterFrom;
        }
        container.replaceChildren(sanitized);
        container.classList.remove("section-enter");
        void container.offsetWidth;
        container.classList.add("section-enter");
        // El análisis del capítulo corre después de pintar el texto y
        // sin bloquearlo: extrae formas, consulta el catálogo y deja la
        // precarga de la sección siguiente.
        void analyzeSection(index, text);

        // Estado de paginación de la sección anterior fuera: sin el
        // reinicio, un recuento puede aterrizar en la página vieja.
        pageRef.current = 0;
        pageCountRef.current = 1;
        pageAnchorRef.current = null;
        setPage(0);
        setPageCount(1);
        // En paginado el destino real lo resuelve el recuento después
        // del primer «ready»: la posición intermedia (página 0 de 1)
        // no es evidencia de lectura — el seguimiento de la invitación
        // ignora observaciones con un aterrizaje pendiente.
        if (layoutRef.current === "pages") pendingPageRef.current = restore;

        const total = countWords(text);
        const tocLabel = tocRowsRef.current.find((row) => row.index === index)?.label;

        setSectionWords(total);
        // La nota «sin texto legible» solo aplica si tampoco hay
        // imagen: una sección de portada o mapa sí tiene contenido.
        setSectionHasImages(Boolean(sanitized.querySelector("img, image")));
        setSectionIndex(index);
        sectionIndexRef.current = index;
        // Las marcas muestran la predicción cacheada si la hay; el
        // análisis en vuelo la trae cuando termina.
        setPrediction(prediction);
        const current = targetAt(
          catalogRef.current?.ranges ?? [],
          index,
        );
        setAnalyzing(
          current != null && analyzingTargets.current.has(current.id),
        );
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
          } else {
            const doc = document.documentElement;
            const max = doc.scrollHeight - window.innerHeight;
            // Primero el ancla de texto (exacta aunque cambie la letra);
            // si no está en esta sección, la fracción guardada.
            const anchored = restore.snippet
              ? scrollToSnippet(container, restore.snippet)
              : restore.fragment
                ? scrollToFragment(container, restore.fragment)
                : restore.anchor
                  ? scrollToAnchor(container, restore.anchor, { markResume: true })
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
          // bloque que efectivamente quedó visible. En páginas el
          // destino real lo resuelve el recuento (pendingPageRef);
          // capturar aquí guardaría la página 0 por encima de la
          // posición restaurada.
          if (layoutRef.current !== "pages") {
            const pos = capturePosition();
            if (pos) void saveBookPosition(pos, captureDbScope());
          }
        });
      } catch {
        setState("error");
        onError("No pudimos abrir esta sección del libro.");
      }
    },
    [],
  );

  return { loadSection };
}
