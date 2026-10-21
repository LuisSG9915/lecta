import Icon from "./Icon";
import {
  getSyncStatusLabel,
  isSyncInError,
  useSyncState,
  type SyncState,
} from "../lib/sync-state";

export type NavDestination = "shelf" | "vocabulary" | "vocab" | "journey" | "account";

export interface AppNavProps {
  active: NavDestination;
  onNavigate: (dest: NavDestination) => void;
  dueCount?: number;
  hasJourneyAlert?: boolean;
  syncState?: SyncState;
  hasAccount?: boolean;
}

export function AppNav({
  active,
  onNavigate,
  dueCount = 0,
  hasJourneyAlert = false,
  syncState: syncStateProp,
  hasAccount = false,
}: AppNavProps) {
  const globalSync = useSyncState();
  const sync = syncStateProp ?? globalSync;
  const syncLabel = getSyncStatusLabel(sync, hasAccount);

  const isShelf = active === "shelf";
  const isVocab = active === "vocabulary" || active === "vocab";
  const isJourney = active === "journey";
  const isAccount = active === "account";

  const hasError = isSyncInError(sync);

  return (
    <nav className="app-nav" aria-label="Principal">
      <div className="app-nav-sync-indicator" aria-live="polite">
        <span
          className={`app-nav-sync-dot ${
            !sync.isOnline
              ? "is-offline"
              : hasError
                ? "is-error"
                : sync.pendingChangesCount > 0
                  ? "is-pending"
                  : "is-synced"
          }`}
          aria-hidden="true"
        />
        <span className="app-nav-sync-text">{syncLabel}</span>
      </div>

      <div className="app-nav-items">
        <button
          type="button"
          className={`app-nav-item ${isShelf ? "is-active" : ""}`}
          aria-current={isShelf ? "page" : undefined}
          data-dest="shelf"
          onClick={() => onNavigate("shelf")}
        >
          <Icon name="shelf" size={22} />
          <span className="app-nav-label">Biblioteca</span>
        </button>

        <button
          type="button"
          className={`app-nav-item ${isVocab ? "is-active" : ""}`}
          aria-current={isVocab ? "page" : undefined}
          data-dest="vocabulary"
          onClick={() => onNavigate("vocabulary")}
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
          onClick={() => onNavigate("journey")}
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
          onClick={() => onNavigate("account")}
        >
          <Icon name="you" size={22} />
          <span className="app-nav-label">Perfil</span>
        </button>
      </div>
    </nav>
  );
}

export default AppNav;
