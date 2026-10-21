import { useId, useCallback, useRef, useState, useEffect, type ReactNode } from "react";
import Dialog from "./Dialog";
import {
  inspectBackupPayload,
  restoreBackupPayload,
  type BackupPreviewSummary,
} from "../lib/export";

export interface RestoreBackupDialogProps {
  onRestored: () => void | Promise<void>;
  trigger?: (openPicker: () => void) => ReactNode;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function RestoreBackupDialog({
  onRestored,
  trigger,
  isOpen,
  onClose,
}: RestoreBackupDialogProps) {
  const inputId = useId();
  const [preview, setPreview] = useState<BackupPreviewSummary | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Si se controla externamente mediante isOpen y no hay previsualización abierta,
  // abrir el selector de archivo cuando isOpen pase a true.
  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current && !preview && !error) {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.click();
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, preview, error, inputId]);

  const openPicker = useCallback(() => {
    setError(null);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) {
      input.value = "";
      input.click();
    }
  }, [inputId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? "");
        const summary = inspectBackupPayload(text);
        setPayload(text);
        setPreview(summary);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo interpretar el archivo de respaldo.",
        );
        setPayload(null);
        setPreview(null);
      }
    };
    reader.onerror = () => {
      setError("No se pudo leer el archivo seleccionado.");
      setPayload(null);
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const handleClose = () => {
    setPreview(null);
    setPayload(null);
    setError(null);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) input.value = "";
    if (onClose) onClose();
  };

  const handleConfirmRestore = async () => {
    if (!payload) return;
    setRestoring(true);
    try {
      await restoreBackupPayload(payload, "merge-by-updated-at");
      await onRestored();
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al restaurar el respaldo.",
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {trigger ? trigger(openPicker) : null}

      <input
        id={inputId}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        data-testid="restore-backup-file-input"
        onChange={handleFileSelect}
      />

      {error ? (
        <Dialog label="Error al leer respaldo" onClose={handleClose}>
          <div className="sheet-head">
            <strong className="sheet-title">Error al leer respaldo</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={handleClose}
              aria-label="Cerrar"
            >
              Cerrar
            </button>
          </div>
          <div style={{ padding: "var(--s-3) 0" }}>
            <p className="field__hint" role="alert">
              {error}
            </p>
            <div style={{ marginTop: "var(--s-3)", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={handleClose}>
                Entendido
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {preview ? (
        <Dialog label="Restaurar respaldo" onClose={handleClose}>
          <div className="sheet-head">
            <strong className="sheet-title">Restaurar respaldo</strong>
            <button
              type="button"
              className="btn--quiet"
              onClick={handleClose}
              aria-label="Cerrar"
              disabled={restoring}
            >
              Cerrar
            </button>
          </div>
          <div style={{ padding: "var(--s-3) 0" }}>
            <p className="meta">
              Se encontraron los siguientes datos en el archivo de respaldo:
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "var(--s-2) 0",
                fontSize: "var(--fs-sm)",
                lineHeight: "1.6",
              }}
            >
              <li>Versión del formato: v{preview.version}</li>
              <li>Fecha de exportación: {new Date(preview.exportedAt).toLocaleString()}</li>
              <li>Libros recordados (metadatos): {preview.booksCount}</li>
              <li>Palabras en cuaderno: {preview.wordsCount}</li>
              <li>Notas y pasajes: {preview.annotationsCount}</li>
              <li>Posiciones de lectura: {preview.positionsCount}</li>
              {preview.reviewsCount > 0 ? <li>Repasos FSRS: {preview.reviewsCount}</li> : null}
              {preview.activityCount > 0 ? <li>Registros de actividad: {preview.activityCount}</li> : null}
              {preview.hasCompanionState ? <li>Estado del compañero: Incluido</li> : null}
            </ul>

            <div
              style={{
                margin: "var(--s-3) 0",
                padding: "var(--s-2) var(--s-3)",
                background: "var(--paper-sunken)",
                borderLeft: "3px solid var(--accent-primary, var(--vermilion))",
                borderRadius: "0 var(--r-sm) var(--r-sm) 0",
                fontSize: "var(--fs-xs)",
                color: "var(--ink-soft)",
                lineHeight: "1.5",
              }}
            >
              El respaldo guarda tus palabras, notas, posiciones e historial. Los archivos EPUB no viajan en el archivo de respaldo: si tienes cuenta se descargan desde tu nube, y si lees sin cuenta basta con volver a abrir tu archivo EPUB para recuperar tu progreso automáticamente.
            </div>

            <p className="field__hint">
              Los datos se fusionarán inteligentemente respetando las modificaciones más recientes sin borrar lecturas nuevas de este dispositivo.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--s-2)",
                marginTop: "var(--s-4)",
              }}
            >
              <button
                type="button"
                className="btn--quiet"
                onClick={handleClose}
                disabled={restoring}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                data-testid="confirm-restore-btn"
                onClick={() => void handleConfirmRestore()}
                disabled={restoring}
              >
                {restoring ? "Restaurando…" : "Restaurar y fusionar datos"}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
