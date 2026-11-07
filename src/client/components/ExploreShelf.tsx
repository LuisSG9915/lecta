import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// «Explora»: una sola sección para lo que no está en tu estantería —
// las guías que otros lectores compartieron (Comunidad) y el catálogo
// público (Libros gratuitos), en pestañas para que dos listas no se
// apilen estirando la página. Ambos paneles quedan montados (solo se
// ocultan con `hidden`): la búsqueda, el filtro y el desplazamiento
// sobreviven al cambiar de pestaña.

type TabId = "community" | "catalog";

export const ExploreCommunityEmptyContext = createContext<(() => void) | null>(
  null,
);

type Props = {
  /** Pestaña Comunidad; null sin sesión → el panel invita a entrar. */
  community?: ReactNode;
  /** Pestaña Libros gratuitos (el riel del catálogo). */
  catalog?: ReactNode;
  /** Acción para ir a Perfil a iniciar sesión cuando no hay cuenta activa. */
  onOpenAccount?: () => void;
};

export default function ExploreShelf({
  community,
  catalog,
  onOpenAccount,
}: Props) {
  const [tab, setTab] = useState<TabId>(community ? "community" : "catalog");
  const userPickedTabRef = useRef(false);
  const communityTabRef = useRef<HTMLButtonElement>(null);
  const catalogTabRef = useRef<HTMLButtonElement>(null);

  const hasCommunity = Boolean(community);
  useEffect(() => {
    if (!userPickedTabRef.current) {
      setTab(hasCommunity ? "community" : "catalog");
    }
  }, [hasCommunity]);

  // Si la comunidad termina de cargar vacía y el lector aún no eligió
  // pestaña manualmente, mostramos «Libros gratuitos» para no dejar
  // una pantalla vacía como vista inicial. El callback es estable: no
  // depende del nodo del catálogo ni del estado, así que no re-dispara
  // la carga de Comunidad en cada render.
  const handleCommunityEmpty = useCallback(() => {
    if (!userPickedTabRef.current) setTab("catalog");
  }, []);

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

  const selectTab = (next: TabId, focus = false) => {
    userPickedTabRef.current = true;
    setTab(next);
    if (focus) {
      const target =
        next === "community" ? communityTabRef.current : catalogTabRef.current;
      target?.focus();
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next: TabId = tab === "community" ? "catalog" : "community";
      selectTab(next, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab("community", true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab("catalog", true);
    }
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
          ref={communityTabRef}
          type="button"
          role="tab"
          id="explore-tab-community"
          className="shelf-explore-tab"
          aria-selected={tab === "community"}
          aria-controls="explore-panel-community"
          tabIndex={tab === "community" ? 0 : -1}
          onClick={() => selectTab("community")}
          onKeyDown={onTabKeyDown}
        >
          Comunidad
        </button>
        <button
          ref={catalogTabRef}
          type="button"
          role="tab"
          id="explore-tab-catalog"
          className="shelf-explore-tab"
          aria-selected={tab === "catalog"}
          aria-controls="explore-panel-catalog"
          tabIndex={tab === "catalog" ? 0 : -1}
          onClick={() => selectTab("catalog")}
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
        <ExploreCommunityEmptyContext.Provider value={handleCommunityEmpty}>
          {community ?? (
            <p className="meta shelf-explore-hint">
              Inicia sesión para ver las guías que otros lectores compartieron.
              {onOpenAccount ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={onOpenAccount}
                  >
                    Iniciar sesión
                  </button>
                </>
              ) : null}
            </p>
          )}
        </ExploreCommunityEmptyContext.Provider>
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
