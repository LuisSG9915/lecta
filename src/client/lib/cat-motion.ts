// Modo de movimiento del compañero: la preferencia vive en
// <html data-cat-motion> («full» | «reduced» | «system») y el CSS ya la
// lee para animar o no; los timers de React leen la misma fuente para
// no duplicar la regla.

import type { CompanionMotion } from "../../shared/companion-data";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Resolución pura del modo efectivo: «full» siempre anima (aunque el
// sistema pida reducir), «reduced» siempre reduce y «system» sigue
// al sistema operativo.
export function catReducedMotion(
  motion: CompanionMotion,
  systemPrefers: boolean,
): boolean {
  return motion === "reduced" || (motion === "system" && systemPrefers);
}

// Lectura del modo desde el DOM: la usan los timers de React que no
// reciben la prop (parpadeo, orejas, saludo de estantería).
export function catMotionReduced(): boolean {
  const motion =
    (document.documentElement.dataset.catMotion as
      | CompanionMotion
      | undefined) ?? "system";
  return catReducedMotion(motion, prefersReducedMotion());
}

// La preferencia en el DOM: <html data-cat-motion> es la llave con la
// que el CSS decide si las animaciones marcadas «cat-anim» viven
// (full), se reducen (reduced) o siguen al sistema (system).
export function applyCatMotion(motion: CompanionMotion) {
  document.documentElement.dataset.catMotion = motion;
}
