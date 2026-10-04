import { useEffect, useState } from "react";
import { isDue, Rating, scheduleReview, type Grade } from "../lib/fsrs";
import { listSavedWords, updateSavedWord, type SavedWord } from "../lib/idb";
import { pushWordsToServer, removeWord } from "../lib/vocab";
import { blankWordInContext } from "../lib/practice";

type VocabularyProps = {
  onClose: () => void;
};

type PracticeMode = "meaning" | "form" | "cloze";

const MODES: { id: PracticeMode; label: string }[] = [
  { id: "meaning", label: "Significado" },
  { id: "form", label: "Palabra" },
  { id: "cloze", label: "Oración" },
];

const MODE_REQUIREMENTS: Record<PracticeMode, string> = {
  meaning: "",
  form: "Este modo necesita palabras con significado guardado.",
  cloze: "Este modo necesita palabras con una oración de contexto guardada.",
};

const GRADES: { rating: Grade; label: string }[] = [
  { rating: Rating.Again, label: "Otra vez" },
  { rating: Rating.Hard, label: "Difícil" },
  { rating: Rating.Good, label: "Bien" },
  { rating: Rating.Easy, label: "Fácil" },
];

const formatDue = (word: SavedWord) =>
  !word.card ? "Nueva" : new Date(word.card.due) <= new Date() ? "Para hoy" : "Programada";

const clozeTextFor = (word: SavedWord) =>
  word.context ? blankWordInContext(word.context, word.form, word.language) : null;

const isEligible = (word: SavedWord, mode: PracticeMode) => {
  if (mode === "form") return Boolean(word.meaning);
  if (mode === "cloze") return Boolean(clozeTextFor(word));
  return true;
};

export default function Vocabulary({ onClose }: VocabularyProps) {
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [mode, setMode] = useState<PracticeMode>("meaning");
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

  const startPractice = (chosen: PracticeMode) => {
    setMode(chosen);
    const due = (words ?? []).filter((word) => isDue(word.card) && isEligible(word, chosen));
    setPractice(due);
    setRevealed(false);
  };

  const grade = async (word: SavedWord, rating: Grade) => {
    const card = scheduleReview(word.card, rating);
    const updated = { ...word, card };
    const stored = await updateSavedWord(updated);
    void pushWordsToServer([stored]);
    setWords((list) => list?.map((w) => (w.key === word.key ? stored : w)) ?? list);
    setPractice((queue) => {
      const next = queue?.slice(1) ?? [];
      if (!next.length) return null;
      return next;
    });
    setRevealed(false);
  };

  const remove = async (key: string) => {
    await removeWord(key);
    setWords((list) => list?.filter((w) => w.key !== key) ?? list);
  };

  const dueCount = (words ?? []).filter((word) => isDue(word.card)).length;
  const current = practice?.[0];
  const cloze = current ? clozeTextFor(current) : null;

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
                <button
                  type="button"
                  className="word-remove"
                  aria-label={`Quitar ${word.form}`}
                  onClick={() => void remove(word.key)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          {dueCount > 0 ? (
            <div className="practice-modes" role="group" aria-label="Modo de práctica">
              {MODES.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => startPractice(id)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {practice && practice.length === 0 ? <p>{MODE_REQUIREMENTS[mode] || "Nada que repasar."}</p> : null}

      {current ? (
        <div className="practice-card">
          {mode === "form" ? (
            <p>{current.meaning}</p>
          ) : mode === "cloze" ? (
            <p className="word-context">“{cloze}”</p>
          ) : (
            <>
              <p>
                <strong>{current.form}</strong>
                {current.pos ? <span className="reader-meta"> {current.pos}</span> : null}
              </p>
              {current.context ? <p className="word-context">“{current.context}”</p> : null}
            </>
          )}

          {revealed ? (
            <p>
              {mode === "meaning" ? (
                (current.meaning ?? "Sin significado guardado.")
              ) : (
                <>
                  <strong>{current.form}</strong>
                  {mode === "cloze" && current.meaning ? ` — ${current.meaning}` : ""}
                </>
              )}
            </p>
          ) : (
            <button type="button" onClick={() => setRevealed(true)}>
              Mostrar respuesta
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
