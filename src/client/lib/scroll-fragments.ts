// Fragmento activo durante el scroll continuo. El lector marcaba cada
// párrafo con `data-frag-id` y, en cada frame, recorría todos los nodos
// del capítulo con `getBoundingClientRect()` — en un capítulo de 300
// bloques eso son 300 lecturas de layout por frame: el grueso del calor
// al leer. Aquí la lista se cachea por contenedor y el fragmento se
// busca por bisección (O(log N) lecturas).
//
// La caché se invalida sola cuando el contenedor cambia de contenido
// (otro capítulo) o cuando los nodos guardados salen del documento.

const FRAG_CACHE = new WeakMap<
  HTMLElement,
  { count: number; first: Element | null; list: HTMLElement[] }
>();

/** Nodos `[data-frag-id]` del contenedor, en orden documental. */
export function fragElements(root: HTMLElement): HTMLElement[] {
  const cached = FRAG_CACHE.get(root);
  if (
    cached &&
    cached.count === root.childElementCount &&
    cached.first === root.firstElementChild &&
    (cached.list.length === 0 || cached.list[0].isConnected)
  ) {
    return cached.list;
  }
  const list = Array.from(
    root.querySelectorAll<HTMLElement>("[data-frag-id]"),
  );
  FRAG_CACHE.set(root, {
    count: root.childElementCount,
    first: root.firstElementChild,
    list,
  });
  return list;
}

/** Invalida la caché de un contenedor (cambio de sección o de DOM). */
export function invalidateFragments(root: HTMLElement): void {
  FRAG_CACHE.delete(root);
}

// Recorrido lineal: el de siempre, para maquetaciones donde el orden
// vertical de los nodos no es monótono (columnas del modo paginado).
function linearActiveFragment(
  list: HTMLElement[],
  threshold: number,
): string | null {
  let best: string | null = null;
  for (const el of list) {
    if (el.getBoundingClientRect().top <= threshold) {
      best = el.getAttribute("data-frag-id");
    }
  }
  return best;
}

/**
 * `data-frag-id` del último fragmento cuyo borde superior ya pasó el
 * umbral (`threshold`, en píxeles de viewport).
 *
 * Por defecto usa bisección (el flujo de scroll es una sola columna en
 * orden documental) y cae al recorrido lineal si el orden no es monótono
 * alrededor del pivote. En modo paginado (`paged: true`) las columnas
 * rompen el orden vertical: ahí manda el recorrido de siempre.
 */
export function activeFragmentAt(
  list: HTMLElement[],
  threshold: number,
  paged = false,
): string | null {
  if (paged) return linearActiveFragment(list, threshold);
  if (list.length === 0) return null;
  let lo = 0;
  let hi = list.length - 1;
  let pivot = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].getBoundingClientRect().top <= threshold) {
      pivot = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (pivot < 0) return null;
  // Verificación de monotonía: un pivote cuyo vecino de abajo quedó más
  // arriba significa columnas (o un DOM que ya no es lineal).
  if (pivot + 1 < list.length) {
    const here = list[pivot].getBoundingClientRect().top;
    const next = list[pivot + 1].getBoundingClientRect().top;
    if (next < here - 1) return linearActiveFragment(list, threshold);
  }
  return list[pivot].getAttribute("data-frag-id");
}
