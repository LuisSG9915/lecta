import { createContext } from "react";

// El puente entre los paneles de «Explora» y la sección que los
// monta. Vive en su propio módulo — sin React.lazy ni el resto de
// ExploreShelf — para que la sección cargue sin arrastrar la pestaña
// y para que CommunityShelf (lazy) y ExploreShelf (lazy desde F0)
// compartan la misma instancia.

export type ExploreCommunityBridge = {
  /** Comunidad cargó bien: número de guías (0 = vacía). */
  onLoaded: (count: number) => void;
  /** Cambia a «Libros gratuitos»; null si esa pestaña no existe. */
  openCatalog: (() => void) | null;
};

/**
 * Comunidad → Explora: reporta cuántas guías cargó (para el contador
 * de la pestaña y para el salto automático cuando está vacía) y
 * permite que el estado vacío ofrezca «Ver libros gratuitos».
 * Las funciones deben ser estables o el efecto de carga de
 * Comunidad se re-dispara en cada render.
 */
export const ExploreCommunityContext =
  createContext<ExploreCommunityBridge | null>(null);
