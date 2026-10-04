import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Comportamiento común de hojas y diálogos: enfoca al abrir, atrapa Tab,
// cierra con Escape y devuelve el foco a quien lo tenía.
export function useModalBehavior(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const target =
      el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? el;
    target.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
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
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [ref, onClose]);
}
