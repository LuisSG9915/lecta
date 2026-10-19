// Ancla de posición por texto: el inicio del bloque visible más alto.
// Sobrevive a cambios de letra, interlineado y ancho de columna porque
// restaura buscando el mismo texto, no una fracción de scroll.

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, pre, td";
const ANCHOR_LEN = 120;

export const normalizeBlockText = (text: string) => text.replace(/\s+/g, " ").trim();

// Texto del primer bloque que cruza la zona de lectura (parte alta de
// la ventana). Devuelve null si no hay bloques con texto.
export function anchorAtViewTop(container: HTMLElement): string | null {
  const horizon = Math.min(window.innerHeight * 0.5, 400);
  for (const el of container.querySelectorAll(BLOCK_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < horizon) {
      const text = normalizeBlockText(el.textContent ?? "").slice(0, ANCHOR_LEN);
      if (text) return text;
    }
  }
  return null;
}

// Muestra una insignia sutil («Continuar aquí») sobre el bloque restaurado.
export function showResumeAnchor(el: Element): void {
  document.querySelectorAll(".resume-anchor").forEach((node) => {
    node.classList.remove("resume-anchor");
  });
  el.classList.add("resume-anchor");
  window.setTimeout(() => {
    el.classList.remove("resume-anchor");
  }, 6000);
}

// Busca el bloque cuyo texto arranca como el ancla y lo lleva arriba.
// Devuelve false si no se encuentra (la sección cambió de contenido):
// quien llama cae a la restauración por fracción.
export function scrollToAnchor(
  container: HTMLElement,
  anchor: string,
  options?: { markResume?: boolean },
): boolean {
  const target = normalizeBlockText(anchor).slice(0, 40);
  if (!target) return false;
  for (const el of container.querySelectorAll(BLOCK_SELECTOR)) {
    const text = normalizeBlockText(el.textContent ?? "");
    // El ancla puede ser un corte del bloque (más corta) o incluir el
    // texto completo (más larga): basta que una sea prefijo de la otra.
    if (text && (text.startsWith(target) || target.startsWith(text))) {
      el.scrollIntoView({ block: "start" });
      if (options?.markResume) {
        showResumeAnchor(el);
      }
      return true;
    }
  }
  return false;
}

// Lleva un fragmento de destino (como `#s2` del índice) a la vista.
// El sanitizado conserva los ids del EPUB como `data-frag-id` para que
// no choquen con identificadores de la interfaz. Devuelve false si la
// sección no lo contiene — quien llama cae al ancla por texto.
export function scrollToFragment(
  container: HTMLElement,
  fragment: string,
): boolean {
  const el = container.querySelector(`[data-frag-id="${CSS.escape(fragment)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: "start" });
  flash(el);
  return true;
}

const flash = (el: Element) => {
  el.classList.remove("search-flash");
  // Forzar reflujo para reiniciar la animación si el bloque ya brilló.
  void (el as HTMLElement).offsetWidth;
  el.classList.add("search-flash");
};

// Busca un fragmento en cualquier punto de un bloque (no solo al
// inicio, como scrollToAnchor). Si el fragmento completo no cabe en un
// solo bloque, prueba con prefijos cada vez más cortos. Al ubicarlo lo
// centra y lo marca con un destello breve para que el ojo lo encuentre.
export function scrollToSnippet(container: HTMLElement, snippet: string): boolean {
  const target = normalizeBlockText(snippet);
  if (!target) return false;
  const blocks = [...container.querySelectorAll(BLOCK_SELECTOR)];
  for (let len = Math.min(80, target.length); len >= 24; len -= 16) {
    const piece = target.slice(0, len);
    for (const el of blocks) {
      const text = normalizeBlockText(el.textContent ?? "");
      if (text && text.includes(piece)) {
        el.scrollIntoView({ block: "center" });
        flash(el);
        return true;
      }
    }
  }
  return false;
}

import { targetAt, type ChapterRange, type ChapterTarget, type IntraSectionContext } from "./chapters";

/**
 * Resuelve el capítulo lógico activo considerando la sección física y el contexto intra-sección.
 */
export function describeReadingLocation(
  ranges: ChapterRange[],
  sectionIndex: number,
  context?: IntraSectionContext | string | null,
): ChapterTarget | null {
  return targetAt(ranges, sectionIndex, context);
}

/**
 * Encuentra el elemento visible más alto dentro del horizonte de lectura.
 */
export function findVisibleBlockAtViewTop(container: HTMLElement): HTMLElement | null {
  const horizon = Math.min(window.innerHeight * 0.5, 400);
  for (const el of container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < horizon) {
      const text = normalizeBlockText(el.textContent ?? "");
      if (text) return el;
    }
  }
  return null;
}

/**
 * Calcula el desplazamiento exacto en caracteres (charOffsetInChapter) de un párrafo o elemento
 * dentro del texto plano del capítulo para garantizar la barrera matemática Cero Spoilers.
 */
export function charOffsetOfElementInChapter(
  container: HTMLElement,
  targetEl: HTMLElement | null,
  chapterText?: string,
): number {
  if (!targetEl) return 0;

  if (chapterText) {
    const snippet = normalizeBlockText(targetEl.textContent ?? "").slice(0, 50);
    if (snippet) {
      const idx = chapterText.indexOf(snippet);
      if (idx !== -1) {
        return idx + (targetEl.textContent ?? "").length;
      }
    }
  }

  const blocks = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  let offset = 0;
  for (const el of blocks) {
    const len = (el.textContent ?? "").length;
    if (el === targetEl) {
      offset += len;
      break;
    }
    offset += len + 1;
  }
  return offset;
}

/**
 * Obtiene el charOffsetInChapter exacto del párrafo visible actual en la parte superior.
 */
export function charOffsetAtViewTop(
  container: HTMLElement,
  chapterText?: string,
): number {
  const visible = findVisibleBlockAtViewTop(container);
  return charOffsetOfElementInChapter(container, visible, chapterText);
}

export interface BookLocationData {
  cfi: string;
  fraction?: number;
  updatedAt?: number;
}

export function getBookLocation(bookId: string): BookLocationData | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`lecta:location:${bookId}`) : null;
    if (!raw) return null;
    return JSON.parse(raw) as BookLocationData;
  } catch {
    return null;
  }
}

export function saveBookLocation(bookId: string, loc: BookLocationData): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`lecta:location:${bookId}`, JSON.stringify(loc));
    }
  } catch {
    // ignore
  }
}

