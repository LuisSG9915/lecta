import { useEffect, useState } from "react";
import {
  getBookDictionaryStatus,
  precacheBookDictionary,
  type PrecacheProgress,
} from "../lib/offline-dictionary";
import { captureDbScope } from "../lib/idb";
import { triggerHaptic } from "../lib/haptics";

export interface OfflineDictionaryControlProps {
  bookHash: string;
  language?: string;
}

export default function OfflineDictionaryControl({
  bookHash,
  language = "es",
}: OfflineDictionaryControlProps) {
  const [status, setStatus] = useState<{
    total: number;
    cached: number;
    percent: number;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<PrecacheProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBookDictionaryStatus(bookHash, language, captureDbScope()).then(
      (res) => {
        if (!cancelled) setStatus(res);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookHash, language]);

  const startPrecache = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    setProgress({ done: 0, total: 100, percent: 0 });
    triggerHaptic("selection");

    try {
      const result = await precacheBookDictionary(
        bookHash,
        (p) => setProgress(p),
        captureDbScope(),
      );

      if (result.error) {
        setError(result.error);
        triggerHaptic("light");
      } else {
        triggerHaptic("success");
        const updated = await getBookDictionaryStatus(
          bookHash,
          language,
          captureDbScope(),
        );
        setStatus(updated);
      }
    } catch {
      setError("No se pudo descargar el diccionario.");
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const isComplete =
    status != null && status.total > 0 && status.cached >= status.total;

  return (
    <div className="offline-dict-control">
      {downloading && progress ? (
        <div>
          <p className="meta">
            Guardando definiciones en el dispositivo… {progress.percent}% ({progress.done}/{progress.total})
          </p>
          <div className="precache-progress-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="precache-progress-fill"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      ) : isComplete ? (
        <p className="meta meta--offline">
          <span className="offline-dot" aria-hidden="true">●</span> Diccionario completo guardado ({status.cached} palabras en memoria local)
        </p>
      ) : status && status.cached > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
          <p className="meta">
            {status.cached} de {status.total} palabras guardadas ({status.percent}% disponible offline).
          </p>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => void startPrecache()}
          >
            Descargar palabras restantes
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => void startPrecache()}
          >
            Guardar diccionario de este libro
          </button>
          <p className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            Permite consultar cualquier palabra del libro aunque estés sin conexión.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="status" style={{ marginTop: "var(--s-1)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
