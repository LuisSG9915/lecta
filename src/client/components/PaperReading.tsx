// «Leo este libro en papel»: índice de capítulos del libro que la
// persona ya tiene físicamente. Cada fila muestra su estado en texto
// (Sin revisar / Preparado · N en tu Cuaderno / Leído) y abre la hoja
// del capítulo con sus palabras. La entrada al modo queda en
// Opciones del libro; tocar el libro sigue abriendo el lector.

import { useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from "../lib/modal";
import { displayTitle } from "../lib/cover";
import {
  usePaperReading,
  type PaperChapterEntry,
} from "../hooks/usePaperReading";
import PaperChapterSheet from "./PaperChapterSheet";
import {
  captureDbScope,
  loadSessionValue,
} from "../lib/idb";
import {
  parseScreenPhrasesRecord,
  screenPhraseItems,
  screenPhrasesKey,
} from "../lib/screen";
import { loadNativeLanguage } from "../lib/settings";

export type PaperReadingProps = {
  book: {
    hash: string;
    name: string;
    title?: string;
    mediaKind?: "movie" | "tv";
  };
  onClose: () => void;
  // «Repasar palabras de este libro»: abre el Cuaderno filtrado.
  onOpenNotebook?: (bookHash: string) => void;
};

const statusText = (entry: PaperChapterEntry) => {
  if (entry.status === "read") return "Leído";
  if (entry.status === "prepared")
    return entry.unknownCount
      ? `Preparado · ${entry.unknownCount} en tu Cuaderno`
      : "Preparado";
  return "Sin revisar";
};

function ChapterButton({
  entry,
  lastTargetId,
  onOpen,
}: {
  entry: PaperChapterEntry;
  lastTargetId: string | null;
  onOpen: (entry: PaperChapterEntry) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="paper-chapter"
        data-target-id={entry.target.id}
        onClick={() => onOpen(entry)}
      >
        <span
          className="paper-chapter-label"
          style={{ paddingInlineStart: entry.target.depth * 14 }}
        >
          {entry.target.label}
        </span>
        <span className="paper-chapter-status">
          {statusText(entry)}
          {entry.target.id === lastTargetId ? " · Aquí te quedaste" : ""}
        </span>
      </button>
    </li>
  );
}

export default function PaperReading({
  book,
  onClose,
  onOpenNotebook,
}: PaperReadingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const paper = usePaperReading(book.hash, { onStatus: setStatus });
  // Frases de la obra de pantalla (claves del banco por capítulo):
  // solo existen cuando el libro tiene mediaKind — los libros en
  // papel no pagan esta lectura.
  const [screenPhrases, setScreenPhrases] = useState<
    Record<string, string[]> | null
  >(null);
  useEffect(() => {
    if (!book.mediaKind) return;
    let cancelled = false;
    void loadSessionValue(screenPhrasesKey(book.hash), captureDbScope())
      .then((raw) => {
        if (cancelled || !raw) return;
        setScreenPhrases(parseScreenPhrasesRecord(raw));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [book.hash, book.mediaKind]);
  const {
    phase,
    title,
    author,
    entries,
    extras,
    lastTargetId,
    sheet,
    manualSaves,
    savedTerms,
    bookWordCount,
    bookForms,
    openChapter,
    closeChapter,
    retryOpen,
    retryAnalysis,
    answerWord,
    finishChapter,
    toggleRead,
    addManualWord,
    undoManualWord,
  } = paper;

  // Salir de la pantalla primero confirma el borrador de la hoja si
  // quedaba una abierta (o el gesto de «atrás» vendría de la propia
  // hoja — su overlay está por encima y corre el mismo guardado).
  const requestClose = () => {
    void (async () => {
      await closeChapter();
      onClose();
    })();
  };
  useModalBehavior(ref, requestClose);

  // «Aquí te quedaste»: al cargar, el scroll aterriza en el último
  // capítulo abierto o en el primero sin revisar. Solo una vez por
  // apertura para no pelear con el usuario si se mueve.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || phase !== "ready") return;
    scrolledRef.current = true;
    const anchor = lastTargetId
      ? `[data-target-id="${CSS.escape(lastTargetId)}"]`
      : null;
    const target = anchor
      ? ref.current?.querySelector(anchor)
      : ref.current?.querySelector("[data-target-id]");
    if (typeof target?.scrollIntoView === "function")
      target.scrollIntoView({ block: "center" });
  }, [phase, lastTargetId]);

  // Frases del capítulo abierto, resueltas contra el banco (máx. 8,
  // orden beta) — solo para obras de pantalla.
  const chapterPhrases = useMemo(() => {
    if (!book.mediaKind || !sheet) return [];
    return screenPhraseItems(
      screenPhrases?.[sheet.target.id],
      loadNativeLanguage(),
    );
  }, [book.mediaKind, sheet, screenPhrases]);

  const display = displayTitle(book.name, title || book.title);
  const isTv = book.mediaKind === "tv";
  const isScreen = book.mediaKind != null;
  const readSheet = sheet
    ? (entries.find((e) => e.target.id === sheet.target.id)?.status ??
        extras.find((e) => e.target.id === sheet.target.id)?.status) ===
      "read"
    : false;

  return (
    <div
      ref={ref}
      className="paper-screen"
      role="dialog"
      aria-modal="true"
      aria-label={`${isScreen ? (isTv ? "Serie" : "Película") : "Leo este libro en papel"} — ${display}`}
    >
      <header className="journey-head">
        <div>
          <p className="eyebrow">
            {isScreen
              ? isTv
                ? "Serie · vocabulario por episodio"
                : "Película · vocabulario"
              : "Leo este libro en papel"}
          </p>
          <h1 className="journey-title">{display}</h1>
          {author ? <p className="meta">{author}</p> : null}
        </div>
        <button
          type="button"
          className="btn--quiet"
          onClick={requestClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </header>

      <main className="journey-content">
        <p className="meta">
          {isScreen
            ? isTv
              ? "Elige el episodio que vas a ver. Te mostramos las palabras que podrían costarte."
              : "Toca la entrada para ver las palabras que podrían costarte."
            : "Elige el capítulo que vas a leer. Te mostramos las palabras que podrían costarte."}
        </p>
        {status ? (
          <p className="meta" role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
        {phase === "opening" ? (
          <p className="meta" role="status">
            Abriendo el libro…
          </p>
        ) : phase === "error" ? (
          <p className="meta" role="alert">
            No se pudo abrir este libro.{" "}
            <button type="button" className="btn--quiet" onClick={retryOpen}>
              Reintentar
            </button>
          </p>
        ) : (
          <>
            {entries.length ? (
              <ul className="paper-chapters">
                {entries.map((entry) => (
                  <ChapterButton
                    key={entry.target.id}
                    entry={entry}
                    lastTargetId={lastTargetId}
                    onOpen={openChapter}
                  />
                ))}
              </ul>
            ) : (
              <p className="meta">No encontramos capítulos en este libro.</p>
            )}
            {extras.length ? (
              <details className="paper-extras">
                <summary>
                  Preliminares y anexos ({extras.length})
                </summary>
                <ul className="paper-chapters">
                  {extras.map((entry) => (
                    <ChapterButton
                      key={entry.target.id}
                      entry={entry}
                      lastTargetId={lastTargetId}
                      onOpen={openChapter}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </main>

      {sheet ? (
        <PaperChapterSheet
          sheet={sheet}
          read={readSheet}
          language={paper.language}
          mediaKind={book.mediaKind}
          phrases={chapterPhrases}
          savedTerms={savedTerms}
          bookForms={bookForms}
          bookWordCount={bookWordCount}
          manualSaves={manualSaves}
          onAnswer={answerWord}
          onRetry={retryAnalysis}
          onClose={() => void closeChapter()}
          onFinish={() => void finishChapter()}
          onToggleRead={toggleRead}
          onAddWord={addManualWord}
          onUndoWord={(key) => void undoManualWord(key)}
          onReviewBook={
            onOpenNotebook
              ? () => {
                  const hash = book.hash;
                  void closeChapter().then(() => onOpenNotebook(hash));
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
