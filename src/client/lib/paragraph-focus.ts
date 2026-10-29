// «Foco de párrafo»: atempera el contraste de los párrafos ajenos a
// la zona activa de lectura — el párrafo enfocado brilla al 100% de tinta
// mientras el resto se atenúa con suavidad (estilo spotlight / contexto
// atenuado). Acompaña el scroll continuo de manera natural sin requerir
// interacción con el cursor del ratón.

export const FOCUSED_BLOCK_CLASS = "is-focused";

/** Opacidad suave para párrafos fuera del foco actual en tema claro */
export const FOCUS_DIM_OPACITY_LIGHT = 0.32;
/** Opacidad suave para párrafos fuera del foco actual en tema oscuro */
export const FOCUS_DIM_OPACITY_DARK = 0.28;

export function getFocusDimOpacity(isDark = false): number {
  return isDark ? FOCUS_DIM_OPACITY_DARK : FOCUS_DIM_OPACITY_LIGHT;
}

const BLOCK_SELECTOR = "p, blockquote, li";
const SKIP_ANCESTOR = ".section-preview-slot";

// La lista de candidatos se recorre en cada frame de scroll: reconstruirla
// con `querySelectorAll` + `textContent` era el gasto dominante. Se cachea
// por contenedor y se invalida cuando el contenido cambia de verdad (otro
// capítulo) o cuando los nodos cachedeados dejan de estar en el documento.
const CANDIDATE_CACHE = new WeakMap<
  ParentNode,
  { count: number; first: Element | null; list: Element[] }
>();

function cacheIsFresh(
  root: ParentNode,
  cached: { count: number; first: Element | null; list: Element[] },
): boolean {
  if (cached.count !== root.childElementCount) return false;
  if (cached.first !== root.firstElementChild) return false;
  return cached.list.length === 0 || cached.list[0].isConnected;
}

/**
 * Obtiene los párrafos y bloques candidatos válidos dentro del contenedor.
 */
export function getParagraphCandidates(root: ParentNode): Element[] {
  const cached = CANDIDATE_CACHE.get(root);
  if (cached && cacheIsFresh(root, cached)) return cached.list;
  const list = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) =>
      !el.closest(SKIP_ANCESTOR) && (el.textContent?.trim().length ?? 0) > 0,
  );
  CANDIDATE_CACHE.set(root, {
    count: root.childElementCount,
    first: root.firstElementChild,
    list,
  });
  return list;
}

/** Invalida la caché de un contenedor (cambio de capítulo, re-maquetado). */
export function invalidateParagraphCandidates(root: ParentNode): void {
  CANDIDATE_CACHE.delete(root);
}

/**
 * Obtiene el bloque actualmente enfocado en el contenedor.
 */
export function getCurrentFocusedBlock(root: ParentNode): Element | null {
  return root.querySelector(`.${FOCUSED_BLOCK_CLASS}`);
}

/**
 * Aplica opacidad suave a los bloques del contenedor (100% al enfocado,
 * 0.32 / 0.28 a los no enfocados) manteniendo contraste pleno en el activo.
 */
export function applyParagraphFocusStyles(
  root: ParentNode,
  focusedTarget?: Element | null,
  isDark = false,
): void {
  const dimOpacity = getFocusDimOpacity(isDark);
  const candidates = getParagraphCandidates(root);
  for (const el of candidates) {
    if (el === focusedTarget) {
      (el as HTMLElement).style.setProperty("opacity", "1");
    } else {
      (el as HTMLElement).style.setProperty("opacity", String(dimOpacity));
    }
  }
}

/**
 * Retira la clase de foco de todos los bloques del contenedor y limpia estilos de opacidad inline.
 */
export function clearParagraphFocus(root: ParentNode): void {
  root.querySelectorAll(`.${FOCUSED_BLOCK_CLASS}`).forEach((el) => {
    el.classList.remove(FOCUSED_BLOCK_CLASS);
  });
  const candidates = getParagraphCandidates(root);
  for (const el of candidates) {
    (el as HTMLElement).style.removeProperty("opacity");
  }
}

/**
 * Fija explícitamente el foco sobre un elemento y limpia a los hermanos.
 */
export function focusBlock(
  root: ParentNode,
  target: Element,
  options?: { isDark?: boolean; applyInlineOpacity?: boolean },
): void {
  const current = root.querySelectorAll(`.${FOCUSED_BLOCK_CLASS}`);
  if (current.length === 1 && current[0] === target) {
    if (options?.applyInlineOpacity) {
      applyParagraphFocusStyles(root, target, options.isDark);
    }
    return;
  }
  current.forEach((el) => {
    if (el !== target) el.classList.remove(FOCUSED_BLOCK_CLASS);
  });
  target.classList.add(FOCUSED_BLOCK_CLASS);
  if (options?.applyInlineOpacity) {
    applyParagraphFocusStyles(root, target, options.isDark);
  }
}

/**
 * Avanza el foco al siguiente párrafo legible. Si no hay ninguno enfocado, enfoca el primero.
 */
export function focusNextParagraph(
  root: ParentNode,
  options?: {
    isDark?: boolean;
    applyInlineOpacity?: boolean;
    scrollIntoView?: boolean;
  },
): Element | null {
  const candidates = getParagraphCandidates(root);
  if (candidates.length === 0) return null;
  const current = getCurrentFocusedBlock(root);
  let next: Element;
  if (!current) {
    next = candidates[0];
  } else {
    const idx = candidates.indexOf(current);
    if (idx >= 0 && idx + 1 < candidates.length) {
      next = candidates[idx + 1];
    } else {
      next = current;
    }
  }
  focusBlock(root, next, options);
  if (options?.scrollIntoView && typeof next.scrollIntoView === "function") {
    next.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  return next;
}

/**
 * Retrocede el foco al párrafo anterior. Si no hay ninguno enfocado, enfoca el último.
 */
export function focusPrevParagraph(
  root: ParentNode,
  options?: {
    isDark?: boolean;
    applyInlineOpacity?: boolean;
    scrollIntoView?: boolean;
  },
): Element | null {
  const candidates = getParagraphCandidates(root);
  if (candidates.length === 0) return null;
  const current = getCurrentFocusedBlock(root);
  let prev: Element;
  if (!current) {
    prev = candidates[candidates.length - 1];
  } else {
    const idx = candidates.indexOf(current);
    if (idx > 0) {
      prev = candidates[idx - 1];
    } else {
      prev = current;
    }
  }
  focusBlock(root, prev, options);
  if (options?.scrollIntoView && typeof prev.scrollIntoView === "function") {
    prev.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  return prev;
}

export interface ParagraphFocusInteractionOptions {
  isDark?: boolean;
  applyInlineOpacity?: boolean;
  scrollIntoView?: boolean;
  onFocusChanged?: (element: Element) => void;
}

/**
 * Maneja atajos de teclado (Flechas Arriba/Abajo o J/K) para navegar párrafos con el foco activo.
 */
export function handleParagraphFocusKey(
  event: KeyboardEvent,
  root: ParentNode,
  options?: ParagraphFocusInteractionOptions,
): Element | null {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return null;
  }

  let focused: Element | null = null;
  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    focused = focusNextParagraph(root, options);
  } else if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    focused = focusPrevParagraph(root, options);
  }

  if (focused && options?.onFocusChanged) {
    options.onFocusChanged(focused);
  }
  return focused;
}

/**
 * Permite cambiar de párrafo enfocado en 1 toque al pulsar directamente sobre cualquier párrafo.
 */
export function setupParagraphFocusClick(
  root: HTMLElement,
  options?: ParagraphFocusInteractionOptions,
): () => void {
  const onClick = (e: MouseEvent) => {
    const target = (e.target as Element)?.closest(BLOCK_SELECTOR);
    if (target && root.contains(target) && !target.closest(SKIP_ANCESTOR)) {
      focusBlock(root, target, options);
      if (options?.onFocusChanged) {
        options.onFocusChanged(target);
      }
    }
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
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
  const candidates = getParagraphCandidates(root);

  if (candidates.length === 0) {
    clearParagraphFocus(root);
    return null;
  }

  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const focalY = targetY ?? Math.round(winH * 0.38);

  // Los bloques van en orden documental: el que cruza la línea focal se
  // busca con bisección (O(log M) lecturas de rect) en vez de recorrer el
  // capítulo entero en cada frame. La ventana de comprobación absorbe el
  // caso de bloques de altura 0 o columnas fuera de pantalla.
  let lo = 0;
  let hi = candidates.length - 1;
  let pivot = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candidates[mid].getBoundingClientRect().top <= focalY) {
      pivot = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (pivot >= 0) {
    const start = Math.max(0, pivot);
    for (let i = start; i < Math.min(candidates.length, start + 3); i += 1) {
      const el = candidates[i];
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      if (rect.right < 0 || rect.left > winW) continue;
      if (rect.top <= focalY && rect.bottom >= focalY) {
        focusBlock(root, el);
        return el;
      }
    }
  }

  // Sin cruce exacto (inicio o fin del texto, o maquetación en columnas
  // que rompe el orden vertical): el más cercano por distancia.
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
