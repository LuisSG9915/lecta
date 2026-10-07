// Ítem «Leer en voz alta» en la hoja de ajustes del lector. Sin
// consentimiento la petición abre el aviso de privacidad; con él
// arranca la sesión desde la posición actual. La activación siempre
// es voluntaria — el TTS nunca se sugiere proactivamente.
export default function TtsMenuItem({
  active,
  onRequest,
}: {
  active: boolean;
  onRequest: () => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label">En voz alta</span>
      <button
        type="button"
        className="btn--quiet tts-menu-item"
        onClick={onRequest}
        aria-pressed={active}
      >
        {active ? "Detener lectura en voz alta" : "Leer en voz alta"}
      </button>
    </div>
  );
}
