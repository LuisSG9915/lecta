// «Foco de párrafo»: atempera el contraste de los párrafos ajenos a
// la zona activa de lectura — el párrafo enfocado brilla al 100% de tinta
// mientras el resto se atenúa con suavidad (estilo spotlight / contexto
// atenuado). Acompaña el scroll continuo de manera natural sin requerir
// interacción con el cursor del ratón.

export const FOCUSED_BLOCK_CLASS = "is-focused";

const BLOCK_SELECTOR = "p, blockquote, li";
const SKIP_ANCESTOR = ".section-preview-slot";

/**
 * Retira la clase de foco de todos los bloques del contenedor.
 */
export function clearParagraphFocus(root: ParentNode): void {
  root.querySelectorAll(`.${FOCUSED_BLOCK_CLASS}`).forEach((el) => {
    el.classList.remove(FOCUSED_BLOCK_CLASS);
  });
}

/**
 * Fija explícitamente el foco sobre un elemento y limpia a los hermanos.
 */
export function focusBlock(root: ParentNode, target: Element): void {
  const current = root.querySelectorAll(`.${FOCUSED_BLOCK_CLASS}`);
  if (current.length === 1 && current[0] === target) return;
  current.forEach((el) => {
    if (el !== target) el.classList.remove(FOCUSED_BLOCK_CLASS);
  });
  target.classList.add(FOCUSED_BLOCK_CLASS);
}

/**
 * Actualiza el bloque enfocado según la altura focal de la pantalla
 * (por defecto el tercio superior ~38% de la ventana, donde se posa la
 * vista habitualmente).
 *
 * Devuelve el elemento enfocado o null si no hay candidatos.
 */
export function updateParagraphFocus(
  root: ParentNode,
  targetY?: number,
): Element | null {
  const candidates = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => !el.closest(SKIP_ANCESTOR) && (el.textContent?.trim().length ?? 0) > 0,
  );

  if (candidates.length === 0) {
    clearParagraphFocus(root);
    return null;
  }

  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const focalY = targetY ?? Math.round(winH * 0.38);

  let best: Element | null = null;
  let minDistance = Infinity;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) continue;

    // En modos multicolumna o paginados, descartar lo que esté fuera de la pantalla visible.
    if (rect.right < 0 || rect.left > winW) continue;

    // Párrafo que cruza exactamente la línea focal:
    if (rect.top <= focalY && rect.bottom >= focalY) {
      best = el;
      break;
    }

    // Si ninguno cruza la línea exacta (p. ej. scroll al inicio o fin del texto),
    // elegimos el más cercano por distancia del centro vertical:
    const midY = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(midY - focalY);
    if (dist < minDistance) {
      minDistance = dist;
      best = el;
    }
  }

  if (best) {
    focusBlock(root, best);
    return best;
  }

  clearParagraphFocus(root);
  return null;
}
