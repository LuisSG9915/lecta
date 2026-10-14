import { useEffect, useRef } from "react";
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
}: ReaderMoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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
