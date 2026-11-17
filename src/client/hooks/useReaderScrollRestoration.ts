// Restauración manual del scroll (evita que el navegador restaure el
// scroll de la estantería al cerrar el libro). Extraído de Reader.tsx (B7).
import { useEffect } from "react";

export function useReaderScrollRestoration(): void {
  useEffect(() => {
    if (typeof history === "undefined" || !("scrollRestoration" in history)) return;
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
}