import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ExploreCommunityContext,
  type ExploreCommunityBridge,
} from "./explore-context";

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
  /** Obras de pantalla instaladas; alimenta el contador de la pestaña. */
  screenCount?: number;
  /** Acción para ir a Perfil a iniciar sesión cuando no hay cuenta activa. */
  onOpenAccount?: () => void;
};

export default function ExploreShelf({
  community,
  catalog,
  screen,
  screenCount,
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

  // Contador de la pestaña Comunidad: llega por el puente cuando la
  // lista termina de cargar (undefined = aún no se sabe).
  const [communityCount, setCommunityCount] = useState<number | undefined>(
    undefined,
  );

  // Comunidad reporta su carga: alimenta el contador y, si quedó
  // vacía y el lector no eligió pestaña, salta a catálogo o pantalla
  // para no dejar una pantalla vacía como vista inicial. Estable:
  // no depende del nodo ni del estado, no re-dispara la carga.
  const onCommunityLoaded = useCallback(
    (count: number) => {
      setCommunityCount(count);
      if (count === 0 && !userPickedTabRef.current) {
        showTab(hasCatalog ? "catalog" : "screen");
      }
    },
    [hasCatalog, showTab],
  );

  const selectTab = useCallback(
    (next: TabId, focus = false) => {
      userPickedTabRef.current = true;
      showTab(next);
      if (focus) tabRefs.current[next]?.focus();
    },
    [showTab],
  );

  // Puente hacia Comunidad: contador + la salida «Ver libros
  // gratuitos» del estado vacío. Memoizado para que el efecto de
  // carga de CommunityShelf no se re-dispare en cada render.
  const communityBridge = useMemo<ExploreCommunityBridge>(
    () => ({
      onLoaded: onCommunityLoaded,
      openCatalog: hasCatalog ? () => selectTab("catalog") : null,
    }),
    [onCommunityLoaded, hasCatalog, selectTab],
  );

  if (!community && !catalog && !screen) return null;

  // Orden fijo de las pestañas; «Libros gratuitos» solo existe cuando
  // hay índice que mostrar — las otras dos siempre (su panel puede ser
  // la invitación a iniciar sesión).
  const tabs: TabId[] = [
    "community",
    ...(hasCatalog ? (["catalog"] as const) : []),
    "screen",
  ];

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

  // Contador de la pestaña: número visible y nombre accesible con el
  // sustantivo («12 guías»). Con 0 o sin dato no se muestra nada.
  const tabButton = (
    id: TabId,
    label: string,
    count?: { value: number; singular: string; plural: string },
  ) => {
    const showCount = count !== undefined && count.value > 0;
    return (
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
        aria-label={
          showCount
            ? `${label}, ${count.value} ${count.value === 1 ? count.singular : count.plural}`
            : undefined
        }
        tabIndex={tab === id ? 0 : -1}
        onClick={() => selectTab(id)}
        onKeyDown={onTabKeyDown}
      >
        {label}
        {showCount ? (
          <span className="shelf-explore-count" aria-hidden="true">
            {count.value > 99 ? "99+" : count.value}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <section className="shelf-explore" aria-label="Explora">
      <h2 className="eyebrow shelf-eyebrow">Explora</h2>
      <div
        className="shelf-explore-tabs"
        role="tablist"
        aria-label="Secciones para descubrir"
      >
        {tabButton(
          "community",
          "Comunidad",
          communityCount !== undefined
            ? {
                value: communityCount,
                singular: "guía",
                plural: "guías",
              }
            : undefined,
        )}
        {hasCatalog ? tabButton("catalog", "Libros gratuitos") : null}
        {tabButton(
          "screen",
          "Series y películas",
          screenCount !== undefined
            ? { value: screenCount, singular: "título", plural: "títulos" }
            : undefined,
        )}
      </div>

      <div
        role="tabpanel"
        id="explore-panel-community"
        aria-labelledby="explore-tab-community"
        tabIndex={0}
        hidden={tab !== "community"}
      >
        <ExploreCommunityContext.Provider value={communityBridge}>
          {community ??
            invite(
              "Inicia sesión para ver las guías que otros lectores compartieron.",
            )}
        </ExploreCommunityContext.Provider>
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
