// Pestaña «Citas y Hallazgos» (Fase 5, V2): pasajes guardados con tarjeta de
// cita, copiar, exportar y eliminar.


import { triggerHaptic } from "../../lib/haptics";

import type { SavedAnnotation } from "../../lib/idb";

export type QuoteCardRequest = {
  text: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  highlightWord?: string;
  gloss?: string;
};

type QuotesPanelProps = {
  /** null mientras carga. */
  quotes: SavedAnnotation[] | null;
  bookTitle: (hash: string | undefined) => string;
  bookAuthor: (hash: string | undefined) => string | undefined;
  onExport: () => void;
  onCopy: (text: string) => void;
  onRemove: (item: SavedAnnotation) => void;
  onQuoteCard: (request: QuoteCardRequest) => void;
};

export function QuotesPanel({
  quotes,
  bookTitle,
  bookAuthor,
  onExport,
  onCopy,
  onRemove,
  onQuoteCard,
}: QuotesPanelProps) {
  return (
    <section aria-label="Citas guardadas">
      <div className="nb-actions-bar">
        <span className="meta">{quotes ? `${quotes.length} cita(s) guardada(s)` : "Cargando…"}</span>
        {quotes && quotes.length > 0 ? (
          <button type="button" className="btn--quiet" onClick={() => onExport()}>
            Exportar CSV
          </button>
        ) : null}
      </div>

      {quotes === null ? (
        <p className="meta">Leyendo tus citas…</p>
      ) : quotes.length === 0 ? (
        <p className="nb-empty">
          Aún no has guardado citas.
          <br />
          Al leer, selecciona cualquier fragmento que te conmueva para guardarlo aquí o crear una tarjeta de cita.
        </p>
      ) : (
        <ul className="nb-quotes-list">
          {quotes.map((quote) => {
            const bTitle = bookTitle(quote.bookHash);
            const bAuthor = bookAuthor(quote.bookHash);
            return (
              <li key={quote.key} className="nb-quote-card">
                <blockquote className="nb-quote-text">
                  “{quote.text}”
                </blockquote>
                <div className="nb-quote-meta">
                  {[bTitle, bAuthor].filter(Boolean).join(" · ")}
                </div>
                {quote.note ? (
                  <div className="nb-quote-note">
                    <strong>Nota:</strong> {quote.note}
                  </div>
                ) : null}
                <div className="nb-quote-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      triggerHaptic("selection");
                      onQuoteCard({
                        text: quote.text ?? "",
                        bookTitle: bTitle,
                        author: bAuthor,
                      });
                    }}
                  >
                    Tarjeta de cita
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onCopy(quote.text ?? "")}
                  >
                    Copiar texto
                  </button>
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => onRemove(quote)}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
