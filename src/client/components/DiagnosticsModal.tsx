import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import { getStoredErrorLogs, ERROR_LOG_STORAGE_KEY } from "./ErrorBoundary";
import { getSyncState, type SyncState } from "../lib/sync-state";
import {
  loadFeatureFlags,
  saveFeatureFlags,
  type FeatureFlags,
} from "../lib/settings";
import {
  captureDbScope,
  listAnnotations,
  listIntervals,
  listPositions,
  listSavedWords,
  listStoredBooks,
} from "../lib/idb";

export interface DiagnosticsModalProps {
  onClose: () => void;
}

interface StorageInfo {
  usage: number;
  quota: number;
}

interface ErrorLogEntry {
  message: string;
  stack?: string;
  timestamp: number;
  url?: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function DiagnosticsModal({ onClose }: DiagnosticsModalProps) {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [counts, setCounts] = useState<{
    books: number;
    words: number;
    positions: number;
    annotations: number;
    activity: number;
  } | null>(null);
  const [recentErrors, setRecentErrors] = useState<ErrorLogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(() => loadFeatureFlags());

  const handleToggleFlag = (flag: keyof FeatureFlags) => {
    const updated = saveFeatureFlags({ [flag]: !featureFlags[flag] });
    setFeatureFlags(updated);
  };

  useEffect(() => {
    setSyncState(getSyncState());

    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      void navigator.storage.estimate().then((est) => {
        if (typeof est.usage === "number" && typeof est.quota === "number") {
          setStorageInfo({ usage: est.usage, quota: est.quota });
        }
      }).catch(() => undefined);
    }

    setRecentErrors(getStoredErrorLogs());

    const scope = captureDbScope();
    void Promise.all([
      listStoredBooks(scope).catch(() => []),
      listSavedWords(undefined, scope).catch(() => []),
      listPositions(scope).catch(() => []),
      listAnnotations(undefined, scope).catch(() => []),
      listIntervals(scope).catch(() => []),
    ]).then(([books, words, positions, annotations, activity]) => {
      setCounts({
        books: books.length,
        words: words.length,
        positions: positions.length,
        annotations: annotations.length,
        activity: activity.length,
      });
    }).catch(() => undefined);
  }, []);

  const handleCopyReport = async () => {
    const report = {
      app: "Lecta",
      version: "0.1.0",
      generatedAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      storage: storageInfo
        ? {
            usageBytes: storageInfo.usage,
            quotaBytes: storageInfo.quota,
            usageFormatted: formatBytes(storageInfo.usage),
            quotaFormatted: formatBytes(storageInfo.quota),
            usagePercent: `${((storageInfo.usage / storageInfo.quota) * 100).toFixed(2)}%`,
          }
        : null,
      collections: counts,
      sync: syncState,
      featureFlags,
      recentErrors: recentErrors.map((err) => ({
        message: err.message,
        timestamp: new Date(err.timestamp).toISOString(),
        url: err.url,
      })),
    };

    const text = JSON.stringify(report, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <Dialog label="Acerca de y Diagnóstico" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Acerca de y Diagnóstico</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      <div className="diagnostics-content" style={{ padding: "var(--s-4) 0", display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
        <section className="setting-block">
          <h3 className="eyebrow">Aplicación y sistema</h3>
          <p className="meta" style={{ margin: "var(--s-1) 0" }}>
            Lecta v0.1.0 · Motor de lectura sin distracciones.
          </p>
          <p className="meta" style={{ margin: "var(--s-1) 0" }}>
            Service Worker: {typeof navigator !== "undefined" && navigator.serviceWorker?.controller ? "Activo" : "Inactivo"}
          </p>
        </section>

        <section className="setting-block">
          <h3 className="eyebrow">Almacenamiento en este dispositivo</h3>
          {storageInfo ? (
            <p className="meta" style={{ margin: "var(--s-1) 0" }}>
              Uso estimado: {formatBytes(storageInfo.usage)} de {formatBytes(storageInfo.quota)} (
              {((storageInfo.usage / storageInfo.quota) * 100).toFixed(2)}%)
            </p>
          ) : (
            <p className="meta" style={{ margin: "var(--s-1) 0" }}>
              Estimación de almacenamiento no disponible en este navegador.
            </p>
          )}
        </section>

        <section className="setting-block">
          <h3 className="eyebrow">Datos locales y sincronización</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "var(--s-1) 0", fontSize: "var(--fs-sm)" }}>
            <li>Libros en dispositivo: {counts ? counts.books : "Cargando…"}</li>
            <li>Palabras en cuaderno: {counts ? counts.words : "Cargando…"}</li>
            <li>Posiciones guardadas: {counts ? counts.positions : "Cargando…"}</li>
            <li>Anotaciones y pasajes: {counts ? counts.annotations : "Cargando…"}</li>
            <li>Sesiones de actividad: {counts ? counts.activity : "Cargando…"}</li>
          </ul>
          <p className="meta" style={{ margin: "var(--s-1) 0" }}>
            Estado de red: {syncState.isOnline ? "En línea" : "Sin conexión"}
            {syncState.lastSyncedAt
              ? ` · Última sinc.: ${new Date(syncState.lastSyncedAt).toLocaleTimeString()}`
              : ""}
            {syncState.pendingChangesCount > 0
              ? ` · ${syncState.pendingChangesCount} cambio(s) pendiente(s)`
              : ""}
          </p>
          {syncState.collections ? (
            <div style={{ marginTop: "var(--s-1)", fontSize: "var(--fs-xs)", color: "var(--ink-muted)" }}>
              Colecciones: {Object.entries(syncState.collections).map(([k, v]) => `${k}: ${v.status}`).join(" · ")}
            </div>
          ) : null}
        </section>

        <section className="setting-block" aria-label="Interruptores de función">
          <h3 className="eyebrow">Interruptores de función (kill-switches locales)</h3>
          <p className="meta" style={{ margin: "var(--s-1) 0" }}>
            Si alguna función experimental o secundaria falla en tu navegador, puedes apagarla de inmediato:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)", marginTop: "var(--s-2)" }}>
            {(
              [
                { key: "neuralTts" as const, label: "Voz Neural HD Offline", desc: "Síntesis neuronal local descargable" },
                { key: "vocabGames" as const, label: "Minijuegos del Cuaderno", desc: "Práctica interactiva y retos de repaso" },
                { key: "kindleSync" as const, label: "Sincronización con Kindle", desc: "Emparejamiento y lectura remota en e-reader" },
                { key: "focusTelemetry" as const, label: "Telemetría de Enfoque", desc: "Detección de fatiga lectora y pausas" },
                { key: "chapterPriming" as const, label: "Pre-lectura de Capítulos", desc: "Anticipación de vocabulario difícil" },
                { key: "shareClientErrors" as const, label: "Compartir errores con el equipo", desc: "Solo metadatos: error, ruta y versión" },
                { key: "includeErrorMessage" as const, label: "Incluir mensaje del error", desc: "Puede contener texto del libro que estabas leyendo" },
              ] as const
            ).map(({ key, label, desc }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "var(--s-2)",
                  background: "var(--paper-sunken)",
                  borderRadius: "var(--r-sm)",
                }}
              >
                <div>
                  <strong style={{ display: "block", fontSize: "var(--fs-sm)" }}>{label}</strong>
                  <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>{desc}</span>
                </div>
                <button
                  type="button"
                  data-flag={key}
                  className={`btn btn--sm ${featureFlags[key] ? "btn--primary" : "btn--quiet"}`}
                  onClick={() => handleToggleFlag(key)}
                  aria-pressed={featureFlags[key]}
                >
                  {featureFlags[key] ? "Activo" : "Desactivado"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="setting-block">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="eyebrow" style={{ margin: 0 }}>Registro de errores recientes ({recentErrors.length})</h3>
            {recentErrors.length > 0 ? (
              <button
                type="button"
                className="btn--quiet"
                style={{ fontSize: "var(--fs-xs)" }}
                onClick={() => {
                  try {
                    localStorage.removeItem(ERROR_LOG_STORAGE_KEY);
                    setRecentErrors([]);
                  } catch {
                    // Quota o permisos
                  }
                }}
              >
                Limpiar registro
              </button>
            ) : null}
          </div>
          {recentErrors.length === 0 ? (
            <p className="meta" style={{ margin: "var(--s-1) 0" }}>
              No hay errores capturados recientemente.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)", maxHeight: "180px", overflowY: "auto", fontSize: "var(--fs-xs)", fontFamily: "monospace", background: "var(--paper-sunken)", padding: "var(--s-2)", borderRadius: "var(--r-sm)" }}>
              {recentErrors.map((err, idx) => (
                <div key={idx} style={{ borderBottom: idx < recentErrors.length - 1 ? "1px solid var(--border)" : "none", paddingBottom: "var(--s-1)" }}>
                  <div><strong>{new Date(err.timestamp).toLocaleTimeString()}:</strong> {err.message}</div>
                  {err.url && <div style={{ color: "var(--ink-muted)" }}>{err.url}</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={{ display: "flex", gap: "var(--s-2)", marginTop: "var(--s-2)" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleCopyReport()}
          >
            {copied ? "Reporte copiado" : "Copiar reporte de diagnóstico"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
