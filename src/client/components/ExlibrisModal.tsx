import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
import { useCompanionSafe } from "./CompanionProvider";
import { resolveCoatId } from "../../shared/companion-data";
import { triggerHaptic } from "../lib/haptics";
import { trackPlanEvent } from "../lib/plan-events";
import {
  buildExlibrisData,
  copyExlibrisToClipboard,
  downloadExlibrisCard,
  generateExlibrisBlob,
  renderExlibrisToCanvas,
  shareExlibrisCard,
  type ExlibrisInput,
  type ExlibrisTheme,
} from "../lib/exlibris-card";

export interface ExlibrisModalProps {
  bookTitle?: string;
  bookName?: string;
  author?: string;
  readingMinutes?: number;
  words?: string[];
  finishedDate?: string;
  onClose: () => void;
}

export default function ExlibrisModal({
  bookTitle,
  bookName,
  author,
  readingMinutes,
  words,
  finishedDate,
  onClose,
}: ExlibrisModalProps) {
  const companion = useCompanionSafe();
  const companionCoat = resolveCoatId(companion?.equipped.coat);
  const companionAvailable = Boolean(companion && companion.enabled !== false);
  const companionStage = companion?.stage ?? 1;

  const [theme, setTheme] = useState<ExlibrisTheme>("papel");
  const [includeCompanion, setIncludeCompanion] = useState(companionAvailable);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const config = useMemo<ExlibrisInput>(
    () => ({
      bookTitle,
      bookName,
      author,
      readingMinutes,
      words,
      finishedDate,
      theme,
      includeCompanion: includeCompanion && companionAvailable,
      coatId: companionCoat,
      companionStage,
    }),
    [
      bookTitle,
      bookName,
      author,
      readingMinutes,
      words,
      finishedDate,
      theme,
      includeCompanion,
      companionAvailable,
      companionCoat,
      companionStage,
    ],
  );

  const data = useMemo(() => buildExlibrisData(config), [config]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderExlibrisToCanvas(config, canvas);
  }, [config]);

  const handleShare = async () => {
    setBusy(true);
    setStatusMsg("Preparando lámina…");
    try {
      const blob = await generateExlibrisBlob(config);
      triggerHaptic("selection");
      const outcome = await shareExlibrisCard(blob, config);
      trackPlanEvent("app:share-exlibris");
      if (outcome === "shared") setStatusMsg("Exlibris compartido.");
      else if (outcome === "copied") setStatusMsg("Copiado al portapapeles.");
      else setStatusMsg("Imagen descargada.");
    } catch {
      setStatusMsg("No se pudo compartir la imagen.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    setBusy(true);
    setStatusMsg("Copiando…");
    try {
      const blob = await generateExlibrisBlob(config);
      const copied = await copyExlibrisToClipboard(blob);
      if (copied) {
        triggerHaptic("selection");
        setStatusMsg("Exlibris copiado al portapapeles.");
      } else {
        downloadExlibrisCard(blob, data.title);
        setStatusMsg("Copia no soportada; imagen descargada.");
      }
      trackPlanEvent("app:share-exlibris");
    } catch {
      setStatusMsg("No se pudo copiar.");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      const blob = await generateExlibrisBlob(config);
      triggerHaptic("light");
      downloadExlibrisCard(blob, data.title);
      trackPlanEvent("app:share-exlibris");
      setStatusMsg("Descargando Exlibris…");
    } catch {
      setStatusMsg("No se pudo descargar.");
    } finally {
      setBusy(false);
    }
  };

  const summaryBits = [
    data.author,
    data.readingTimeLabel,
    data.words.length > 0
      ? `${data.words.length} ${data.words.length === 1 ? "palabra guardada" : "palabras guardadas"}`
      : null,
  ].filter(Boolean);

  return (
    <Dialog label={`Exlibris de ${data.title}`} onClose={onClose}>
      <div className="quote-modal">
        <div className="sheet-head">
          <strong className="sheet-title">Exlibris</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar Exlibris"
            data-autofocus
          >
            Cerrar
          </button>
        </div>

        <div className="quote-modal-body">
          <div
            className="quote-preview-wrap quote-preview-wrap--story"
            aria-label="Vista previa del Exlibris"
          >
            <canvas ref={canvasRef} className="quote-preview-canvas" />
          </div>

          <div className="quote-modal-controls">
            <div>
              <strong className="exlibris-modal-title">{data.title}</strong>
              {summaryBits.length > 0 ? (
                <p className="meta" style={{ margin: "var(--s-1) 0 0" }}>
                  {summaryBits.join(" · ")}
                </p>
              ) : null}
            </div>

            <div className="setting-row">
              <span className="setting-label">Papel</span>
              <div className="segmented" role="group" aria-label="Tema del Exlibris">
                {(
                  [
                    ["papel", "Papel"],
                    ["noche", "Noche"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    data-active={theme === id || undefined}
                    aria-pressed={theme === id}
                    onClick={() => {
                      triggerHaptic("light");
                      setTheme(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {companionAvailable ? (
              <div className="quote-toggles">
                <label className="quote-toggle-item">
                  <input
                    type="checkbox"
                    checked={includeCompanion}
                    onChange={(e) => setIncludeCompanion(e.target.checked)}
                  />
                  <span>
                    <Icon name="cat" size={15} /> Incluir compañero
                  </span>
                </label>
              </div>
            ) : null}

            {statusMsg ? (
              <p className="meta quote-status" role="status">
                {statusMsg}
              </p>
            ) : null}

            <div className="quote-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void handleShare()}
              >
                Compartir
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void handleCopy()}
              >
                Copiar imagen
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void handleDownload()}
              >
                Descargar PNG
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
