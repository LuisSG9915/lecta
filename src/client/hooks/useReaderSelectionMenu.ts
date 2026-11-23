// Menú de selección del lector: escucha `selectionchange`, clasifica la
// selección (una palabra → ficha, varias → barra de pasajes) y posiciona el menú.
//
// Extraído de Reader.tsx (R1). Debe llamarse en el mismo punto que el efecto
// original: los efectos corren en orden de declaración.
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { OverlayHandle } from "../lib/history";
import { classifySelection, isTouchInput } from "../lib/tap-intent-guard";
import { sameWordHit, wordHitFromRange, type WordHit } from "../lib/words";
import type { ReaderSelectionButton } from "../components/reader/ReaderSelectionBar";

const TOUCH_HANDLE_CLEARANCE_PX = 44;

type Ref<T> = { current: T };

export interface UseReaderSelectionMenuOptions {
  containerRef: Ref<HTMLElement | null>;
  language: string;
  lastPointerTypeRef: Ref<string>;
  reappliedRangeRef: Ref<Range | null>;
  selectionRef: Ref<WordHit | null>;
  keepNativeSelectionRef: Ref<boolean>;
  overlayReleaseRef: Ref<OverlayHandle | null>;
  selButtonVisibleRef: Ref<boolean>;
  setSelButton: Dispatch<SetStateAction<ReaderSelectionButton | null>>;
  openSelection: (hit: WordHit) => void;
  closeSelection: () => void;
}

export function useReaderSelectionMenu({
  containerRef,
  language,
  lastPointerTypeRef,
  reappliedRangeRef,
  selectionRef,
  keepNativeSelectionRef,
  overlayReleaseRef,
  selButtonVisibleRef,
  setSelButton,
  openSelection,
  closeSelection,
}: UseReaderSelectionMenuOptions): void {
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
      // Táctil: Android dibuja su barra «Copiar / Seleccionar todo» sobre la
      // selección nativa y no hay API para quitarla. Reaplicar la misma
      // selección por código la oculta (y también sus tiradores: el menú
      // pinta tiradores propios). Una vez por rango: el siguiente
      // selectionchange llega con el rango ya aplicado.
      if (isTouchInput(lastPointerTypeRef.current)) {
        const applied = reappliedRangeRef.current;
        const same =
          applied &&
          applied.startContainer === range.startContainer &&
          applied.startOffset === range.startOffset &&
          applied.endContainer === range.endContainer &&
          applied.endOffset === range.endOffset;
        if (!same) {
          const clone = range.cloneRange();
          reappliedRangeRef.current = clone;
          sel.removeAllRanges();
          sel.addRange(clone);
          return;
        }
      }

      const rawText = sel.toString().trim();
      const words = rawText.split(/\s+/).filter(Boolean);
      const singleWordHit = wordHitFromRange(range, container, language);
      const hit: WordHit | null =
        words.length <= 1
          ? singleWordHit ||
            (words[0] ? { word: words[0].replace(/[.,;:!?¡¿"«»()]/g, ""), context: rawText } : null)
          : null;
      const card = selectionRef.current;
      const isTouch = isTouchInput(lastPointerTypeRef.current);
      // Una palabra = ficha directa (Track 4, sin menú intermedio); dos o
      // más = barra de pasajes, cerrando antes la ficha. En táctil la
      // selección nativa queda viva para poder arrastrar los tiradores.
      const intent = classifySelection({
        words: words.length,
        emptyWord: !hit?.word,
        cardOpen: card !== null,
        sheetOpen: card === null && overlayReleaseRef.current !== null,
        sameWord: Boolean(card && hit && sameWordHit(card, hit)),
        isTouch,
      });
      if (intent === "ignore") {
        if (words.length >= 2) setSelButton(null);
        return;
      }
      if (intent === "open-card" && hit) {
        if (!isTouch) window.getSelection()?.removeAllRanges();
        openSelection(hit);
        return;
      }
      if (intent === "close-card-then-bar") {
        // La selección nativa sigue siendo la del menú: el efecto de
        // cierre de la ficha no debe soltarla.
        keepNativeSelectionRef.current = true;
        closeSelection();
      }

      if (words.length >= 2 || (isTouch && hit)) {
        let placement: "top" | "bottom" = isTouch ? "bottom" : "top";
        // En táctil el menú baja más allá de los tiradores nativos (que
        // cuelgan bajo la selección): encima los taparía y el arrastre caería
        // en el menú (visto por adb el 2026-11-11). Arriba queda la barra
        // «Copiar / Seleccionar todo» del sistema.
        const handleClearance = isTouch ? TOUCH_HANDLE_CLEARANCE_PX : 0;
        let y = isTouch ? rect.bottom + handleClearance : rect.top;
        // Reserva para la franja flotante + dock: el menú no debe caer
        // encima de la cápsula ni de las acciones de lectura.
        const bottomReserve = isTouch ? 190 : 96;

        if (
          placement === "bottom" &&
          rect.bottom + handleClearance + bottomReserve > window.innerHeight &&
          rect.top > bottomReserve
        ) {
          placement = "top";
          // En táctil, por encima de la barra del sistema.
          y = rect.top - (isTouch ? TOUCH_HANDLE_CLEARANCE_PX : 0);
        } else if (
          placement === "top" &&
          rect.top < bottomReserve &&
          rect.bottom + bottomReserve <= window.innerHeight
        ) {
          placement = "bottom";
          y = rect.bottom;
        }

        const centerX = rect.left + rect.width / 2;
        const menuHalfW = 170;
        const clampedX = Math.max(menuHalfW + 12, Math.min(centerX, window.innerWidth - menuHalfW - 12));

        setSelButton({
          x: clampedX,
          y,
          placement,
          word: words.length <= 1 && hit ? hit : undefined,
          touch: isTouch,
        });
      } else {
        setSelButton(null);
      }
    };
    const onSelection = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
    // `scroll` dispara en cada frame: sin esta guarda se pedía un
    // `setState(null)` por frame aunque no hubiera nada que ocultar.
    const hide = () => {
      if (!selButtonVisibleRef.current) return;
      selButtonVisibleRef.current = false;
      setSelButton(null);
    };
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", hide);
      window.clearTimeout(timer);
    };
  }, [
    language,
    openSelection,
    closeSelection,
    containerRef,
    keepNativeSelectionRef,
    lastPointerTypeRef,
    overlayReleaseRef,
    reappliedRangeRef,
    selButtonVisibleRef,
    selectionRef,
    setSelButton,
  ]);
}
