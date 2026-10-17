/**
 * Helper seguro para la View Transitions API.
 * Si el navegador la soporta y el usuario no tiene activo prefers-reduced-motion,
 * ejecuta la actualización dentro de document.startViewTransition().
 * En entornos de prueba (jsdom) o navegadores sin soporte, corre la callback
 * de forma síncrona inmediata sin demoras ni microtareas pendientes.
 */
export function startSafeViewTransition(updateCb: () => void): void {
  if (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof document.startViewTransition === "function" &&
    (typeof window === "undefined" ||
      !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
  ) {
    try {
      document.startViewTransition(updateCb);
      return;
    } catch {
      // Degradación elegante si falla startViewTransition
    }
  }
  updateCb();
}
