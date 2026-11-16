import { createContext } from "react";

// El puente entre los paneles de «Explora» y la sección que los
// monta. Vive en su propio módulo — sin React.lazy ni el resto de
// ExploreShelf — para que la sección cargue sin arrastrar la pestaña
// y para que CommunityShelf (lazy) y ExploreShelf (lazy desde F0)
// compartan la misma instancia.

/**
 * Comunidad → Explora: avisa que cargó vacía para que la pestaña
 * salte a «Libros gratuitos» cuando el lector no eligió pestaña.
 * El callback debe ser estable o el efecto de carga se re-dispara.
 */
export const ExploreCommunityEmptyContext = createContext<
  (() => void) | null
>(null);
