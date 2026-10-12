import { useEffect, useRef } from "react";
import Icon from "./Icon";

export interface ReaderMoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: () => void;
  onToggleTts?: () => void;
  ttsActive?: boolean;
  ttsSupported?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
  onOpenRetreat: () => void;
}

export default function ReaderMoreMenu({
  isOpen,
  onClose,
  onSearch,
  onToggleTts,
  ttsActive = false,
  ttsSupported = true,
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = true,
  onOpenRetreat,
}: ReaderMoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Autofocus first button when opening
    const firstButton = menuRef.current?.querySelector<HTMLButtonElement>("button");
    firstButton?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSearch = () => {
    onSearch();
    onClose();
  };

  const handleTts = () => {
    onToggleTts?.();
    onClose();
  };

  const handleFullscreen = () => {
    // onToggleFullscreen se invoca sincrónicamente en el click
    // antes de cerrar el menú para respetar la política de gestos del navegador.
    onToggleFullscreen?.();
    onClose();
  };

  const handleRetreat = () => {
    onOpenRetreat();
    onClose();
  };

  return (
    <>
      <div
        className="reader-more-scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        className="reader-more-menu"
        role="menu"
        aria-label="Más opciones"
      >
        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={handleSearch}
        >
          <Icon name="search" size={18} />
          <span className="reader-more-label">Buscar en el libro</span>
          <kbd className="reader-more-shortcut">Ctrl+F</kbd>
        </button>

        {ttsSupported ? (
          <button
            type="button"
            role="menuitem"
            className="reader-more-item"
            onClick={handleTts}
            aria-pressed={ttsActive}
          >
            <Icon name={ttsActive ? "stop" : "headphones"} size={18} />
            <span className="reader-more-label">
              {ttsActive ? "Detener voz" : "Leer en voz alta"}
            </span>
          </button>
        ) : null}

        {fullscreenSupported ? (
          <button
            type="button"
            role="menuitem"
            className="reader-more-item"
            onClick={handleFullscreen}
            aria-pressed={isFullscreen}
          >
            <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={18} />
            <span className="reader-more-label">
              {isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            </span>
            <kbd className="reader-more-shortcut">F</kbd>
          </button>
        ) : null}

        <button
          type="button"
          role="menuitem"
          className="reader-more-item"
          onClick={handleRetreat}
        >
          <Icon name="retreat" size={18} />
          <span className="reader-more-label">Retiro de lectura</span>
        </button>
      </div>
    </>
  );
}
