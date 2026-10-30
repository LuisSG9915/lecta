// Ancla de posición por texto: el inicio del bloque visible más alto.
// Sobrevive a cambios de letra, interlineado y ancho de columna porque
// restaura buscando el mismo texto, no una fracción de scroll.

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, pre, td";
const ANCHOR_LEN = 120;
// Un bloque más corto que esto no puede competir como ancla parcial
// («El» o un epígrafe de dos palabras casa con media sección y dejaría
// la lectura antes del punto real).
const MIN_PARTIAL_ANCHOR = 16;

export const normalizeBlockText = (text: string) => text.replace(/\s+/g, " ").trim();

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const viewTopHorizon = () => Math.min(window.innerHeight * 0.5, 400);

export interface ViewTopAnchor {
  text: string;
  /**
   * Fracción del bloque que quedó por encima del borde superior de la
   * ventana (0–1). Es la parte de la posición que el texto del ancla no
   * puede reconstruir: sin ella, restaurar planta el inicio del párrafo
   * y se pierde hasta una pantalla de lectura.
   */
  offset: number;
}

// Primer bloque que cruza la zona de lectura (parte alta de la ventana),
// con cuánto de él ya pasó por arriba. Devuelve null si no hay bloques
// con texto.
export function viewTopAnchor(container: HTMLElement): ViewTopAnchor | null {
  const horizon = viewTopHorizon();
  for (const el of container.querySelectorAll(BLOCK_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0) continue;
    const text = normalizeBlockText(el.textContent ?? "").slice(0, ANCHOR_LEN);
    if (!text) continue;
    const height = rect.height || el.scrollHeight || 0;
    // El bloque que contiene el borde superior de la ventana es el que se
    // está leyendo: su fracción reconstruye el punto exacto. Se guarda
    // como fracción, no como píxeles, para aguantar un cambio de letra o
    // de ancho de columna. Si el borde cae en el hueco entre dos bloques,
    // vale el siguiente con la fracción a cero.
    const containsTop = rect.top <= 0 && height > 0;
    if (containsTop) return { text, offset: clamp01(-rect.top / height) };
    if (rect.top < horizon) return { text, offset: 0 };
    return null;
  }
  return null;
}

// Texto del ancla visible (sin la fracción). Se mantiene porque el
// formato guardado en el servidor es solo texto.
export function anchorAtViewTop(container: HTMLElement): string | null {
  return viewTopAnchor(container)?.text ?? null;
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

// Busca el bloque que corresponde al ancla guardada. Prefiere el que
// empieza con el texto del ancla (el caso normal: el ancla es un prefijo
// del bloque) y solo si no hay ninguno acepta un bloque entero que el
// ancla contenga, que es lo que pasa cuando el texto se partió en dos
// bloques al cambiar el marcado.
function findAnchorBlock(
  container: HTMLElement,
  target: string,
): HTMLElement | null {
  const blocks = [...container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];
  for (const el of blocks) {
    const text = normalizeBlockText(el.textContent ?? "");
    if (text && text.startsWith(target)) return el;
  }
  let best: HTMLElement | null = null;
  let bestLen = MIN_PARTIAL_ANCHOR - 1;
  for (const el of blocks) {
    const text = normalizeBlockText(el.textContent ?? "");
    if (text.length > bestLen && target.startsWith(text)) {
      best = el;
      bestLen = text.length;
    }
  }
  return best;
}

// Busca el bloque cuyo texto arranca como el ancla y lo lleva arriba,
// respetando la fracción del bloque que ya se había leído (`offset`).
// Devuelve false si no se encuentra (la sección cambió de contenido):
// quien llama cae a la restauración por fracción.
export function scrollToAnchor(
  container: HTMLElement,
  anchor: string,
  options?: { markResume?: boolean; offset?: number },
): boolean {
  const target = normalizeBlockText(anchor).slice(0, 40);
  if (!target) return false;
  const el = findAnchorBlock(container, target);
  if (!el) return false;
  const offset = clamp01(options?.offset ?? 0);
  if (offset > 0) {
    // La lectura estaba a media página dentro del bloque: se recoloca la
    // misma fracción (proporcional, para aguantar un reflujo) en vez de
    // plantar el inicio del párrafo.
    const rect = el.getBoundingClientRect();
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const y = rect.top + window.scrollY - offset * rect.height;
    window.scrollTo(0, Math.min(Math.max(0, y), max));
  } else {
    el.scrollIntoView({ block: "start" });
  }
  if (options?.markResume) {
    showResumeAnchor(el);
  }
  return true;
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

const ANCHOR_TOLERANCE_PX = 12;
const ANCHOR_KEEP_MS = 2_500;
// Ventana extendida para reflujos tardíos de imágenes lentas (redes 3G/móviles).
const MEDIA_LATE_REFLOW_MS = 15_000;
// Ventana en la que la colocación recién restaurada se revisa cuadro a
// cuadro: la primera medida puede caer con los estilos a medio aplicar.
const ANCHOR_SETTLE_MS = 400;

// Después de restaurar, el contenido puede crecer por arriba un rato
// más: asientan las fuentes, el cromo del lector o las imágenes de la
// sección. El bloque ancla se hunde y la lectura aparece unas líneas
// antes de donde estaba (eso es el «no respeta la posición»). Aquí se
// corrige solo el desvío medido, desplazando por la diferencia: si la
// persona ya se movió, se la respeta.
export function keepAnchorStable(
  container: HTMLElement,
  anchor: string,
  offset = 0,
  options?: {
    durationMs?: number;
    mediaTimeoutMs?: number;
    tolerancePx?: number;
    settleMs?: number;
  },
): () => void {
  const target = normalizeBlockText(anchor).slice(0, 40);
  if (!target) return () => {};
  const fraction = clamp01(offset);
  const tolerance = options?.tolerancePx ?? ANCHOR_TOLERANCE_PX;
  const settleMs = options?.settleMs ?? ANCHOR_SETTLE_MS;
  const start = Date.now();
  const rafDeadline = start + (options?.durationMs ?? ANCHOR_KEEP_MS);
  const mediaDeadline =
    start + Math.max(options?.durationMs ?? ANCHOR_KEEP_MS, options?.mediaTimeoutMs ?? MEDIA_LATE_REFLOW_MS);

  let stopped = false;
  let rafFinished = false;
  let lastHeight = -1;
  let frame = 0;
  let mediaCleanupTimer: number | null = null;
  let node: HTMLElement | null = null;
  const imgCleanups: Array<() => void> = [];

  const correct = () => {
    if (stopped) return;
    if (Date.now() > mediaDeadline) {
      stop();
      return;
    }
    if (!node || !node.isConnected) node = findAnchorBlock(container, target);
    const el = node;
    if (!el || !el.isConnected) return;
    const rect = el.getBoundingClientRect();
    const height = rect.height || el.scrollHeight;
    if (height <= 0) return;
    const delta = rect.top + fraction * height;
    if (Math.abs(delta) <= tolerance) return;
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const next = Math.min(Math.max(0, window.scrollY + delta), max);
    if (Math.abs(next - window.scrollY) >= 1) window.scrollTo(0, next);
  };

  const tick = () => {
    if (stopped || rafFinished) return;
    const height = document.documentElement.scrollHeight;
    if (Date.now() - start < settleMs || height !== lastHeight) {
      lastHeight = height;
      correct();
    }
    // Al cumplir los 2.500 ms se apaga solo el bucle RAF por cuadro,
    // pero se mantienen vivos los listeners de imágenes lentas hasta mediaDeadline
    // siempre que la persona no haya interactuado.
    if (Date.now() >= rafDeadline) {
      rafFinished = true;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    rafFinished = true;
    cancelAnimationFrame(frame);
    if (mediaCleanupTimer !== null) window.clearTimeout(mediaCleanupTimer);
    container.removeEventListener("load", onMediaLoad, true);
    while (imgCleanups.length > 0) imgCleanups.pop()?.();
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("wheel", stop, true);
    window.removeEventListener("touchstart", stop, true);
    window.removeEventListener("touchmove", stop, true);
    window.removeEventListener("keydown", stop, true);
  };

  const onMediaLoad = () => {
    if (stopped) return;
    lastHeight = document.documentElement.scrollHeight;
    correct();
  };

  // Registrar listeners directos sobre cada <img> pendiente y ResizeObserver
  // para cubrir decodificaciones asíncronas tardías después de los 2.500 ms.
  const images = container.querySelectorAll<HTMLImageElement>("img");
  images.forEach((img) => {
    if (img.complete && img.naturalHeight > 0) return;
    const onImgSettled = () => {
      if (stopped) return;
      if (typeof img.decode === "function") {
        void img.decode().then(onMediaLoad).catch(onMediaLoad);
      } else {
        onMediaLoad();
      }
    };
    img.addEventListener("load", onImgSettled, { once: true });
    img.addEventListener("error", onImgSettled, { once: true });
    imgCleanups.push(() => {
      img.removeEventListener("load", onImgSettled);
      img.removeEventListener("error", onImgSettled);
    });
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!stopped && rafFinished) onMediaLoad();
    });
    ro.observe(container);
    imgCleanups.push(() => ro.disconnect());
  }

  container.addEventListener("load", onMediaLoad, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("wheel", stop, true);
  window.addEventListener("touchstart", stop, true);
  window.addEventListener("touchmove", stop, true);
  window.addEventListener("keydown", stop, true);

  mediaCleanupTimer = window.setTimeout(
    stop,
    Math.max(0, mediaDeadline - start),
  );

  const fonts = (
    document as Document & { fonts?: { ready?: Promise<unknown> } }
  ).fonts;
  void fonts?.ready?.then(() => correct()).catch(() => undefined);
  lastHeight = document.documentElement.scrollHeight;
  frame = requestAnimationFrame(tick);

  return stop;
}

/**
 * Encuentra el elemento visible más alto dentro del horizonte de lectura.
 */
export function findVisibleBlockAtViewTop(container: HTMLElement): HTMLElement | null {
  const horizon = viewTopHorizon();
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

