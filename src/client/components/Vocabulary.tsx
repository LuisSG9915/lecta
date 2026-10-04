import { useEffect, useRef, useState } from "react";
import { isDue, Rating, scheduleReview, type Card, type Grade } from "../lib/fsrs";
import {
  listAnnotations,
  listSavedWords,
  putSavedWord,
  updateSavedWord,
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
import { pushWordsToServer, removeWord } from "../lib/vocab";
import { blankWordInContext } from "../lib/practice";
import { markLevel, type MarkLevel } from "../lib/word-level";
import { formatInterval } from "../lib/relative-time";
import {
  downloadText,
  passagesToCsv,
  wordsToAnkiTsv,
  wordsToCsv,
} from "../lib/export";
import { useModalBehavior } from "../lib/modal";
import ReadingActivity from "./ReadingActivity";

type VocabularyProps = {
  onClose: () => void;
  books: StoredBook[];
};

type PracticeMode = "meaning" | "form" | "cloze";
type FilterId = (typeof FILTERS)[number]["id"];
type OrderId = (typeof ORDERS)[number]["id"];

const MODES: { id: PracticeMode; label: string; needs: string }[] = [
  { id: "meaning", label: "Significado", needs: "significado" },
  { id: "form", label: "Palabra", needs: "significado" },
  { id: "cloze", label: "Oración", needs: "oración" },
];

const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: "Otra vez", key: "1" },
  { rating: Rating.Hard, label: "Difícil", key: "2" },
  { rating: Rating.Good, label: "Bien", key: "3" },
  { rating: Rating.Easy, label: "Fácil", key: "4" },
];

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "due", label: "Para hoy" },
  { id: "new", label: "Nueva" },
  { id: "learning", label: "Aprendiendo" },
  { id: "settled", label: "Asentada" },
] as const;

const ORDERS = [
  { id: "fecha", label: "Fecha" },
  { id: "libro", label: "Libro" },
  { id: "estado", label: "Estado" },
] as const;

const GROUP_PAGE = 50;
const UNDO_MS = 6000;

// Etiqueta de estado visible de cada palabra. «Para hoy» gana sobre el
// nivel de estabilidad: es lo que el lector necesita saber primero.
const stateOf = (word: SavedWord): { label: string; level: MarkLevel | "due" } =>
  isDue(word.card)
    ? { label: "Para hoy", level: "due" }
    : { label: FILTERS.find((f) => f.id === (markLevel(word.card) ?? "settled"))?.label ?? "Asentada",
        level: markLevel(word.card) ?? "settled" };

const STATE_RANK: Record<string, number> = { due: 0, new: 1, learning: 2, settled: 3 };

const matchesFilter = (word: SavedWord, filter: FilterId): boolean => {
  if (filter === "all") return true;
  if (filter === "due") return isDue(word.card);
  const level = markLevel(word.card);
  if (filter === "new") return level === "new";
  if (filter === "learning") return level === "learning";
  return level === "settled" || level === null;
};

const clozeTextFor = (word: SavedWord) =>
  word.context ? blankWordInContext(word.context, word.form, word.language) : null;

// Cada modo necesita su materia prima: no repasar «significado» sin
// significado guardado ni «oración» sin contexto donde ocultar la palabra.
const isEligible = (word: SavedWord, mode: PracticeMode) => {
  if (mode === "cloze") return Boolean(clozeTextFor(word));
  return Boolean(word.meaning);
};

const norm = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const matchesSearch = (word: SavedWord, query: string) => {
  if (!query) return true;
  const hay = norm([word.form, word.lemma, word.meaning, word.context].filter(Boolean).join(" "));
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
};

export default function Vocabulary({ onClose, books }: VocabularyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);

  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"words" | "activity">("words");
  const [filter, setFilter] = useState<FilterId>("all");
  const [order, setOrder] = useState<OrderId>("fecha");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ mode: PracticeMode; total: number; items: SavedWord[] } | null>(
    null,
  );
  const [revealed, setRevealed] = useState(false);
  const [previews, setPreviews] = useState<string[] | null>(null);
  const [grading, setGrading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ word: SavedWord } | null>(null);

  // La tarjeta candidata de cada calificación se calcula una sola vez al
  // revelar: el botón guarda exactamente lo que su intervalo anuncia.
  const candidates = useRef<Map<Grade, Card> | null>(null);
  const gradingRef = useRef(false);
  const undoTimer = useRef<number | undefined>(undefined);
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const firstGradeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listSavedWords()
      .then((list) => {
        if (!cancelled) setWords(list.sort((a, b) => b.savedAt - a.savedAt));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(undoTimer.current);
    };
  }, []);

  const all = words ?? [];
  const dueWords = all.filter((word) => isDue(word.card));
  const dueCount = dueWords.length;
  const eligibleDue = (mode: PracticeMode) => dueWords.filter((word) => isEligible(word, mode)).length;

  const startPractice = (chosen: PracticeMode) => {
    const items = dueWords.filter((word) => isEligible(word, chosen));
    if (!items.length) return;
    setQueue({ mode: chosen, total: items.length, items });
    setFinishedAt(null);
    setRevealed(false);
    setPreviews(null);
    setSaveError("");
    candidates.current = null;
  };

  const reveal = () => {
    const current = queue?.items[0];
    if (!current) return;
    const now = new Date();
    candidates.current = new Map(
      GRADES.map(({ rating }) => [rating, scheduleReview(current.card, rating, now)]),
    );
    setPreviews(
      GRADES.map(({ rating }) =>
        formatInterval(
          Math.max(0, (candidates.current?.get(rating)?.due.getTime() ?? 0) - now.getTime()),
        ),
      ),
    );
    setRevealed(true);
  };

  const grade = async (word: SavedWord, rating: Grade) => {
    // Bloqueo inmediato: un doble clic o dos teclas no avanzan dos tarjetas.
    if (gradingRef.current) return;
    gradingRef.current = true;
    setGrading(true);
    setSaveError("");
    try {
      const card = candidates.current?.get(rating) ?? scheduleReview(word.card, rating);
      const stored = await updateSavedWord({ ...word, card });
      void pushWordsToServer([stored]);
      setWords((list) => list?.map((w) => (w.key === word.key ? stored : w)) ?? list);
      setQueue((current) => {
        if (!current) return current;
        if (current.items.length === 1) setFinishedAt(Date.now());
        return { ...current, items: current.items.slice(1) };
      });
      setRevealed(false);
      setPreviews(null);
      candidates.current = null;
    } catch {
      setSaveError("No se pudo guardar la calificación. Intenta de nuevo.");
    } finally {
      gradingRef.current = false;
      setGrading(false);
    }
  };

  // Espacio revela la respuesta; 1–4 califican una vez revelada.
  useEffect(() => {
    if (!queue) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const current = queue.items[0];
      if (!current) return;
      if (event.key === " " && !revealed) {
        if (target instanceof HTMLElement && target.closest("button")) return;
        event.preventDefault();
        reveal();
        return;
      }
      const match = GRADES.find((item) => item.key === event.key);
      if (match && revealed) {
        event.preventDefault();
        void grade(current, match.rating);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // grade/reveal se releen de closures actuales en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, revealed]);

  // Foco a la acción siguiente: al revelar → primera calificación;
  // al avanzar de tarjeta → «Mostrar respuesta».
  const current = queue?.items[0];
  const currentKey = current?.key;
  useEffect(() => {
    if (revealed) firstGradeRef.current?.focus();
    else if (currentKey) revealButtonRef.current?.focus();
  }, [revealed, currentKey]);

  const remove = async (word: SavedWord) => {
    try {
      await removeWord(word.key);
      setWords((list) => list?.filter((w) => w.key !== word.key) ?? list);
      window.clearTimeout(undoTimer.current);
      setUndo({ word });
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
    } catch {
      setSaveError(`No se pudo quitar «${word.form}». Intenta de nuevo.`);
    }
  };

  const restore = async () => {
    if (!undo) return;
    const restored = { ...undo.word, deleted: false, updatedAt: Date.now() };
    setUndo(null);
    try {
      await putSavedWord(restored);
      void pushWordsToServer([restored]);
      setWords((list) =>
        list ? [...list.filter((w) => w.key !== restored.key), restored] : [restored],
      );
    } catch {
      setSaveError(`No se pudo recuperar «${undo.word.form}».`);
    }
  };

  const bookTitle = (hash: string | undefined) => {
    if (!hash) return "Sin libro";
    const found = books.find((item) => item.hash === hash);
    return found ? (found.title ?? found.name) : "Libro que ya no está";
  };
  const bookName = (hash: string | undefined) =>
    hash ? bookTitle(hash) : undefined;

  const filtered = all.filter(
    (word) => matchesFilter(word, filter) && matchesSearch(word, query),
  );

  const groups = new Map<string, SavedWord[]>();
  for (const word of filtered) {
    const key = word.bookHash ?? "";
    const group = groups.get(key);
    if (group) group.push(word);
    else groups.set(key, [word]);
  }

  const byForm = (a: SavedWord, b: SavedWord) => a.form.localeCompare(b.form, "es");
  const stateRank = (word: SavedWord) => STATE_RANK[stateOf(word).level] ?? 3;
  if (order === "libro") {
    for (const list of groups.values()) list.sort(byForm);
  } else if (order === "estado") {
    for (const list of groups.values())
      list.sort((a, b) => stateRank(a) - stateRank(b) || byForm(a, b));
  }

  const groupEntries = [...groups.entries()].sort(([hashA, listA], [hashB, listB]) => {
    if (order === "fecha")
      return Math.max(...listB.map((w) => w.savedAt)) - Math.max(...listA.map((w) => w.savedAt));
    return bookTitle(hashA || undefined).localeCompare(bookTitle(hashB || undefined), "es");
  });

  const toggle = (set: Set<string>, key: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const cloze = current ? clozeTextFor(current) : null;
  const done = queue ? queue.total - queue.items.length : 0;
  // Próximo vencimiento real tras el repaso, no un «mañana» inventado.
  const nextDue =
    queue && finishedAt !== null
      ? Math.min(
          ...all
            .filter((word) => word.card && new Date(word.card.due).getTime() > finishedAt)
            .map((word) => new Date(word.card!.due).getTime()),
        )
      : Infinity;

  const exportCsv = () =>
    downloadText(
      `cuaderno-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      wordsToCsv(filtered.filter((w) => !w.deleted), bookName),
      "text/csv;charset=utf-8",
    );
  const exportTsv = () =>
    downloadText(
      `cuaderno-lecta-${new Date().toISOString().slice(0, 10)}.txt`,
      wordsToAnkiTsv(filtered.filter((w) => !w.deleted), bookName),
      "text/plain;charset=utf-8",
    );
  const exportPassages = async () => {
    const stored = await listAnnotations().catch(() => []);
    const passages = stored.filter((item) => item.kind === "passage" && !item.deleted);
    downloadText(
      `pasajes-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      passagesToCsv(passages, bookName),
      "text/csv;charset=utf-8",
    );
  };

  return (
    <div ref={ref} className="notebook" role="dialog" aria-modal="true" aria-label="Cuaderno">
      <header className="notebook-bar">
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Volver"
          data-autofocus
        >
          ‹ Volver
        </button>
        <h1 className="notebook-title">{queue ? "Repaso" : "Cuaderno"}</h1>
        <span className="notebook-count">
          {queue
            ? `${Math.min(done + 1, queue.total)} de ${queue.total}`
            : words
              ? `${all.length} guardadas · ${dueCount} para hoy`
              : ""}
        </span>
      </header>

      <div className="notebook-main">
        {!queue ? (
          <div className="nb-filters nb-tabs" role="group" aria-label="Secciones del cuaderno">
            <button
              type="button"
              className="theme-option"
              data-active={tab === "words" || undefined}
              aria-pressed={tab === "words"}
              onClick={() => setTab("words")}
            >
              Palabras
            </button>
            <button
              type="button"
              className="theme-option"
              data-active={tab === "activity" || undefined}
              aria-pressed={tab === "activity"}
              onClick={() => setTab("activity")}
            >
              Actividad
            </button>
          </div>
        ) : null}

        {tab === "activity" && !queue ? (
          <ReadingActivity books={books} words={all} />
        ) : null}

        {tab === "words" || queue ? (
          <>
        {loadError ? (
          <p className="nb-empty" role="alert">
            No se pudo abrir tu cuaderno en este dispositivo.
          </p>
        ) : null}
        {words === null && !loadError ? <p className="meta">Abriendo tu cuaderno…</p> : null}
        {words?.length === 0 ? (
          <p className="nb-empty">
            Aún no has apuntado palabras.
            <br />
            Toca cualquier palabra mientras lees y aparecerá aquí, con su oración.
          </p>
        ) : null}

        {saveError ? (
          <p className="status" role="alert">
            {saveError}
          </p>
        ) : null}

        {undo ? (
          <p className="nb-undo" role="status">
            «{undo.word.form}» se quitó del cuaderno.{" "}
            <button type="button" className="btn--quiet" onClick={() => void restore()}>
              Deshacer
            </button>
          </p>
        ) : null}

        {!queue && all.length > 0 ? (
          <>
            {dueCount > 0 ? (
              <section className="nb-review" aria-label="Repaso de hoy">
                <p className="eyebrow">Repasar hoy · {dueCount}</p>
                <div className="practice-modes" role="group" aria-label="Modo de repaso">
                  {MODES.map(({ id, label, needs }) => {
                    const count = eligibleDue(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className="btn"
                        disabled={count === 0}
                        title={count === 0 ? `Sin pendientes con ${needs}` : undefined}
                        onClick={() => startPractice(id)}
                      >
                        {label} · {count}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="nb-tools">
              <label className="nb-search">
                <span className="visually-hidden">Buscar en el cuaderno</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar palabra, significado u oración…"
                  autoComplete="off"
                />
              </label>
              <div className="nb-filters" role="group" aria-label="Filtrar palabras">
                {FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className="theme-option"
                    data-active={filter === id || undefined}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="nb-filters" role="group" aria-label="Ordenar palabras">
                {ORDERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className="theme-option"
                    data-active={order === id || undefined}
                    aria-pressed={order === id}
                    onClick={() => setOrder(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="nb-export">
                <button type="button" className="btn--quiet" onClick={exportCsv}>
                  Exportar CSV
                </button>
                <button type="button" className="btn--quiet" onClick={exportTsv}>
                  Para Anki
                </button>
                <button type="button" className="btn--quiet" onClick={() => void exportPassages()}>
                  Exportar pasajes
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="meta">
                {query ? `Nada coincide con «${query}».` : "Nada en este filtro por ahora."}
              </p>
            ) : (
              groupEntries.map(([hash, group]) => {
                const isCollapsed = collapsed.has(hash);
                const shown = expanded.has(hash) ? group : group.slice(0, GROUP_PAGE);
                return (
                  <section key={hash || "sin-libro"} className="nb-group">
                    <h2 className="nb-group-title">
                      <button
                        type="button"
                        className="nb-group-toggle"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggle(collapsed, hash, setCollapsed)}
                      >
                        <span aria-hidden="true">{isCollapsed ? "▸ " : "▾ "}</span>
                        {bookTitle(hash || undefined)}
                      </button>
                      <span className="meta"> · {group.length}</span>
                    </h2>
                    {isCollapsed ? null : (
                      <ul className="nb-words">
                        {shown.map((word) => {
                          const state = stateOf(word);
                          return (
                            <li key={word.key} className="nb-word">
                              <div className="nb-word-head">
                                <strong className="nb-word-form">{word.form}</strong>
                                {word.pos ? <span className="card-pos">{word.pos}</span> : null}
                                {word.lemma && word.lemma !== word.form ? (
                                  <span className="meta">de «{word.lemma}»</span>
                                ) : null}
                                <span className="nb-state" data-level={state.level}>
                                  {state.label}
                                </span>
                                <button
                                  type="button"
                                  className="btn--quiet nb-remove"
                                  aria-label={`Quitar ${word.form}`}
                                  onClick={() => void remove(word)}
                                >
                                  Quitar
                                </button>
                              </div>
                              {word.meaning ? <p className="nb-meaning">{word.meaning}</p> : null}
                              {word.context ? (
                                <p className="nb-context">“{word.context}”</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {!isCollapsed && group.length > shown.length ? (
                      <button
                        type="button"
                        className="btn--quiet nb-more"
                        onClick={() => toggle(expanded, hash, setExpanded)}
                      >
                        Mostrar {group.length - shown.length} más
                      </button>
                    ) : null}
                  </section>
                );
              })
            )}
          </>
        ) : null}
          </>
        ) : null}

        {queue && !current ? (
          <div className="nb-done">
            <p className="nb-done-title">Repaso terminado.</p>
            <p className="meta">
              {queue.total} {queue.total === 1 ? "palabra repasada" : "palabras repasadas"}.
              {Number.isFinite(nextDue) && finishedAt !== null
                ? ` Vuelve en ${formatInterval(nextDue - finishedAt)}.`
                : " Nada pendiente por ahora."}
            </p>
            <button type="button" className="btn--quiet" onClick={() => setQueue(null)}>
              Ver el cuaderno
            </button>
          </div>
        ) : null}

        {current ? (
          <div className="nb-practice">
            <p className="meta nb-practice-meta">
              Modo {MODES.find((m) => m.id === queue.mode)?.label.toLowerCase()}
            </p>
            <div className="index-card nb-card">
              {queue.mode === "form" ? (
                <p className="nb-card-front">{current.meaning}</p>
              ) : queue.mode === "cloze" ? (
                <p className="card-context">“{cloze}”</p>
              ) : (
                <>
                  <p className="nb-card-front">
                    <strong>{current.form}</strong>
                    {current.pos ? <span className="card-pos"> · {current.pos}</span> : null}
                  </p>
                  {current.context ? (
                    <p className="card-context">“{current.context}”</p>
                  ) : null}
                </>
              )}

              {revealed ? (
                <p className="nb-card-back">
                  {queue.mode === "meaning" ? (
                    (current.meaning ?? "Sin significado guardado.")
                  ) : (
                    <>
                      <strong>{current.form}</strong>
                      {queue.mode === "cloze" && current.meaning
                        ? ` — ${current.meaning}`
                        : ""}
                    </>
                  )}
                </p>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={reveal}
                  ref={revealButtonRef}
                >
                  Mostrar respuesta
                </button>
              )}
            </div>

            {revealed ? (
              <>
                <div className="practice-grades" role="group" aria-label="Calificar recuerdo">
                  {GRADES.map(({ rating, label }, index) => (
                    <div key={rating} className="grade-col">
                      <button
                        type="button"
                        className="btn"
                        ref={index === 0 ? firstGradeRef : undefined}
                        disabled={grading}
                        aria-label={`${label}, en ${previews?.[index] ?? ""}`}
                        onClick={() => void grade(current, rating)}
                      >
                        {label}
                      </button>
                      <span className="grade-interval">{previews?.[index] ?? ""}</span>
                    </div>
                  ))}
                </div>
                <p className="meta nb-keys-hint">Teclas 1–4 califican · Espacio muestra la respuesta</p>
              </>
            ) : null}

            <button
              type="button"
              className="btn--quiet nb-quit"
              onClick={() => setQueue(null)}
            >
              Terminar por hoy
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
