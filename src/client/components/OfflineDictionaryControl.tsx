import { useEffect, useMemo, useState } from "react";
import {
  getBookDictionaryStatus,
  precacheBookDictionary,
  isAutoPrecacheEnabled,
  setAutoPrecacheEnabled,
  type PrecacheProgress,
} from "../lib/offline-dictionary";
import { captureDbScope } from "../lib/idb";
import { triggerHaptic } from "../lib/haptics";

export interface OfflineDictionaryControlProps {
  bookHash: string;
  language?: string;
  currentChapterIndex?: number;
  totalChapters?: number;
  cachedChaptersRange?: { start: number; end: number };
}

export default function OfflineDictionaryControl({
  bookHash,
  language = "es",
  currentChapterIndex,
  totalChapters,
  cachedChaptersRange,
}: OfflineDictionaryControlProps) {
  const [status, setStatus] = useState<{
    total: number;
    cached: number;
    percent: number;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<PrecacheProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoPrecache, setAutoPrecache] = useState(isAutoPrecacheEnabled());

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

  const handleToggleAutoPrecache = () => {
    const next = !autoPrecache;
    setAutoPrecache(next);
    setAutoPrecacheEnabled(next);
    triggerHaptic("selection");
  };

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

  const chapterRangeText = useMemo(() => {
    if (cachedChaptersRange) {
      return `${cachedChaptersRange.start}–${cachedChaptersRange.end}`;
    }
    if (
      currentChapterIndex !== undefined &&
      totalChapters !== undefined &&
      totalChapters > 0
    ) {
      const start = 1;
      const end = Math.min(totalChapters, currentChapterIndex + 1 + 2);
      return `${start}–${end}`;
    }
    return null;
  }, [cachedChaptersRange, currentChapterIndex, totalChapters]);

  return (
    <div className="offline-dict-control">
      {downloading && progress ? (
        <div>
          <p className="meta">
            Guardando definiciones en el dispositivo… {progress.percent}% ({progress.done}/{progress.total})
          </p>
          <div
            className="precache-progress-bar"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="precache-progress-fill"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      ) : isComplete ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
          <p className="meta meta--offline">
            <span className="offline-dot" aria-hidden="true">●</span> Diccionario completo guardado ({status.cached} palabras en memoria local)
          </p>
        </div>
      ) : status && status.cached > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
          <p className="meta meta--offline">
            <span className="offline-check" aria-hidden="true">✓</span>{" "}
            Vocabulario listo sin conexión{chapterRangeText ? ` (Capítulos ${chapterRangeText})` : ` (${status.percent}% disponible)`}
          </p>
          <p className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            {status.cached} de {status.total} palabras guardadas.
          </p>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => void startPrecache()}
          >
            Guardar libro entero para viaje
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

      {/* Control de pre-carga automática para ahorro de batería/datos */}
      <div
        className="offline-dict-toggle"
        style={{
          marginTop: "var(--s-2)",
          display: "flex",
          alignItems: "center",
          gap: "var(--s-1)",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--s-1)",
            fontSize: "var(--fs-xs)",
            cursor: "pointer",
            color: "var(--fg-muted)",
          }}
        >
          <input
            type="checkbox"
            checked={autoPrecache}
            onChange={handleToggleAutoPrecache}
            aria-label="Pre-cargar próximos capítulos automáticamente"
          />
          <span>Pre-cargar próximos capítulos automáticamente</span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="status" style={{ marginTop: "var(--s-1)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
