import { useState, useEffect } from "react";
import Icon from "./Icon";
import type { TtsEngineMode } from "../lib/ttsTypes";
import { kittenTtsEngine } from "../lib/kittenTtsEngine";
import type { TtsEngineKind } from "../workers/kitten-tts.worker";

export interface TtsConsentDialogProps {
  onAccept: (engine?: TtsEngineMode) => void;
  onDismiss: () => void;
  downloadProgress?: number | null; // 0 a 100
  isModelDownloaded?: boolean;
  onDeleteModel?: () => void;
  /** Idioma del libro: «es» ofrece la voz Piper VITS; el resto, KittenTTS. */
  bookLanguage?: string;
}

// Diálogo de consentimiento y preparación de «Leer en voz alta»:
// Explica la voz neural (~24 MB inglés KittenTTS / ~63 MB español Piper VITS,
// descargada una sola vez y guardada offline en CacheStorage) frente a la voz
// ligera del sistema (0 MB).
export default function TtsConsentDialog({
  onAccept,
  onDismiss,
  downloadProgress,
  isModelDownloaded,
  onDeleteModel,
  bookLanguage,
}: TtsConsentDialogProps) {
  const neuralKind: TtsEngineKind = bookLanguage?.toLowerCase().startsWith("es")
    ? "piper"
    : "kitten";
  const neuralName = neuralKind === "piper" ? "Piper VITS es_MX" : "KittenTTS Neural";
  const neuralSize = neuralKind === "piper" ? "~63 MB" : "~24 MB";
  const neuralDescription =
    neuralKind === "piper"
      ? "con la voz neuronal claude-high en español mexicano a 22 kHz"
      : "con 8 voces naturales a 24 kHz para lecturas en inglés";
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDownloadingProp =
    typeof downloadProgress === "number" &&
    downloadProgress >= 0 &&
    downloadProgress <= 99;
  const isBusy = downloading || isDownloadingProp;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, isBusy]);

  const handleDownloadNeural = async () => {
    setDownloading(true);
    setErrorMsg(null);
    setPercent(0);

    try {
      await kittenTtsEngine.downloadEngineModel(neuralKind, (p) => {
        setPercent(p.percent);
      });
      await kittenTtsEngine.init(undefined, neuralKind);
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
        if (!isBusy) onDismiss();
      }}
    >
      <div
        className="tts-consent"
        role="dialog"
        aria-modal="true"
        aria-label="Leer en voz alta"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="tts-consent-title">
          Lectura en voz alta
        </h3>
        <p className="tts-consent-text">
          Lecta incluye el motor neural <strong>{neuralName} ({neuralSize})</strong>{" "}
          {neuralDescription} (se descarga <strong>una sola vez</strong> y funciona sin
          conexión), además de la voz de tu dispositivo al instante. Lecta jamás envía
          el texto de tus libros a servidores externos.
        </p>

        {isDownloadingProp ? (
          <div className="tts-consent-progress">
            <div
              className="tts-progress-bar"
              role="progressbar"
              aria-valuenow={downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="tts-progress-fill"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="tts-progress-text">
              Descargando Voz Neural HD (Offline)... {downloadProgress}%
            </p>
          </div>
        ) : downloading ? (
          <div className="tts-consent-progress">
            <div
              className="tts-progress-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="tts-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="tts-progress-text">
              Descargando modelo neural... {percent}%
            </p>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="tts-consent-error">
            {errorMsg}
          </p>
        ) : null}

        <div className="tts-consent-actions">
          {!isBusy ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleDownloadNeural}
                data-autofocus
                aria-label={`Descargar modelo neural ${neuralName}`}
              >
                Descargar {neuralName} ({neuralSize})
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={handleUseBrowser}
                aria-label="Usar voz ligera del sistema sin descargar"
              >
                Usar voz ligera del sistema (0 MB)
              </button>
              {isModelDownloaded && onDeleteModel ? (
                <button
                  type="button"
                  className="btn--quiet tts-delete-model-btn"
                  onClick={onDeleteModel}
                  aria-label="Borrar datos de voz offline"
                >
                  <Icon name="trash" size={15} /> Borrar datos de voz offline ({neuralSize})
                </button>
              ) : null}
              <button
                type="button"
                className="btn--quiet tts-dismiss-btn"
                onClick={onDismiss}
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
