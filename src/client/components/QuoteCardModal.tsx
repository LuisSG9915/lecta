import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import {
  generateQuoteCardBlob,
  renderQuoteCardToCanvas,
  shareQuoteCard,
  copyQuoteCardToClipboard,
  downloadQuoteCard,
  type QuoteCardConfig,
  type QuoteCardFormat,
  type QuoteCardTheme,
} from "../lib/quote-card";
import { triggerHaptic } from "../lib/haptics";
import { useCompanionSafe } from "./CompanionProvider";
import { resolveCoatId } from "../../shared/companion-data";

type QuoteCardModalProps = {
  text: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  onClose: () => void;
  onSavePassage?: () => void;
  alreadySaved?: boolean;
};

export default function QuoteCardModal({
  text,
  bookTitle,
  author,
  chapterTitle,
  onClose,
  onSavePassage,
  alreadySaved = false,
}: QuoteCardModalProps) {
  const companion = useCompanionSafe();
  const companionCoat = resolveCoatId(companion?.equipped.coat);
  const companionAvailable = Boolean(companion && companion.enabled !== false);

  const [format, setFormat] = useState<QuoteCardFormat>("portrait");
  const [theme, setTheme] = useState<QuoteCardTheme>("clasico_crema");
  const [showAuthor, setShowAuthor] = useState(Boolean(author));
  const [showBookTitle, setShowBookTitle] = useState(Boolean(bookTitle));
  const [showChapter, setShowChapter] = useState(Boolean(chapterTitle));
  const [showBranding, setShowBranding] = useState(true);
  const [includeCompanion, setIncludeCompanion] = useState(companionAvailable);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [savedLocal, setSavedLocal] = useState(alreadySaved);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const config = useMemo<QuoteCardConfig>(
    () => ({
      text,
      bookTitle,
      author,
      chapterTitle,
      format,
      theme,
      showAuthor,
      showBookTitle,
      showChapter,
      showBranding,
      includeCompanion: includeCompanion && companionAvailable,
      coatId: companionCoat,
    }),
    [
      text,
      bookTitle,
      author,
      chapterTitle,
      format,
      theme,
      showAuthor,
      showBookTitle,
      showChapter,
      showBranding,
      includeCompanion,
      companionAvailable,
      companionCoat,
    ],
  );

  // Re-renderizar canvas cuando cambian los ajustes
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    void renderQuoteCardToCanvas(config, canvas).then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [config]);

  const handleShare = async () => {
    setBusy(true);
    setStatusMsg("Preparando imagen…");
    try {
      const blob = await generateQuoteCardBlob(config);
      triggerHaptic("selection");
      const outcome = await shareQuoteCard(blob, config);
      if (outcome === "shared") {
        setStatusMsg("Compartido.");
      } else if (outcome === "copied") {
        setStatusMsg("Copiado al portapapeles.");
      } else {
        setStatusMsg("Imagen descargada.");
      }
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
      const blob = await generateQuoteCardBlob(config);
      const copied = await copyQuoteCardToClipboard(blob);
      if (copied) {
        triggerHaptic("selection");
        setStatusMsg("Imagen copiada al portapapeles.");
      } else {
        downloadQuoteCard(blob);
        setStatusMsg("Copia no soportada; imagen descargada.");
      }
    } catch {
      setStatusMsg("No se pudo copiar.");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      const blob = await generateQuoteCardBlob(config);
      triggerHaptic("light");
      downloadQuoteCard(blob);
      setStatusMsg("Descargando imagen…");
    } catch {
      setStatusMsg("No se pudo descargar.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveToNotebook = () => {
    if (onSavePassage && !savedLocal) {
      triggerHaptic("success");
      onSavePassage();
      setSavedLocal(true);
      setStatusMsg("Pasaje guardado en tu Cuaderno.");
    }
  };

  return (
    <Dialog label="Tarjeta de cita" onClose={onClose}>
      <div className="quote-modal">
        <div className="sheet-head">
          <strong className="sheet-title">Tarjeta de cita</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar creador de tarjeta"
            data-autofocus
          >
            Cerrar
          </button>
        </div>

        <div className="quote-modal-body">
          {/* Vista previa en tiempo real */}
          <div
            className={`quote-preview-wrap quote-preview-wrap--${format}`}
            aria-label="Vista previa de la tarjeta"
          >
            <canvas ref={canvasRef} className="quote-preview-canvas" />
          </div>

          {/* Panel de personalización */}
          <div className="quote-modal-controls">
            <div className="setting-row">
              <span className="setting-label">Formato</span>
              <div className="segmented" role="group" aria-label="Formato de la tarjeta">
                <button
                  type="button"
                  data-active={format === "portrait" || undefined}
                  aria-pressed={format === "portrait"}
                  onClick={() => {
                    triggerHaptic("light");
                    setFormat("portrait");
                  }}
                >
                  Postal (4:5)
                </button>
                <button
                  type="button"
                  data-active={format === "story" || undefined}
                  aria-pressed={format === "story"}
                  onClick={() => {
                    triggerHaptic("light");
                    setFormat("story");
                  }}
                >
                  Historia (9:16)
                </button>
                <button
                  type="button"
                  data-active={format === "square" || undefined}
                  aria-pressed={format === "square"}
                  onClick={() => {
                    triggerHaptic("light");
                    setFormat("square");
                  }}
                >
                  Cuadrado (1:1)
                </button>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">Tema</span>
              <div className="segmented quote-theme-chips" role="group" aria-label="Tema de color">
                {(
                  [
                    ["clasico_crema", "Clásico Crema"],
                    ["noche_tinta", "Noche Tinta"],
                    ["azul_modernista", "Azul Modernista"],
                    ["papel", "Papel"],
                    ["bermellon", "Bermellón"],
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

            <div className="quote-toggles">
              <span className="setting-label">Información visible</span>
              <div className="quote-toggle-list">
                {bookTitle ? (
                  <label className="quote-toggle-item">
                    <input
                      type="checkbox"
                      checked={showBookTitle}
                      onChange={(e) => setShowBookTitle(e.target.checked)}
                    />
                    <span>Título del libro</span>
                  </label>
                ) : null}

                {author ? (
                  <label className="quote-toggle-item">
                    <input
                      type="checkbox"
                      checked={showAuthor}
                      onChange={(e) => setShowAuthor(e.target.checked)}
                    />
                    <span>Autor</span>
                  </label>
                ) : null}

                {chapterTitle ? (
                  <label className="quote-toggle-item">
                    <input
                      type="checkbox"
                      checked={showChapter}
                      onChange={(e) => setShowChapter(e.target.checked)}
                    />
                    <span>Capítulo</span>
                  </label>
                ) : null}

                {companionAvailable ? (
                  <label className="quote-toggle-item">
                    <input
                      type="checkbox"
                      checked={includeCompanion}
                      onChange={(e) => setIncludeCompanion(e.target.checked)}
                    />
                    <span>🐱 Incluir a mi gato compañero en la postal</span>
                  </label>
                ) : null}

                <label className="quote-toggle-item">
                  <input
                    type="checkbox"
                    checked={showBranding}
                    onChange={(e) => setShowBranding(e.target.checked)}
                  />
                  <span>Firma discreta de Lecta</span>
                </label>
              </div>
            </div>

            {statusMsg ? (
              <p className="meta quote-status" role="status">
                {statusMsg}
              </p>
            ) : null}

            {/* Botones de acción */}
            <div className="quote-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void handleShare()}
              >
                Compartir en historias
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void handleCopy()}
                title="Copiar imagen al portapapeles"
              >
                Copiar imagen
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void handleDownload()}
                title="Descargar imagen PNG"
              >
                Descargar PNG
              </button>
              {onSavePassage && !savedLocal ? (
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={handleSaveToNotebook}
                >
                  Guardar en mi Cuaderno
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
