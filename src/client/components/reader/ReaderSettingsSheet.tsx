// Hoja «Opciones de lectura» del lector.
//
// Extraída de Reader.tsx (Fase 7) sin cambiar comportamiento: es presentacional y
// recibe el estado y los callbacks que antes vivían en el closure del lector.
import ReaderMoreMenu from "../ReaderMoreMenu";
import Sheet from "../Sheet";
import ThemeMenu from "../ThemeMenu";
import Toggle from "../Toggle";
import {
  PREPARATION_MODES,
  applyReadingPreset,
  detectActiveReadingPreset,
  type ReaderSettings,
  type ThemeChoice,
} from "../../lib/settings";
import type { CompanionContextValue } from "../CompanionProvider";
import type { ReaderSettingsTab } from "../Reader";

export interface ReaderSettingsSheetProps {
  settings: ReaderSettings;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  settingsTab: ReaderSettingsTab;
  setSettingsTab: (tab: ReaderSettingsTab) => void;
  closeSheet: () => void;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  language: string;
  bookHash: string;
  bookOverride: boolean;
  useGlobalSettings: () => void;
  companion: CompanionContextValue;
  presenceMode: string;
  catEnabled: boolean;
  catSuppressed: boolean;
  setCatSuppressed: (suppressed: boolean) => void;
  openPrepManual: () => void;
  openSheet: (sheet: "toc" | "search" | "settings") => void;
  handleCreateQuoteCard: () => void;
  handleExportBook: () => void;
  handleToggleFullscreen: () => void;
  isFullscreenActive: boolean;
  isFullscreenSupported: () => boolean;
  onOpenNotebook: () => void;
  setGlossaryOpen: (open: boolean) => void;
}

export default function ReaderSettingsSheet({
  settings,
  updateSettings,
  settingsTab,
  setSettingsTab,
  closeSheet,
  theme,
  onThemeChange,
  language,
  bookHash,
  bookOverride,
  useGlobalSettings,
  companion,
  presenceMode,
  catEnabled,
  catSuppressed,
  setCatSuppressed,
  openPrepManual,
  openSheet,
  handleCreateQuoteCard,
  handleExportBook,
  handleToggleFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  onOpenNotebook,
  setGlossaryOpen,
}: ReaderSettingsSheetProps) {
  return (
  <Sheet label="Opciones de lectura" onClose={closeSheet}>
    <div className="sheet-head">
      <strong className="sheet-title">Opciones de lectura</strong>
      <button
        type="button"
        className="btn--quiet"
        onClick={closeSheet}
        aria-label="Cerrar opciones"
        data-autofocus
      >
        Cerrar
      </button>
    </div>
    <div className="sheet-tabs" role="tablist" aria-label="Categorías de opciones">
      <button
        type="button"
        role="tab"
        aria-selected={settingsTab === "appearance" || settingsTab === "strategy"}
        className="sheet-tab"
        data-active={settingsTab === "appearance" || settingsTab === "strategy" || undefined}
        onClick={() => setSettingsTab("appearance")}
      >
        Apariencia y ayudas
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={settingsTab === "book"}
        className="sheet-tab"
        data-active={settingsTab === "book" || undefined}
        onClick={() => setSettingsTab("book")}
      >
        Herramientas del libro
      </button>
    </div>


    {/* Pestaña: Apariencia y ayudas (SSOT) */}
    {settingsTab === "appearance" || settingsTab === "strategy" ? (
      <div role="tabpanel" aria-label="Apariencia y ayudas" className="sheet-panel">
        <ThemeMenu
          value={theme}
          onChange={onThemeChange}
          settings={settings}
          onUpdateSettings={updateSettings}
          activePreset={detectActiveReadingPreset(settings)}
          onSelectPreset={(preset) => {
            const updated = applyReadingPreset(settings, preset);
            updateSettings(updated);
          }}
          onToggleFocusRuler={(checked) => {
            updateSettings({
              focusRuler: checked,
              readingPreset: "custom",
              strategyPreset: "custom",
            });
          }}
          onToggleParagraphFocus={(checked) => {
            updateSettings({
              paragraphFocus: checked,
              readingPreset: "custom",
              strategyPreset: "custom",
            });
          }}
        />

        <div className="setting-section">
          <span className="setting-section-label">Maquetación</span>
          <div className="setting-row">
            <span className="setting-label">Modo de lectura</span>
            <div className="segmented" role="group" aria-label="Modo de lectura">
              <button
                type="button"
                data-active={settings.layout === "scroll" || undefined}
                aria-pressed={settings.layout === "scroll"}
                onClick={() => updateSettings({ layout: "scroll" })}
              >
                Desplazamiento
              </button>
              <button
                type="button"
                data-active={settings.layout === "pages" || undefined}
                aria-pressed={settings.layout === "pages"}
                onClick={() => updateSettings({ layout: "pages" })}
              >
                Por páginas
              </button>
            </div>
          </div>
          {settings.layout === "pages" ? (
            <>
              <div className="setting-row">
                <span className="setting-label">Columnas</span>
                <div className="segmented" role="group" aria-label="Columnas por página">
                  {(
                    [
                      [1, "Una"],
                      [2, "Dos"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      data-active={settings.pageColumns === value || undefined}
                      aria-pressed={settings.pageColumns === value}
                      onClick={() => updateSettings({ pageColumns: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="meta">
                Las flechas ← → pasan página. Si algo se corta, apaga
                «Lectura por páginas» sin perder tu lugar.
              </p>
            </>
          ) : null}
          <div className="setting-row">
            <span className="setting-label">Justificar</span>
            <Toggle
              label="Justificar texto"
              checked={settings.justify}
              onChange={(on) => updateSettings({ justify: on })}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label">Separación silábica (guiones)</span>
            <Toggle
              label="Separación silábica"
              checked={settings.enableHyphenation}
              onChange={(on) => updateSettings({ enableHyphenation: on })}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label">Letra capital</span>
            <Toggle
              label="Letra capital al inicio del capítulo"
              checked={settings.dropCap}
              onChange={(on) => updateSettings({ dropCap: on })}
            />
          </div>
          {isFullscreenSupported() ? (
            <div className="setting-row">
              <span className="setting-label">Pantalla completa</span>
              <Toggle
                label="Modo pantalla completa"
                checked={isFullscreenActive}
                onChange={() => void handleToggleFullscreen()}
              />
            </div>
          ) : null}
          {bookOverride ? (
            <div className="setting-row">
              <span className="setting-label">Este libro tiene ajustes propios</span>
              <button
                type="button"
                className="btn--quiet"
                onClick={useGlobalSettings}
              >
                Usar mis ajustes generales
              </button>
            </div>
          ) : null}
        </div>
      </div>
    ) : null}

    {/* Pestaña 3: Libro */}
    {settingsTab === "book" ? (
      <div role="tabpanel" aria-label="Libro" className="sheet-panel">
        <ReaderMoreMenu
          isOpen={true}
          embedded={true}
          onSearch={() => {
            closeSheet();
            openSheet("search");
          }}
          onOpenGlossary={() => {
            closeSheet();
            setGlossaryOpen(true);
          }}
          onOpenNotebook={() => {
            closeSheet();
            onOpenNotebook();
          }}
          onCreateQuoteCard={handleCreateQuoteCard}
          onExportBook={handleExportBook}
          bookHash={bookHash}
          language={language}
          onToggleFullscreen={() => void handleToggleFullscreen()}
          isFullscreen={isFullscreenActive}
          fullscreenSupported={isFullscreenSupported()}
          settings={settings}
          onUpdateSettings={updateSettings}
          onClose={closeSheet}
        />

        <div className="setting-section">
          <span className="setting-section-label">Vocabulario de la Obra</span>
          <div className="setting-row setting-row--stack">
            <span className="setting-label">Antes de leer</span>
            <div className="theme-menu" role="group" aria-label="Preparación de vocabulario">
              {PREPARATION_MODES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className="theme-option"
                  data-active={settings.preparationMode === id || undefined}
                  aria-pressed={settings.preparationMode === id}
                  onClick={() => updateSettings({ preparationMode: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span className="setting-label">Palabras de este capítulo</span>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                closeSheet();
                openPrepManual();
              }}
            >
              Revisar ahora
            </button>
          </div>
        </div>

        {catEnabled ? (
          <div className="setting-section">
            <span className="setting-section-label">Compañero Lector</span>
            <div className="setting-row">
              <span className="setting-label">Tu compañero</span>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => {
                  closeSheet();
                  companion.openPanel();
                }}
              >
                Ver a {companion.name}
              </button>
            </div>
            {presenceMode !== "off" ? (
              <div className="setting-row">
                <span className="setting-label">
                  Ocultar al gato en esta lectura
                </span>
                <Toggle
                  label="Ocultar al gato en esta lectura"
                  checked={catSuppressed}
                  onChange={setCatSuppressed}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <details className="settings-advanced">
          <summary>Atajos de lectura</summary>
          <div className="settings-advanced-body shortcuts-list">
            <div className="shortcut-row">
              <span>Avanzar página</span>
              <div><kbd>Espacio</kbd> · <kbd>→</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Retroceder página</span>
              <div><kbd>Shift</kbd> + <kbd>Espacio</kbd> · <kbd>←</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Buscar en el libro</span>
              <div><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>F</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Índice de capítulos</span>
              <div><kbd>T</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Marcadores y notas</span>
              <div><kbd>M</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Definir palabra bajo el cursor</span>
              <div><kbd>D</kbd></div>
            </div>
            <div className="shortcut-row">
              <span>Mostrar controles</span>
              <div><kbd>Tab</kbd></div>
            </div>
          </div>
        </details>
      </div>
    ) : null}
  </Sheet>
  );
}
