import {
  THEME_CHOICES,
  THEME_LABELS,
  THEME_SWATCHES,
  type ThemeChoice,
} from "../lib/settings";

type ThemeMenuProps = {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
  // «text» rinde opciones de texto discretas (cabecera); «swatches»
  // enseña cada paleta como círculo con su papel y su tinta (panel Aa).
  variant?: "text" | "swatches";
};

// Selector de tema. En la variante de muestras, «Auto» parte el
// círculo en las dos caras que el sistema elegiría.
export default function ThemeMenu({ value, onChange, variant }: ThemeMenuProps) {
  if (variant === "swatches") {
    return (
      <div className="theme-swatches" role="radiogroup" aria-label="Tema">
        {THEME_CHOICES.map((choice) => {
          const swatch = THEME_SWATCHES[choice];
          return (
            <button
              key={choice}
              type="button"
              className="swatch"
              role="radio"
              aria-checked={choice === value}
              data-active={choice === value || undefined}
              onClick={() => onChange(choice)}
            >
              <span
                className="swatch-dot"
                style={{ background: swatch.bg }}
                aria-hidden="true"
              >
                {swatch.fg ? (
                  <span style={{ color: swatch.fg }}>A</span>
                ) : null}
              </span>
              <span className="swatch-name">{THEME_LABELS[choice]}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="theme-menu" role="group" aria-label="Tema">
      {THEME_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          className="theme-option"
          data-active={choice === value || undefined}
          aria-pressed={choice === value}
          onClick={() => onChange(choice)}
        >
          {THEME_LABELS[choice]}
        </button>
      ))}
    </div>
  );
}
