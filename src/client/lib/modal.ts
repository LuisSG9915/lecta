import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// No es enfocable un control dentro de un subárbol oculto o inerte.
const isUsable = (item: HTMLElement, root: HTMLElement) =>
  !item.closest("[hidden], [inert]") ||
  item.closest("[hidden], [inert]") === root;

// Capas abiertas en orden de montaje: solo la superior atiende Escape y
// atrapa Tab, así dos escuchas activas no cierran ambas capas a la vez.
type Layer = { el: HTMLElement; onClose: () => void };
const stack: Layer[] = [];

// Bloqueo del scroll de fondo mientras haya capas abiertas. overflow:hidden
// conserva la posición (no hay salto al bloquear ni al restaurar) y el
// contador cubre dos capas o un cierre fuera de orden. La compensación por
// la barra clásica solo se aplica cuando existe (escritorio); en móvil las
// barras se superponen y la medida es cero.
let scrollLocks = 0;
let savedOverflow = "";
let savedPaddingRight = "";

const lockScroll = () => {
  if (scrollLocks++ > 0) return;
  const de = document.documentElement;
  savedOverflow = de.style.overflow;
  savedPaddingRight = de.style.paddingRight;
  const gap = window.innerWidth - de.clientWidth;
  if (gap > 0) de.style.paddingRight = `${gap}px`;
  de.style.overflow = "hidden";
};

const unlockScroll = () => {
  if (scrollLocks === 0) return;
  if (--scrollLocks > 0) return;
  const de = document.documentElement;
  de.style.overflow = savedOverflow;
  de.style.paddingRight = savedPaddingRight;
};

// Comportamiento común de hojas y diálogos: enfoca al abrir, atrapa Tab,
// cierra con Escape y devuelve el foco a quien lo tenía.
export function useModalBehavior(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  // onClose cambia en cada render; el ref lo estabiliza para que el
  // efecto de abajo corra una sola vez por apertura y no reenfoque
  // al usuario mientras escribe.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const layer: Layer = { el, onClose: () => onCloseRef.current() };
    stack.push(layer);
    lockScroll();
    const isTop = () => stack[stack.length - 1] === layer;

    const focusables = () =>
      [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) =>
        isUsable(item, el),
      );
    const target =
      el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? el;
    // preventScroll: enfocar no debe mover la posición de lectura.
    target.focus({ preventScroll: true });

    // La trampa de Tab solo cubre el teclado: un lector de pantalla
    // podía seguir recorriendo la página de fondo. `inert` en cada
    // hermano del camino modal→body saca ese fondo del árbol de
    // accesibilidad y de cualquier interacción mientras la capa viva.
    // Se respetan los que ya venían inert y se restauran al cerrar.
    const inerted: HTMLElement[] = [];
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
          // Mutación DOM deliberada en el efecto, no estado de React.
          // eslint-disable-next-line react-hooks/immutability
          sibling.inert = true;
          inerted.push(sibling);
        }
      }
      node = parent;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Las capas de abajo ignoran el teclado mientras exista una encima.
      if (!isTop()) return;
      if (event.key === "Escape") {
        // Consume el evento: no debe llegar a la capa de abajo.
        event.stopPropagation();
        event.preventDefault();
        layer.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = stack.indexOf(layer);
      if (at !== -1) stack.splice(at, 1);
      // Primero se devuelve el fondo al árbol: si el foco cae sobre un
      // elemento aún inerte, el navegador lo rechaza.
      for (const item of inerted) item.inert = false;
      unlockScroll();
      previouslyFocused?.focus({ preventScroll: true });
    };
    // Solo por montaje: reenfocar en cada render quita el foco al usuario.
  }, [ref]);
}
