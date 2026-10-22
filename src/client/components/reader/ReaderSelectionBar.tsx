// Barra de acciones de selección del lector: volver a donde estaba, menú de
// pasaje (tinta, cita, preguntar) y aviso de pulsación larga.
//
// Extraída de Reader.tsx (Fase 7). Solo pinta; la posición y el estado del menú
// los calcula el lector.
import Icon from "../Icon";
import type { WordHit } from "../../lib/words";

export type ReaderReturnPoint = {
  sectionIndex: number;
  ratio: number;
  anchor?: string;
};

export type ReaderSelectionButton = {
  x: number;
  y: number;
  placement: "top" | "bottom";
  singleWordHit: WordHit | null;
};

export interface ReaderSelectionBarProps {
  returnPoint: ReaderReturnPoint | null;
  setReturnPoint: (value: ReaderReturnPoint | null) => void;
  goBack: () => void;
  selButton: ReaderSelectionButton | null;
  setSelButton: (value: ReaderSelectionButton | null) => void;
  openSelection: (hit: WordHit) => void;
  savePassageSelection: (tone: "amber" | "salvia" | "dario") => void | Promise<unknown>;
  openQuoteCardFromSelection: () => void;
  askCatAboutSelection: () => void | Promise<unknown>;
  setDeepModal: (value: boolean) => void;
  showLongPressHint: boolean;
}

export function ReaderSelectionBar(props: ReaderSelectionBarProps) {
  const {
  returnPoint,
  setReturnPoint,
  goBack,
  selButton,
  setSelButton,
  openSelection,
  savePassageSelection,
  openQuoteCardFromSelection,
  askCatAboutSelection,
  setDeepModal,
  showLongPressHint,
  } = props;

  return (
    <>
  {returnPoint ? (
    <div className="reader-return">
      <button
        type="button"
        className="reader-return-btn"
        onClick={goBack}
      >
        ‹ Volver a donde estaba
      </button>
      <button
        type="button"
        className="reader-return-dismiss"
        onClick={() => setReturnPoint(null)}
        aria-label="Descartar regreso"
      >
        ×
      </button>
    </div>
  ) : null}

  {selButton ? (
    <div
      className="selection-menu reader__passage-bar"
      data-placement={selButton.placement}
      style={{ left: selButton.x, top: selButton.y }}
    >
      {selButton.singleWordHit ? (
        <button
          type="button"
          className="selection-menu-btn selection-define"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const hit = selButton.singleWordHit;
            window.getSelection()?.removeAllRanges();
            setSelButton(null);
            if (hit) openSelection(hit);
          }}
        >
          Definir
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
  ) : null}

  {showLongPressHint ? (
    <div className="reader-hint-toast" role="status" aria-live="polite">
      Mantén presionada una palabra para ver qué significa.
    </div>
  ) : null}
    </>
  );
}
