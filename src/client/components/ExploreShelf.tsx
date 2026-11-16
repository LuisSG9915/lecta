import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ExploreCommunityEmptyContext } from "./explore-context";

// «Explora»: una sola sección para lo que no está en tu estantería —
// las guías que otros lectores compartieron (Comunidad), el catálogo
// público (Libros gratuitos) y las obras audiovisuales (Series y
// películas), en pestañas para que dos listas no se apilen estirando
// la página. Comunidad queda montada siempre (es la pestaña inicial y
// su carga dispara el salto cuando está vacía); catálogo y pantalla se
// montan en su primera visita y ahí se quedan (ocultas con `hidden`):
// la búsqueda, el filtro y el desplazamiento sobreviven al cambiar, y
// el chunk lazy de cada sección no se descarga hasta que se visita.

type TabId = "community" | "catalog" | "screen";

type Props = {
  /** Pestaña Comunidad; null sin sesión → el panel invita a entrar. */
  community?: ReactNode;
  /** Pestaña Libros gratuitos (el riel del catálogo); null lo omite. */
  catalog?: ReactNode;
  /** Pestaña Series y películas; null sin sesión → invita a entrar. */
  screen?: ReactNode;
  /** Acción para ir a Perfil a iniciar sesión cuando no hay cuenta activa. */
  onOpenAccount?: () => void;
};

export default function ExploreShelf({
  community,
  catalog,
  screen,
  onOpenAccount,
}: Props) {
  const initialTab: TabId = community
    ? "community"
    : catalog
      ? "catalog"
      : "screen";
  const [tab, setTab] = useState<TabId>(initialTab);
  const userPickedTabRef = useRef(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  // Qué paneles ya se visitaron: se montan en su primera visita y
  // quedan (ocultos) para conservar búsqueda, filtro y posición.
  const [opened, setOpened] = useState<Partial<Record<TabId, true>>>(() => ({
    [initialTab]: true,
  }));

  const hasCommunity = Boolean(community);
  const hasCatalog = catalog != null;

  // Único punto que cambia de pestaña: marca la visita para que el
  // panel se monte y queda visible.
  const showTab = useCallback((next: TabId) => {
    setTab(next);
    setOpened((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
  }, []);

  useEffect(() => {
    if (!userPickedTabRef.current) {
      showTab(hasCommunity ? "community" : hasCatalog ? "catalog" : "screen");
    }
  }, [hasCommunity, hasCatalog, showTab]);

  // Si la comunidad termina de cargar vacía y el lector aún no eligió
  // pestaña manualmente, mostramos «Libros gratuitos» para no dejar
  // una pantalla vacía como vista inicial. El callback es estable: no
  // depende del nodo del catálogo ni del estado, así que no re-dispara
  // la carga de Comunidad en cada render.
  const handleCommunityEmpty = useCallback(() => {
    if (userPickedTabRef.current) return;
    showTab(hasCatalog ? "catalog" : "screen");
  }, [hasCatalog, showTab]);

  if (!community && !catalog && !screen) return null;

  // Orden fijo de las pestañas; «Libros gratuitos» solo existe cuando
  // hay índice que mostrar — las otras dos siempre (su panel puede ser
  // la invitación a iniciar sesión).
  const tabs: TabId[] = [
    "community",
    ...(hasCatalog ? (["catalog"] as const) : []),
    "screen",
  ];

  const selectTab = (next: TabId, focus = false) => {
    userPickedTabRef.current = true;
    showTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(at + step + tabs.length) % tabs.length];
      selectTab(next, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(tabs[0], true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(tabs[tabs.length - 1], true);
    }
  };

  const invite = (text: string) => (
    <p className="meta shelf-explore-hint">
      {text}
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
  );

  const tabButton = (id: TabId, label: string) => (
    <button
      key={id}
      ref={(el) => {
        tabRefs.current[id] = el;
      }}
      type="button"
      role="tab"
      id={`explore-tab-${id}`}
      className="shelf-explore-tab"
      aria-selected={tab === id}
      aria-controls={`explore-panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => selectTab(id)}
      onKeyDown={onTabKeyDown}
    >
      {label}
    </button>
  );

  return (
    <section className="shelf-explore" aria-label="Explora">
      <h2 className="eyebrow shelf-eyebrow">Explora</h2>
      <div
        className="shelf-explore-tabs"
        role="tablist"
        aria-label="Secciones para descubrir"
      >
        {tabButton("community", "Comunidad")}
        {hasCatalog ? tabButton("catalog", "Libros gratuitos") : null}
        {tabButton("screen", "Series y películas")}
      </div>

      <div
        role="tabpanel"
        id="explore-panel-community"
        aria-labelledby="explore-tab-community"
        tabIndex={0}
        hidden={tab !== "community"}
      >
        <ExploreCommunityEmptyContext.Provider value={handleCommunityEmpty}>
          {community ??
            invite(
              "Inicia sesión para ver las guías que otros lectores compartieron.",
            )}
        </ExploreCommunityEmptyContext.Provider>
      </div>
      {hasCatalog ? (
        <div
          role="tabpanel"
          id="explore-panel-catalog"
          aria-labelledby="explore-tab-catalog"
          tabIndex={0}
          hidden={tab !== "catalog"}
        >
          {opened.catalog || tab === "catalog" ? catalog : null}
        </div>
      ) : null}
      <div
        role="tabpanel"
        id="explore-panel-screen"
        aria-labelledby="explore-tab-screen"
        tabIndex={0}
        hidden={tab !== "screen"}
      >
        {opened.screen || tab === "screen"
          ? (screen ??
            invite(
              "Inicia sesión para preparar vocabulario de series y películas.",
            ))
          : null}
      </div>
    </section>
  );
}
