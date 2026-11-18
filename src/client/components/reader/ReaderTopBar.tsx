import { memo } from "react";
import Icon from "../Icon";
import { ProgressInk } from "../ProgressInk";

export interface ReaderTopBarProps {
  onBack: () => void;
  title: string;
  author?: string;
  progress: number;
  isZenFaded?: boolean;
  barsShown?: boolean;
  onOpenToc: () => void;
  hasRibbonHere?: boolean;
  onToggleRibbon?: () => void;
  onOpenAppearance: () => void;
  onOpenMore: () => void;
}

function ReaderTopBarImpl({
  onBack,
  title,
  author,
  progress,
  isZenFaded = false,
  barsShown = true,
  onOpenToc,
  hasRibbonHere = false,
  onToggleRibbon,
  onOpenAppearance,
  onOpenMore,
}: ReaderTopBarProps) {
  const percent = Math.round(progress * 100);

  return (
    <header
      className={`reader-bar ${isZenFaded ? "reader-head--faded" : ""}`.trim()}
      data-zen-faded={isZenFaded || undefined}
      data-hidden={!barsShown || undefined}
    >
      <button
        type="button"
        className="btn--quiet reader-back"
        onClick={onBack}
        aria-label="Volver a la estantería"
      >
        <Icon name="back" size={18} />
        <span className="reader-back-label"> Estantería</span>
      </button>
      <p className="reader-bar-title" title={title}>
        {title}
        {author ? <span className="reader-bar-author"> · {author}</span> : null}
      </p>
      <div className="reader-bar-actions">
        {onToggleRibbon ? (
          <button
            type="button"
            className="btn--quiet reader-bar-btn reader-bar-btn--ribbon"
            onClick={onToggleRibbon}
            aria-pressed={hasRibbonHere}
            data-active={hasRibbonHere || undefined}
            aria-label={hasRibbonHere ? "Quitar cinta" : "Guardar cinta aquí"}
            title={hasRibbonHere ? "Quitar cinta" : "Guardar cinta aquí"}
          >
            <Icon name="bookmark" size={20} />
            <span className="reader-btn-text">Cinta</span>
          </button>
        ) : null}
        <button
          type="button"
          className="btn--quiet reader-bar-btn"
          onClick={onOpenToc}
          aria-label="Índice del libro"
          title="Índice (T)"
        >
          <Icon name="index" size={20} />
          <span className="reader-btn-text">Índice</span>
        </button>
        <button
          type="button"
          className="btn--quiet reader-bar-btn reader-bar-btn--settings"
          onClick={onOpenAppearance}
          aria-label="Apariencia y ayudas"
          title="Apariencia y ayudas (Aa)"
        >
          <span className="reader-btn-icon reader-btn-icon--aa" aria-hidden="true">
            Aa
          </span>
          <span className="reader-btn-text">Apariencia</span>
        </button>
        <button
          type="button"
          className="btn--quiet reader-bar-btn reader-bar-btn--more"
          onClick={onOpenMore}
          aria-label="Herramientas del libro"
          title="Herramientas del libro"
        >
          <Icon name="more" size={20} />
          <span className="reader-btn-text">Más</span>
        </button>
      </div>
      <div className="reader-bar-progress" aria-hidden="true">
        <ProgressInk
          value={percent}
          max={100}
          variant="vermilion"
          ariaValueText={`${percent}% del libro`}
        />
      </div>
    </header>
  );
}


export const ReaderTopBar = memo(ReaderTopBarImpl);
