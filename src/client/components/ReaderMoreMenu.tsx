import { useEffect, useRef, useState } from "react";
import {
  isPrimingMutedForBook,
  unmuteBookForPriming,
  loadNativeLanguage,
  saveUnifiedSmartAssists,
  loadInterfaceMode,
  saveInterfaceMode,
  type InterfaceMode,
  type ChapterPrimingMode,
  type ReaderSettings,
  type StrategyContrast,
} from "../lib/settings";
import { saveSmartAssistsPrefsIdb } from "../lib/idb";
import {
  loadFocusTelemetryProfile,
  saveFocusTelemetryProfile,
  unmuteBookFocusSuggestions,
  setFocusAutoSuggestEnabled,
  type UserFocusTelemetryProfile,
} from "../lib/focus-telemetry";
import {
  loadBilingualScaffoldingProfile,
  unmuteBilingualForBook,
  setBilingualMode,
  type BilingualScaffoldingProfile,
} from "../lib/phrases";
import {
  loadPostChapterConsolidationPrefs,
  unmuteConsolidationForBook,
  enableConsolidationGlobally,
  type PostChapterConsolidationPrefs,
} from "../lib/practice";
import {
  loadCharacterMemoryEnabled,
  saveCharacterMemoryEnabled,
} from "../lib/page-recap";
import Icon from "./Icon";
import OfflineDictionaryControl from "./OfflineDictionaryControl";

export interface ReaderMoreMenuProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSearch: () => void;
  onOpenGlossary?: () => void;
  onOpenNotebook?: () => void;
  onCreateQuoteCard?: () => void;
  onExportBook?: () => void;
  bookHash?: string;
  language?: string;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
  embedded?: boolean;
  // Props opcionales/en desuso conservadas para compatibilidad de tipos
  onToggleTts?: () => void;
  ttsActive?: boolean;
  ttsSupported?: boolean;
  onOpenRetreat?: () => void;
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
  onOpenNotebook,
  onCreateQuoteCard,
  onExportBook,
  bookHash,
  language = "es",
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = true,
  embedded = false,
  chapterPrimingMode,
  settings,
  onUpdateSettings,
}: ReaderMoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(() =>
    settings?.interfaceMode ?? loadInterfaceMode(),
  );

  const handleSetInterfaceMode = (mode: InterfaceMode) => {
    saveInterfaceMode(mode);
    setInterfaceMode(mode);
    if (settings && onUpdateSettings) {
      onUpdateSettings({ ...settings, interfaceMode: mode });
    }
  };

  // Estados reactivos de asistencias para ver y reactivar si fueron silenciadas
  const [isPrimingMutedThisBook, setIsPrimingMutedThisBook] = useState(() =>
    bookHash ? isPrimingMutedForBook(bookHash) : false,
  );
  const [focusProfile, setFocusProfile] = useState<UserFocusTelemetryProfile>(() =>
    loadFocusTelemetryProfile(),
  );
  const [bilingualProfile, setBilingualProfile] = useState<BilingualScaffoldingProfile>(() =>
    loadBilingualScaffoldingProfile(),
  );
  const [consolidationPrefs, setConsolidationPrefs] = useState<PostChapterConsolidationPrefs>(() =>
    loadPostChapterConsolidationPrefs(),
  );
  const [characterMemoryEnabled, setCharacterMemoryEnabled] = useState(() =>
    loadCharacterMemoryEnabled(),
  );

  const isForeignLang = language !== loadNativeLanguage();
  const isFocusMutedThisBook = Boolean(
    bookHash && focusProfile.mutedBookIds.includes(bookHash),
  );
  const isBilingualMutedThisBook = Boolean(
    bookHash && bilingualProfile.mutedBookIds.includes(bookHash),
  );
  const isConsolidationMutedThisBook = Boolean(
    bookHash && consolidationPrefs.mutedBookIds.includes(bookHash),
  );

  const handleReactivatePrimingForBook = () => {
    if (bookHash) {
      unmuteBookForPriming(bookHash);
      setIsPrimingMutedThisBook(false);
      saveUnifiedSmartAssists({ mutedPrimingBookIds: [] }, bookHash);
      void saveSmartAssistsPrefsIdb({ mutedPrimingBookIds: [] });
    }
  };

  const handleReactivateFocusForBook = () => {
    if (bookHash) {
      const updated = unmuteBookFocusSuggestions(focusProfile, bookHash);
      saveFocusTelemetryProfile(updated);
      setFocusProfile(updated);
      saveUnifiedSmartAssists({ mutedFocusBookIds: updated.mutedBookIds }, bookHash);
      void saveSmartAssistsPrefsIdb({ mutedFocusBookIds: updated.mutedBookIds });
    }
  };

  const handleReactivateFocusGlobally = () => {
    const updated = setFocusAutoSuggestEnabled(focusProfile, true);
    saveFocusTelemetryProfile(updated);
    setFocusProfile(updated);
    saveUnifiedSmartAssists({ focusAutoSuggestEnabled: true }, bookHash);
    void saveSmartAssistsPrefsIdb({ focusAutoSuggestEnabled: true });
  };

  const handleReactivateBilingualForBook = () => {
    if (bookHash) {
      unmuteBilingualForBook(bookHash);
      const next = loadBilingualScaffoldingProfile();
      setBilingualProfile(next);
      saveUnifiedSmartAssists({ mutedBilingualBookIds: next.mutedBookIds }, bookHash);
      void saveSmartAssistsPrefsIdb({ mutedBilingualBookIds: next.mutedBookIds });
    }
  };

  const handleReactivateBilingualGlobally = () => {
    setBilingualMode("auto");
    setBilingualProfile(loadBilingualScaffoldingProfile());
    saveUnifiedSmartAssists({ bilingualScaffoldingMode: "auto" }, bookHash);
    void saveSmartAssistsPrefsIdb({ bilingualScaffoldingMode: "auto" });
  };

  const handleReactivateConsolidationForBook = () => {
    if (bookHash) {
      unmuteConsolidationForBook(bookHash);
      const next = loadPostChapterConsolidationPrefs();
      setConsolidationPrefs(next);
      saveUnifiedSmartAssists({ mutedConsolidationBookIds: next.mutedBookIds }, bookHash);
      void saveSmartAssistsPrefsIdb({ mutedConsolidationBookIds: next.mutedBookIds });
    }
  };

  const handleReactivateConsolidationGlobally = () => {
    enableConsolidationGlobally();
    setConsolidationPrefs(loadPostChapterConsolidationPrefs());
    saveUnifiedSmartAssists({ postChapterConsolidationEnabled: true }, bookHash);
    void saveSmartAssistsPrefsIdb({ postChapterConsolidationEnabled: true });
  };

  const handleReactivateCharacterMemory = () => {
    saveCharacterMemoryEnabled(true);
    setCharacterMemoryEnabled(true);
    saveUnifiedSmartAssists({ characterMemoryEnabled: true }, bookHash);
    void saveSmartAssistsPrefsIdb({ characterMemoryEnabled: true });
  };

  const currentPrimingMode =
    chapterPrimingMode ?? settings?.chapterPrimingMode ?? "auto";

  useEffect(() => {
    if (!isOpen || embedded) return;

    // Autofocus primer botón al abrir como popover
    const firstButton =
      menuRef.current?.querySelector<HTMLButtonElement>(".reader-more-item") ??
      menuRef.current?.querySelector<HTMLButtonElement>("button");
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
      aria-label="Herramientas del libro"
    >
      {/* 0. Selector de Modo de Interfaz (Simple / Avanzado) */}
      <div
        className="reader-interface-mode-box"
        style={{
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid rgba(127,127,127,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
          <span className="meta" style={{ fontWeight: 600, fontSize: "0.8rem" }}>Modo de lectura</span>
          <span className="meta" style={{ fontSize: "0.72rem" }}>
            {interfaceMode === "advanced" ? "Avanzado" : "Simple"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button
            type="button"
            className={`btn btn--sm ${interfaceMode === "simple" ? "btn--primary" : "btn--quiet"}`}
            style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.78rem" }}
            onClick={() => handleSetInterfaceMode("simple")}
          >
            Modo Simple
          </button>
          <button
            type="button"
            className={`btn btn--sm ${interfaceMode === "advanced" ? "btn--primary" : "btn--quiet"}`}
            style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.78rem" }}
            onClick={() => handleSetInterfaceMode("advanced")}
          >
            Modo Avanzado
          </button>
        </div>
      </div>

      {/* 1. Buscar en el libro */}
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

      {/* 2. Personajes y glosario */}
      {onOpenGlossary ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onOpenGlossary)}
        >
          <Icon name="notebook" size={18} />
          <span className="reader-more-label">Personajes y glosario</span>
        </button>
      ) : null}

      {/* 3. Cuaderno de notas y citas */}
      {onOpenNotebook ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => handleAction(onOpenNotebook)}
        >
          <Icon name="notebook" size={18} />
          <span className="reader-more-label">Cuaderno de notas</span>
        </button>
      ) : null}

      {interfaceMode === "advanced" && onCreateQuoteCard ? (
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

      {interfaceMode === "advanced" && onExportBook ? (
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

      {/* 4. Pantalla completa */}
      {fullscreenSupported && onToggleFullscreen ? (
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={() => {
            // Invocación sincrónica antes de cerrar para cumplir política de gestos del navegador
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

      {/* Sección de Asistencias Inteligentes y Reactivación para este libro (Track 12) */}
      {interfaceMode === "advanced" && bookHash ? (
        <div className="reader-more-assists-section">
          <div className="reader-more-assists-header">
            <Icon name="sparkles" size={16} />
            <span className="reader-more-assists-title">Asistencias inteligentes</span>
          </div>
          <div className="reader-more-assists-list">
            {/* 1. Vocabulario de inicio de capítulo */}
            <div className="reader-more-assist-row">
              <div className="reader-more-assist-info">
                <span className="reader-more-assist-name">Vocabulario de capítulo</span>
                <span className="reader-more-assist-desc">
                  {isPrimingMutedThisBook
                    ? "Silenciado en este libro"
                    : currentPrimingMode === "off"
                      ? "Desactivado globalmente"
                      : "Activo"}
                </span>
              </div>
              {isPrimingMutedThisBook ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivatePrimingForBook}
                >
                  Reactivar
                </button>
              ) : null}
            </div>

            {/* 2. Neuro-foco adaptativo */}
            <div className="reader-more-assist-row">
              <div className="reader-more-assist-info">
                <span className="reader-more-assist-name">Sugerencias de concentración</span>
                <span className="reader-more-assist-desc">
                  {isFocusMutedThisBook
                    ? "Silenciadas en este libro"
                    : !focusProfile.autoSuggestEnabled
                      ? "Desactivadas siempre"
                      : "Activas"}
                </span>
              </div>
              {isFocusMutedThisBook ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivateFocusForBook}
                >
                  Reactivar
                </button>
              ) : !focusProfile.autoSuggestEnabled ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivateFocusGlobally}
                >
                  Activar
                </button>
              ) : null}
            </div>

            {/* 3. Andamiaje bilingüe */}
            {(isForeignLang || isBilingualMutedThisBook) ? (
              <div className="reader-more-assist-row">
                <div className="reader-more-assist-info">
                  <span className="reader-more-assist-name">Andamiaje bilingüe</span>
                  <span className="reader-more-assist-desc">
                    {isBilingualMutedThisBook
                      ? "Silenciado en este libro"
                      : bilingualProfile.mode === "off"
                        ? "Desactivado siempre"
                        : "Activo"}
                  </span>
                </div>
                {isBilingualMutedThisBook ? (
                  <button
                    type="button"
                    className="btn--quiet reader-more-reactivate-btn"
                    onClick={handleReactivateBilingualForBook}
                  >
                    Reactivar
                  </button>
                ) : bilingualProfile.mode === "off" ? (
                  <button
                    type="button"
                    className="btn--quiet reader-more-reactivate-btn"
                    onClick={handleReactivateBilingualGlobally}
                  >
                    Activar
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* 4. Consolidación post-capítulo */}
            <div className="reader-more-assist-row">
              <div className="reader-more-assist-info">
                <span className="reader-more-assist-name">Consolidación post-capítulo</span>
                <span className="reader-more-assist-desc">
                  {isConsolidationMutedThisBook
                    ? "Silenciada en este libro"
                    : !consolidationPrefs.enabled
                      ? "Desactivada siempre"
                      : "Activa (25s)"}
                </span>
              </div>
              {isConsolidationMutedThisBook ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivateConsolidationForBook}
                >
                  Reactivar
                </button>
              ) : !consolidationPrefs.enabled ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivateConsolidationGlobally}
                >
                  Activar
                </button>
              ) : null}
            </div>

            {/* 5. Memoria de personajes */}
            <div className="reader-more-assist-row">
              <div className="reader-more-assist-info">
                <span className="reader-more-assist-name">Memoria de personajes</span>
                <span className="reader-more-assist-desc">
                  {characterMemoryEnabled ? "Activa (Cero Spoilers)" : "Desactivada"}
                </span>
              </div>
              {!characterMemoryEnabled ? (
                <button
                  type="button"
                  className="btn--quiet reader-more-reactivate-btn"
                  onClick={handleReactivateCharacterMemory}
                >
                  Activar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {interfaceMode === "advanced" && bookHash ? (
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
