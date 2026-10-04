// Pila de vistas y hojas sincronizada con el historial del navegador,
// para que «atrás» cierre primero lo más reciente en vez de salir de
// la app. Cada entrada se abre con pushOverlay dentro del evento que
// la crea (nunca en un efecto: así no hay dobles pushes en StrictMode).

type Entry = { id: number; close: () => void };

export interface OverlayHandle {
  // Cierra por programa: quita la entrada y retrocede el historial.
  // No hace nada si la entrada ya salió vía «atrás».
  release(): void;
  // Cambia qué cierra la entrada sin crear otra: sirve cuando una
  // capa sustituye a otra del mismo nivel (p. ej. una hoja por otra),
  // así no hay release+push y el back() asíncrono no se traga la
  // entrada nueva.
  swap(next: () => void): void;
}

const stack: Entry[] = [];
let listening = false;
let seq = 0;

const currentOverlayId = () =>
  (history.state as { lecta?: number } | null)?.lecta ?? 0;

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    const current = currentOverlayId();
    while (stack.length && stack[stack.length - 1].id > current) {
      stack.pop()?.close();
    }
  });
}

export function pushOverlay(close: () => void): OverlayHandle {
  ensureListener();
  const entry: Entry = { id: ++seq, close };
  stack.push(entry);
  history.pushState({ lecta: entry.id }, "");
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const index = stack.indexOf(entry);
      if (index === -1) return; // ya salió vía popstate
      stack.splice(index, 1);
      history.back();
    },
    swap(next: () => void) {
      if (!released && stack.includes(entry)) entry.close = next;
    },
  };
}
