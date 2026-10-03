import { useEffect, useState } from "react";
import { isDue, Rating, scheduleReview, type Grade } from "../lib/fsrs";
import { listSavedWords, updateSavedWord, type SavedWord } from "../lib/idb";

type VocabularyProps = {
  onClose: () => void;
};

const GRADES: { rating: Grade; label: string }[] = [
  { rating: Rating.Again, label: "Otra vez" },
  { rating: Rating.Hard, label: "Difícil" },
  { rating: Rating.Good, label: "Bien" },
  { rating: Rating.Easy, label: "Fácil" },
];

const formatDue = (word: SavedWord) =>
  !word.card ? "Nueva" : new Date(word.card.due) <= new Date() ? "Para hoy" : "Programada";

export default function Vocabulary({ onClose }: VocabularyProps) {
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [practice, setPractice] = useState<SavedWord[] | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listSavedWords().then((list) => {
      if (!cancelled) setWords(list.sort((a, b) => b.savedAt - a.savedAt));
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const startPractice = () => {
    const due = (words ?? []).filter((word) => isDue(word.card));
    setPractice(due);
    setRevealed(false);
  };

  const grade = async (word: SavedWord, rating: Grade) => {
    const card = scheduleReview(word.card, rating);
    const updated = { ...word, card };
    await updateSavedWord(updated);
    setWords((list) => list?.map((w) => (w.key === word.key ? updated : w)) ?? list);
    setPractice((queue) => {
      const next = queue?.slice(1) ?? [];
      if (!next.length) return null;
      return next;
    });
    setRevealed(false);
  };

  const dueCount = (words ?? []).filter((word) => isDue(word.card)).length;
  const current = practice?.[0];

  return (
    <div className="word-panel" role="dialog" aria-modal="true" aria-label="Vocabulario guardado">
      <div className="word-panel-header">
        <strong>{practice ? "Repaso" : "Vocabulario"}</strong>
        <button type="button" onClick={onClose} aria-label="Cerrar vocabulario">
          Cerrar
        </button>
      </div>

      {words === null ? <p>Cargando…</p> : null}
      {words?.length === 0 ? <p>Todavía no guardas palabras.</p> : null}

      {!practice && words && words.length > 0 ? (
        <>
          <p className="reader-meta">
            {words.length} guardadas · {dueCount} para repasar hoy
          </p>
          <ul className="word-list">
            {words.slice(0, 30).map((word) => (
              <li key={word.key}>
                <strong>{word.form}</strong>
                {word.lemma && word.lemma !== word.form ? ` (${word.lemma})` : ""}
                {word.meaning ? ` — ${word.meaning}` : ""}
                <span className="reader-meta"> {formatDue(word)}</span>
              </li>
            ))}
          </ul>
          {dueCount > 0 ? (
            <button type="button" onClick={startPractice}>
              Practicar {dueCount}
            </button>
          ) : null}
        </>
      ) : null}

      {practice && practice.length === 0 ? <p>Terminaste el repaso de hoy.</p> : null}

      {current ? (
        <div className="practice-card">
          <p>
            <strong>{current.form}</strong>
            {current.pos ? <span className="reader-meta"> {current.pos}</span> : null}
          </p>
          {current.context ? <p className="word-context">“{current.context}”</p> : null}
          {revealed ? (
            <p>{current.meaning ?? "Sin significado guardado."}</p>
          ) : (
            <button type="button" onClick={() => setRevealed(true)}>
              Mostrar significado
            </button>
          )}
          {revealed ? (
            <div className="practice-grades">
              {GRADES.map(({ rating, label }) => (
                <button key={rating} type="button" onClick={() => void grade(current, rating)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
