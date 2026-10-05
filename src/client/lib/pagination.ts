import { normalizeBlockText } from "./reading-location";

// Paginación por columnas CSS: el contenido fluye en columnas de la
// altura del visor y cada página muestra `numCols` columnas. La página
// se desplaza con translateX; la posición se deriva del texto (ancla),
// nunca del número de página, que cambia con la fuente y la ventana.

export type PageLayout = {
  numCols: number; // columnas visibles por página (1 móvil, 1–2 escritorio)
  colW: number; // ancho real de cada columna en px
  gap: number;
  boxW: number; // ancho de la caja que produjo esas columnas
};

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, pre, td";

// Reparte el ancho útil en columnas: `minColW` es el ancho mínimo que
// cada columna debería tener (la medida de lectura). Con caja angosta
// sale una sola columna — degradación natural a móvil.
export function pageLayout(boxW: number, minColW: number, gap: number): PageLayout {
  const numCols = Math.max(1, Math.floor((boxW + gap) / (minColW + gap)));
  const colW = (boxW + gap) / numCols - gap;
  return { numCols, colW, gap, boxW };
}

// Cada página avanza numCols columnas completas más un gap.
export const pageAdvance = (boxW: number, gap: number) => boxW + gap;

// Total de columnas que ocupa el contenido (scrollWidth incluye las
// que quedan fuera aunque estén recortadas).
export const totalColumns = (scrollW: number, l: PageLayout) =>
  Math.max(1, Math.round((scrollW + l.gap) / (l.colW + l.gap)));

export const totalPages = (scrollW: number, l: PageLayout) =>
  Math.max(1, Math.ceil(totalColumns(scrollW, l) / l.numCols));

// Columna en la que cae una coordenada X dentro del contenido.
export const columnOfOffset = (x: number, l: PageLayout) =>
  Math.max(0, Math.round(x / (l.colW + l.gap)));

export const pageOfColumn = (col: number, l: PageLayout) =>
  Math.floor(col / l.numCols);

export const firstColumnOfPage = (page: number, l: PageLayout) =>
  page * l.numCols;

const blocks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter(
    (el) => normalizeBlockText(el.textContent ?? ""),
  );

// Página del bloque: offsetLeft da la columna (el transform del
// contenedor no afecta offsetLeft — mide el flujo sin desplazar).
export function pageOfElement(el: HTMLElement, l: PageLayout): number {
  return pageOfColumn(columnOfOffset(el.offsetLeft, l), l);
}

// Texto del primer bloque de la página: el ancla que se guarda y con
// la que se restaura tras cambios de fuente o tamaño de ventana.
export function anchorAtPage(
  container: HTMLElement,
  l: PageLayout,
  page: number,
): string | null {
  const first = firstColumnOfPage(page, l);
  for (const el of blocks(container)) {
    if (columnOfOffset(el.offsetLeft, l) >= first)
      return normalizeBlockText(el.textContent ?? "").slice(0, 120) || null;
  }
  return null;
}

// Página donde aparece un ancla (inicio de bloque) o un fragmento
// (cualquier punto del bloque). Devuelve null si el texto no está.
export function pageForText(
  container: HTMLElement,
  target: string,
  l: PageLayout,
  mode: "anchor" | "snippet",
  flashEl = true,
): number | null {
  const needle = normalizeBlockText(target);
  if (!needle) return null;
  const lengths =
    mode === "anchor" ? [Math.min(40, needle.length)] : [80, 64, 48, 32, 24];
  for (const len of lengths) {
    const piece = needle.slice(0, Math.min(len, needle.length));
    if (!piece) break;
    for (const el of blocks(container)) {
      const text = normalizeBlockText(el.textContent ?? "");
      if (!text) continue;
      const hit =
        mode === "anchor"
          ? text.startsWith(piece) || piece.startsWith(text)
          : text.includes(piece);
      if (hit) {
        if (flashEl) flash(el);
        return pageOfElement(el, l);
      }
    }
    if (mode === "anchor") break;
  }
  return null;
}

// Página donde vive un fragmento (`#s2` del índice; el sanitizado lo
// conserva como `data-frag-id`). Devuelve null si no está en la sección.
export function pageForFragment(
  container: HTMLElement,
  fragment: string,
  l: PageLayout,
): number | null {
  const el = container.querySelector<HTMLElement>(
    `[data-frag-id="${CSS.escape(fragment)}"]`,
  );
  if (!el) return null;
  flash(el);
  return pageOfElement(el, l);
}

const flash = (el: Element) => {
  el.classList.remove("search-flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("search-flash");
};
