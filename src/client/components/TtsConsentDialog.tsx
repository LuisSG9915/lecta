import { useState, useEffect } from "react";
import type { TtsEngineMode } from "../lib/ttsTypes";
import { downloadKittenModel, kittenTtsEngine } from "../lib/kittenTtsEngine";

// Diálogo de consentimiento y preparación de «Leer en voz alta»:
// Explica la voz neural KittenTTS (~24 MB, descargada una sola vez y guardada
// offline en CacheStorage) frente a la voz ligera del sistema (0 MB).
export default function TtsConsentDialog({
  onAccept,
  onDismiss,
}: {
  onAccept: (engine?: TtsEngineMode) => void;
  onDismiss: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !downloading) onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, downloading]);

  const handleDownloadNeural = async () => {
    setDownloading(true);
    setErrorMsg(null);
    setPercent(0);

    try {
      await downloadKittenModel((progress) => {
        setPercent(progress.percent);
      });
      kittenTtsEngine.setReadyForTesting(true);
      onAccept("kitten-neural");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al descargar el modelo.";
      setErrorMsg(msg);
      setDownloading(false);
    }
  };

  const handleUseBrowser = () => {
    onAccept("browser");
  };

  return (
    <div
      className="tts-consent-backdrop"
      onClick={() => {
        if (!downloading) onDismiss();
      }}
    >
      <div
        className="tts-consent"
        role="dialog"
        aria-modal="true"
        aria-label="Leer en voz alta"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="tts-consent-title" style={{ margin: "0 0 var(--s-2)", fontSize: "var(--fs-1)" }}>
          Lectura en voz alta
        </h3>
        <p className="tts-consent-text">
          Lecta incluye el motor neural <strong>KittenTTS Neural (~24 MB)</strong> con 8 voces
          naturales a 24 kHz. Se descarga <strong>una sola vez</strong> y funciona completamente
          sin conexión. Lecta jamás envía el texto de tus libros a servidores externos.
        </p>

        {downloading ? (
          <div className="tts-consent-progress" style={{ margin: "var(--s-3) 0" }}>
            <div
              className="tts-progress-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: "8px",
                background: "var(--paper-sunken, #e4e2dd)",
                borderRadius: "4px",
                overflow: "hidden",
                margin: "var(--s-2) 0",
              }}
            >
              <div
                className="tts-progress-fill"
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: "var(--accent-primary, #c86d3b)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
            <p className="tts-progress-text" style={{ fontSize: "var(--fs-xs)", color: "var(--ink-soft)" }}>
              Descargando modelo neural... {percent}%
            </p>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="tts-consent-error" style={{ color: "var(--accent-danger, #d94848)", fontSize: "var(--fs-xs)" }}>
            {errorMsg}
          </p>
        ) : null}

        <div className="tts-consent-actions" style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)", marginTop: "var(--s-4)" }}>
          {!downloading ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleDownloadNeural}
                data-autofocus
                aria-label="Descargar modelo neural KittenTTS"
              >
                Descargar KittenTTS Neural (24 MB)
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={handleUseBrowser}
                aria-label="Usar voz ligera del sistema sin descargar"
              >
                Usar voz ligera del sistema (0 MB)
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={onDismiss}
                style={{ opacity: 0.7 }}
              >
                Ahora no
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn--quiet"
              onClick={handleUseBrowser}
            >
              Continuar con voz del sistema mientras tanto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
