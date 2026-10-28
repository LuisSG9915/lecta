// Área de lectura del lector: contenido de la sección, resaltados, burbuja de
// recapitulación, tarjeta de fin de capítulo y pie de navegación entre secciones.
//
// Extraída de Reader.tsx (Fase 7) sin cambiar comportamiento. Es presentacional:
// recibe estado y callbacks, no posee estado propio.
import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { validateTapIntent } from "../../lib/tap-intent-guard";
import type { ReaderSelectionButton } from "./ReaderSelectionBar";
import { ReaderRecapBubble } from "../ReaderRecapBubble";
import type { ReaderSettings } from "../../lib/settings";
import type { PageLayout } from "../../lib/pagination";
import { saveCharacterMemoryEnabled, type SceneReturnRecap } from "../../lib/page-recap";
import { focusBlock } from "../../lib/paragraph-focus";
import { tapZone } from "../../lib/page-gesture";
import { triggerHaptic } from "../../lib/haptics";
import { captureDbScope, saveSessionValue } from "../../lib/idb";
import type { WordHit } from "../../lib/words";
import type { EpisodicWordItem } from "../../lib/practice";
import { MidChapterRecallCard } from "./MidChapterRecallCard";

export type ReaderSectionRow = { index: number; fragment?: string; label: string };

export interface ReaderContentProps {
  containerRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  settings: ReaderSettings;
  state: "idle" | "opening" | "ready" | "error";
  sectionIndex: number;
  sectionTotal: number;
  sectionWords: number;
  title: string;
  sectionTitle: string;
  sectionHasImages: boolean;
  showChapterTitle: boolean;
  strategyPaused: boolean;
  page: number;
  pageCount: number;
  pageAdvance: (boxW: number, gap: number) => number;
  pageMetrics: PageLayout | null;
  ttsSnap: { status: string };
  selection: WordHit | null;
  setSelection: (selection: WordHit | null) => void;
  setBarsVisible: (updater: boolean | ((prev: boolean) => boolean)) => void;
  setShowLongPressHint: (updater: boolean | ((prev: boolean) => boolean)) => void;
  showLongPressHint: boolean;
  recapBubbleVisible: boolean;
  recapBubbleLoading: boolean;
  recapBubbleBullets: string[];
  setRecapBubbleVisible: (visible: boolean) => void;
  sceneRecap: SceneReturnRecap | null;
  chapterEndCard: ReactNode;
  nextRow: ReaderSectionRow | null;
  prevRow: ReaderSectionRow | null;
  language: string;
  noteActivity: () => void;
  navigate: (
    kind: "chapter",
    options: { index: number; restore?: { ratio: number } },
  ) => void | Promise<unknown>;
  goPage: (delta: number) => void;
  navNextSection: (index: number, fragment?: string) => void;
  navPrevSection: (index: number, fragment?: string) => void;
  openSelection: (hit: WordHit) => void;
  onSingleWordTap?: (hit: WordHit, clientX: number, clientY: number) => void;
  selButton?: ReaderSelectionButton | null;
  setSelButton?: (value: ReaderSelectionButton | null) => void;
  extractWordAtPoint: (
    clientX: number,
    clientY: number,
    root: HTMLElement,
    language?: string,
  ) => WordHit | null;
  handleContainerDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
  handleTriggerReturnRecap: () => void | Promise<unknown>;
  toggleParagraphTranslation: (element: HTMLElement) => void | Promise<unknown>;
  onInternalLinkClick?: (href: string) => void;
  lastPointRef: RefObject<{ x: number; y: number } | null>;
  lastTapRef: RefObject<{ time: number; element: HTMLElement | null }>;
  lastPointerTypeRef: RefObject<string>;
  pacerIndexRef: RefObject<number>;
  onBack: () => void;
  midChapterRecall?: EpisodicWordItem | null;
  onMidChapterRecallSolve?: () => void;
  onMidChapterRecallSkip?: () => void;
}

export function ReaderContent(props: ReaderContentProps) {
  const { setSelButton } = props;
  const pointerDownPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const lastScrollOrNavTimeRef = useRef<number>(0);

  useEffect(() => {
    const markScroll = () => {
      lastScrollOrNavTimeRef.current = Date.now();
      if (setSelButton) setSelButton(null);
    };
    window.addEventListener("scroll", markScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", markScroll, { capture: true });
    };
  }, [setSelButton]);
  const {
  title,
  containerRef,
  viewportRef,
  settings,
  state,
  sectionIndex,
  sectionTotal,
  sectionWords,
  sectionTitle,
  sectionHasImages,
  showChapterTitle,
  strategyPaused,
  page,
  pageCount,
  pageAdvance,
  pageMetrics,
  ttsSnap,
  selection,
  setSelection,
  setBarsVisible,
  setShowLongPressHint,
  showLongPressHint,
  recapBubbleVisible,
  recapBubbleLoading,
  recapBubbleBullets,
  setRecapBubbleVisible,
  sceneRecap,
  chapterEndCard,
  nextRow,
  prevRow,
  language,
  noteActivity,
  navigate,
  goPage,
  navNextSection,
  navPrevSection,
  openSelection,
  onSingleWordTap,
  selButton,
  extractWordAtPoint,
  handleContainerDoubleClick,
  handleTriggerReturnRecap,
  toggleParagraphTranslation,
  onInternalLinkClick,
  lastPointRef,
  lastTapRef,
  lastPointerTypeRef,
  pacerIndexRef,
  onBack,
  midChapterRecall,
  onMidChapterRecallSolve,
  onMidChapterRecallSkip,
  } = props;

  return (
<div
  className={`reader-body reader__stage ${settings.chromaticGuide && !strategyPaused ? "reader__stage--chromatic" : ""}`}
  data-strategy-contrast={settings.strategyContrast}
  data-has-floating-bar={ttsSnap.status !== "idle" || (settings.visualPacer && !strategyPaused) ? "true" : undefined}
>
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
          onClick={() => void navigate("chapter", { index: sectionIndex, restore: { ratio: 0 } })}
        >
          Intentar de nuevo
        </button>
        <button type="button" className="btn--quiet" onClick={onBack}>
          Volver a la estantería
        </button>
      </div>
    </div>
  ) : null}
  {state === "ready" && sectionWords === 0 && !sectionHasImages ? (
    <p className="reader-empty meta">
      Esta sección no tiene texto legible (puede ser una portada o una imagen).
    </p>
  ) : null}
  {showChapterTitle ? <h1 className="chapter-title">{sectionTitle}</h1> : null}
  {recapBubbleVisible ? (
    <ReaderRecapBubble
      recapBullets={recapBubbleBullets}
      isLoading={recapBubbleLoading}
      sceneRecap={sceneRecap}
      onDismiss={() => setRecapBubbleVisible(false)}
      onTriggerRecap={handleTriggerReturnRecap}
      onSelectCharacter={(name) => {
        openSelection({
          word: name,
          context: sceneRecap?.lastReadSnippet,
        });
      }}
      onDisableCharacterMemory={() => saveCharacterMemoryEnabled(false)}
    />
  ) : null}
  {/* En modo páginas el texto vive en columnas de alto fijo: una tarjeta
      arriba le quita casi todo el área de lectura (medido: 248 px de 687).
      Ahí el repaso llega en el cierre de capítulo, que ya lo cubre. */}
  {midChapterRecall && onMidChapterRecallSolve && onMidChapterRecallSkip && settings.layout !== "pages" ? (
    <MidChapterRecallCard
      item={midChapterRecall}
      onSolve={onMidChapterRecallSolve}
      onSkip={onMidChapterRecallSkip}
    />
  ) : null}
  <div className="page-viewport" ref={viewportRef}>
    <div
      ref={containerRef}
      role="document"
      className={`book-content reader__stage ${settings.chromaticGuide && !strategyPaused ? "reader__stage--chromatic" : ""}`}
      data-focus-mode={strategyPaused ? "off" : settings.focusMode}
      data-paragraph-focus={
        (!strategyPaused && (settings.paragraphFocus || settings.focusMode === "paragraph")) || undefined
      }
      data-strategy-preset={settings.strategyPreset}
      data-strategy-contrast={settings.strategyContrast}
      data-strategy-paused={strategyPaused || undefined}
      data-has-floating-bar={ttsSnap.status !== "idle" || (settings.visualPacer && !strategyPaused) ? "true" : undefined}
      data-hide-indicators={
        settings.hideSecondaryIndicators || settings.strategyPreset === "immersive" || undefined
      }
      style={
        settings.layout === "pages" && pageMetrics
          ? ({
              inlineSize: `${pageMetrics.boxW}px`,
              blockSize: "100%",
              columnWidth: `${pageMetrics.colW}px`,
              columnGap: `${pageMetrics.gap}px`,
              columnFill: "auto",
              "--page-x": `${-page * pageAdvance(pageMetrics.boxW, pageMetrics.gap)}px`,
            } as CSSProperties)
          : undefined
      }
      lang={language}
      onDoubleClick={handleContainerDoubleClick}
    onClick={(event: MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      if (!strategyPaused && (settings.focusMode === "paragraph" || settings.paragraphFocus)) {
        const block = (event.target as HTMLElement).closest("p, blockquote, li");
        if (block && container.contains(block)) {
          focusBlock(container, block);
        }
      }
      if (settings.visualPacer) {
        const chunk = (event.target as HTMLElement).closest<HTMLElement>(".lecta-syntactic-chunk");
        if (chunk && container.contains(chunk)) {
          const allChunks = Array.from(container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"));
          const idx = allChunks.indexOf(chunk);
          if (idx >= 0) {
            pacerIndexRef.current = idx;
            allChunks.forEach((c, i) => {
              if (i === idx) c.classList.add("lecta-pacer-active");
              else c.classList.remove("lecta-pacer-active");
            });
          }
        }
      }
      // Los enlaces internos del EPUB (notas al pie, referencias)
      // navegan dentro de la obra guardando el punto de retorno.
      const internalLink = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-epub-link='internal']");
      if (internalLink) {
        event.preventDefault();
        event.stopPropagation();
        const href = internalLink.getAttribute("href");
        if (href && onInternalLinkClick) {
          onInternalLinkClick(href);
        }
        return;
      }
      if ((event.target as HTMLElement).closest("a")) {
        event.preventDefault();
        return;
      }

      const isTouch =
        lastPointerTypeRef.current === "touch" ||
        lastPointerTypeRef.current === "pen" ||
        (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
      if (selButton && setSelButton) {
        setSelButton(null);
        return;
      }

      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0;

      if (isTouch) {
        // En táctil (modelo Kindle):
        // Track 5: Detección de doble toque en táctil para traducir párrafo si el libro está en inglés
        if (language === "en") {
          const target = event.target as HTMLElement;
          const p = target.closest<HTMLElement>("p, blockquote");
          const now = Date.now();
          if (p && lastTapRef.current.element === p && now - lastTapRef.current.time < 350) {
            lastTapRef.current = { time: 0, element: null };
            void toggleParagraphTranslation(p);
            return;
          }
          lastTapRef.current = { time: now, element: p };
        }

        if (selection) {
          setSelection(null);
          return;
        }

        // 1. Si hay una selección de texto activa, el toque solo la limpia
        if (hasSelection) {
          sel.removeAllRanges();
          return;
        }

        // 2. Navegación táctil en páginas: 25% bordes pasa página, centro busca palabra o alterna barras
        if (settings.layout === "pages") {
          const viewport = viewportRef.current ?? container;
          const rect = viewport.getBoundingClientRect();
          const zone = tapZone(event.clientX, rect);
          if (zone === "next") {
            void goPage(1);
          } else if (zone === "prev") {
            void goPage(-1);
          } else {
            const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
            if (hit) {
              const validation = validateTapIntent({
                downPoint: pointerDownPosRef.current,
                upPoint: { clientX: event.clientX, clientY: event.clientY },
                pointerType: "touch",
                lastScrollOrNavTime: lastScrollOrNavTimeRef.current,
                word: hit.word,
              });
              if (!validation.valid) return;
              if (onSingleWordTap) onSingleWordTap(hit, event.clientX, event.clientY);
              else openSelection(hit);
            } else {
              setBarsVisible((v) => !v);
            }
          }
        } else {
          // En modo scroll: si tocó una palabra, abrir ficha; si no, alternar barras
          const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
          if (hit) {
            const validation = validateTapIntent({
              downPoint: pointerDownPosRef.current,
              upPoint: { clientX: event.clientX, clientY: event.clientY },
              pointerType: "touch",
              lastScrollOrNavTime: lastScrollOrNavTimeRef.current,
              word: hit.word,
            });
            if (!validation.valid) return;
            if (onSingleWordTap) onSingleWordTap(hit, event.clientX, event.clientY);
            else openSelection(hit);
          } else {
            setBarsVisible((v) => !v);
          }
        }
      } else {
        // En ratón (escritorio):
        // Riesgo 5: al soltar tras seleccionar texto, no abrir la ficha de palabra
        if (hasSelection) {
          return;
        }

        const hit = extractWordAtPoint(event.clientX, event.clientY, container, language);
        if (hit) {
          const validation = validateTapIntent({
            downPoint: pointerDownPosRef.current,
            upPoint: { clientX: event.clientX, clientY: event.clientY },
            pointerType: "mouse",
            lastScrollOrNavTime: lastScrollOrNavTimeRef.current,
            word: hit.word,
          });
          if (!validation.valid) return;
          if (onSingleWordTap) onSingleWordTap(hit, event.clientX, event.clientY);
          else openSelection(hit);
        } else {
          if (settings.layout === "pages") {
            const viewport = viewportRef.current ?? container;
            const rect = viewport.getBoundingClientRect();
            const zone = tapZone(event.clientX, rect);
            if (zone === "next") {
              void goPage(1);
            } else if (zone === "prev") {
              void goPage(-1);
            } else {
              setBarsVisible((v) => !v);
            }
          } else {
            setBarsVisible(true);
          }
        }
      }
    }}
    onPointerMove={(event) => {
      lastPointRef.current = { x: event.clientX, y: event.clientY };
    }}
    onPointerDown={(event) => {
      noteActivity();
      lastPointerTypeRef.current = event.pointerType;
      pointerDownPosRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (showLongPressHint) {
        setShowLongPressHint(false);
        void saveSessionValue("hint:longPress:v1", "1", captureDbScope()).catch(() => undefined);
      }
    }}
    aria-busy={state === "opening"}
    aria-label="Contenido de la sección"
  />
  </div>
  {settings.layout === "pages" ? (
    <>
      {chapterEndCard}
    <nav className="page-nav" aria-label="Navegación de páginas">
      <button
        type="button"
        className="page-nav-btn"
        disabled={sectionIndex === 0 && page === 0}
        onClick={() => {
          triggerHaptic("selection");
          void goPage(-1);
        }}
        aria-label="Página anterior"
      >
        <span aria-hidden="true">‹</span> Anterior
      </button>
      <div className="page-nav-center">
        <span className="page-nav-count meta" aria-live="polite">
          {pageCount ? `Página ${page + 1} de ${pageCount}` : ""}
        </span>
        {pageCount > 1 ? (
          <div className="thread page-nav-thread" aria-hidden="true">
            <div
              className="thread-fill"
              style={{ "--thread-value": `${Math.round(((page + 1) / pageCount) * 100)}%` } as CSSProperties}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="page-nav-btn"
        disabled={sectionIndex + 1 >= sectionTotal && page + 1 >= pageCount}
        onClick={() => {
          triggerHaptic("selection");
          void goPage(1);
        }}
        aria-label="Página siguiente"
      >
        Siguiente <span aria-hidden="true">›</span>
      </button>
    </nav>
    </>
  ) : (
    <>
      {chapterEndCard}
    <nav className="reader-end" aria-label="Navegación de secciones">
      {prevRow != null || sectionIndex > 0 ? (
        <button
          type="button"
          className="reader-end-link"
          onClick={() => {
            if (prevRow) {
              navPrevSection(prevRow.index, prevRow.fragment);
            } else {
              navPrevSection(sectionIndex - 1);
            }
          }}
        >
          ← {prevRow?.label ?? "Anterior"}
        </button>
      ) : (
        <span />
      )}
      {nextRow != null || sectionIndex + 1 < sectionTotal ? (
        <button
          type="button"
          className="reader-end-link"
          onClick={() => {
            if (nextRow) {
              navNextSection(nextRow.index, nextRow.fragment);
            } else {
              navNextSection(sectionIndex + 1);
            }
          }}
        >
          Siguiente: {nextRow?.label ?? `Sección ${sectionIndex + 2}`} →
        </button>
      ) : (
        <span className="reader-end-done meta">Fin del libro</span>
      )}
    </nav>
    </>
  )}
</div>
  );
}
