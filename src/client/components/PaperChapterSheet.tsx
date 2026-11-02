// Hoja de capítulo de «Leo este libro en papel»: las palabras que el
// lector probablemente encontrará en el libro físico, con la misma
// fila de respuesta de la preparación del lector (La conozco / No la
// conozco) y un buscador para anotar palabras que el papel traiga y la
// sugerencia no — sin jerga del lector digital ni «Entrar al capítulo».

import { useEffect, useMemo, useState } from "react";
import Sheet from "./Sheet";
import { PreparationAnswerRow } from "./SectionPreview";
import type { PreparationAnswer } from "../lib/preparation";
import type {
  ManualSaveOutcome,
  PaperSheetState,
} from "../hooks/usePaperReading";

const MORE_PAGE = 8;
// Toque rápido en el buscador: sugerencias del capítulo, luego del
// resto del libro, y al final la consulta libre al diccionario.
const SUGGESTION_LIMIT = 6;
const SAVED_NOTE_MS = 8000;

export type PaperChapterSheetProps = {
  sheet: PaperSheetState;
  // ¿El capítulo ya quedó marcado como leído?
  read: boolean;
  language: string;
  savedTerms: ReadonlySet<string>;
  bookForms: string[];
  // Palabras del Cuaderno ligadas a este libro: sin ellas el panel
  // posterior a «Terminé» no ofrece repaso.
  bookWordCount: number;
  manualSaves: ManualSaveOutcome[];
  onAnswer: (key: string, answer: PreparationAnswer) => void;
  onRetry: () => void;
  // Cierre completo (vuelve a la lista): autoguarda el borrador.
  onClose: () => void;
  onFinish: () => void;
  onToggleRead: () => void;
  onAddWord: (form: string) => Promise<ManualSaveOutcome>;
  onUndoWord: (wordKey: string) => void;
  onReviewBook?: () => void;
};

// Confirma una alta manual y se oculta solo: si no se deshizo a
// tiempo, la palabra queda guardada igual (Deshacer era la opción).
function SavedNote({
  outcome,
  onUndo,
}: {
  outcome: ManualSaveOutcome;
  onUndo: (wordKey: string) => void;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (outcome.kind === "error") return;
    const timer = setTimeout(() => setHidden(true), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [outcome]);
  if (hidden) return null;
  if (outcome.kind === "error")
    return (
      <p className="paper-saved-note" role="alert">
        No se pudo guardar «{outcome.form}». Intenta de nuevo.
      </p>
    );
  if (outcome.kind === "already")
    return (
      <p className="paper-saved-note" role="status">
        «{outcome.form}» ya está en tu Cuaderno.
      </p>
    );
  return (
    <p className="paper-saved-note" role="status">
      «{outcome.form}» guardada en tu Cuaderno
      {outcome.meaning ? ` — ${outcome.meaning}` : ""}.{" "}
      <button
        type="button"
        className="btn--quiet"
        onClick={() => onUndo(outcome.wordKey)}
      >
        Deshacer
      </button>
    </p>
  );
}

function PagedRows({
  rows,
  answers,
  saving,
  expandedKey,
  onAnswer,
  onToggleExpand,
}: {
  rows: PaperSheetState["more"];
  answers: PaperSheetState["answers"];
  saving: boolean;
  expandedKey: string | null;
  onAnswer: PaperChapterSheetProps["onAnswer"];
  onToggleExpand: (key: string) => void;
}) {
  const [shown, setShown] = useState(MORE_PAGE);
  return (
    <>
      <ol className="section-preview-list">
        {rows.slice(0, shown).map((row) => (
          <PreparationAnswerRow
            key={row.key}
            row={row}
            answer={answers[row.key]}
            expanded={expandedKey === row.key}
            saving={saving}
            onAnswer={onAnswer}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </ol>
      {shown < rows.length ? (
        <button
          type="button"
          className="btn--quiet"
          onClick={() => setShown((n) => n + MORE_PAGE)}
        >
          Ver {Math.min(MORE_PAGE, rows.length - shown)} más
        </button>
      ) : null}
    </>
  );
}

export default function PaperChapterSheet({
  sheet,
  read,
  language,
  savedTerms,
  bookForms,
  bookWordCount,
  manualSaves,
  onAnswer,
  onRetry,
  onClose,
  onFinish,
  onToggleRead,
  onAddWord,
  onUndoWord,
  onReviewBook,
}: PaperChapterSheetProps) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return { chapter: [], book: [] };
    const match = (form: string) => form.toLowerCase().includes(q);
    const chapter = sheet.chapterForms.filter(match).slice(0, SUGGESTION_LIMIT);
    const chapterSet = new Set(chapter);
    const book = bookForms
      .filter((form) => match(form) && !chapterSet.has(form))
      .slice(0, SUGGESTION_LIMIT);
    return { chapter, book };
  }, [query, sheet.chapterForms, bookForms]);

  const trimmed = query.trim();
  const addWord = async (form: string) => {
    if (pending) return;
    setPending(true);
    try {
      await onAddWord(form);
    } finally {
      setPending(false);
      setQuery("");
    }
  };

  const rowProps = {
    answers: sheet.answers,
    saving: sheet.saving,
    expandedKey,
    onAnswer,
    onToggleExpand: (key: string) =>
      setExpandedKey((prev) => (prev === key ? null : key)),
  };
  const totalRows =
    sheet.main.length + sheet.more.length + sheet.uncertain.length;

  return (
    <Sheet label={sheet.target.label} onClose={onClose}>
      <header className="paper-sheet-head">
        <button
          type="button"
          className="btn--quiet"
          data-sheet-close
          data-autofocus
        >
          ← Capítulos
        </button>
        <h2 className="paper-sheet-title">{sheet.target.label}</h2>
      </header>

      <section className="paper-add" aria-label="Anotar palabra">
        <label className="paper-add-label" htmlFor="paper-add-input">
          ¿Encontraste otra palabra?
        </label>
        <input
          id="paper-add-input"
          type="search"
          autoComplete="off"
          placeholder="Escríbela aquí"
          lang={language}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {trimmed.length >= 2 ? (
          <ul className="paper-suggestions" aria-label="Sugerencias">
            {suggestions.chapter.map((form) => (
              <li key={`c:${form}`}>
                <button
                  type="button"
                  className="paper-suggestion"
                  disabled={pending}
                  onClick={() => void addWord(form)}
                >
                  {form}
                  {savedTerms.has(form.toLowerCase())
                    ? " · en tu Cuaderno"
                    : ""}
                </button>
              </li>
            ))}
            {suggestions.book.map((form) => (
              <li key={`b:${form}`}>
                <button
                  type="button"
                  className="paper-suggestion"
                  disabled={pending}
                  onClick={() => void addWord(form)}
                >
                  {form}
                  {savedTerms.has(form.toLowerCase())
                    ? " · en tu Cuaderno"
                    : " · del libro"}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="paper-suggestion paper-suggestion--free"
                disabled={pending}
                onClick={() => void addWord(trimmed)}
              >
                Buscar «{trimmed}» en el diccionario
              </button>
            </li>
          </ul>
        ) : null}
        {manualSaves.map((outcome, index) => (
          <SavedNote
            key={`${outcome.kind}:${outcome.form}:${index}`}
            outcome={outcome}
            onUndo={onUndoWord}
          />
        ))}
      </section>

      {sheet.analysis === "loading" ? (
        <p className="meta" role="status">
          Buscando palabras de este capítulo…
        </p>
      ) : sheet.analysis === "error" ? (
        <p className="meta" role="alert">
          No se pudo preparar este capítulo.{" "}
          <button type="button" className="btn--quiet" onClick={onRetry}>
            Reintentar
          </button>
        </p>
      ) : totalRows === 0 ? (
        <p className="meta" role="status">
          Este capítulo no trae palabras nuevas para ti.
        </p>
      ) : (
        <>
          <p className="meta">
            Palabras que podrían costarte. Marca las que ya conoces; las
            demás van a tu Cuaderno.
          </p>
          <ol className="section-preview-list">
            {sheet.main.map((row) => (
              <PreparationAnswerRow
                key={row.key}
                row={row}
                answer={sheet.answers[row.key]}
                expanded={expandedKey === row.key}
                saving={sheet.saving}
                onAnswer={onAnswer}
                onToggleExpand={rowProps.onToggleExpand}
              />
            ))}
          </ol>
          {sheet.more.length ? (
            <details className="paper-more">
              <summary>
                Ver más palabras de este capítulo ({sheet.more.length})
              </summary>
              <PagedRows rows={sheet.more} {...rowProps} />
            </details>
          ) : null}
          {sheet.uncertain.length ? (
            <details className="paper-more">
              <summary>
                Otras palabras difíciles de medir ({sheet.uncertain.length})
              </summary>
              <PagedRows rows={sheet.uncertain} {...rowProps} />
            </details>
          ) : null}
        </>
      )}

      <footer className="paper-sheet-foot">
        {sheet.finished ? (
          <div className="paper-finished" role="status">
            <p>Capítulo marcado como leído.</p>
            <div className="actions">
              {bookWordCount > 0 && onReviewBook ? (
                <button
                  type="button"
                  className="btn"
                  onClick={onReviewBook}
                >
                  Repasar palabras de este libro
                </button>
              ) : null}
              <button type="button" className="btn--quiet" data-sheet-close>
                Volver a los capítulos
              </button>
            </div>
          </div>
        ) : read ? (
          <button
            type="button"
            className="btn--quiet"
            onClick={onToggleRead}
          >
            Marcar como no leído
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={sheet.saving}
            onClick={onFinish}
          >
            Terminé este capítulo
          </button>
        )}
      </footer>
    </Sheet>
  );
}
