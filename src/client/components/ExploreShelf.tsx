import { useState, type KeyboardEvent, type ReactNode } from "react";

// «Explora»: una sola sección para lo que no está en tu estantería —
// las guías que otros lectores compartieron (Comunidad) y el catálogo
// público (Libros gratuitos), en pestañas para que dos listas no se
// apilen estirando la página. Ambos paneles quedan montados (solo se
// ocultan con `hidden`): la búsqueda, el filtro y el desplazamiento
// sobreviven al cambiar de pestaña.

type TabId = "community" | "catalog";

type Props = {
  /** Pestaña Comunidad; null sin sesión → el panel invita a entrar. */
  community?: ReactNode;
  /** Pestaña Libros gratuitos (el riel del catálogo). */
  catalog?: ReactNode;
};

export default function ExploreShelf({ community, catalog }: Props) {
  const [tab, setTab] = useState<TabId>(community ? "community" : "catalog");

  if (!community && !catalog) return null;

  // Sin catálogo (caso límite) la pestaña sobra: se pinta Comunidad
  // tal cual, sin el marco de pestañas.
  if (catalog == null) {
    return (
      <section className="shelf-explore" aria-label="Comunidad">
        {community}
      </section>
    );
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setTab((current) => (current === "community" ? "catalog" : "community"));
  };

  return (
    <section className="shelf-explore" aria-label="Explora">
      <h2 className="eyebrow shelf-eyebrow">Explora</h2>
      <div
        className="shelf-explore-tabs"
        role="tablist"
        aria-label="Secciones para descubrir"
      >
        <button
          type="button"
          role="tab"
          id="explore-tab-community"
          className="shelf-explore-tab"
          aria-selected={tab === "community"}
          aria-controls="explore-panel-community"
          onClick={() => setTab("community")}
          onKeyDown={onTabKeyDown}
        >
          Comunidad
        </button>
        <button
          type="button"
          role="tab"
          id="explore-tab-catalog"
          className="shelf-explore-tab"
          aria-selected={tab === "catalog"}
          aria-controls="explore-panel-catalog"
          onClick={() => setTab("catalog")}
          onKeyDown={onTabKeyDown}
        >
          Libros gratuitos
        </button>
      </div>

      <div
        role="tabpanel"
        id="explore-panel-community"
        aria-labelledby="explore-tab-community"
        hidden={tab !== "community"}
      >
        {community ?? (
          <p className="meta shelf-explore-hint">
            Inicia sesión para ver las guías que otros lectores compartieron.
          </p>
        )}
      </div>
      <div
        role="tabpanel"
        id="explore-panel-catalog"
        aria-labelledby="explore-tab-catalog"
        hidden={tab !== "catalog"}
      >
        {catalog}
      </div>
    </section>
  );
}
