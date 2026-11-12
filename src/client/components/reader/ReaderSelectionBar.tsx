// Menú de acciones de selección del lector: tinta, reflexión, postal y
// preguntar al compañero. En táctil la presión larga selecciona la
// palabra y abre este menú (con «Significado» primero) en vez de la
// ficha: así los tiradores quedan libres para ampliar la cita. Con ratón
// el clic sobre una palabra sigue abriendo la ficha directa.
import { useEffect, useState, memo, type RefObject } from "react";
import Icon from "../Icon";
import type { WordHit } from "../../lib/words";

export type ReaderSelectionButton = {
  x: number;
  y: number;
  placement: "top" | "bottom";
  /** Selección de una sola palabra: el menú ofrece «Significado». */
  word?: WordHit;
  /**
   * Selección táctil: Android pinta su propia barra «Copiar / Seleccionar
   * todo» sobre la nativa. El lector la reaplica por código (sin barra ni
   * tiradores del sistema) y aquí se dibujan tiradores propios.
   */
  touch?: boolean;
};

// Tiradores propios para la selección táctil. Arrastrar uno mueve ese
// extremo a la palabra bajo el dedo (ajustado a límites de palabra).
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  const p = document.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}

// Lleva el offset al borde de la palabra: inicio si `toStart`, fin si no.
function snapToWord(node: Node, offset: number, toStart: boolean): number {
  if (node.nodeType !== Node.TEXT_NODE) return offset;
  const text = node.textContent ?? "";
  for (const seg of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (!seg.isWordLike) continue;
    const end = seg.index + seg.segment.length;
    if (offset >= seg.index && offset <= end) return toStart ? seg.index : end;
  }
  return offset;
}

const HANDLE_FINGER_OFFSET_PX = 24;

function SelectionHandles({ containerRef }: { containerRef?: RefObject<HTMLElement | null> }) {
  const [ends, setEnds] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setEnds(null);
      const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0);
      if (!rects.length) return setEnds(null);
      const first = rects[0];
      const last = rects[rects.length - 1];
      setEnds({ sx: first.left, sy: first.bottom, ex: last.right, ey: last.bottom });
    };
    measure();
    document.addEventListener("selectionchange", measure);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("selectionchange", measure);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  if (!ends) return null;

  const startDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget;
    const which = el.dataset.which === "start" ? "start" : "end";
    el.setPointerCapture(event.pointerId);
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const fixed = sel.getRangeAt(0).cloneRange();
    const move = (e: PointerEvent) => {
      // El dedo tapa el texto: se apunta un poco por encima del tirador.
      const caret = caretAt(e.clientX, e.clientY - HANDLE_FINGER_OFFSET_PX);
      if (!caret || !containerRef?.current?.contains(caret.node)) return;
      const range = document.createRange();
      if (which === "end") {
        range.setStart(fixed.startContainer, fixed.startOffset);
        const offset = snapToWord(caret.node, caret.offset, false);
        try {
          range.setEnd(caret.node, offset);
        } catch {
          return;
        }
        if (range.collapsed) return;
      } else {
        range.setEnd(fixed.endContainer, fixed.endOffset);
        const offset = snapToWord(caret.node, caret.offset, true);
        try {
          range.setStart(caret.node, offset);
        } catch {
          return;
        }
        if (range.collapsed) return;
      }
      sel.removeAllRanges();
      sel.addRange(range);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <>
      <span
        className="selection-handle selection-handle--start"
        style={{ left: ends.sx, top: ends.sy }}
        data-which="start"
        onPointerDown={startDrag}
        aria-hidden="true"
      />
      <span
        className="selection-handle selection-handle--end"
        style={{ left: ends.ex, top: ends.ey }}
        data-which="end"
        onPointerDown={startDrag}
        aria-hidden="true"
      />
    </>
  );
}

export interface ReaderSelectionBarProps {
  selButton: ReaderSelectionButton | null;
  setSelButton: (value: ReaderSelectionButton | null) => void;
  savePassageSelection: (tone: "amber" | "salvia" | "dario") => void | Promise<unknown>;
  openQuoteCardFromSelection: () => void;
  askCatAboutSelection: (param?: string | { word?: string; passage: string; bookId?: string }) => void | Promise<unknown>;
  setDeepModal: (value: boolean) => void;
  /** Abre la ficha de la palabra seleccionada. */
  onDefine?: (hit: WordHit) => void;
  /** Contenedor del texto: los tiradores propios no salen de él. */
  containerRef?: RefObject<HTMLElement | null>;
}

export const ReaderSelectionBar = memo(function ReaderSelectionBar(props: ReaderSelectionBarProps) {
  const {
    selButton,
    setSelButton,
    savePassageSelection,
    openQuoteCardFromSelection,
    askCatAboutSelection,
    setDeepModal,
    onDefine,
    containerRef,
  } = props;

  // Auto-dismiss sin fricción: si el usuario hace scroll o toca fuera de la barra
  useEffect(() => {
    if (!selButton) return;
    const hide = () => setSelButton(null);
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".selection-menu, .selection-handle")) return;
      hide();
    };

    // Deslizar la propia fila del menú (en móvil no cabe y se desplaza en
    // horizontal) no es un scroll de lectura: no cierra el menú.
    const onScroll = (e: Event) => {
      const target = e.target as Element | null;
      if (target instanceof Element && target.closest(".selection-menu")) return;
      hide();
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [selButton, setSelButton]);

  if (!selButton) return null;

  return (
    <>
    {selButton.touch ? <SelectionHandles containerRef={containerRef} /> : null}
    <div
      className="selection-menu reader__passage-bar"
      data-placement={selButton.placement}
      style={{ left: selButton.x, top: selButton.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* 0. Significado: solo cuando la selección es una palabra */}
      {selButton.word && onDefine ? (
        <button
          type="button"
          className="selection-menu-btn selection-define"
          title="Ver qué significa"
          aria-label="Ver qué significa"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const hit = selButton.word!;
            window.getSelection()?.removeAllRanges();
            setSelButton(null);
            onDefine(hit);
          }}
        >
          <Icon name="book" size={14} />
          <span>Significado</span>
        </button>
      ) : null}

      {/* 1. Resaltar con tinta (3 tonos: Ámbar, Salvia, Azul Darío) */}
      <div className="selection-highlight-group" role="group" aria-label="Resaltar con tinta">
        <button
          type="button"
          className="selection-menu-btn selection-save"
          title="Resaltar con tinta ámbar"
          aria-label="Resaltar con tinta"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void savePassageSelection("amber")}
        >
          <Icon name="highlight" size={14} />
          <span>Tinta</span>
        </button>
        <div className="selection-tones-picker" aria-label="Elegir tono de tinta">
          <button
            type="button"
            className="tone-dot tone-dot--amber reader__passage-color reader__passage-color--amber"
            title="Tinta Ámbar"
            aria-label="Tinta Ámbar"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("amber")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--salvia reader__passage-color reader__passage-color--sage"
            title="Tinta Salvia"
            aria-label="Tinta Salvia"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("salvia")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--dario reader__passage-color reader__passage-color--dario-blue"
            title="Tinta Azul Darío"
            aria-label="Tinta Azul Darío"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("dario")}
          />
        </div>
      </div>

      {/* 2. Reflexión Profunda */}
      <button
        type="button"
        className="selection-menu-btn selection-deep"
        title="Reflexión Profunda"
        aria-label="Reflexión Profunda"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          window.getSelection()?.removeAllRanges();
          setSelButton(null);
          setDeepModal(true);
        }}
      >
        <Icon name="retreat" size={14} />
        <span>Reflexión</span>
      </button>

      {/* 3. Crear Postal de Cita */}
      <button
        type="button"
        className="selection-menu-btn selection-card"
        title="Crear postal de cita"
        aria-label="Crear postal de cita"
        onPointerDown={(event) => event.preventDefault()}
        onClick={openQuoteCardFromSelection}
      >
        <Icon name="quote" size={14} />
        <span>Postal</span>
      </button>

      {/* 4. Preguntar al Gato */}
      <button
        type="button"
        className="selection-menu-btn selection-ask-cat"
        title="Preguntar al Gato"
        aria-label="Preguntar al Gato"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void askCatAboutSelection()}
      >
        <Icon name="sparkles" size={14} />
        <span>Preguntar</span>
      </button>

      {/* 5. Copiar: sustituye a la barra del sistema, que se oculta en táctil */}
      <button
        type="button"
        className="selection-menu-btn selection-copy"
        title="Copiar"
        aria-label="Copiar"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          const text = window.getSelection()?.toString() ?? "";
          if (text) void navigator.clipboard?.writeText(text).catch(() => {});
          window.getSelection()?.removeAllRanges();
          setSelButton(null);
        }}
      >
        <Icon name="text" size={14} />
        <span>Copiar</span>
      </button>
    </div>
    </>
  );
});