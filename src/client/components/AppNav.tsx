import Icon from "./Icon";

export type NavTab = "shelf" | "vocab" | "journey";
export type NavDestination = "shelf" | "vocabulary" | "vocab" | "journey" | "account";

export interface AppNavProps {
  // Nueva interfaz unificada
  activeTab?: NavTab;
  onSelect?: (tab: NavTab) => void;
  dueReviewsCount?: number;
  companionName?: string;
  onOpenCompanion?: () => void;

  // Interfaz de retrocompatibilidad
  active?: NavDestination;
  onNavigate?: (dest: NavDestination) => void;
  dueCount?: number;
  hasJourneyAlert?: boolean;
}

export function AppNav({
  activeTab,
  onSelect,
  dueReviewsCount,
  companionName,
  onOpenCompanion,
  active,
  onNavigate,
  dueCount = 0,
  hasJourneyAlert = false,
}: AppNavProps) {
  // Si se provee onSelect, se renderiza la navegación unificada de 3 secciones + compañero
  if (onSelect) {
    const tab: NavTab =
      activeTab ?? (active === "vocabulary" ? "vocab" : (active as NavTab) ?? "shelf");
    const count = dueReviewsCount ?? dueCount ?? 0;

    return (
      <nav className="app-nav" aria-label="Navegación principal">
        <div className="app-nav-inner">
          <button
            type="button"
            className={`app-nav-item ${tab === "shelf" ? "is-active" : ""}`}
            onClick={() => onSelect("shelf")}
            aria-current={tab === "shelf" ? "page" : undefined}
          >
            <Icon name="book" size={20} />
            <span>Biblioteca</span>
          </button>

          <button
            type="button"
            className={`app-nav-item ${tab === "vocab" ? "is-active" : ""}`}
            onClick={() => onSelect("vocab")}
            aria-current={tab === "vocab" ? "page" : undefined}
          >
            <span className="app-nav-icon-wrapper">
              <Icon name="bookmark" size={20} />
              {count > 0 && (
                <span className="app-nav-badge" aria-label={`${count} repasos pendientes`}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </span>
            <span>Mi vocabulario</span>
          </button>

          <button
            type="button"
            className={`app-nav-item ${tab === "journey" ? "is-active" : ""}`}
            onClick={() => onSelect("journey")}
            aria-current={tab === "journey" ? "page" : undefined}
          >
            <Icon name="sparkles" size={20} />
            <span>Progreso</span>
          </button>

          {onOpenCompanion && (
            <button
              type="button"
              className="app-nav-item app-nav-companion"
              onClick={onOpenCompanion}
              aria-label={`Compañero: ${companionName || "Michi"}`}
            >
              <span className="app-nav-companion-avatar">🐾</span>
              <span>{companionName || "Compañero"}</span>
            </button>
          )}
        </div>
      </nav>
    );
  }

  // Modo retrocompatible (onNavigate)
  const isShelf = active === "shelf";
  const isVocab = active === "vocabulary" || active === "vocab";
  const isJourney = active === "journey";
  const isAccount = active === "account";

  return (
    <nav className="app-nav" aria-label="Principal">
      <button
        type="button"
        className={`app-nav-item ${isShelf ? "is-active" : ""}`}
        aria-current={isShelf ? "page" : undefined}
        data-dest="shelf"
        onClick={() => onNavigate?.("shelf")}
      >
        <Icon name="shelf" size={22} />
        <span className="app-nav-label">Biblioteca</span>
      </button>

      <button
        type="button"
        className={`app-nav-item ${isVocab ? "is-active" : ""}`}
        aria-current={isVocab ? "page" : undefined}
        data-dest="vocabulary"
        onClick={() => onNavigate?.("vocabulary")}
      >
        <div style={{ position: "relative", display: "inline-flex" }}>
          <Icon name="notebook" size={22} />
          {dueCount > 0 && (
            <span
              className="app-nav-badge"
              aria-label={`${dueCount} palabras listas para repasar`}
            >
              {dueCount}
            </span>
          )}
        </div>
        <span className="app-nav-label">Cuaderno</span>
      </button>

      <button
        type="button"
        className={`app-nav-item ${isJourney ? "is-active" : ""}`}
        aria-current={isJourney ? "page" : undefined}
        data-dest="journey"
        onClick={() => onNavigate?.("journey")}
      >
        <div style={{ position: "relative", display: "inline-flex" }}>
          <Icon name="journey" size={22} />
          {hasJourneyAlert && (
            <span
              className="app-nav-sparkle"
              aria-label="Novedad en tu recorrido"
            >
              <Icon name="sparkles" size={12} />
            </span>
          )}
        </div>
        <span className="app-nav-label">Camino</span>
      </button>

      <button
        type="button"
        className={`app-nav-item ${isAccount ? "is-active" : ""}`}
        aria-current={isAccount ? "page" : undefined}
        data-dest="account"
        onClick={() => onNavigate?.("account")}
      >
        <Icon name="you" size={22} />
        <span className="app-nav-label">Perfil</span>
      </button>
    </nav>
  );
}

export default AppNav;
