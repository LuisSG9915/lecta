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

// release() encola un back() que consume el hueco que dejó la entrada
// en el historial. El retroceso es asíncrono: si el usuario empuja
// otra capa antes de que aterrice (abrir el Cuaderno tras cerrar la
// hoja del gato), su popstate la confundiría con un atrás del usuario
// y la cerraría al instante — el clic se sentía ignorado. La cuenta
// de back() debidos marca cuántos popstates siguientes son solo
// contabilidad del hueco: no cierran nada.
let owedBacks = 0;

// Marca de esta carga de la app. Los estados lecta:* persisten en el
// historial de la pestaña entre recargas, así que «atrás» puede
// aterrizar en uno viejo con un id mayor que el de las capas vivas;
// compararlo por id dejaría la capa abierta y el gesto se sentiría
// ignorado. Un estado sin nuestra marca siempre quedó por debajo de
// nuestras entradas, así que equivale a la base: cierra todo.
const session = Math.random().toString(36).slice(2);

const currentOverlayId = () => {
  const st = history.state as { lecta?: number; s?: string } | null;
  return st?.s === session ? (st.lecta ?? 0) : 0;
};

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (owedBacks > 0) {
      owedBacks -= 1;
      return;
    }
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
  history.pushState({ lecta: entry.id, s: session }, "");
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const index = stack.indexOf(entry);
      if (index === -1) return; // ya salió vía popstate
      stack.splice(index, 1);
      // Solo retrocede si nuestra entrada sigue siendo la vigente: si
      // el usuario empujó otra capa encima (aunque sea en el mismo
      // gesto), back() aterrizaría en el hueco que dejamos y, sin la
      // cuenta de owedBacks, su popstate cerraría esa capa nueva.
      if (currentOverlayId() !== entry.id) return;
      owedBacks += 1;
      history.back();
    },
    swap(next: () => void) {
      if (!released && stack.includes(entry)) entry.close = next;
    },
  };
}
