import Icon from "./Icon";

export type NavDestination = "shelf" | "vocab" | "account";

export interface AppNavProps {
  active: NavDestination;
  onNavigate: (dest: NavDestination) => void;
}

export default function AppNav({ active, onNavigate }: AppNavProps) {
  return (
    <nav className="app-nav" aria-label="Principal">
      <button
        type="button"
        className={`app-nav-item ${active === "shelf" ? "is-active" : ""}`}
        aria-current={active === "shelf" ? "page" : undefined}
        data-dest="shelf"
        onClick={() => onNavigate("shelf")}
      >
        <Icon name="shelf" size={22} />
        <span className="app-nav-label">Estantería</span>
      </button>

      <button
        type="button"
        className={`app-nav-item ${active === "vocab" ? "is-active" : ""}`}
        aria-current={active === "vocab" ? "page" : undefined}
        data-dest="vocab"
        onClick={() => onNavigate("vocab")}
      >
        <Icon name="notebook" size={22} />
        <span className="app-nav-label">Cuaderno</span>
      </button>

      <button
        type="button"
        className={`app-nav-item ${active === "account" ? "is-active" : ""}`}
        aria-current={active === "account" ? "page" : undefined}
        data-dest="account"
        onClick={() => onNavigate("account")}
      >
        <Icon name="you" size={22} />
        <span className="app-nav-label">Tú</span>
      </button>
    </nav>
  );
}
