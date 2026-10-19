import {
  FONT_LABELS,
  LINE_HEIGHT_LABELS,
  MARGIN_LABELS,
  THEME_LABELS,
  THEME_CHOICES,
  THEME_SWATCHES,
  type ReaderFont,
  type ReaderLineHeight,
  type ReaderMargins,
  type ReaderSettings,
  type ReaderTheme,
  type ReadingPreset,
  type ThemeChoice,
} from "../lib/settings";
import { Toggle } from "./Toggle";

export interface ThemeMenuProps {
  settings?: ReaderSettings;
  onChange?: ((patch: Partial<ReaderSettings>) => void) | ((choice: ThemeChoice) => void);
  onClose?: () => void;

  // Retrocompatibilidad con Account.tsx y Reader.tsx
  value?: ThemeChoice;
  variant?: "text" | "swatches";
  onUpdateSettings?: (updates: Partial<ReaderSettings>) => void;
  activePreset?: ReadingPreset;
  onSelectPreset?: (preset: Exclude<ReadingPreset, "custom">) => void;
  onToggleFocusRuler?: (val: boolean) => void;
  onToggleParagraphFocus?: (val: boolean) => void;
  onToggleBilingualScaffolding?: (val: boolean) => void;
}

const FONTS: ReaderFont[] = ["literata", "source-serif", "alegreya-sans", "atkinson", "opendyslexic"];
const THEMES: ReaderTheme[] = ["paper", "sepia", "night"];
const LINE_HEIGHTS: ReaderLineHeight[] = ["compact", "comfortable", "spacious"];
const MARGINS: ReaderMargins[] = ["narrow", "medium", "wide"];

export function ThemeMenu({
  settings,
  onChange,
  onClose,
  value,
  variant,
  onUpdateSettings,
  onToggleFocusRuler,
  onToggleParagraphFocus,
  onToggleBilingualScaffolding,
}: ThemeMenuProps) {
  // Variante simple sin settings (retrocompatibilidad para Account.tsx o cabecera simple)
  if (!settings) {
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
                onClick={() => (onChange as (choice: ThemeChoice) => void)?.(choice)}
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
            onClick={() => (onChange as (choice: ThemeChoice) => void)?.(choice)}
          >
            {THEME_LABELS[choice]}
          </button>
        ))}
      </div>
    );
  }

  // Despachador de cambios con retrocompatibilidad
  const handlePatch = (patch: Partial<ReaderSettings>) => {
    if (onUpdateSettings) {
      onUpdateSettings(patch);
    } else if (onChange) {
      (onChange as (p: Partial<ReaderSettings>) => void)(patch);
    }
    if (patch.theme && typeof onChange === "function" && onUpdateSettings) {
      const themeChoiceMap: Record<string, ThemeChoice> = {
        paper: "blanco",
        sepia: "papel",
        night: "noche",
      };
      const choice = themeChoiceMap[patch.theme] ?? (patch.theme as ThemeChoice);
      try {
        (onChange as (c: ThemeChoice) => void)(choice);
      } catch {
        // no-op
      }
    }
  };

  const currentTheme: ReaderTheme =
    settings.theme ??
    (value === "papel" ? "sepia" : value === "noche" || value === "oled" ? "night" : "paper");

  const currentFontSize = settings.fontSize ?? settings.size ?? 18;

  const currentLineHeight: ReaderLineHeight =
    typeof settings.lineHeight === "string" && ["compact", "comfortable", "spacious"].includes(settings.lineHeight)
      ? (settings.lineHeight as ReaderLineHeight)
      : settings.leading && settings.leading <= 1.5
        ? "compact"
        : settings.leading && settings.leading >= 1.8
          ? "spacious"
          : "comfortable";

  const currentMargins: ReaderMargins =
    typeof settings.margins === "string" && ["narrow", "medium", "wide"].includes(settings.margins)
      ? (settings.margins as ReaderMargins)
      : settings.measure && settings.measure >= 70
        ? "narrow"
        : settings.measure && settings.measure <= 55
          ? "wide"
          : "medium";

  return (
    <div className="theme-menu" role="dialog" aria-label="Apariencia y ayudas de lectura">
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="theme-menu-close btn--quiet"
            onClick={onClose}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>
      )}
      <div className="theme-row">
        <span className="theme-label">Color de página</span>
        <div className="theme-swatches">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`swatch swatch-${t} ${currentTheme === t ? "is-active" : ""}`}
              onClick={() => handlePatch({ theme: t })}
              aria-pressed={currentTheme === t}
            >
              <span className="swatch-dot" />
              <span>{THEME_LABELS[t]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-row">
        <span className="theme-label">Letra</span>
        <div className="font-choices">
          {FONTS.map((f) => (
            <button
              key={f}
              type="button"
              className={`font-choice font-preview-${f} ${settings.font === f ? "is-active" : ""}`}
              onClick={() => handlePatch({ font: f })}
              aria-pressed={settings.font === f}
            >
              <span className="font-choice-name">{FONT_LABELS[f]?.name ?? f}</span>
              <span className="font-choice-hint">{FONT_LABELS[f]?.hint ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-row">
        <div className="theme-label-row">
          <span className="theme-label">Tamaño de letra</span>
          <span className="theme-value">{currentFontSize} px</span>
        </div>
        <div className="size-controls">
          <button
            type="button"
            className="size-btn"
            onClick={() => {
              const nextSize = Math.max(15, currentFontSize - 1);
              handlePatch({ fontSize: nextSize, size: nextSize });
            }}
            disabled={currentFontSize <= 15}
            aria-label="Reducir tamaño de letra"
          >
            A−
          </button>
          <input
            type="range"
            min={15}
            max={26}
            step={1}
            value={currentFontSize}
            onChange={(e) => {
              const nextSize = Number(e.target.value);
              handlePatch({ fontSize: nextSize, size: nextSize });
            }}
            aria-label="Tamaño de letra"
          />
          <button
            type="button"
            className="size-btn"
            onClick={() => {
              const nextSize = Math.min(26, currentFontSize + 1);
              handlePatch({ fontSize: nextSize, size: nextSize });
            }}
            disabled={currentFontSize >= 26}
            aria-label="Aumentar tamaño de letra"
          >
            A+
          </button>
        </div>
      </div>

      <div className="theme-row">
        <span className="theme-label">Espacio entre líneas</span>
        <div className="segmented">
          {LINE_HEIGHTS.map((lh) => (
            <button
              key={lh}
              type="button"
              className={currentLineHeight === lh ? "is-active" : ""}
              onClick={() =>
                handlePatch({
                  lineHeight: lh,
                  leading: lh === "compact" ? 1.4 : lh === "comfortable" ? 1.65 : 1.9,
                })
              }
              aria-pressed={currentLineHeight === lh}
            >
              {LINE_HEIGHT_LABELS[lh]}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-row">
        <span className="theme-label">Ancho de página</span>
        <div className="segmented">
          {MARGINS.map((m) => (
            <button
              key={m}
              type="button"
              className={currentMargins === m ? "is-active" : ""}
              onClick={() =>
                handlePatch({
                  margins: m,
                  measure: m === "narrow" ? 75 : m === "medium" ? 65 : 55,
                })
              }
              aria-pressed={currentMargins === m}
            >
              {MARGIN_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Regla guía de lectura</span>
          <span className="theme-toggle-hint">
            Ilumina la línea actual para no perder el renglón
          </span>
        </div>
        <Toggle
          checked={Boolean(settings.focusRuler)}
          onChange={(next) => {
            onToggleFocusRuler?.(next);
            handlePatch({ focusRuler: next });
          }}
          ariaLabel="Regla guía de lectura"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Un párrafo a la vez</span>
          <span className="theme-toggle-hint">
            Atenúa el resto del texto para concentrarte en el bloque actual
          </span>
        </div>
        <Toggle
          checked={Boolean(settings.paragraphFocus)}
          onChange={(next) => {
            onToggleParagraphFocus?.(next);
            handlePatch({ paragraphFocus: next });
          }}
          ariaLabel="Un párrafo a la vez"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Guía visual de sílabas</span>
          <span className="theme-toggle-hint">
            Destaca el inicio de cada palabra para leer con más agilidad
          </span>
        </div>
        <Toggle
          checked={Boolean(settings.bionicReading ?? settings.bionicAnchors)}
          onChange={(next) => handlePatch({ bionicReading: next, bionicAnchors: next })}
          ariaLabel="Guía visual de sílabas"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Dividir palabras largas</span>
          <span className="theme-toggle-hint">
            Separa con guiones sutiles las palabras complejas para facilitar la pronunciación
          </span>
        </div>
        <Toggle
          checked={Boolean(settings.syllableBreaks)}
          onChange={(next) => handlePatch({ syllableBreaks: next })}
          ariaLabel="Dividir palabras largas"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Agrupar frases por idea</span>
          <span className="theme-toggle-hint">
            Separa el texto en pausas naturales para facilitar la comprensión
          </span>
        </div>
        <Toggle
          checked={Boolean(settings.syntacticLines)}
          onChange={(next) => handlePatch({ syntacticLines: next })}
          ariaLabel="Agrupar frases por idea"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Traducción al inglés por párrafo</span>
          <span className="theme-toggle-hint">
            Muestra una traducción discreta debajo de cada párrafo en libros en inglés
          </span>
        </div>
        <Toggle
          checked={Boolean(
            settings.bilingueEnabled ??
              (settings.bilingualScaffoldingMode && settings.bilingualScaffoldingMode !== "off"),
          )}
          onChange={(next) => {
            onToggleBilingualScaffolding?.(next);
            handlePatch({
              bilingueEnabled: next,
              bilingualScaffoldingMode: next ? "auto" : "off",
            });
          }}
          ariaLabel="Traducción al inglés por párrafo"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Sugerir palabras del capítulo</span>
          <span className="theme-toggle-hint">
            Muestra un resumen de vocabulario clave al comenzar un nuevo capítulo
          </span>
        </div>
        <Toggle
          checked={settings.chapterPreview !== false && settings.chapterPreview !== "off"}
          onChange={(next) => handlePatch({ chapterPreview: next })}
          ariaLabel="Sugerir palabras del capítulo"
        />
      </div>

      <div className="theme-row theme-row-toggle">
        <div className="theme-toggle-text">
          <span className="theme-label">Modo sin mascota</span>
          <span className="theme-toggle-hint">
            Oculta las animaciones del búho para una lectura completamente sobria
          </span>
        </div>
        <Toggle
          checked={!settings.companionEnabled}
          onChange={(next) => handlePatch({ companionEnabled: !next })}
          ariaLabel="Modo sin mascota"
        />
      </div>
    </div>
  );
}

export default ThemeMenu;
