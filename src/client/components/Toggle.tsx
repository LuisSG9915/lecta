type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // Etiqueta accesible: el rótulo visible vive en la fila del ajuste.
  label: string;
};

// Interruptor del panel de ajustes: píldora con perilla deslizante.
// El botón conserva área táctil de 44px aunque la pista sea más baja.
export default function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob toggle__thumb" aria-hidden="true" />
    </button>
  );
}
