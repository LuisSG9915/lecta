// Avisos «Volver…» sobre el dock: regreso tras saltar de punto y retorno desde
// una nota al pie. Extraído de Reader.tsx (R1/F6).
export interface ReaderReturnBarsProps {
  hasReturnPoint: boolean;
  onGoBack: () => void;
  onDismissReturnPoint: () => void;
  hasFootnoteReturn: boolean;
  onReturnFromFootnote: () => void;
  onDismissFootnoteReturn: () => void;
}

export function ReaderReturnBars({
  hasReturnPoint,
  onGoBack,
  onDismissReturnPoint,
  hasFootnoteReturn,
  onReturnFromFootnote,
  onDismissFootnoteReturn,
}: ReaderReturnBarsProps) {
  return (
    <>
      {hasReturnPoint ? (
        <div className="reader-return">
          <button type="button" className="reader-return-btn" onClick={onGoBack}>
            ‹ Volver a donde estaba
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={onDismissReturnPoint}
            aria-label="Descartar regreso"
          >
            ×
          </button>
        </div>
      ) : null}

      {hasFootnoteReturn ? (
        <div className="reader-return">
          <button type="button" className="reader-return-btn" onClick={onReturnFromFootnote}>
            ← Volver a la lectura
          </button>
          <button
            type="button"
            className="reader-return-dismiss"
            onClick={onDismissFootnoteReturn}
            aria-label="Descartar retorno"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
