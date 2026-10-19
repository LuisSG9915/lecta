// Regla de enfoque: una franja clara que sigue el puntero y vela el
// resto del texto con una máscara translúcida del color del papel —
// funciona igual en tema claro y oscuro sin tocar el render del
// libro. pointer-events:none: el velo nunca estorba el paso de
// página, la selección ni la consulta de palabras.
// Cuenta con tirador lateral para fijar (pin) o arrastrar manualmente.

import React, { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RulerSize } from "../lib/settings";

// «Párrafo» como alto de banda: un párrafo típico de 5–6 líneas a la
// medida habitual del lector (no medimos el párrafo real bajo el
// puntero — la aproximación fija evita saltos de altura al moverse).
export const RULER_PARAGRAPH_LINES = 6;

// Alto de la franja clara en px: N veces la altura de línea real
// (tamaño × interlineado del ajuste vigente).
export function rulerBandPx(size: RulerSize, linePx: number): number {
  const lines = size === "paragraph" ? RULER_PARAGRAPH_LINES : size;
  return Math.max(1, Math.round(lines * linePx));
}

export interface FocusRulerProps {
  enabled?: boolean;
  heightPx?: number;
  bandPx?: number;
  initialY?: number;
  // Ancla visual en el margen de la franja (la patita del gato).
  anchor?: ReactNode;
  // Posición Y de párrafo enfocado para seguimiento automático
  activeParagraphY?: number | null;
  // Alto de línea para el paso con flechas del teclado
  lineHeightPx?: number;
  // Callback para cerrar la regla de lectura en 1 toque
  onClose?: () => void;
}

export function FocusRuler({
  enabled = true,
  heightPx,
  bandPx,
  initialY = 220,
  anchor,
  activeParagraphY,
  lineHeightPx = 28,
  onClose,
}: FocusRulerProps) {
  const effectiveBandPx = heightPx ?? bandPx ?? 56;
  const [y, setY] = useState<number>(() => {
    if (typeof activeParagraphY === "number" && !Number.isNaN(activeParagraphY)) {
      return activeParagraphY;
    }
    if (typeof window !== "undefined") {
      return Math.round(window.innerHeight * 0.42);
    }
    return initialY;
  });
  const [pinned, setPinned] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  // Seguimiento del movimiento del ratón
  useEffect(() => {
    if (!enabled || pinned || dragging) return;
    const handleMove = (e: MouseEvent) => {
      setY(e.clientY);
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, [enabled, pinned, dragging]);

  // Seguimiento de pointermove (compatibilidad con lápiz y tests)
  useEffect(() => {
    if (!enabled || pinned || dragging) return;
    const handlePointerMoveEvt = (e: PointerEvent) => {
      setY(e.clientY);
    };
    window.addEventListener("pointermove", handlePointerMoveEvt, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMoveEvt);
  }, [enabled, pinned, dragging]);

  // Soporte táctil con el dedo (touchmove)
  useEffect(() => {
    if (!enabled || pinned || dragging) return;
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        setY(event.touches[0].clientY);
      }
    };
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => window.removeEventListener("touchmove", handleTouchMove);
  }, [enabled, pinned, dragging]);

  // Seguimiento automático del párrafo enfocado cuando no está fijado ni arrastrándose
  const [prevActiveY, setPrevActiveY] = useState(activeParagraphY);
  if (
    !pinned &&
    !dragging &&
    typeof activeParagraphY === "number" &&
    !Number.isNaN(activeParagraphY) &&
    activeParagraphY !== prevActiveY
  ) {
    setPrevActiveY(activeParagraphY);
    setY(activeParagraphY);
  }

  // Atajos de teclado: flechas Arriba / Abajo para desplazar la regla renglón a renglón
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const step = Math.max(20, Math.round(lineHeightPx));
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setY((prev) => Math.max(0, prev - step));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setY((prev) =>
          Math.min(
            typeof window !== "undefined" ? window.innerHeight : 800,
            prev + step,
          ),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, lineHeightPx]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignorar fallo de pointer capture en entornos sin soporte (p.ej. jsdom)
    }
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const winH = typeof window !== "undefined" ? window.innerHeight : 800;
    const clampedY = Math.max(64, Math.min(winH - 96, e.clientY));
    setY(clampedY);
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignorar fallo de pointer capture en entornos sin soporte
    }
    setDragging(false);
  }, [dragging]);

  if (!enabled || isDismissed) return null;

  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const top = Math.max(0, Math.min(y - effectiveBandPx / 2, winH - effectiveBandPx));

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDismissed(true);
    onClose?.();
  };

  return (
    <div
      className={`focus-ruler ${pinned ? "is-pinned" : ""}`}
      style={{
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      <div
        className="focus-ruler-veil focus-ruler-veil--top focus-ruler__mask"
        style={{ insetBlockStart: 0, blockSize: top }}
      />
      <div
        className="focus-ruler-band"
        style={{ insetBlockStart: top, blockSize: effectiveBandPx }}
      >
        {anchor ? <span className="focus-ruler-anchor">{anchor}</span> : null}

        <button
          type="button"
          className="focus-ruler__handle"
          aria-label={pinned ? "Desbloquear regla de enfoque" : "Fijar o arrastrar regla de enfoque"}
          title={pinned ? "Toca para desbloquear · Arrastra para mover" : "Toca para fijar · Arrastra para mover"}
          onClick={(e) => {
            e.stopPropagation();
            setPinned((prev) => !prev);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span className="focus-ruler__grip">{pinned ? "📌" : "⋮"}</span>
        </button>

        <button
          type="button"
          className="focus-ruler-close-btn"
          onClick={handleClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Cerrar regla de lectura"
          title="Cerrar regla de lectura (1 toque)"
          style={{
            pointerEvents: "auto",
            position: "absolute",
            insetInlineEnd: "48px",
            insetBlockStart: "50%",
            transform: "translateY(-50%)",
            width: "28px",
            height: "28px",
            borderRadius: "9999px",
            background: "rgba(0, 0, 0, 0.08)",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            color: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            fontWeight: 500,
            lineHeight: 1,
            padding: 0,
            zIndex: 10,
            opacity: 0.85,
          }}
        >
          ✕
        </button>
      </div>
      <div
        className="focus-ruler-veil focus-ruler-veil--bottom focus-ruler__mask"
        style={{ insetBlockStart: top + effectiveBandPx, insetBlockEnd: 0 }}
      />
    </div>
  );
}
