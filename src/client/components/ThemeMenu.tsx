import {
  FOCUS_MODES,
  READER_FONTS,
  READER_LIMITS,
  RULER_SIZES,
  THEME_CHOICES,
  THEME_LABELS,
  THEME_SWATCHES,
  LEADING_OPTIONS,
  MARGIN_OPTIONS,
  READING_PRESETS,
  applyReadingPreset,
  detectActiveReadingPreset,
  type FocusMode,
  type ReaderFont,
  type RulerSize,
  type ThemeChoice,
  type ReaderSettings,
  type ReadingPreset,
} from "../lib/settings";
import { setBilingualMode } from "../lib/phrases";
import Toggle from "./Toggle";

export type ThemeMenuProps = {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
  // «text» rinde opciones de texto discretas (cabecera); «swatches»
  // enseña cada paleta como círculo con su papel y su tinta (panel Aa).
  variant?: "text" | "swatches";
  // Props para el centro de diseño y lectura (hoja Aa completa)
  settings?: ReaderSettings;
  onUpdateSettings?: (updates: Partial<ReaderSettings>) => void;
  activePreset?: ReadingPreset;
  onSelectPreset?: (preset: Exclude<ReadingPreset, "custom">) => void;
  onToggleFocusRuler?: (val: boolean) => void;
  onToggleParagraphFocus?: (val: boolean) => void;
  onToggleBilingualScaffolding?: (val: boolean) => void;
};

// Selector de tema y panel maestro de diseño y lectura (Hoja Aa).
// Si no se proveen settings, mantiene retrocompatibilidad con Account.tsx.
export default function ThemeMenu({
  value,
  onChange,
  variant,
  settings,
  onUpdateSettings,
  activePreset,
  onSelectPreset,
  onToggleFocusRuler,
  onToggleParagraphFocus,
  onToggleBilingualScaffolding,
}: ThemeMenuProps) {
  const renderSwatches = () => (
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
              {swatch.fg ? <span style={{ color: swatch.fg }}>A</span> : null}
            </span>
            <span className="swatch-name">{THEME_LABELS[choice]}</span>
          </button>
        );
      })}
    </div>
  );

  // Variante simple (retrocompatible para Account.tsx o cabecera)
  if (!settings || !onUpdateSettings) {
    if (variant === "swatches") {
      return renderSwatches();
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

  // Panel completo de Apariencia y Ayudas (3 Bloques Escaneables)
  const currentActivePreset =
    activePreset ?? settings.readingPreset ?? detectActiveReadingPreset(settings);

  const handleSelectPreset = (preset: Exclude<ReadingPreset, "custom">) => {
    if (onSelectPreset) {
      onSelectPreset(preset);
    } else {
      const updated = applyReadingPreset(settings, preset);
      onUpdateSettings(updated);
    }
  };

  const handleToggleFocusRuler = (checked: boolean) => {
    onToggleFocusRuler?.(checked);
    onUpdateSettings({
      focusRuler: checked,
      readingPreset: "custom",
      strategyPreset: "custom",
    });
  };

  const handleToggleParagraphFocus = (checked: boolean) => {
    onToggleParagraphFocus?.(checked);
    onUpdateSettings({
      paragraphFocus: checked,
      readingPreset: "custom",
      strategyPreset: "custom",
    });
  };

  const isBilingualActive = (settings.bilingualScaffoldingMode ?? "auto") !== "off";

  const handleToggleBilingual = (checked: boolean) => {
    const nextMode = checked ? "auto" : "off";
    setBilingualMode(nextMode);
    onToggleBilingualScaffolding?.(checked);
    onUpdateSettings({
      bilingualScaffoldingMode: nextMode,
    });
  };

  return (
    <div className="theme-sheet-container">
      {/* Bloque 1: Tema y Color */}
      <section className="theme-sheet-section" aria-labelledby="theme-section-title">
        <span id="theme-section-title" className="setting-section-label">Tema y color</span>
        {renderSwatches()}
      </section>

      {/* Bloque 2: Tipografía y Ritmo */}
      <section className="theme-sheet-section" aria-labelledby="typography-section-title">
        <span id="typography-section-title" className="setting-section-label">Tipografía y ritmo</span>
        <FontCarousel
          value={settings.font}
          onChange={(font) => onUpdateSettings({ font })}
        />

        <div className="theme-sheet-steppers">
          <StepperControl
            label="Tamaño de letra"
            valueText={`${settings.size} px`}
            canDecrement={settings.size > READER_LIMITS.size.min}
            canIncrement={settings.size < READER_LIMITS.size.max}
            onDecrement={() => onUpdateSettings({ size: settings.size - 1 })}
            onIncrement={() => onUpdateSettings({ size: settings.size + 1 })}
            ariaDecrementLabel="Letra más pequeña"
            ariaIncrementLabel="Letra más grande"
          />

          <StepperControl
            label="Interlineado"
            valueText={
              LEADING_OPTIONS.find((o) => o.value === settings.leading)?.label ??
              String(settings.leading)
            }
            canDecrement={settings.leading > LEADING_OPTIONS[0].value}
            canIncrement={
              settings.leading < LEADING_OPTIONS[LEADING_OPTIONS.length - 1].value
            }
            onDecrement={() => {
              const idx = LEADING_OPTIONS.findIndex((o) => o.value === settings.leading);
              if (idx > 0) onUpdateSettings({ leading: LEADING_OPTIONS[idx - 1].value });
              else if (idx === -1) onUpdateSettings({ leading: LEADING_OPTIONS[0].value });
            }}
            onIncrement={() => {
              const idx = LEADING_OPTIONS.findIndex((o) => o.value === settings.leading);
              if (idx >= 0 && idx < LEADING_OPTIONS.length - 1) {
                onUpdateSettings({ leading: LEADING_OPTIONS[idx + 1].value });
              } else if (idx === -1) {
                onUpdateSettings({ leading: LEADING_OPTIONS[LEADING_OPTIONS.length - 1].value });
              }
            }}
            ariaDecrementLabel="Reducir interlineado"
            ariaIncrementLabel="Aumentar interlineado"
          />

          <div className="setting-row">
            <span className="setting-label">Márgenes</span>
            <div className="segmented" role="group" aria-label="Márgenes">
              {MARGIN_OPTIONS.map(({ value: marginVal, label }) => (
                <button
                  key={marginVal}
                  type="button"
                  data-active={settings.measure === marginVal || undefined}
                  aria-pressed={settings.measure === marginVal}
                  onClick={() => onUpdateSettings({ measure: marginVal })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bloque 3: Ayudas de Enfoque */}
      <section className="theme-sheet-section" aria-labelledby="focus-section-title">
        <span id="focus-section-title" className="setting-section-label">Ayudas de enfoque</span>

        <div className="reader-mode-cards" role="radiogroup" aria-label="Modo de lectura activo">
          {READING_PRESETS.map((preset) => {
            const active = currentActivePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`reader-mode-card ${active ? "is-active" : ""}`}
                data-active={active || undefined}
                onClick={() => handleSelectPreset(preset.id as Exclude<ReadingPreset, "custom">)}
              >
                <span className="reader-mode-card-icon" aria-hidden="true">{preset.icon}</span>
                <strong className="reader-mode-card-title">{preset.label}</strong>
                <span className="reader-mode-card-desc">{preset.description}</span>
              </button>
            );
          })}
        </div>

        <div className="theme-focus-switches">
          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">Regla de lectura</span>
              <span className="setting-subtext">Ilumina solo la línea actual para no perder el renglón</span>
            </div>
            <Toggle
              label="Regla de lectura"
              checked={Boolean(settings.focusRuler)}
              onChange={handleToggleFocusRuler}
            />
          </div>

          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">Párrafos por bloques</span>
              <span className="setting-subtext">Agrupa frases largas para leer sin fatiga</span>
            </div>
            <Toggle
              label="Párrafos por bloques"
              checked={Boolean(settings.paragraphFocus)}
              onChange={handleToggleParagraphFocus}
            />
          </div>

          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">Apoyo bilingüe</span>
              <span className="setting-subtext">Muestra traducciones suaves en pasajes difíciles</span>
            </div>
            <Toggle
              label="Apoyo bilingüe"
              checked={isBilingualActive}
              onChange={handleToggleBilingual}
            />
          </div>
        </div>
      </section>
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
