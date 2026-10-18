import { useEffect, useRef } from "react";
import {
  applyReadingPreset,
  detectActiveReadingPreset,
  READING_PRESETS,
  setChapterPrimingMode,
  type ChapterPrimingMode,
  type ReaderSettings,
  type ReadingPreset,
  type StrategyContrast,
} from "../lib/settings";
import Icon from "./Icon";
import OfflineDictionaryControl from "./OfflineDictionaryControl";

export interface ReaderMoreMenuProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSearch: () => void;
  onOpenGlossary?: () => void;
  onCreateQuoteCard?: () => void;
  onExportBook?: () => void;
  bookHash?: string;
  language?: string;
  onToggleTts?: () => void;
  ttsActive?: boolean;
  ttsSupported?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
  onOpenRetreat?: () => void;
  embedded?: boolean;
  strategyContrast?: StrategyContrast;
  onStrategyContrastChange?: (contrast: StrategyContrast) => void;
  settings?: ReaderSettings;
  onUpdateSettings?: (settings: ReaderSettings) => void;
  onToggleFocusRuler?: (val: boolean) => void;
  onToggleParagraphFocus?: (val: boolean) => void;
  onToggleSyntacticLines?: (val: boolean) => void;
  onToggleColorGuide?: (val: boolean) => void;
  chapterPrimingMode?: ChapterPrimingMode;
  onChapterPrimingModeChange?: (mode: ChapterPrimingMode) => void;
}

export default function ReaderMoreMenu({
  isOpen = true,
  onClose,
  onSearch,
  onOpenGlossary,
  onCreateQuoteCard,
  onExportBook,
  bookHash,
  language = "es",
  onToggleTts,
  ttsActive = false,
  ttsSupported = true,
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = true,
  onOpenRetreat,
  embedded = false,
  strategyContrast = "high",
  onStrategyContrastChange,
  settings,
  onUpdateSettings,
  onToggleFocusRuler,
  onToggleParagraphFocus,
  onToggleSyntacticLines,
  onToggleColorGuide,
  chapterPrimingMode,
  onChapterPrimingModeChange,
}: ReaderMoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const currentPrimingMode =
    chapterPrimingMode ?? settings?.chapterPrimingMode ?? "auto";

  const handlePrimingModeChange = (mode: ChapterPrimingMode) => {
    onChapterPrimingModeChange?.(mode);
    if (settings && onUpdateSettings) {
      onUpdateSettings({ ...settings, chapterPrimingMode: mode });
    }
    setChapterPrimingMode(mode);
  };

  useEffect(() => {
    if (!isOpen || embedded) return;

    // Autofocus first button when opening as popover
    const firstButton = menuRef.current?.querySelector<HTMLButtonElement>("button");
    firstButton?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") {
          const next = index < buttons.length - 1 ? index + 1 : 0;
          buttons[next]?.focus();
        } else {
          const prev = index > 0 ? index - 1 : buttons.length - 1;
          buttons[prev]?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, embedded, onClose]);

  if (!isOpen) return null;

  const handleAction = (fn?: () => void) => {
    fn?.();
    if (!embedded) onClose?.();
  };

  const content = (
    <div
      ref={menuRef}
      className={embedded ? "reader-book-actions" : "reader-more-menu"}
      role="menu"
      aria-label="Opciones del libro"
    >
      {onOpenGlossary ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onOpenGlossary)}
        >
          <Icon name="notebook" size={18} />
          <span className="reader-more-label">Glosario del libro</span>
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="reader-more-item"
        onClick={() => handleAction(onSearch)}
      >
        <Icon name="search" size={18} />
        <span className="reader-more-label">Buscar en el libro</span>
        <kbd className="reader-more-shortcut">Ctrl+F</kbd>
      </button>

      {onCreateQuoteCard ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onCreateQuoteCard)}
        >
          <Icon name="quote" size={18} />
          <span className="reader-more-label">Crear tarjeta de cita</span>
        </button>
      ) : null}

      {onExportBook ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onExportBook)}
        >
          <Icon name="download" size={18} />
          <span className="reader-more-label">Exportar notas y vocabulario</span>
        </button>
      ) : null}

      {ttsSupported && onToggleTts ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onToggleTts)}
          aria-pressed={ttsActive}
        >
          <Icon name={ttsActive ? "stop" : "headphones"} size={18} />
          <span className="reader-more-label">
            {ttsActive ? "Detener voz" : "Leer en voz alta"}
          </span>
        </button>
      ) : null}

      {fullscreenSupported && onToggleFullscreen ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => {
            // Invocación sincrónica antes de cerrar para cumplir política de gestos
            onToggleFullscreen();
            if (!embedded) onClose?.();
          }}
          aria-pressed={isFullscreen}
        >
          <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={18} />
          <span className="reader-more-label">
            {isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          </span>
          <kbd className="reader-more-shortcut">F</kbd>
        </button>
      ) : null}

      {onOpenRetreat ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onOpenRetreat)}
        >
          <Icon name="retreat" size={18} />
          <span className="reader-more-label">Retiro de lectura</span>
        </button>
      ) : null}

      <div className="reader-more-strategy-section">
        <span className="reader-more-strategy-label">Contraste de ayudas:</span>
        <div
          className="segmented segmented--contrast"
          role="group"
          aria-label="Contraste de ayudas"
        >
          <button
            type="button"
            className="segmented-btn"
            data-active={strategyContrast === "soft" || undefined}
            aria-pressed={strategyContrast === "soft"}
            onClick={() => onStrategyContrastChange?.("soft")}
          >
            Suave
          </button>
          <button
            type="button"
            className="segmented-btn"
            data-active={strategyContrast === "balanced" || undefined}
            aria-pressed={strategyContrast === "balanced"}
            onClick={() => onStrategyContrastChange?.("balanced")}
          >
            Nítido
          </button>
          <button
            type="button"
            className="segmented-btn"
            data-active={strategyContrast === "high" || undefined}
            aria-pressed={strategyContrast === "high"}
            onClick={() => onStrategyContrastChange?.("high")}
          >
            Intenso (AAA)
          </button>
        </div>
      </div>

      <div className="reader-more-strategy-section">
        <span className="reader-more-strategy-label">Preparación de capítulo:</span>
        <div
          className="segmented segmented--priming"
          role="group"
          aria-label="Preparación de capítulo"
        >
          <button
            type="button"
            className="segmented-btn"
            data-active={currentPrimingMode === "auto" || undefined}
            aria-pressed={currentPrimingMode === "auto"}
            onClick={() => handlePrimingModeChange("auto")}
          >
            Auto
          </button>
          <button
            type="button"
            className="segmented-btn"
            data-active={currentPrimingMode === "on-demand" || undefined}
            aria-pressed={currentPrimingMode === "on-demand"}
            onClick={() => handlePrimingModeChange("on-demand")}
          >
            Bajo demanda
          </button>
          <button
            type="button"
            className="segmented-btn"
            data-active={currentPrimingMode === "off" || undefined}
            aria-pressed={currentPrimingMode === "off"}
            onClick={() => handlePrimingModeChange("off")}
          >
            Desactivado
          </button>
        </div>
      </div>

      {settings && onUpdateSettings ? (
        <div className="reader-more-presets-section">
          <div className="reader-more-presets-header">
            <span className="reader-more-presets-title">Modos de lectura</span>
          </div>
          <div className="reader-mode-cards" role="group" aria-label="Modos de lectura">
            {READING_PRESETS.map((preset) => {
              const active =
                settings.readingPreset === preset.id ||
                detectActiveReadingPreset(settings) === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`reader-mode-card ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    const updated = applyReadingPreset(
                      settings,
                      preset.id as Exclude<ReadingPreset, "custom">,
                    );
                    onUpdateSettings(updated);
                  }}
                >
                  <span className="reader-mode-card-icon" aria-hidden="true">{preset.icon}</span>
                  <strong className="reader-mode-card-title">{preset.label}</strong>
                </button>
              );
            })}
          </div>

          <details className="strategy-accordion reader-more-customize">
            <summary>
              <span>Personalizar</span>
            </summary>
            <div className="strategy-accordion-body">
              <label className="setting-row">
                <span className="setting-label">Regla de lectura</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="focusRuler"
                  checked={Boolean(settings.focusRuler)}
                  onChange={(e) => {
                    onToggleFocusRuler?.(e.target.checked);
                    onUpdateSettings({
                      ...settings,
                      focusRuler: e.target.checked,
                      readingPreset: "custom",
                      strategyPreset: "custom",
                    });
                  }}
                />
              </label>
              <label className="setting-row">
                <span className="setting-label">Foco de párrafo</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="paragraphFocus"
                  checked={Boolean(settings.paragraphFocus)}
                  onChange={(e) => {
                    onToggleParagraphFocus?.(e.target.checked);
                    onUpdateSettings({
                      ...settings,
                      paragraphFocus: e.target.checked,
                      readingPreset: "custom",
                      strategyPreset: "custom",
                    });
                  }}
                />
              </label>
              <label className="setting-row">
                <span className="setting-label">Líneas sintácticas</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="syntacticLines"
                  checked={Boolean(settings.syntacticLines)}
                  onChange={(e) => {
                    onToggleSyntacticLines?.(e.target.checked);
                    onUpdateSettings({
                      ...settings,
                      syntacticLines: e.target.checked,
                      readingPreset: "custom",
                      strategyPreset: "custom",
                    });
                  }}
                />
              </label>
              <label className="setting-row">
                <span className="setting-label">Guía de color</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="colorGuide"
                  checked={Boolean(settings.colorGuide || settings.chromaticGuide)}
                  onChange={(e) => {
                    onToggleColorGuide?.(e.target.checked);
                    onUpdateSettings({
                      ...settings,
                      chromaticGuide: e.target.checked,
                      colorGuide: e.target.checked,
                      readingPreset: "custom",
                      strategyPreset: "custom",
                    });
                  }}
                />
              </label>
            </div>
          </details>
        </div>
      ) : null}

      {bookHash ? (
        <div className="reader-more-offline-section">
          <div className="reader-more-offline-header">
            <Icon name="cloud" size={16} />
            <span className="reader-more-offline-title">Diccionario sin conexión</span>
          </div>
          <OfflineDictionaryControl bookHash={bookHash} language={language} />
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <>
      <div
        className="reader-more-scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      {content}
    </>
  );
}
