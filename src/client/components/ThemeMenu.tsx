import {
  FOCUS_MODES,
  READER_FONTS,
  RULER_SIZES,
  THEME_CHOICES,
  THEME_LABELS,
  THEME_SWATCHES,
  type FocusMode,
  type ReaderFont,
  type RulerSize,
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
      <div className="theme-swatches" role="radiogroup" aria-label="Tema de lectura">
        {THEME_CHOICES.map((choice) => {
          const swatch = THEME_SWATCHES[choice];
          const isSelected = choice === value;
          return (
            <button
              key={choice}
              type="button"
              className="swatch"
              role="radio"
              aria-checked={isSelected}
              data-active={isSelected || undefined}
              onClick={() => onChange(choice)}
            >
              <span
                className="swatch-dot"
                style={{
                  background: swatch.bg,
                  borderColor: swatch.border,
                }}
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

// Carrusel horizontal de tipografías con vista previa real y etiquetas de ayuda
export function FontCarousel({
  value,
  onChange,
}: {
  value: ReaderFont;
  onChange: (font: ReaderFont) => void;
}) {
  return (
    <div className="font-carousel" role="radiogroup" aria-label="Tipografía">
      {READER_FONTS.map(({ id, label, family, help, sample }) => {
        const isSelected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-active={isSelected || undefined}
            className="font-card"
            onClick={() => onChange(id)}
          >
            <span
              className="font-card-sample"
              style={{ fontFamily: family }}
              aria-hidden="true"
            >
              {sample}
            </span>
            <strong className="font-card-label" style={{ fontFamily: family }}>
              {label}
            </strong>
            <span className="font-card-help">{help}</span>
          </button>
        );
      })}
    </div>
  );
}

// Control paso a paso (- / +) con indicador numérico/visual
export function StepperControl({
  label,
  valueText,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
  ariaDecrementLabel = "Disminuir",
  ariaIncrementLabel = "Aumentar",
}: {
  label: string;
  valueText: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
  ariaDecrementLabel?: string;
  ariaIncrementLabel?: string;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="setting-stepper">
        <button
          type="button"
          className="btn stepper-btn"
          aria-label={ariaDecrementLabel}
          disabled={!canDecrement}
          onClick={onDecrement}
        >
          −
        </button>
        <span className="setting-value" aria-live="polite">
          {valueText}
        </span>
        <button
          type="button"
          className="btn stepper-btn"
          aria-label={ariaIncrementLabel}
          disabled={!canIncrement}
          onClick={onIncrement}
        >
          +
        </button>
      </div>
    </div>
  );
}

// Selector del modo de concentración: texto normal, líneas
// sintácticas o regla de foco; con la regla aparece su tamaño.
export function FocusModeMenu({
  value,
  rulerSize,
  onChange,
  onRulerSize,
}: {
  value: FocusMode;
  rulerSize: RulerSize;
  onChange: (mode: FocusMode) => void;
  onRulerSize: (size: RulerSize) => void;
}) {
  return (
    <div className="focus-menu">
      <div className="segmented" role="group" aria-label="Modo de concentración">
        {FOCUS_MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-active={value === id || undefined}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {value === "ruler" ? (
        <div
          className="segmented"
          role="group"
          aria-label="Tamaño de la regla de foco"
        >
          {RULER_SIZES.map(({ id, label }) => (
            <button
              key={String(id)}
              type="button"
              data-active={rulerSize === id || undefined}
              aria-pressed={rulerSize === id}
              onClick={() => onRulerSize(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
