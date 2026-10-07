// Botón real que envuelve al gato: tap/click/Enter/Espacio llegan al
// button nativo y el SVG interior va decorativo (aria-hidden) para no
// duplicar el rótulo — quien lo activa escucha solo el label del
// botón. El área mínima de 44×44 vive en .companion-btn (game.css).

import { Companion, type CompanionProps } from "./Companion";

export function CompanionButton({
  label,
  onClick,
  disabled = false,
  ...cat
}: Omit<CompanionProps, "decorative"> & {
  // Rótulo del botón («Ver a Michi»); el gato de adentro es mudo.
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="companion-btn"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Companion {...cat} decorative />
    </button>
  );
}
