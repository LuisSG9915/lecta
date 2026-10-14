// Botón real que envuelve al gato: tap/click/Enter/Espacio llegan al
// button nativo y el SVG interior va decorativo (aria-hidden) para no
// duplicar el rótulo — quien lo activa escucha solo el label del
// botón. El área mínima de 44×44 vive en .companion-btn (game.css).

import { Companion, type CompanionProps } from "./Companion";
import { triggerHaptic } from "../lib/haptics";

export function CompanionButton({
  label,
  onClick,
  disabled = false,
  bubbleMessage,
  onBubbleClick,
  ...cat
}: Omit<CompanionProps, "decorative"> & {
  // Rótulo del botón («Ver a Michi»); el gato de adentro es mudo.
  label: string;
  onClick: () => void;
  disabled?: boolean;
  bubbleMessage?: string | null;
  onBubbleClick?: () => void;
}) {
  const catButton = (
    <button
      type="button"
      className="companion-btn"
      aria-label={label}
      onClick={() => {
        triggerHaptic(12);
        onClick();
      }}
      disabled={disabled}
    >
      <Companion {...cat} decorative />
    </button>
  );

  if (!bubbleMessage) {
    return catButton;
  }

  return (
    <div className="companion-btn-wrapper">
      <button
        type="button"
        className="companion-bubble-prompt"
        role="status"
        aria-live="polite"
        onClick={() => {
          triggerHaptic(12);
          if (onBubbleClick) onBubbleClick();
          else onClick();
        }}
      >
        <span className="companion-bubble-text">{bubbleMessage}</span>
        <span className="companion-bubble-beak" aria-hidden="true" />
      </button>
      {catButton}
    </div>
  );
}
