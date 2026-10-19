export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
};

// Interruptor del panel de ajustes: píldora con perilla deslizante.
// El botón conserva área táctil de 44px aunque la pista sea más baja.
export function Toggle({ checked, onChange, label, ariaLabel }: ToggleProps) {
  const accessibleLabel = ariaLabel || label || "";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={accessibleLabel}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob toggle__thumb" aria-hidden="true" />
    </button>
  );
}

export default Toggle;
