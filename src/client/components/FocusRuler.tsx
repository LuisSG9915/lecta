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
}: {
  bandPx: number;
  // Ancla visual en el margen de la franja (la patita del gato).
  anchor?: ReactNode;
}) {
  // Arranca centrada (no pegada al tope esperando el primer
  // movimiento) y luego sigue al puntero.
  const [y, setY] = useState(() => Math.round(window.innerHeight * 0.42));

  useEffect(() => {
    const onMove = (event: PointerEvent) => setY(event.clientY);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const top = Math.max(
    0,
    Math.min(y - bandPx / 2, window.innerHeight - bandPx),
  );

  return (
    <div className="focus-ruler" aria-hidden="true">
      <div
        className="focus-ruler-veil"
        style={{ insetBlockStart: 0, blockSize: top }}
      />
      <div
        className="focus-ruler-band"
        style={{ insetBlockStart: top, blockSize: bandPx }}
      >
        {anchor ? <span className="focus-ruler-anchor">{anchor}</span> : null}
      </div>
      <div
        className="focus-ruler-veil"
        style={{ insetBlockStart: top + bandPx, insetBlockEnd: 0 }}
      />
    </div>
  );
}
