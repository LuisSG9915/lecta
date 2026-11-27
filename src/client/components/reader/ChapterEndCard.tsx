interface ChapterEndCardProps {
  label: string;
  summaryParts: string;
  /** Palabras en la cola congelada del capítulo; 0 oculta el chip. */
  wordCount: number;
  onFixWords: () => void;
  onOpenNotebook: () => void;
}

/** Tarjeta de cierre natural de capítulo: resumen + chip «Fijar N palabras». */
export function ChapterEndCard({
  label,
  summaryParts,
  wordCount,
  onFixWords,
  onOpenNotebook,
}: ChapterEndCardProps) {
  return (
    <div className="chapter-summary" role="status">
      <p className="chapter-summary-text">
        Cerraste «{label}»{summaryParts ? ` — ${summaryParts}` : ""}
      </p>
      {wordCount > 0 ? (
        <button type="button" className="btn--quiet" onClick={onFixWords}>
          Fijar {wordCount} {wordCount === 1 ? "palabra" : "palabras"} (≈25 s)
        </button>
      ) : null}
      <button type="button" className="btn--quiet" onClick={onOpenNotebook}>
        Ver Herbario
      </button>
    </div>
  );
}
