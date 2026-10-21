import { Component, type ErrorInfo, type ReactNode } from "react";

export const ERROR_LOG_STORAGE_KEY = "lecta_error_log_v1";
export const ERROR_LOG_MAX_ENTRIES = 5;

export interface LoggedErrorEntry {
  message: string;
  stack?: string;
  timestamp: number;
  url: string;
}

export function logErrorToStorage(error: unknown, errorInfo?: ErrorInfo | null): void {
  try {
    const raw = localStorage.getItem(ERROR_LOG_STORAGE_KEY);
    const list: LoggedErrorEntry[] = raw ? JSON.parse(raw) : [];
    const stack =
      (error instanceof Error ? error.stack : undefined) ||
      errorInfo?.componentStack ||
      undefined;

    const entry: LoggedErrorEntry = {
      message: error instanceof Error ? error.message : String(error),
      stack,
      timestamp: Date.now(),
      url: typeof window !== "undefined" ? window.location.href : "",
    };

    const updated = [...list, entry].slice(-ERROR_LOG_MAX_ENTRIES);
    localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Quota o localStorage inaccesible
  }
}

export function getStoredErrorLogs(): LoggedErrorEntry[] {
  try {
    const raw = localStorage.getItem(ERROR_LOG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearActiveBookState(): void {
  try {
    sessionStorage.removeItem("activeBook");
    sessionStorage.removeItem("lecta:active-book");
    sessionStorage.clear();
  } catch {
    // Protección ante ambientes sin sessionStorage
  }
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logErrorToStorage(error, errorInfo);
  }

  private handleBackToLibrary = (): void => {
    clearActiveBookState();
    if (this.props.onReset) {
      this.setState({ hasError: false, error: null });
      this.props.onReset();
      return;
    }
    if (typeof window !== "undefined") {
      if (window.location.hash) {
        window.location.hash = "";
      }
      window.location.href = window.location.pathname;
    }
  };

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div
        className="error-boundary-screen"
        role="alert"
        aria-live="assertive"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "var(--s-6, 2rem)",
          backgroundColor: "var(--bg, #f7f5f0)",
          color: "var(--ink, #1f1d1a)",
          fontFamily: "var(--font-book, serif)",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: "32rem",
            width: "100%",
            border: "1px solid var(--border-subtle, rgba(0, 0, 0, 0.12))",
            borderRadius: "var(--radius-s, 8px)",
            padding: "var(--s-6, 2rem)",
            backgroundColor: "var(--bg-card, var(--bg, #fff))",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-book, serif)",
              fontSize: "var(--fs-xl, 1.5rem)",
              fontWeight: 600,
              lineHeight: "var(--lh-display, 1.2)",
              margin: "0 0 var(--s-3, 0.75rem) 0",
              color: "var(--ink, #1f1d1a)",
            }}
          >
            Interrupción inesperada
          </h1>
          <p
            style={{
              fontFamily: "var(--font-ui, sans-serif)",
              fontSize: "var(--fs-sm, 0.875rem)",
              lineHeight: "var(--lh-ui, 1.45)",
              color: "var(--ink-muted, #555)",
              margin: "0 0 var(--s-6, 2rem) 0",
            }}
          >
            Ocurrió un error al procesar la vista actual. Tu biblioteca, notas y
            vocabulario se encuentran intactos en este dispositivo.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "center",
              gap: "var(--s-3, 0.75rem)",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn--primary"
              onClick={this.handleBackToLibrary}
              style={{ minWidth: "10rem" }}
            >
              Volver a la biblioteca
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={this.handleReload}
              style={{ minWidth: "8rem" }}
            >
              Recargar
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
