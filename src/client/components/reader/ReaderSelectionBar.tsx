// Menú de acciones de selección del lector: tinta, reflexión, postal y
// preguntar al compañero. En táctil la presión larga selecciona la
// palabra y abre este menú (con «Significado» primero) en vez de la
// ficha: así los tiradores quedan libres para ampliar la cita. Con ratón
// el clic sobre una palabra sigue abriendo la ficha directa.
import { useEffect, memo } from "react";
import Icon from "../Icon";
import type { WordHit } from "../../lib/words";

export type ReaderSelectionButton = {
  x: number;
  y: number;
  placement: "top" | "bottom";
  /** Selección de una sola palabra: el menú ofrece «Significado». */
  word?: WordHit;
};

export interface ReaderSelectionBarProps {
  selButton: ReaderSelectionButton | null;
  setSelButton: (value: ReaderSelectionButton | null) => void;
  savePassageSelection: (tone: "amber" | "salvia" | "dario") => void | Promise<unknown>;
  openQuoteCardFromSelection: () => void;
  askCatAboutSelection: (param?: string | { word?: string; passage: string; bookId?: string }) => void | Promise<unknown>;
  setDeepModal: (value: boolean) => void;
  /** Abre la ficha de la palabra seleccionada. */
  onDefine?: (hit: WordHit) => void;
}

export const ReaderSelectionBar = memo(function ReaderSelectionBar(props: ReaderSelectionBarProps) {
  const {
    selButton,
    setSelButton,
    savePassageSelection,
    openQuoteCardFromSelection,
    askCatAboutSelection,
    setDeepModal,
    onDefine,
  } = props;

  // Auto-dismiss sin fricción: si el usuario hace scroll o toca fuera de la barra
  useEffect(() => {
    if (!selButton) return;
    const hide = () => setSelButton(null);
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".selection-menu")) return;
      hide();
    };

    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, [selButton, setSelButton]);

  if (!selButton) return null;

  return (
    <div
      className="selection-menu reader__passage-bar"
      data-placement={selButton.placement}
      style={{ left: selButton.x, top: selButton.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* 0. Significado: solo cuando la selección es una palabra */}
      {selButton.word && onDefine ? (
        <button
          type="button"
          className="selection-menu-btn selection-define"
          title="Ver qué significa"
          aria-label="Ver qué significa"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const hit = selButton.word!;
            window.getSelection()?.removeAllRanges();
            setSelButton(null);
            onDefine(hit);
          }}
        >
          <Icon name="book" size={14} />
          <span>Significado</span>
        </button>
      ) : null}

      {/* 1. Resaltar con tinta (3 tonos: Ámbar, Salvia, Azul Darío) */}
      <div className="selection-highlight-group" role="group" aria-label="Resaltar con tinta">
        <button
          type="button"
          className="selection-menu-btn selection-save"
          title="Resaltar con tinta ámbar"
          aria-label="Resaltar con tinta"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void savePassageSelection("amber")}
        >
          <Icon name="highlight" size={14} />
          <span>Tinta</span>
        </button>
        <div className="selection-tones-picker" aria-label="Elegir tono de tinta">
          <button
            type="button"
            className="tone-dot tone-dot--amber reader__passage-color reader__passage-color--amber"
            title="Tinta Ámbar"
            aria-label="Tinta Ámbar"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("amber")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--salvia reader__passage-color reader__passage-color--sage"
            title="Tinta Salvia"
            aria-label="Tinta Salvia"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("salvia")}
          />
          <button
            type="button"
            className="tone-dot tone-dot--dario reader__passage-color reader__passage-color--dario-blue"
            title="Tinta Azul Darío"
            aria-label="Tinta Azul Darío"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void savePassageSelection("dario")}
          />
        </div>
      </div>

      {/* 2. Reflexión Profunda */}
      <button
        type="button"
        className="selection-menu-btn selection-deep"
        title="Reflexión Profunda"
        aria-label="Reflexión Profunda"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          window.getSelection()?.removeAllRanges();
          setSelButton(null);
          setDeepModal(true);
        }}
      >
        <Icon name="retreat" size={14} />
        <span>Reflexión</span>
      </button>

      {/* 3. Crear Postal de Cita */}
      <button
        type="button"
        className="selection-menu-btn selection-card"
        title="Crear postal de cita"
        aria-label="Crear postal de cita"
        onPointerDown={(event) => event.preventDefault()}
        onClick={openQuoteCardFromSelection}
      >
        <Icon name="quote" size={14} />
        <span>Postal</span>
      </button>

      {/* 4. Preguntar al Gato */}
      <button
        type="button"
        className="selection-menu-btn selection-ask-cat"
        title="Preguntar al Gato"
        aria-label="Preguntar al Gato"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void askCatAboutSelection()}
      >
        <Icon name="sparkles" size={14} />
        <span>Preguntar</span>
      </button>
    </div>
  );
});