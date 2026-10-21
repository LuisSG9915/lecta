import type { ReactElement } from "react";
import Sheet from "../Sheet";
import type { ChapterCatalog, ChapterTarget, IntraSectionContext } from "../../lib/chapters";
import { targetAt } from "../../lib/chapters";
import type { SearchHit } from "../../lib/book-search";
import type { SavedAnnotation } from "../../lib/idb";
import { triggerHaptic } from "../../lib/deep-reading";
import { downloadBookMarkdown } from "../../lib/export";
import type { QuoteCardState } from "../../hooks/useReaderAnnotationsAndSearch";

export type SheetKind = "toc" | "settings" | "search" | "marks";

export interface TocRow {
  label: string;
  index: number;
  depth: number;
  target: ChapterTarget;
}

export interface ReaderSearchAndTocSheetProps {
  sheet: SheetKind | null;
  closeSheet: () => void;
  setSheet: (sheet: SheetKind | null) => void;
  tocRows: TocRow[];
  currentChapterTarget: ChapterTarget | null;
  catalog: ChapterCatalog | null;
  sectionIndex: number;
  activeIntraContext?: IntraSectionContext;
  jumpTo: (
    index: number,
    options?: { fragment?: string; snippet?: string; anchor?: string },
    intent?: "initial" | "chapter" | "resume" | "lookup" | "return",
  ) => void;
  annotations: SavedAnnotation[];
  setGlossaryOpen: (open: boolean) => void;
  searchQ: string;
  setSearchQ: (q: string) => void;
  searchDone: boolean;
  searchHits: SearchHit[];
  sectionLabel: (index: number) => string;
  bookmark?: SavedAnnotation;
  passages: SavedAnnotation[];
  saveBookmarkHere: () => Promise<void>;
  removeMark: (key: string) => Promise<void>;
  editingNote: string | null;
  noteDraft: string;
  setNoteDraft: (draft: string) => void;
  setEditingNote: (key: string | null) => void;
  saveNote: (annotation: SavedAnnotation) => Promise<void>;
  setQuoteCard: (card: QuoteCardState | null) => void;
  bookHash: string;
  title: string;
  author: string;
}

export function ReaderSearchAndTocSheet({
  sheet,
  closeSheet,
  setSheet,
  tocRows,
  currentChapterTarget,
  catalog,
  sectionIndex,
  activeIntraContext,
  jumpTo,
  annotations,
  setGlossaryOpen,
  searchQ,
  setSearchQ,
  searchDone,
  searchHits,
  sectionLabel,
  bookmark,
  passages,
  saveBookmarkHere,
  removeMark,
  editingNote,
  noteDraft,
  setNoteDraft,
  setEditingNote,
  saveNote,
  setQuoteCard,
  bookHash,
  title,
  author,
}: ReaderSearchAndTocSheetProps): ReactElement | null {
  if (sheet === "toc") {
    return (
      <Sheet label="Índice" onClose={closeSheet} side="left">
        <div className="sheet-head">
          <strong className="sheet-title">Índice</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={closeSheet}
            aria-label="Cerrar índice"
            data-autofocus
          >
            Cerrar
          </button>
        </div>
        {tocRows.length ? (
          <ul className="toc-list">
            {tocRows.map((row, i) => {
              const isCurrent =
                (currentChapterTarget?.id ??
                  targetAt(catalog?.ranges ?? [], sectionIndex, activeIntraContext)?.id) ===
                row.target.id;
              return (
                <li key={`${row.index}-${i}`} style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}>
                  <button
                    type="button"
                    className="toc-item"
                    data-current={isCurrent || undefined}
                    aria-current={isCurrent ? "location" : undefined}
                    onClick={() =>
                      jumpTo(
                        row.index,
                        { fragment: row.target.fragment },
                        "chapter",
                      )
                    }
                  >
                    {row.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="meta">Este libro no trae índice.</p>
        )}
        <button
          type="button"
          className="btn--quiet toc-vocab"
          onClick={() => setSheet("marks")}
        >
          Marcadores y pasajes
          {annotations.length ? ` · ${annotations.length}` : ""}
        </button>
        <button
          type="button"
          className="btn--quiet toc-vocab"
          onClick={() => {
            closeSheet();
            setGlossaryOpen(true);
          }}
        >
          Glosario y singularidades de la obra
        </button>
      </Sheet>
    );
  }

  if (sheet === "search") {
    return (
      <Sheet label="Buscar en el libro" onClose={closeSheet} side="left">
        <div className="sheet-head">
          <strong className="sheet-title">Buscar en el libro</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={closeSheet}
            aria-label="Cerrar búsqueda"
          >
            Cerrar
          </button>
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Palabra o frase…"
          value={searchQ}
          onChange={(event) => setSearchQ(event.target.value)}
          aria-label="Texto a buscar en el libro"
          data-autofocus
        />
        {searchQ.trim().length >= 2 ? (
          <p className="meta search-status" role="status">
            {searchDone
              ? searchHits.length
                ? `${searchHits.length} resultado(s)${searchHits.length >= 100 ? " (primeros 100)" : ""}`
                : "Sin resultados."
              : `Buscando… ${searchHits.length ? `${searchHits.length} hasta ahora` : ""}`}
          </p>
        ) : (
          <p className="meta search-status">
            Escribe al menos 2 letras. Los acentos y las mayúsculas no importan.
          </p>
        )}
        {searchHits.length ? (
          <ul className="search-results">
            {searchHits.map((hit, index) => (
              <li key={`${hit.sectionIndex}-${index}`}>
                <button
                  type="button"
                  className="search-hit"
                  onClick={() => jumpTo(hit.sectionIndex, { snippet: hit.anchor })}
                >
                  <span className="search-hit-label">{hit.label}</span>
                  <span className="search-hit-context">
                    {hit.before}
                    <mark>{hit.match}</mark>
                    {hit.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Sheet>
    );
  }

  if (sheet === "marks") {
    return (
      <Sheet label="Marcadores y pasajes" onClose={closeSheet} side="left">
        <div className="sheet-head">
          <strong className="sheet-title">Marcadores</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={closeSheet}
            aria-label="Cerrar marcadores"
            data-autofocus
          >
            Cerrar
          </button>
        </div>
        {bookmark ? (
          <div className="mark-bookmark">
            <p>
              Marcador en <strong>{sectionLabel(bookmark.sectionIndex)}</strong>
            </p>
            <div className="mark-actions">
              <button
                type="button"
                className="btn--quiet"
                onClick={() => jumpTo(bookmark.sectionIndex, { anchor: bookmark.anchor })}
              >
                Ir al marcador
              </button>
              <button
                type="button"
                className="btn--quiet mark-remove"
                onClick={() => void removeMark(bookmark.key)}
              >
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => void saveBookmarkHere()}>
            Guardar este lugar
          </button>
        )}
        <h3 className="sheet-subtitle">Pasajes guardados</h3>
        {passages.length ? (
          <ul className="marks-list">
            {passages.map((passage) => (
              <li key={passage.key} className="mark-item">
                <button
                  type="button"
                  className="mark-jump"
                  onClick={() =>
                    jumpTo(passage.sectionIndex, {
                      snippet: passage.anchor ?? passage.text ?? "",
                    })
                  }
                >
                  <span className="search-hit-label">
                    {sectionLabel(passage.sectionIndex)}
                  </span>
                  <q className="mark-text">
                    {passage.text && passage.text.length > 140
                      ? `${passage.text.slice(0, 140)}…`
                      : passage.text}
                  </q>
                </button>
                {passage.note ? <p className="mark-note">{passage.note}</p> : null}
                {editingNote === passage.key ? (
                  <div className="mark-note-edit">
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Una nota sobre este pasaje…"
                      aria-label="Nota del pasaje"
                    />
                    <div className="mark-actions">
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => void saveNote(passage)}
                      >
                        Guardar nota
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => setEditingNote(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mark-actions">
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() => {
                        setQuoteCard({
                          text: passage.text ?? "",
                          bookTitle: title,
                          author,
                          chapterTitle: sectionLabel(passage.sectionIndex),
                          alreadySaved: true,
                        });
                      }}
                    >
                      Tarjeta
                    </button>
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() => {
                        setEditingNote(passage.key);
                        setNoteDraft(passage.note ?? "");
                      }}
                    >
                      {passage.note ? "Editar nota" : "Nota"}
                    </button>
                    <button
                      type="button"
                      className="btn--quiet mark-remove"
                      onClick={() => void removeMark(passage.key)}
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">
            Selecciona un fragmento del texto para guardarlo como pasaje.
          </p>
        )}
        {passages.length ? (
          <button
            type="button"
            className="btn--quiet"
            style={{ marginTop: "var(--s-3)", width: "100%", justifyContent: "center" }}
            onClick={() => {
              triggerHaptic("selection");
              void downloadBookMarkdown(bookHash, title);
            }}
          >
            Exportar notas y citas (.md)
          </button>
        ) : null}
      </Sheet>
    );
  }

  return null;
}
