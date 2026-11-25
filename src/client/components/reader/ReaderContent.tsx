// Área de lectura del lector: contenido de la sección, resaltados, burbuja de
// recapitulación, tarjeta de fin de capítulo y pie de navegación entre secciones.
//
// Extraída de Reader.tsx (Fase 7) sin cambiar comportamiento. Es presentacional:
// recibe estado y callbacks, no posee estado propio.
import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { isTouchInput, validateTapIntent } from "../../lib/tap-intent-guard";
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
import ReaderChapterHeader from "./ReaderChapterHeader";

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
  /** Cierra la ficha y suelta la capa de historial que la abrió. */
  onCloseSelection: () => void;
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
  onMidChapterRecallSolve?: (outcome?: { errorCount?: number; usedHint?: boolean }) => void;
  onMidChapterRecallSkip?: () => void;
}

// Presión sostenida en táctil: el gesto que consulta una palabra no es el
// toque (se reserva para barras y páginas) sino mantener el dedo ~480 ms
// sin moverlo. La tolerancia absorbe el temblor natural del dedo.
const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP_PX = 12;
// Margen para que el sistema cree su selección nativa (con tiradores)
// antes de seleccionar la palabra por código.
const NATIVE_SELECTION_GRACE_MS = 300;

export function ReaderContent(props: ReaderContentProps) {
  const { setSelButton } = props;
  const pointerDownPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const lastScrollOrNavTimeRef = useRef<number>(0);
  // Detector de presión: el timer abre la ficha; `pressConsumed` marca que la
  // interacción fue una presión (hit o no) para que el click del release no se
  // comporte como toque — un dedo sostenido jamás alterna barras ni cierra.
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const pressConsumedRef = useRef(false);
  // Sello de apertura de la ficha: en dispositivos donde soltar el dedo tras
  // seleccionar una palabra (presión nativa del OS) sí emite click, ese click
  // de release cerraba la ficha recién abierta. Una gracia corta lo descarta.
  const selectionOpenedAtRef = useRef(0);
  const cancelLongPress = useCallback(() => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  }, []);

  useEffect(() => {
    const markScroll = (event: Event) => {
      // Deslizar la fila del menú de selección no es leer: ni cierra el
      // menú ni cuenta como scroll.
      const target = event.target;
      if (target instanceof Element && target.closest(".selection-menu")) return;
      lastScrollOrNavTimeRef.current = Date.now();
      cancelLongPress();
      if (setSelButton) setSelButton(null);
    };
    window.addEventListener("scroll", markScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", markScroll, { capture: true });
    };
  }, [setSelButton, cancelLongPress]);

  // Un timer huérfano no debe abrir la ficha tras desmontar el lector.
  useEffect(() => cancelLongPress, [cancelLongPress]);

  useEffect(() => {
    if (props.selection) selectionOpenedAtRef.current = Date.now();
  }, [props.selection]);
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
  onCloseSelection,
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
  data-has-floating-bar={ttsSnap.status !== "idle" ? "true" : undefined}
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
  <ReaderChapterHeader title={sectionTitle} visible={showChapterTitle} />
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
      data-has-floating-bar={ttsSnap.status !== "idle" ? "true" : undefined}
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
      // Release de una presión sostenida: no es un toque — sin barras ni cierre.
      if (pressConsumedRef.current) {
        pressConsumedRef.current = false;
        return;
      }
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

      const isTouch = isTouchInput(lastPointerTypeRef.current);

      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0;

      if (selButton && setSelButton && !hasSelection) {
        setSelButton(null);
        return;
      }

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
          // El click que suelta la selección nativa no cierra la ficha que
          // acaba de abrir: solo cuentan los toques posteriores a la gracia.
          if (Date.now() - selectionOpenedAtRef.current < 400) return;
          // Cerrar con un toque soltaba solo el estado: la capa de historial
          // (`overlayReleaseRef`) seguía viva y el listener de
          // `selectionchange` ignoraba las selecciones siguientes, así que la
          // palabra dejaba de abrirse hasta recargar. El × ya usaba este camino.
          onCloseSelection();
          return;
        }

        // 1. Si hay una selección de texto activa, el toque solo la limpia
        if (hasSelection) {
          sel.removeAllRanges();
          return;
        }

        // 2. El toque no consulta palabras: la consulta es por presión
        //    sostenida (ver onPointerDown). En páginas, los bordes pasan
        //    página y el centro alterna barras; en scroll, todo toque
        //    alterna barras.
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
          setBarsVisible((v) => !v);
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
          openSelection(hit);
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
      // Mover el dedo más que el temblor natural aborta la presión.
      const pressStart = pressStartRef.current;
      if (
        pressStart &&
        Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) >
          LONG_PRESS_SLOP_PX
      ) {
        cancelLongPress();
      }
    }}
    onPointerDown={(event) => {
      noteActivity();
      lastPointerTypeRef.current = event.pointerType;
      pointerDownPosRef.current = { clientX: event.clientX, clientY: event.clientY };
      pressConsumedRef.current = false;
      if (showLongPressHint) {
        setShowLongPressHint(false);
        void saveSessionValue("hint:longPress:v1", "1", captureDbScope()).catch(() => undefined);
      }
      // Presión sostenida en táctil = consultar la palabra bajo el dedo.
      // El toque queda para barras y páginas; la selección nativa del OS
      // (otra forma de presión) abre por `selectionchange` en Reader.tsx.
      if ((event.pointerType === "touch" || event.pointerType === "pen") && event.isPrimary) {
        const startX = event.clientX;
        const startY = event.clientY;
        pressStartRef.current = { x: startX, y: startY };
        if (pressTimerRef.current !== null) window.clearTimeout(pressTimerRef.current);
        pressTimerRef.current = window.setTimeout(() => {
          pressTimerRef.current = null;
          // Sostuvo el dedo sin moverse: el release ya no cuenta como toque.
          pressConsumedRef.current = true;
          const container = containerRef.current;
          if (!container) return;
          const hit = extractWordAtPoint(startX, startY, container, language);
          if (!hit) return;
          // isLongPress: salta el filtro de stopwords y la zona del pulgar —
          // presionar «la» o «que» a propósito sí consulta. Se conserva el
          // cooldown de scroll para no abrir la ficha a media sacudida.
          const validation = validateTapIntent({
            upPoint: { clientX: startX, clientY: startY },
            pointerType: "touch",
            lastScrollOrNavTime: lastScrollOrNavTimeRef.current,
            word: hit.word,
            isLongPress: true,
          });
          if (!validation.valid) return;
          if (selection) return;
          triggerHaptic("selection");
          // La presión selecciona la palabra: `selectionchange` (Reader.tsx)
          // abre el mini menú («Significado», tinta…) y los tiradores quedan
          // libres para ampliar la cita. Si el sistema ya creó su selección
          // nativa, se respeta. (Ya no hay onContextMenu con preventDefault:
          // en Android suprimía la selección nativa y sus tiradores —
          // verificado por adb el 2026-11-11.)
          // La selección nativa de Android llega unos ms después del
          // temporizador; solo si no aparece se crea por código (sin
          // tiradores, pero con el mismo menú).
          const hasNative = () => {
            const native = window.getSelection();
            return Boolean(native && !native.isCollapsed && native.rangeCount > 0 && container.contains(native.getRangeAt(0).commonAncestorContainer));
          };
          if (hasNative()) return;
          window.setTimeout(() => {
            if (hasNative()) return;
            const native = window.getSelection();
            if (native && hit.range) {
              native.removeAllRanges();
              native.addRange(hit.range.cloneRange());
            } else {
              openSelection(hit);
            }
          }, NATIVE_SELECTION_GRACE_MS);
        }, LONG_PRESS_MS);
      }
    }}
    onPointerUp={cancelLongPress}
    onPointerCancel={cancelLongPress}
    onPointerLeave={cancelLongPress}
    aria-busy={state === "opening"}
    aria-label="Contenido de la sección"
  />
  </div>
  {settings.layout === "pages" ? (
    <>
      {chapterEndCard}
    <div className="page-nav" role="group" aria-label="Progreso de lectura">
      <span className="page-nav-count meta" aria-live="polite">
        {pageCount
          ? `${sectionTitle ? `${sectionTitle} · ` : ""}${page + 1} / ${pageCount}`
          : ""}
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
