import { useEffect } from "react";

// Aviso de primer uso de «Leer en voz alta»: la voz sale de las voces
// del dispositivo y el texto del libro jamás sale de la app. Aceptar
// guarda `consentedAt` (epoch ms); cancelar no re-insiste — el ítem
// del menú vuelve a ofrecerlo solo si el lector lo toca otra vez.
export default function TtsConsentDialog({
  onAccept,
  onDismiss,
}: {
  onAccept: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="tts-consent-backdrop" onClick={onDismiss}>
      <div
        className="tts-consent"
        role="dialog"
        aria-modal="true"
        aria-label="Leer en voz alta"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="tts-consent-text">
          Esta función usa las voces de tu dispositivo. Lecta no envía
          el texto del libro a sus servidores.
        </p>
        <div className="tts-consent-actions">
          <button type="button" className="btn" onClick={onAccept} data-autofocus>
            Activar
          </button>
          <button type="button" className="btn--quiet" onClick={onDismiss}>
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
