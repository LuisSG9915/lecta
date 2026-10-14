// Regla de enfoque: una franja clara que sigue el puntero y vela el
// resto del texto con una máscara translúcida del color del papel —
// funciona igual en tema claro y oscuro sin tocar el render del
// libro. pointer-events:none: el velo nunca estorba el paso de
// página, la selección ni la consulta de palabras.

import { useEffect, useState, type ReactNode } from "react";
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

export function FocusRuler({
  bandPx,
  anchor,
  activeParagraphY,
  lineHeightPx = 28,
}: {
  bandPx: number;
  // Ancla visual en el margen de la franja (la patita del gato).
  anchor?: ReactNode;
  // Posición Y de párrafo enfocado para seguimiento automático
  activeParagraphY?: number | null;
  // Alto de línea para el paso con flechas del teclado
  lineHeightPx?: number;
}) {
  // Arranca centrada (no pegada al tope esperando el primer
  // movimiento) y luego sigue al puntero o párrafo enfocado.
  const [y, setY] = useState(() => Math.round(window.innerHeight * 0.42));

  // Seguimiento del puntero (ratón o lápiz)
  useEffect(() => {
    const onMove = (event: PointerEvent) => setY(event.clientY);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Soporte táctil fluido con el dedo
  useEffect(() => {
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        setY(event.touches[0].clientY);
      }
    };
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => window.removeEventListener("touchmove", onTouchMove);
  }, []);

  // Seguimiento automático del párrafo enfocado
  const [prevActiveY, setPrevActiveY] = useState(activeParagraphY);
  if (
    typeof activeParagraphY === "number" &&
    !Number.isNaN(activeParagraphY) &&
    activeParagraphY !== prevActiveY
  ) {
    setPrevActiveY(activeParagraphY);
    setY(activeParagraphY);
  }

  // Atajos de teclado: flechas Arriba / Abajo para desplazar la regla renglón a renglón
  useEffect(() => {
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
        setY((prev) => Math.min(window.innerHeight, prev + step));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lineHeightPx]);

  const top = Math.max(
    0,
    Math.min(y - bandPx / 2, window.innerHeight - bandPx),
  );

  return (
    <div className="focus-ruler" aria-hidden="true">
      <div
        className="focus-ruler-veil focus-ruler-veil--top"
        style={{ insetBlockStart: 0, blockSize: top }}
      />
      <div
        className="focus-ruler-band"
        style={{ insetBlockStart: top, blockSize: bandPx }}
      >
        {anchor ? <span className="focus-ruler-anchor">{anchor}</span> : null}
      </div>
      <div
        className="focus-ruler-veil focus-ruler-veil--bottom"
        style={{ insetBlockStart: top + bandPx, insetBlockEnd: 0 }}
      />
    </div>
  );
}
