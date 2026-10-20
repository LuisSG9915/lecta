import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDue, newCard, Rating, scheduleReview, type Card, type Grade } from "../lib/fsrs";
import {
  captureDbScope,
  fillSavedWordMeaning,
  getActiveUserId,
  knowledgeKey,
  listAnnotations,
  listKnowledge,
  listSavedWords,
  loadSessionValue,
  putSavedWord,
  saveKnowledge,
  saveSessionValue,
  updateAnnotation,
  updateSavedWord,
  type KnownWord,
  type SavedAnnotation,
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
import QuoteCardModal from "./QuoteCardModal";
import BookGlossaryModal from "./BookGlossaryModal";
import {
  answerItem,
  batchLookup,
  enrichWord,
  explainInContext,
  fetchItems,
  verifySentence,
  type LexiconEntry,
  type LexiconItem,
} from "../lib/lexicon";
import {
  emptyLearnExposure,
  isLearnPending,
  knownKeysFor,
  LEARN_EXPOSURE_KEY,
  parseLearnExposure,
  withExposure,
  type LearnExposure,
} from "../lib/learn";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { pushWordsToServer, removeWord } from "../lib/vocab";
import { backfillWordMeanings } from "../lib/word-meanings";
import { recordReview } from "../lib/reviews";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";
import {
  blankWordInContext,
  buildAdaptivePracticeQueue,
  conciseMeaning,
  EXERCISE_RATING,
  pickDistractors,
  ratingToCorrect,
  rescueChallenge,
  shuffleStable,
  type AdaptiveChallenge,
  buildOneMinuteReviewSession,
  savedWordToItem,
  type AutoGameType,
  type SavedWordItem,
  type OneMinuteReviewRound,
} from "../lib/practice";

export {
  buildOneMinuteReviewSession,
  savedWordToItem,
  type AutoGameType,
  type SavedWordItem,
  type OneMinuteReviewRound,
};
import { markLevel, type MarkLevel } from "../lib/word-level";
import { loadUseAi } from "../lib/ai-pref";
import { GamePanel } from "./GamePanel";
import { formatInterval, futureRelativeDay } from "../lib/relative-time";
import {
  downloadBookMarkdown,
  downloadNotebookMarkdown,
  downloadText,
  passagesToCsv,
  exportAnkiTsv,
  wordsToCsv,
} from "../lib/export";
import { useModalBehavior } from "../lib/modal";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import { Companion, type CompanionPose } from "./Companion";
import ReadingActivity from "./ReadingActivity";
import { PracticeContext } from "./PracticeContext";
import { PracticeCompanionHeader } from "./PracticeCompanionHeader";
import {
  loadNativeLanguage,
  loadPracticeCompanionMode,
  savePracticeCompanionMode,
  type PracticeCompanionMode,
} from "../lib/settings";
import { useCompanionSafe } from "./CompanionProvider";
import { levelProgress } from "../lib/gamification";
import { WordScrambleGame } from "./WordScrambleGame";
import { GrammarGame } from "./GrammarGame";
import { SentenceBuilderGame } from "./SentenceBuilderGame";
import { isGrammarEligible, isSentenceEligible } from "../lib/grammar";
import { languageName } from "../lib/epub";
import { speakWord } from "../lib/speech";
import Icon from "./Icon";

export type UnifiedVocabularyProps = {
  words?: SavedWordItem[];
  onStartQuickReview?: (rounds: OneMinuteReviewRound[]) => void;
  onDeleteWord?: (id: string) => void;
  onClose?: () => void;
  // Solo se usa hash/título/nombre/idioma para nombrar y filtrar libros:
  // la estantería manda ShelfItem, que no carga el archivo.
  books?: Pick<StoredBook, "hash" | "name" | "title" | "author" | "language">[];
  // Sube cuando la sincronización trae intervalos nuevos; la pestaña
  // de actividad relee su progreso sin remontar el panel.
  activityVersion?: number;
  onOpenJourney?: () => void;
  presentation?: "overlay" | "page";
  backLabel?: string;
};

export const UnifiedNotebookView: React.FC<{
  words: SavedWordItem[];
  onStartQuickReview?: (rounds: OneMinuteReviewRound[]) => void;
  onDeleteWord?: (id: string) => void;
}> = ({ words, onStartQuickReview, onDeleteWord }) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredWords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return words;
    return words.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        w.shortDefinition.toLowerCase().includes(q) ||
        (w.bookTitle && w.bookTitle.toLowerCase().includes(q)),
    );
  }, [words, searchQuery]);

  const quickSession = useMemo(() => buildOneMinuteReviewSession(words), [words]);

  return (
    <div className="notebook-unified-container">
      {/* Cabecera limpia con el CTA único de 1 toque */}
      <header className="notebook-hero-header">
        <div className="notebook-hero-copy">
          <h1 className="notebook-title">Tu Cuaderno</h1>
          <p className="notebook-subtitle">
            {words.length === 0
              ? "Toca cualquier palabra mientras lees para guardarla aquí."
              : `${words.length} ${words.length === 1 ? "palabra guardada" : "palabras guardadas"} de tus lecturas`}
          </p>
        </div>

        {words.length > 0 && (
          <button
            type="button"
            className="notebook-quick-review-cta"
            onClick={() => onStartQuickReview?.(quickSession)}
          >
            <span className="cta-icon">🎮</span>
            <span className="cta-text">
              Repaso rápido ({Math.min(5, words.length)}{" "}
              {Math.min(5, words.length) === 1 ? "palabra" : "palabras"})
            </span>
            <span className="cta-badge">1 min · 🐱</span>
          </button>
        )}
      </header>

      {/* Buscador instantáneo */}
      {words.length > 0 && (
        <div className="notebook-search-bar">
          <input
            type="search"
            className="notebook-search-input"
            placeholder="🔍 Buscar palabra, significado o libro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar en tu cuaderno"
          />
        </div>
      )}

      {/* Lista única y limpia de palabras */}
      <div className="notebook-words-list">
        {filteredWords.map((item) => (
          <article key={item.id} className="notebook-word-card">
            <div className="notebook-word-card-main">
              <div className="notebook-word-top-row">
                <strong className="notebook-word-lemma">{item.word}</strong>
                {item.bookTitle && (
                  <span className="notebook-word-book-tag">📖 {item.bookTitle}</span>
                )}
              </div>
              <p className="notebook-word-def">
                {item.inPassageMeaning || item.shortDefinition}
              </p>
              {item.sentenceContext && (
                <blockquote className="notebook-word-quote">
                  “{item.sentenceContext}”
                </blockquote>
              )}
            </div>

            {onDeleteWord && (
              <button
                type="button"
                className="notebook-word-delete-btn"
                onClick={() => onDeleteWord(item.id)}
                aria-label={`Eliminar ${item.word}`}
                title="Quitar del cuaderno"
              >
                ✕
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
};
type PracticeMode =
  | "meaning"
  | "form"
  | "cloze"
  | "choose"
  | "match"
  | "scramble"
  | "grammar"
  | "syntax"
  | "sense"
  | "context"
  | "clozeNew"
  | "write";
type FilterId = (typeof FILTERS)[number]["id"];
type OrderId = (typeof ORDERS)[number]["id"];

// Un item de la cola de repaso: la palabra y el modo con el que toca
// (en la mezcla «Repasar hoy» cada una puede traer un modo distinto).
// «sense» además carga la ficha completa y el índice de su acepción;
// «context» y «clozeNew» cargan el ítem de ejercicio del catálogo.
type QueueItem = {
  word: SavedWord;
  mode: PracticeMode;
  entry?: LexiconEntry;
  correctIndex?: number;
  item?: LexiconItem;
  adaptiveChallenge?: AdaptiveChallenge;
};

const MODES: { id: PracticeMode; label: string; needs: string }[] = [
  { id: "meaning", label: "Significado", needs: "significado" },
  { id: "form", label: "Palabra", needs: "significado" },
  { id: "cloze", label: "Oración", needs: "oración" },
  { id: "choose", label: "Elegir palabra", needs: "oración" },
  { id: "match", label: "Parejas", needs: "significado" },
  { id: "scramble", label: "Descifrar", needs: "significado" },
  { id: "grammar", label: "Categoría", needs: "categoría gramatical" },
  { id: "syntax", label: "Ordenar frase", needs: "oración" },
  { id: "sense", label: "Acepción", needs: "acepción guardada" },
  { id: "context", label: "Contexto", needs: "acepción guardada" },
  { id: "clozeNew", label: "Oración nueva", needs: "acepción guardada" },
  { id: "write", label: "Escribir", needs: "significado" },
];

// Modos que no usan la autovaloración Espacio/1–4: los de opciones se
// responden con sus botones y «escribir» tiene el foco en el textarea.
const EXERCISE_MODES: ReadonlySet<PracticeMode> = new Set([
  "choose",
  "match",
  "scramble",
  "grammar",
  "syntax",
  "sense",
  "context",
  "write",
]);

// Palabras por tanda del juego de parejas.
const MATCH_TANDA = 4;

// Modo de repaso → tipo de anotación en el historial (reviews.kind).
const KIND_BY_MODE: Record<PracticeMode, ReviewKind> = {
  meaning: "meaning",
  form: "word",
  cloze: "cloze",
  choose: "choose",
  match: "match",
  scramble: "word",
  grammar: "word",
  syntax: "cloze",
  sense: "sense",
  context: "context",
  clozeNew: "clozeNew",
  write: "write",
};
const mapMode = (mode: PracticeMode): ReviewKind => KIND_BY_MODE[mode];

// Calificación FSRS → valor del historial (reviews.rating).
const ratingString = (rating: Grade): ReviewRating => {
  if (rating === Rating.Again) return "again";
  if (rating === Rating.Hard) return "hard";
  if (rating === Rating.Easy) return "easy";
  return "good";
};

// Semilla estable por palabra o tanda: las opciones no cambian de
// orden entre renders ni si se interrumpe y retoma el repaso.
const seedFor = (text: string) => {
  let seed = 7;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  return seed;
};

const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: "Otra vez", key: "1" },
  { rating: Rating.Hard, label: "Difícil", key: "2" },
  { rating: Rating.Good, label: "Bien", key: "3" },
  { rating: Rating.Easy, label: "Fácil", key: "4" },
];

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "due", label: "Para hoy" },
  { id: "new", label: "Nuevas" },
  { id: "learning", label: "En Práctica" },
  { id: "settled", label: "Dominadas" },
] as const;

const ORDERS = [
  { id: "fecha", label: "Fecha" },
  { id: "libro", label: "Libro" },
  { id: "estado", label: "Estado" },
] as const;

const GROUP_PAGE = 50;
const UNDO_MS = 6000;

// Nivel de estabilidad FSRS en 4 segmentos para el indicador visual
function getStabilitySegments(s: number): number {
  if (s >= 14) return 4;
  if (s >= 7) return 3;
  if (s >= 2) return 2;
  if (s > 0.5) return 1;
  return 0;
}

// Resalta la palabra dentro del contexto del libro con estilo ámbar suave
function renderHighlightedContext(context: string | null | undefined, form: string) {
  if (!context) return null;
  const target = form.trim();
  if (!target) return context;
  const lowerTarget = target.toLowerCase();
  const lowerContext = context.toLowerCase();
  const idx = lowerContext.indexOf(lowerTarget);
  if (idx === -1) return context;
  const before = context.slice(0, idx);
  const match = context.slice(idx, idx + target.length);
  const after = context.slice(idx + target.length);
  return (
    <>
      {before}
      <mark className="nb-word-quote-highlight">{match}</mark>
      {after}
    </>
  );
}

// Etiqueta de estado visible de cada palabra según estabilidad FSRS (S)
const stateOf = (word: SavedWord): { label: string; level: MarkLevel | "due" } => {
  if (isDue(word.card)) return { label: "Para hoy", level: "due" };
  const card = word.card;
  const s = card?.stability ?? 0;
  const isNew = !card || (card.reps ?? 0) === 0 || s < 2;
  if (isNew) return { label: "Nuevas", level: "new" };
  if (s < 14) return { label: "En Práctica", level: "learning" };
  return { label: "Dominadas", level: "settled" };
};

const STATE_RANK: Record<string, number> = { due: 0, new: 1, learning: 2, settled: 3 };

const matchesFilter = (word: SavedWord, filter: FilterId): boolean => {
  if (filter === "all") return true;
  if (filter === "due") return isDue(word.card);
  const card = word.card;
  const s = card?.stability ?? 0;
  const isNew = !card || (card.reps ?? 0) === 0 || s < 2;
  if (filter === "new") return isNew;
  if (filter === "learning") return !isNew && s >= 2 && s < 14;
  return !isNew && s >= 14;
};

const clozeTextFor = (word: SavedWord) =>
  word.context ? blankWordInContext(word.context, word.form, word.language) : null;

// Cada modo necesita su materia prima: no repasar «significado» sin
// significado guardado ni «oración» sin contexto donde ocultar la
// palabra. «sense» pide una acepción guardada; que la ficha tenga
// varias se comprueba al armar la cola (necesita conexión). Los modos
// B «contexto» y «oración nueva» piden la acepción completa (entryId
// + senseOrder): el conteo muestra candidatas y las que no tengan
// ítem caen al armar la cola, igual que «acepción».
const isEligible = (word: SavedWord, mode: PracticeMode) => {
  if (mode === "cloze" || mode === "choose") return Boolean(clozeTextFor(word));
  if (mode === "sense") return word.senseEntryId != null;
  if (mode === "context" || mode === "clozeNew")
    return word.senseEntryId != null && word.senseOrder != null;
  if (mode === "scramble")
    return Boolean(word.meaning) && word.form.trim().length >= 2;
  if (mode === "grammar") return isGrammarEligible(word);
  if (mode === "syntax") return isSentenceEligible(word);
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

function WordRow({
  word,
  state,
  isOpen,
  onToggle,
  canLearn,
  onLearn,
  onRemove,
  onSpeak,
  bookTitle,
  onQuickGame,
}: {
  word: SavedWord;
  state: { label: string; level: MarkLevel | "due" };
  isOpen: boolean;
  onToggle: () => void;
  canLearn: boolean;
  onLearn: () => void;
  onRemove: () => void;
  onSpeak: () => void;
  bookTitle?: string;
  onQuickGame?: () => void;
}) {
  const detailId = `word-detail-${word.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const cardStability = word.card?.stability ?? 0;
  const stabilityDays = Math.round(cardStability);
  const stabilityPercent = Math.min(
    100,
    Math.max(word.card ? 5 : 0, Math.round((cardStability / 90) * 100)),
  );
  const activeSegments = getStabilitySegments(cardStability);

  return (
    <li className="nb-word nb-editorial-card">
      <button
        type="button"
        className="nb-word-row"
        aria-expanded={isOpen}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="nb-word-row-head">
          <strong className="nb-word-form nb-word-lemma">{word.lemma || word.form}</strong>
          {word.pos ? <span className="nb-badge-pos card-pos">{word.pos}</span> : null}
          <span className="nb-state" data-level={state.level}>
            {state.label}
          </span>
        </span>
        {word.meaning ? (
          <span className="nb-word-preview">{word.meaning}</span>
        ) : null}
      </button>

      {isOpen ? (
        <div id={detailId} className="nb-word-detail">
          <div className="nb-word-detail-meta">
            {word.lemma && word.lemma !== word.form ? (
              <span className="meta">de «{word.lemma}»</span>
            ) : null}
            {word.pos ? <span className="card-pos">{word.pos}</span> : null}
          </div>
          {word.meaning ? <p className="nb-meaning">{word.meaning}</p> : null}

          {/* Barra de estabilidad de memoria (FSRS) de 4 segmentos */}
          <div
            className="word-memory-stability word-memory-stability--segmented"
            title={`Estabilidad de memoria FSRS: ${stabilityDays} días`}
          >
            <div className="word-stability-header">
              <span className="word-stability-label">Estabilidad en memoria</span>
              <span className="word-stability-val">
                {word.card
                  ? `${stabilityDays} ${stabilityDays === 1 ? "día" : "días"}`
                  : "Sin repasar"}
              </span>
            </div>
            <div
              className="word-stability-bar"
              role="progressbar"
              aria-label="Estabilidad de memoria"
              aria-valuenow={stabilityPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="word-stability-fill"
                style={{ inlineSize: `${stabilityPercent}%` }}
              />
            </div>
            <div className="word-stability-segments" aria-hidden="true">
              {[1, 2, 3, 4].map((seg) => (
                <span
                  key={seg}
                  className={`word-stability-segment ${seg <= activeSegments ? "is-filled" : ""}`}
                />
              ))}
            </div>
          </div>

          {/* Caja de citación del libro donde apareció con palabra resaltada en ámbar suave */}
          {word.context ? (
            <div className="nb-word-quote-box">
              <blockquote className="nb-word-quote">
                “{renderHighlightedContext(word.context, word.form)}”
              </blockquote>
              {bookTitle ? (
                <cite className="nb-word-cite">
                  <Icon name="quote" size={13} />
                  <span>{bookTitle}</span>
                </cite>
              ) : null}
            </div>
          ) : null}

          <div className="nb-word-actions">
            <button
              type="button"
              className="btn--pronounce"
              aria-label={`Pronunciar ${word.form}`}
              title="Escuchar pronunciación"
              onClick={onSpeak}
            >
              <Icon name="speaker" size={16} />
            </button>
            {onQuickGame ? (
              <button
                type="button"
                className="btn btn--quick-game"
                onClick={onQuickGame}
                title="Partida rápida de repaso (3 min)"
              >
                <Icon name="sparkles" size={14} />
                <span>Partida rápida (3 min)</span>
              </button>
            ) : null}
            {canLearn ? (
              <button
                type="button"
                className="btn--quiet"
                aria-label={`Aprender ${word.form}`}
                onClick={onLearn}
              >
                Aprender
              </button>
            ) : null}
            <button
              type="button"
              className="btn--quiet nb-remove"
              aria-label={`Quitar ${word.form}`}
              onClick={onRemove}
            >
              Quitar
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function Vocabulary({
  words: wordsProp,
  onStartQuickReview,
  onDeleteWord,
  onClose = () => {},
  books = [],
  activityVersion,
  onOpenJourney,
  presentation = "overlay",
  backLabel,
}: UnifiedVocabularyProps) {
  if (wordsProp) {
    return (
      <UnifiedNotebookView
        words={wordsProp}
        onStartQuickReview={onStartQuickReview}
        onDeleteWord={onDeleteWord}
      />
    );
  }
  const ref = useRef<HTMLDivElement>(null);
  const isOverlay = presentation !== "page";
  useModalBehavior(ref, onClose, { enabled: isOverlay });

  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"words" | "quotes" | "activity" | "today">("words");
  const [listLimit, setListLimit] = useState(GROUP_PAGE);
  const [openWords, setOpenWords] = useState<Set<string>>(() => new Set());
  const toggleWordOpen = (key: string) => {
    setOpenWords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [quotes, setQuotes] = useState<SavedAnnotation[] | null>(null);
  const [quoteModal, setQuoteModal] = useState<{
    text: string;
    bookTitle?: string;
    author?: string;
    chapterTitle?: string;
  } | null>(null);
  const [glossaryBookHash, setGlossaryBookHash] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [order, setOrder] = useState<OrderId>("fecha");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [bookFilter, setBookFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ total: number; items: QueueItem[] } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [previews, setPreviews] = useState<string[] | null>(null);
  const [grading, setGrading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ word: SavedWord } | null>(null);
  // Ejercicios con opciones: la opción tocada y si fue acierto.
  const [answered, setAnswered] = useState<{ picked: string; correct: boolean } | null>(null);
  // «Escribir»: el texto del usuario, el veredicto de la IA (si hay
  // sesión) y la autocalificación elegida o precargada por la IA.
  const [writeText, setWriteText] = useState("");
  const [writePick, setWritePick] = useState<"good" | "again" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    correct: boolean;
    feedback: string;
  } | null>(null);
  const [verifyError, setVerifyError] = useState("");
  // Tarjeta a la que pertenece la revisión IA en vuelo: si la cola
  // avanzó o se cerró antes de la respuesta, el veredicto se descarta.
  const writeItemRef = useRef<QueueItem | null>(null);
  // Parejas: forma seleccionada, pares resueltos y fallos por forma.
  const [matchSel, setMatchSel] = useState<string | null>(null);
  const [matchDone, setMatchDone] = useState<Set<string>>(new Set());
  const [matchFails, setMatchFails] = useState<Record<string, number>>({});
  const [matchFlash, setMatchFlash] = useState<string | null>(null);
  // Aviso suave cuando un modo no puede armar su cola (p. ej. acepciones sin conexión).
  const [practiceNote, setPracticeNote] = useState("");
  const [workshopOpen, setWorkshopOpen] = useState(false);
  // Preferencia «Usar IA» (Cuenta): una lectura al abrir el cuaderno.
  // Apagada, los modos que llaman al generador (contexto, oración
  // nueva) lo avisan y la corrección de «escribir» no se ofrece.
  const [useAi, setUseAi] = useState(true);
  // «Aprender»: conocimiento vigente (excluye lo ya conocido de la
  // cola y del repaso), exposiciones registradas y la sesión activa.
  const [knowledge, setKnowledge] = useState<KnownWord[]>([]);
  const [exposure, setExposure] = useState<LearnExposure>(emptyLearnExposure());
  const [learn, setLearn] = useState<{
    items: SavedWord[];
    total: number;
    revealed: boolean;
  } | null>(null);
  const [learnBusy, setLearnBusy] = useState<"" | "action" | "enrich">("");
  const [learnError, setLearnError] = useState("");

  // La tarjeta candidata de cada calificación se calcula una sola vez al
  // revelar: el botón guarda exactamente lo que su intervalo anuncia.
  const candidates = useRef<Map<Grade, Card> | null>(null);
  const gradingRef = useRef(false);
  const undoTimer = useRef<number | undefined>(undefined);
  const matchFlashTimer = useRef<number | undefined>(undefined);
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const firstGradeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const writeAreaRef = useRef<HTMLTextAreaElement>(null);
  const companion = useCompanionSafe();

  // Compañero en juegos y repasos (animado / tranquilo / oculto) y su interactividad.
  const [companionMode, setCompanionMode] = useState<PracticeCompanionMode>(() =>
    loadPracticeCompanionMode(),
  );
  const [catPose, setCatPose] = useState<CompanionPose>("idle");
  const [catSpeech, setCatSpeech] = useState<string>("¡Vamos a repasar!");
  const [combo, setCombo] = useState(0);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const catPoseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCatTimer = () => {
    if (catPoseTimer.current !== null) {
      clearTimeout(catPoseTimer.current);
      catPoseTimer.current = null;
    }
  };
  useEffect(() => clearCatTimer, []);

  const updateCompanionMode = (mode: PracticeCompanionMode) => {
    setCompanionMode(mode);
    savePracticeCompanionMode(mode);
  };

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void listSavedWords(undefined, scope)
      .then(async (list) => {
        const sorted = list.sort((a, b) => b.savedAt - a.savedAt);
        if (cancelled) return;
        setWords(sorted);
        // Guardadas sin significado: el catálogo puede tener ficha
        // ya (Wikcionario o una definición IA posterior al guardado);
        // rellenarlas habilita los repasos por significado.
        const merged = await backfillWordMeanings(sorted, {}, scope).catch(
          () => null,
        );
        if (!cancelled && merged) setWords(merged);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    void loadUseAi(scope).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    void listKnowledge(undefined, scope).then((list) => {
      if (!cancelled) setKnowledge(list);
    }).catch(() => {
      /* sin evidencia cargada la cola de Aprender no excluye nada */
    });
    void loadSessionValue(LEARN_EXPOSURE_KEY, scope).then((raw) => {
      if (!cancelled) setExposure(parseLearnExposure(raw));
    }).catch(() => {
      /* sin registro previo: cola completa */
    });
    return () => {
      cancelled = true;
      window.clearTimeout(undoTimer.current);
      window.clearTimeout(matchFlashTimer.current);
    };
  }, []);

  const all = useMemo(() => words ?? [], [words]);

  const recentWords = useMemo(() => {
    return [...all]
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .slice(0, 8);
  }, [all]);

  const handleRecentChipClick = (word: SavedWord) => {
    if (tab !== "words") setTab("words");
    const bh = word.bookHash;
    if (bh && collapsed.has(bh)) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(bh);
        return next;
      });
    }
    setOpenWords((prev) => new Set(prev).add(word.key));
    setTimeout(() => {
      const detailId = `word-detail-${word.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const el = document.getElementById(detailId)?.parentElement || document.getElementById(detailId);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  const availableLanguages = useMemo(() => {
    const langs = new Set<string>();
    for (const w of all) {
      langs.add(w.language || "es");
    }
    for (const b of books) {
      if (b.language) langs.add(b.language);
    }
    return [...langs].sort();
  }, [all, books]);

  const availableBooks = useMemo(() => {
    if (languageFilter === "all") return books;
    return books.filter((b) => (b.language || "es") === languageFilter);
  }, [books, languageFilter]);

  const scopedWords = useMemo(() => {
    return all.filter((word) => {
      if (languageFilter !== "all" && (word.language || "es") !== languageFilter) {
        return false;
      }
      if (bookFilter !== "all" && word.bookHash !== bookFilter) {
        return false;
      }
      return true;
    });
  }, [all, languageFilter, bookFilter]);

  const activeScoped = useMemo(() => scopedWords.filter((w) => !w.deleted), [scopedWords]);

  // Estadísticas de progreso del cuaderno (Asentada / Aprendiendo / Nueva)
  const progressStats = useMemo(() => {
    let settled = 0;
    let learning = 0;
    let newWords = 0;

    for (const w of activeScoped) {
      const lvl = markLevel(w.card);
      if (lvl === "settled" || lvl === null) {
        settled += 1;
      } else if (lvl === "learning") {
        learning += 1;
      } else {
        newWords += 1;
      }
    }

    return { total: activeScoped.length, settled, learning, newWords };
  }, [activeScoped]);

  const knownKeys = useMemo(() => knownKeysFor(knowledge), [knowledge]);
  // Un lema declarado «ya la conozco» sale del vocabulario activo: ni
  // la cola de Aprender ni el repaso lo vuelven a ofrecer, aunque la
  // palabra siga listada en el cuaderno.
  const isWordKnown = useCallback(
    (word: SavedWord) =>
      knownKeys.has(knowledgeKey(word.language || "es", word.lemma ?? word.form)) ||
      (word.lemma != null &&
        knownKeys.has(knowledgeKey(word.language || "es", word.form))),
    [knownKeys],
  );
  const nextDueTs = useMemo(() => {
    const futureTimestamps = scopedWords
      .filter((w) => !w.deleted && w.card?.due && !isDue(w.card) && !isWordKnown(w))
      .map((w) => new Date(w.card!.due).getTime());
    return futureTimestamps.length > 0 ? Math.min(...futureTimestamps) : null;
  }, [scopedWords, isWordKnown]);
  const dueWords = scopedWords
    .filter((word) => isDue(word.card) && !isWordKnown(word))
    .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  const dueCount = dueWords.length;
  const learnPending = scopedWords.filter((word) =>
    isLearnPending(word, knownKeys, exposure),
  );

  const resetExercise = () => {
    setRevealed(false);
    setPreviews(null);
    setSaveError("");
    setAnswered(null);
    setHintText(null);
    setMatchSel(null);
    setMatchDone(new Set());
    setMatchFails({});
    setMatchFlash(null);
    setWriteText("");
    setWritePick(null);
    setVerifyResult(null);
    setVerifyError("");
    setVerifying(false);
    writeItemRef.current = null;
    candidates.current = null;
  };

  const beginQueue = (items: QueueItem[]) => {
    setQueue({ total: items.length, items });
    setFinishedAt(null);
    resetExercise();
  };

  // «Acepción» necesita la ficha completa de cada palabra guardada
  // con acepción; sin conexión o con menos de dos acepciones la
  // palabra no entra en la cola (elegibilidad honesta, no error).
  const buildSenseItems = async (): Promise<QueueItem[]> => {
    const candidates = dueWords.filter((word) => word.senseEntryId != null);
    if (!candidates.length) return [];
    const languages = [...new Set(candidates.map((word) => word.language || "es"))];
    const results = await Promise.all(
      languages.map((lang) =>
        batchLookup(
          candidates
            .filter((word) => (word.language || "es") === lang)
            .map((word) => word.form),
          lang,
        ),
      ),
    );
    const items: QueueItem[] = [];
    results.forEach((result, index) => {
      if (!result.ok) return;
      const lang = languages[index];
      for (const word of candidates) {
        if ((word.language || "es") !== lang) continue;
        // El catálogo clavea por la forma en minúsculas.
        const entries =
          result.entries[word.form.toLowerCase()] ?? result.entries[word.form] ?? [];
        // senseEntryId ya viaja como string; String() cubre las filas
        // locales viejas que lo guardaron como number truncado.
        const entry = entries.find(
          (item) => item.entryId != null && item.entryId === String(word.senseEntryId),
        );
        if (!entry || entry.senses.length < 2) continue;
        // La acepción correcta se reconoce por senseOrder; si falta en
        // alguno de los dos lados se iguala por la definición guardada.
        const correctIndex = entry.senses.findIndex((sense) => {
          if (word.senseOrder != null && sense.senseOrder != null)
            return sense.senseOrder === word.senseOrder;
          return word.meaning != null && sense.definition === word.meaning;
        });
        if (correctIndex < 0) continue;
        items.push({ word, mode: "sense", entry, correctIndex });
      }
    });
    return items;
  };

  // «Contexto» y «oración nueva» (modos B) ejercitan la acepción
  // guardada con un ítem del catálogo: una oración nueva con opciones,
  // generada con IA. fetchItems sirve los que ya existen y manda a
  // generar los que falten (hasta 8 por llamada), así que una cola
  // vacía suele significar «aún no están listos» más que un error.
  const buildItemItems = async (mode: "context" | "clozeNew"): Promise<QueueItem[]> => {
    const candidates = dueWords.filter(
      (word) => word.senseEntryId != null && word.senseOrder != null,
    );
    if (!candidates.length) return [];
    // Refs únicas: varias palabras pueden apuntar a la misma acepción.
    const refs = [
      ...new Map(
        candidates.map((word) => [
          `${word.senseEntryId}:${word.senseOrder}`,
          { entryId: String(word.senseEntryId), senseOrder: word.senseOrder! },
        ]),
      ).values(),
    ];
    const result = await fetchItems(refs, captureDbScope());
    if (!result.ok) return [];
    const itemByRef = new Map(
      result.items.map((item) => [`${item.entryId}:${item.senseOrder}`, item]),
    );
    const items: QueueItem[] = [];
    for (const word of candidates) {
      const item = itemByRef.get(`${word.senseEntryId}:${word.senseOrder}`);
      if (!item) continue;
      // En «oración nueva» el hueco se abre sobre la forma literal: si
      // la IA conjugó la palabra de otra manera no se puede ejercitar.
      if (
        mode === "clozeNew" &&
        !blankWordInContext(item.sentence, word.form, word.language)
      )
        continue;
      items.push({ word, mode, item });
    }
    return items;
  };

  const startPractice = async (chosen: PracticeMode) => {
    setPracticeNote("");
    // Con la IA apagada estos modos no pueden armar cola (fetchItems
    // sirve ítems generados con IA): se avisa y no se llama.
    if ((chosen === "context" || chosen === "clozeNew") && !useAi) {
      setPracticeNote(
        "Los ejercicios Contexto y Oración nueva usan IA; actívala en Cuenta.",
      );
      return;
    }
    const items =
      chosen === "sense"
        ? await buildSenseItems()
        : chosen === "context" || chosen === "clozeNew"
          ? await buildItemItems(chosen)
          : dueWords
              .filter((word) => isEligible(word, chosen))
              .map((word) => ({ word, mode: chosen }));
    if (!items.length) {
      if (chosen === "sense")
        setPracticeNote(
          "Ahora no se pudieron cargar las acepciones. Prueba otro modo o intenta más tarde.",
        );
      else if (chosen === "context" || chosen === "clozeNew")
        setPracticeNote(
          "No hay ejercicios de este tipo todavía; se generan con IA y tardan un poco. Vuelve a intentarlo.",
        );
      return;
    }
    beginQueue(items);
  };


  const startAdaptiveFlow = () => {
    setPracticeNote("");
    const candidates = dueWords.length > 0 ? dueWords.slice(0, 5) : scopedWords.slice(0, 5);
    if (!candidates.length) return;

    const challenges = buildAdaptivePracticeQueue(candidates, {
      pool: scopedWords,
      useAi,
      hasConnection: typeof navigator !== "undefined" ? navigator.onLine : true,
    });

    const queueItems: QueueItem[] = challenges.map((ch) => {
      let mode: PracticeMode;
      switch (ch.mechanic) {
        case "contextual_cloze":
          mode = "choose";
          break;
        case "syllable_scramble":
          mode = "scramble";
          break;
        case "phrase_weaver":
          mode = "syntax";
          break;
        case "grammar_nuance":
          mode = "grammar";
          break;
        case "ai_sentence_craft":
          mode = "write";
          break;
        default:
          mode = "choose";
      }
      return {
        word: ch.word,
        mode,
        adaptiveChallenge: ch,
      };
    });

    beginQueue(queueItems);
  };

  const handleQuickGame = (targetWord: SavedWord) => {
    triggerHaptic("selection");
    setPracticeNote("");
    const targetMode: PracticeMode = targetWord.meaning ? "choose" : "form";
    const others = scopedWords
      .filter((w) => w.key !== targetWord.key && isEligible(w, targetMode))
      .slice(0, 4);
    const items: QueueItem[] = [
      { word: targetWord, mode: targetMode },
      ...others.map((w) => ({ word: w, mode: targetMode })),
    ];
    beginQueue(items);
  };

  // ---------- Aprender (primera exposición guiada) ----------
  // La ficha no califica ni agenda: solo muestra la palabra y su
  // significado, y la decisión explícita la registra en
  // learnExposure:v1. «Ya la conozco» escribe evidencia declared;
  // «Quiero aprenderla» crea la card FSRS que la trae al repaso hoy.

  const startLearn = (first?: SavedWord) => {
    const items = first
      ? [first, ...learnPending.filter((word) => word.key !== first.key)]
      : learnPending;
    if (!items.length) return;
    setLearnError("");
    setLearnBusy("");
    setLearn({ items, total: items.length, revealed: false });
  };

  const advanceLearn = () =>
    setLearn((current) =>
      current ? { ...current, items: current.items.slice(1), revealed: false } : current,
    );

  const persistExposure = async (
    key: string,
    verdict: "known" | "learn",
    scope: ReturnType<typeof captureDbScope>,
  ) => {
    const next = withExposure(exposure, key, verdict, Date.now());
    setExposure(next);
    await saveSessionValue(LEARN_EXPOSURE_KEY, JSON.stringify(next), scope);
  };

  const learnKnown = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("action");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const row = await saveKnowledge(
        {
          language: item.language || "es",
          lemma: (item.lemma ?? item.form).toLowerCase(),
          known: true,
          source: "declared",
        },
        scope,
      );
      setKnowledge((list) => [
        ...list.filter((entry) => entry.key !== row.key),
        row,
      ]);
      void pushKnowledgeToServer([row], scope);
      await persistExposure(item.key, "known", scope);
      triggerHaptic(12);
      advanceLearn();
    } catch {
      setLearnError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setLearnBusy("");
    }
  };

  const learnKeep = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("action");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const stored = await updateSavedWord({ ...item, card: newCard() }, scope);
      void pushWordsToServer([stored], scope);
      setWords((list) =>
        list?.map((word) => (word.key === stored.key ? stored : word)) ?? list,
      );
      await persistExposure(item.key, "learn", scope);
      triggerHaptic(12);
      advanceLearn();
    } catch {
      setLearnError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setLearnBusy("");
    }
  };

  // Sin significado guardado: la IA define la palabra en el momento
  // (mismo endpoint que la ficha del lector) y el relleno respeta el
  // compare-and-set por sello — un repaso o borrado concurrente gana.
  const learnEnrich = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("enrich");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const result = await enrichWord(
        item.form,
        item.language || "es",
        item.context,
        scope,
        loadNativeLanguage(),
      );
      if (!result.ok) {
        setLearnError(result.error);
        return;
      }
      const entry = result.entries[0];
      const sense = entry?.senses[0];
      if (!entry || !sense) {
        setLearnError("La IA no devolvió una definición. Intenta de nuevo.");
        return;
      }
      const stored = await fillSavedWordMeaning(
        item.key,
        item.updatedAt,
        {
          meaning: sense.definition,
          lemma: entry.lemma,
          pos: entry.pos ?? undefined,
          senseEntryId: entry.entryId ?? undefined,
          senseOrder: sense.senseOrder,
        },
        scope,
      );
      if (stored) {
        void pushWordsToServer([stored], scope);
        setWords((list) =>
          list?.map((word) => (word.key === stored.key ? stored : word)) ?? list,
        );
        setLearn((current) =>
          current
            ? {
                ...current,
                items: current.items.map((word) =>
                  word.key === stored.key ? stored : word,
                ),
              }
            : current,
        );
      }
    } catch {
      setLearnError("Sin conexión con el catálogo.");
    } finally {
      setLearnBusy("");
    }
  };

  const reveal = () => {
    const current = queue?.items[0];
    if (!current) return;
    const now = new Date();
    candidates.current = new Map(
      GRADES.map(({ rating }) => [rating, scheduleReview(current.word.card, rating, now)]),
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

  const grade = async (item: QueueItem, rating: Grade) => {
    // Bloqueo inmediato: un doble clic o dos teclas no avanzan dos tarjetas.
    if (gradingRef.current) return;
    gradingRef.current = true;
    setGrading(true);
    setSaveError("");
    try {
      const scope = captureDbScope();
      const { word } = item;
      const card = candidates.current?.get(rating) ?? scheduleReview(word.card, rating);
      const stored = await updateSavedWord({ ...word, card }, scope);
      void pushWordsToServer([stored], scope);
      // El repaso queda en el historial anexable: qué modo se hizo y
      // cómo se calificó. No bloquea el avance de la cola.
      void recordReview(
        {
          language: word.language,
          form: word.form,
          kind: mapMode(item.mode),
          rating: ratingString(rating),
          hints: 0,
        },
        scope,
      ).catch(() => {
        /* el historial es auxiliar; no deshace la calificación */
      });
      // «Oración nueva» se autocalifica con la escala completa, pero al
      // ítem del catálogo solo le importa el acierto: Again es fallo y
      // el resto (difícil/bien/fácil) cuenta como acierto.
      if (item.mode === "clozeNew" && item.item)
        void answerItem(item.item.id, ratingToCorrect(rating), scope);

      const isCorrect = ratingToCorrect(rating);
      if (isCorrect) {
        setCombo((prev) => {
          const next = prev + 1;
          if (next >= 3) {
            setCatPose("celebrate");
            setCatSpeech(`¡Imparable! Racha de ${next} aciertos 🔥`);
          } else {
            setCatPose("celebrate");
            setCatSpeech(rating === Rating.Easy ? "¡Pan comido! ✨" : "¡Muy bien! 🐾");
          }
          return next;
        });
        triggerHaptic("success");
        triggerPurrHaptic();
        playCompanionSound("purr");
      } else {
        setCombo(0);
        setCatPose("idle");
        setCatSpeech("Casi... la repasaremos de nuevo 🌿");
        triggerHaptic(rating === Rating.Again ? 8 : 12);
      }
      clearCatTimer();
      catPoseTimer.current = setTimeout(() => {
        setCatPose("idle");
        catPoseTimer.current = null;
      }, 2200);

      setWords((list) => list?.map((w) => (w.key === word.key ? stored : w)) ?? list);
      setQueue((current) => {
        if (!current) return current;
        if (current.items.length === 1) setFinishedAt(Date.now());
        return { ...current, items: current.items.slice(1) };
      });
      setRevealed(false);
      setPreviews(null);
      setAnswered(null);
      setHintText(null);
      setWriteText("");
      setWritePick(null);
      setVerifyResult(null);
      setVerifyError("");
      writeItemRef.current = null;
      candidates.current = null;
    } catch {
      setSaveError("No se pudo guardar la calificación. Intenta de nuevo.");
    } finally {
      gradingRef.current = false;
      setGrading(false);
    }
  };

  // Ejercicios con opciones («elegir palabra», «acepción», «contexto»):
  // al tocar una opción se anota el resultado y se muestra cuál era
  // correcta; «Continuar» aplica la calificación (acierto = Hard,
  // fallo = Again).
  const answerOption = (picked: string, correct: boolean) => {
    const item = queue?.items[0];
    if (!item || answered) return;
    triggerHaptic(correct ? 14 : 24);
    setAnswered({ picked, correct });
    if (correct) {
      setCombo((prev) => {
        const next = prev + 1;
        if (next >= 3) {
          setCatPose("celebrate");
          setCatSpeech(`¡En racha! x${next} 🔥`);
        } else {
          setCatPose("celebrate");
          setCatSpeech("¡Exacto! 🎯");
        }
        return next;
      });
      triggerPurrHaptic();
      playCompanionSound("purr");
    } else {
      setCombo(0);
      setCatPose("idle");
      setCatSpeech("¡Ánimo! Vamos con la siguiente 🌿");
    }
    clearCatTimer();
    catPoseTimer.current = setTimeout(() => {
      setCatPose("idle");
      catPoseTimer.current = null;
    }, 2200);
    // Los ejercicios con ítem del catálogo («contexto») también anotan
    // el intento en su estadística editorial; no bloquea el repaso.
    const scope = captureDbScope();
    if (item.item) void answerItem(item.item.id, correct, scope);
    void recordReview(
      {
        language: item.word.language,
        form: item.word.form,
        kind: mapMode(item.mode),
        rating: correct ? "correct" : "wrong",
        hints: 0,
      },
      scope,
    ).catch(() => {
      /* el historial es auxiliar; no deshace el ejercicio */
    });
  };

  // «Escribir» con sesión: la IA revisa la oración (solo viajan la
  // forma, el significado y el texto escrito, nunca el contexto del
  // libro) y su veredicto precarga la autocalificación; si falla, el
  // error se muestra y el lector se califica igual por su cuenta.
  const checkWriteSentence = async () => {
    const item = queue?.items[0];
    const sentence = writeText.trim();
    if (!item || !sentence || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError("");
    writeItemRef.current = item;
    const result = await verifySentence(
      item.word.form,
      item.word.meaning ?? "",
      sentence,
      captureDbScope(),
      item.word.language,
      loadNativeLanguage(),
    );
    // Si la tarjeta ya no es la misma (la cola avanzó o se cerró),
    // el veredicto tardío se descarta.
    if (writeItemRef.current !== item) return;
    setVerifying(false);
    if (!result.ok) {
      setVerifyError(result.error);
      return;
    }
    setVerifyResult({ correct: result.correct, feedback: result.feedback });
    setWritePick(result.correct ? "good" : "again");
  };

  // Parejas: tocar significado tras elegir una forma. El acierto
  // resuelve el par; el error flashea la opción y cuenta fallo de la
  // forma elegida. Al resolver la tanda se califica cada palabra.
  const pickMeaning = (meaningKey: string) => {
    if (!queue || !matchSel || matchDone.has(meaningKey)) return;
    const tanda = queue.items.slice(0, MATCH_TANDA);
    if (meaningKey === matchSel) {
      triggerPurrHaptic();
      playCompanionSound("purr");
      setCatPose("celebrate");
      clearCatTimer();
      catPoseTimer.current = setTimeout(() => {
        setCatPose("idle");
        catPoseTimer.current = null;
      }, 1500);
      const nextDone = new Set(matchDone).add(meaningKey);
      setMatchDone(nextDone);
      setMatchSel(null);
      setCombo((prev) => {
        const next = prev + 1;
        if (nextDone.size === tanda.length) {
          setCatSpeech("¡Tanda de parejas completada con éxito! 🧩🎉");
        } else if (next >= 3) {
          setCatSpeech(`¡Parejas en racha! x${next} 🔥`);
        } else {
          setCatSpeech("¡Pareja encontrada! ✨");
        }
        return next;
      });
      if (tanda.length > 0 && nextDone.size === tanda.length)
        void finishMatchTanda(tanda, matchFails);
    } else {
      setCombo(0);
      setCatPose("greet");
      setCatSpeech("Ese no corresponde... ¡sigue buscando! 🌿");
      setMatchFails((fails) => ({ ...fails, [matchSel]: (fails[matchSel] ?? 0) + 1 }));
      setMatchFlash(meaningKey);
      window.clearTimeout(matchFlashTimer.current);
      matchFlashTimer.current = window.setTimeout(() => setMatchFlash(null), 700);
    }
  };

  const finishMatchTanda = async (tanda: QueueItem[], fails: Record<string, number>) => {
    for (const item of tanda) {
      const wrongs = fails[item.word.key] ?? 0;
      void recordReview({
        language: item.word.language,
        form: item.word.form,
        kind: "match",
        rating: wrongs ? "wrong" : "correct",
        hints: 0,
      }).catch(() => {
        /* el historial es auxiliar; no deshace el ejercicio */
      });
      // grade() avanza la cola de a un item; la tanda respeta el orden.
      await grade(item, wrongs ? EXERCISE_RATING.wrong : EXERCISE_RATING.correct);
    }
    setMatchSel(null);
    setMatchDone(new Set());
    setMatchFails({});
    setMatchFlash(null);
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
      // Los ejercicios con opciones se responden con sus botones;
      // las teclas de autovaloración no aplican.
      if (EXERCISE_MODES.has(current.mode)) return;
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
  // al responder una opción o autocalificar en «escribir» → «Continuar»;
  // al avanzar → «Mostrar respuesta» (o el textarea en «escribir»).
  const current = queue?.items[0];
  const currentKey = current?.word.key;
  const currentMode = current?.mode;
  useEffect(() => {
    if (revealed) firstGradeRef.current?.focus();
    else if (answered || writePick) continueRef.current?.focus();
    else if (currentMode === "write") writeAreaRef.current?.focus();
    else if (currentKey) revealButtonRef.current?.focus();
  }, [revealed, answered, writePick, currentKey, currentMode]);

  const askCatHint = () => {
    if (!current || hintBusy) return;
    setHintBusy(true);
    setCatSpeech("Pensando en una pista… 🤔");
    const scope = captureDbScope();
    void explainInContext(current.word.form, current.word.language, current.word.context, scope, loadNativeLanguage())
      .then((res) => {
        if (res.ok && res.explanation) {
          setHintText(res.explanation);
          setCatSpeech("¡Aquí tienes una pista!");
          setCatPose("greet");
        } else {
          const fallback = current.word.meaning
            ? `Significado: «${current.word.meaning.slice(0, 50)}…»`
            : "Intenta recordar el pasaje del libro.";
          setHintText(fallback);
          setCatSpeech("Pista del cuaderno 📖");
        }
      })
      .catch(() => {
        const fallback = current.word.meaning
          ? `Significado: «${current.word.meaning.slice(0, 50)}…»`
          : "Intenta recordar el pasaje del libro.";
        setHintText(fallback);
        setCatSpeech("Pista del cuaderno 📖");
      })
      .finally(() => setHintBusy(false));
  };

  const remove = async (word: SavedWord) => {
    try {
      await removeWord(word.key, captureDbScope());
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
      const scope = captureDbScope();
      await putSavedWord(restored, scope);
      void pushWordsToServer([restored], scope);
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
  const bookAuthor = (hash: string | undefined) => {
    if (!hash) return undefined;
    const found = books.find((item) => item.hash === hash);
    return found?.author;
  };
  const bookName = (hash: string | undefined) =>
    hash ? bookTitle(hash) : undefined;

  useEffect(() => {
    if (tab !== "quotes" || quotes !== null) return;
    let cancelled = false;
    const scope = captureDbScope();
    void listAnnotations(undefined, scope)
      .then((stored) => {
        if (cancelled) return;
        const list = stored.filter((item) => item.kind === "passage" && !item.deleted);
        list.sort((a, b) => b.createdAt - a.createdAt);
        setQuotes(list);
      })
      .catch(() => {
        if (!cancelled) setQuotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, quotes]);

  const removeQuote = async (item: SavedAnnotation) => {
    triggerHaptic("light");
    const scope = captureDbScope();
    await updateAnnotation({ ...item, deleted: true }, scope).catch(() => undefined);
    setQuotes((prev) => (prev ? prev.filter((q) => q.key !== item.key) : []));
  };

  const copyQuoteText = async (text: string) => {
    triggerHaptic("selection");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // noop
    }
  };

  const filtered = scopedWords.filter(
    (word) => matchesFilter(word, filter) && matchesSearch(word, query),
  );

  const byForm = (a: SavedWord, b: SavedWord) => a.form.localeCompare(b.form, "es");
  const stateRank = (word: SavedWord) => STATE_RANK[stateOf(word).level] ?? 3;

  const groups = new Map<string, SavedWord[]>();
  if (order === "libro") {
    for (const word of filtered) {
      const key = word.bookHash ?? "";
      const group = groups.get(key);
      if (group) group.push(word);
      else groups.set(key, [word]);
    }
    for (const list of groups.values()) list.sort(byForm);
  }

  const groupEntries = [...groups.entries()].sort(([hashA], [hashB]) => {
    return bookTitle(hashA || undefined).localeCompare(bookTitle(hashB || undefined), "es");
  });

  const flatWords = useMemo(() => {
    if (order === "fecha") {
      return [...filtered].sort((a, b) => b.savedAt - a.savedAt || byForm(a, b));
    }
    if (order === "estado") {
      return [...filtered].sort((a, b) => stateRank(a) - stateRank(b) || byForm(a, b));
    }
    return filtered;
  }, [filtered, order]);

  const shownWords = flatWords.slice(0, listLimit);

  const activeExtraFiltersCount =
    (languageFilter !== "all" ? 1 : 0) +
    (bookFilter !== "all" ? 1 : 0) +
    (order !== "fecha" ? 1 : 0);

  const countForFilter = (id: FilterId) =>
    activeScoped.filter((w) => matchesFilter(w, id)).length;

  const toggle = (set: Set<string>, key: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const cloze = current ? clozeTextFor(current.word) : null;
  // «Oración nueva» oculta la forma en la oración del ítem del
  // catálogo; la cola ya descartó las que no dan hueco, así que aquí
  // solo falta recomputar el texto para mostrarlo.
  const clozeNewText =
    current?.mode === "clozeNew" && current.item
      ? blankWordInContext(current.item.sentence, current.word.form, current.word.language)
      : null;
  // «Contexto» y «acepción» comparten opciones indexadas (definiciones
  // de la acepción): el índice correcto viene del ítem o de la ficha.
  const senseLikeOptions =
    current?.mode === "context"
      ? (current.item?.options ?? [])
      : current?.mode === "sense"
        ? (current.entry?.senses ?? []).map((sense) => sense.definition)
        : [];
  const senseLikeAnswer =
    current?.mode === "context" ? current.item?.answerIndex : current?.correctIndex;
  // La corrección IA de «escribir» pide sesión; sin ella el ejercicio
  // queda en autocalificación directa.
  const hasSession = Boolean(getActiveUserId());
  const done = queue ? queue.total - queue.items.length : 0;

  // «Elegir palabra»: la forma correcta más tres distractores del
  // cuaderno, mezclados con semilla estable por palabra.
  const choiceOptions =
    current?.mode === "choose"
      ? shuffleStable(
          [current.word, ...pickDistractors(current.word, all, 3)],
          seedFor(current.word.key),
        )
      : [];

  // «Parejas»: la tanda vigente (hasta 4) y las dos columnas mezcladas.
  const tanda =
    current?.mode === "match" ? (queue?.items.slice(0, MATCH_TANDA) ?? []) : [];
  const tandaSeed = seedFor(tanda.map((item) => item.word.key).join("|"));
  const matchLeft = shuffleStable(tanda, tandaSeed);
  const matchRight = shuffleStable(tanda, tandaSeed ^ 0x9e3779b9);
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
  const exportAnkiCloze = () =>
    downloadText(
      `cuaderno-lecta-cloze-${new Date().toISOString().slice(0, 10)}.txt`,
      exportAnkiTsv(filtered.filter((w) => !w.deleted), bookName, { cloze: true }),
      "text/plain;charset=utf-8",
    );
  const exportPassages = async () => {
    const stored = await listAnnotations(undefined, captureDbScope()).catch(
      () => [],
    );
    const passages = stored.filter((item) => item.kind === "passage" && !item.deleted);
    downloadText(
      `pasajes-lecta-${new Date().toISOString().slice(0, 10)}.csv`,
      passagesToCsv(passages, bookName),
      "text/csv;charset=utf-8",
    );
  };
  const exportMarkdownNotebook = () => {
    triggerHaptic("selection");
    void downloadNotebookMarkdown();
  };

  return (
    <div
      ref={ref}
      className={`notebook ${isOverlay ? "notebook--overlay" : "notebook--page"} vocab`}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? "true" : undefined}
      aria-label="Cuaderno"
      data-session={queue ? "queue" : learn ? "learn" : undefined}
    >
      <header className="notebook-bar">
        {isOverlay ? (
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Volver"
            data-autofocus
          >
            {backLabel ?? "‹ Volver"}
          </button>
        ) : null}
        <h1 className="notebook-title">
          {learn ? "Aprender" : queue ? "Repaso" : "Cuaderno"}
        </h1>
        <span className="notebook-count">
          {learn
            ? `${Math.min(learn.total - learn.items.length + 1, learn.total)} de ${learn.total}`
            : queue
              ? `${Math.min(done + 1, queue.total)} de ${queue.total}`
              : words
                ? `${scopedWords.length === all.length ? all.length : `${scopedWords.length} de ${all.length}`} guardadas · ${dueCount} para hoy`
                : ""}
        </span>
      </header>

      <div className="notebook-main">
        {!queue && !learn ? (
          <>
            {/* Hero Card: "La Mesa de Estudio con el Gato" */}
            <section className="nb-hero-card" aria-label="La Mesa de Estudio con el Gato">
              <div className="nb-hero-study-desk">
                <div className="nb-hero-companion-pane">
                  <div
                    className="nb-hero-cat-wrapper"
                    onClick={() => {
                      triggerHaptic("selection");
                      playCompanionSound("purr");
                      setCatPose((p) => (p === "idle" ? "greet" : "idle"));
                      setCatSpeech(
                        combo > 0
                          ? `¡Llevas racha x${combo}! 🐾`
                          : "¡A leer y repasar con ganas! 🐾",
                      );
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Interactuar con ${companion?.name ?? "el gato"}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCatPose("greet");
                      }
                    }}
                  >
                    <Companion
                      stage={companion?.stage ?? 1}
                      mood={companion?.mood ?? "awake"}
                      accessories={companion?.accessories ?? []}
                      pose={catPose}
                      name={companion?.name ?? "Gato"}
                    />
                    {catSpeech ? (
                      <div className="nb-hero-cat-bubble" role="status">
                        <span>{catSpeech}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="nb-hero-session-summary">
                  <div className="nb-hero-header">
                    <span className="nb-hero-eyebrow">La Mesa de Estudio</span>
                    <h2 className="nb-hero-title">
                      {dueCount > 0
                        ? `Tienes ${dueCount} ${dueCount === 1 ? "palabra lista" : "palabras listas"} para brillar hoy`
                        : all.length === 0
                          ? "Tu cuaderno está esperando tus lecturas"
                          : `Estás al día. ${nextDueTs !== null ? `El próximo repaso: ${futureRelativeDay(nextDueTs)}` : "Tu mente descansa hoy."}`}
                    </h2>
                  </div>

                  {all.length > 0 ? (
                    <div className="vocab-progress-card" aria-label="Progreso del cuaderno">
                      <div
                        className="vocab-progress-track"
                        role="progressbar"
                        aria-label="Progreso del cuaderno"
                        aria-valuenow={progressStats.settled}
                        aria-valuemin={0}
                        aria-valuemax={progressStats.total}
                      >
                        <div
                          className="vocab-progress-seg vocab-progress-seg--settled"
                          style={{
                            inlineSize: `${progressStats.total > 0 ? (progressStats.settled / progressStats.total) * 100 : 0}%`,
                          }}
                          title={`${progressStats.settled} asentadas`}
                        />
                        <div
                          className="vocab-progress-seg vocab-progress-seg--learning"
                          style={{
                            inlineSize: `${progressStats.total > 0 ? (progressStats.learning / progressStats.total) * 100 : 0}%`,
                          }}
                          title={`${progressStats.learning} aprendiendo`}
                        />
                        <div
                          className="vocab-progress-seg vocab-progress-seg--new"
                          style={{
                            inlineSize: `${progressStats.total > 0 ? (progressStats.newWords / progressStats.total) * 100 : 0}%`,
                          }}
                          title={`${progressStats.newWords} nuevas`}
                        />
                      </div>
                      <div className="vocab-progress-legend" role="group" aria-label="Filtrar por nivel de dominio">
                        <button
                          type="button"
                          className={`vocab-progress-item vocab-progress-pill vocab-progress-item--new ${filter === "new" ? "is-active" : ""}`}
                          onClick={() => {
                            triggerHaptic("selection");
                            setFilter((prev) => (prev === "new" ? "all" : "new"));
                            setTab("words");
                          }}
                          aria-pressed={filter === "new"}
                        >
                          <span className="vocab-progress-dot" aria-hidden="true" />
                          <span className="vocab-progress-name">Nuevas</span>
                          <strong className="vocab-progress-count">{progressStats.newWords}</strong>
                        </button>
                        <button
                          type="button"
                          className={`vocab-progress-item vocab-progress-pill vocab-progress-item--learning ${filter === "learning" ? "is-active" : ""}`}
                          onClick={() => {
                            triggerHaptic("selection");
                            setFilter((prev) => (prev === "learning" ? "all" : "learning"));
                            setTab("words");
                          }}
                          aria-pressed={filter === "learning"}
                        >
                          <span className="vocab-progress-dot" aria-hidden="true" />
                          <span className="vocab-progress-name">En aprendizaje</span>
                          <strong className="vocab-progress-count">{progressStats.learning}</strong>
                        </button>
                        <button
                          type="button"
                          className={`vocab-progress-item vocab-progress-pill vocab-progress-item--settled ${filter === "settled" ? "is-active" : ""}`}
                          onClick={() => {
                            triggerHaptic("selection");
                            setFilter((prev) => (prev === "settled" ? "all" : "settled"));
                            setTab("words");
                          }}
                          aria-pressed={filter === "settled"}
                        >
                          <span className="vocab-progress-dot" aria-hidden="true" />
                          <span className="vocab-progress-name">Dominadas</span>
                          <strong className="vocab-progress-count">{progressStats.settled}</strong>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Barra de Energía Léxica / Racha de Combo */}
                  <div className="nb-hero-energy" aria-label="Energía Léxica y Racha">
                    <div className="nb-hero-energy-header">
                      <span className="nb-hero-energy-label">
                        <Icon name="sparkles" size={14} />
                        <span>Energía Léxica</span>
                      </span>
                      <span className="nb-hero-energy-streak">
                        {combo > 0 ? `🔥 Combo x${combo}` : `⚡ ${Math.floor(companion?.state?.xp ?? 0)} pts`}
                        {companion?.state?.stats?.streakDays && companion.state.stats.streakDays > 1
                          ? ` · Racha ${companion.state.stats.streakDays} días`
                          : ""}
                      </span>
                    </div>
                    <div
                      className="nb-hero-energy-track"
                      role="progressbar"
                      aria-label="Energía léxica"
                      aria-valuenow={Math.min(100, Math.round(((companion?.state?.xp ?? 0) % 100)))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="nb-hero-energy-fill"
                        style={{
                          inlineSize: `${Math.max(8, Math.min(100, Math.round(((companion?.state?.xp ?? 0) % 100))))}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* CTA Principal Único */}
                  <div className="nb-hero-cta" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {all.length === 0 ? (
                      <button
                        type="button"
                        className="btn btn--primary nb-hero-btn-flow"
                        onClick={onClose}
                      >
                        <Icon name="shelf" size={16} />
                        <span>Abrir un libro para guardar palabras</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--primary nb-hero-btn-flow"
                          onClick={startAdaptiveFlow}
                        >
                          <Icon name="sparkles" size={16} />
                          <span>Iniciar Sesión Fluida (~2 min)</span>
                        </button>
                        <button
                          type="button"
                          className="notebook-quick-review-cta"
                          onClick={() => {
                            const items = all.map(savedWordToItem);
                            const session = buildOneMinuteReviewSession(items);
                            if (onStartQuickReview) {
                              onStartQuickReview(session);
                            } else {
                              startAdaptiveFlow();
                            }
                          }}
                        >
                          <span className="cta-icon">🎮</span>
                          <span className="cta-text">
                            Repaso rápido ({Math.min(5, all.length)}{" "}
                            {Math.min(5, all.length) === 1 ? "palabra" : "palabras"})
                          </span>
                          <span className="cta-badge">1 min · 🐱</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Selector Secundario de Juegos ("Elegir modo libre") */}
                  <div className="nb-free-modes">
                    <span className="nb-free-modes-label">Elegir modo libre:</span>
                    <div className="nb-free-modes-grid" role="group" aria-label="Modos de juego libres">
                      <button
                        type="button"
                        className="nb-free-mode-card"
                        onClick={() => void startPractice("cloze")}
                        disabled={all.filter((w) => isEligible(w, "cloze")).length === 0}
                        title="Hueco en el Libro · Contexto rápido"
                      >
                        <span className="nb-free-mode-icon" aria-hidden="true">📖</span>
                        <div className="nb-free-mode-info">
                          <strong className="nb-free-mode-name">Hueco en el Libro</strong>
                          <span className="nb-free-mode-time">Contexto rápido</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="nb-free-mode-card"
                        onClick={() => void startPractice("scramble")}
                        disabled={all.filter((w) => isEligible(w, "scramble")).length === 0}
                        title="Sílabas de Tinta · Descifrar palabra"
                      >
                        <span className="nb-free-mode-icon" aria-hidden="true">✒️</span>
                        <div className="nb-free-mode-info">
                          <strong className="nb-free-mode-name">Sílabas de Tinta</strong>
                          <span className="nb-free-mode-time">Descifrar palabra</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="nb-free-mode-card"
                        onClick={() => void startPractice("syntax")}
                        disabled={all.filter((w) => isEligible(w, "syntax")).length === 0}
                        title="Telar de Frases · Ordenar oración"
                      >
                        <span className="nb-free-mode-icon" aria-hidden="true">🧵</span>
                        <div className="nb-free-mode-info">
                          <strong className="nb-free-mode-name">Telar de Frases</strong>
                          <span className="nb-free-mode-time">Ordenar frase</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="nb-free-mode-card"
                        onClick={() => setWorkshopOpen((prev) => !prev)}
                        disabled={all.length === 0}
                        title="Taller con el Gato IA · Generativo"
                      >
                        <span className="nb-free-mode-icon" aria-hidden="true">🐾</span>
                        <div className="nb-free-mode-info">
                          <strong className="nb-free-mode-name">Taller con el Gato IA</strong>
                          <span className="nb-free-mode-time">Generativo</span>
                        </div>
                      </button>
                    </div>
                    {practiceNote ? <p className="meta nb-practice-note">{practiceNote}</p> : null}
                  </div>
                </div>
              </div>
            </section>

            {recentWords.length > 0 ? (
              <div className="nb-recent-rail" aria-label="Guardadas recientemente en tu lectura">
                <div
                  className="nb-recent-head"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <span className="nb-recent-label">📌 Guardadas recientemente en tu lectura</span>
                  <button
                    type="button"
                    className="btn--quiet nb-recent-all-btn"
                    onClick={() => setTab("words")}
                    style={{ fontSize: "var(--fs-xs, 0.75rem)", padding: "2px 8px" }}
                    aria-label={`Ver todas las ${all.length} palabras en Mi Herbario`}
                  >
                    {`Ver todas (${all.length}) →`}
                  </button>
                </div>
                <div className="nb-recent-track" role="list">
                  {recentWords.slice(0, 5).map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      role="listitem"
                      className="nb-recent-chip"
                      onClick={() => handleRecentChipClick(w)}
                      title={w.meaning ? `${w.lemma || w.form}: ${w.meaning}` : `Ver ficha de ${w.lemma || w.form}`}
                    >
                      <span className="nb-recent-chip-star" aria-hidden="true">★</span>
                      <span className="nb-recent-chip-text">{w.lemma || w.form}</span>
                      {w.meaning ? (
                        <span
                          className="nb-recent-chip-meaning"
                          style={{
                            opacity: 0.8,
                            fontSize: "0.85em",
                            maxWidth: "160px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          · {w.meaning}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <GamePanel
              mode={workshopOpen ? "ai_workshop" : "dashboard"}
              onStartAdaptiveFlow={startAdaptiveFlow}
              words={all.map((w) => ({
                word: w.form,
                meaning: w.meaning,
                bookTitle: w.bookHash ? bookTitle(w.bookHash) : undefined,
                lemma: w.lemma,
              }))}
              onClose={() => setWorkshopOpen(false)}
            />

            <div className="segmented nb-tabs" role="group" aria-label="Secciones del cuaderno">
              <button
                type="button"
                data-active={tab === "words" || tab === "today" || undefined}
                aria-pressed={tab === "words" || tab === "today"}
                onClick={() => setTab("words")}
              >
                Mi Herbario de Palabras
              </button>
              <button
                type="button"
                data-active={tab === "quotes" || undefined}
                aria-pressed={tab === "quotes"}
                onClick={() => setTab("quotes")}
              >
                Citas y Hallazgos
              </button>
              {onOpenJourney || activityVersion ? (
                <button
                  type="button"
                  data-active={tab === "activity" || undefined}
                  aria-pressed={tab === "activity"}
                  onClick={() => setTab("activity")}
                >
                  Actividad
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "activity" && !queue && !learn ? (
          <ReadingActivity
            books={books}
            words={all}
            activityVersion={activityVersion}
            onOpenJourney={onOpenJourney}
          />
        ) : null}

        {tab === "quotes" && !queue && !learn ? (
          <section aria-label="Citas guardadas">
            <div className="nb-actions-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--s-3)" }}>
              <span className="meta">{quotes ? `${quotes.length} cita(s) guardada(s)` : "Cargando…"}</span>
              {quotes && quotes.length > 0 ? (
                <button type="button" className="btn--quiet" onClick={() => void exportPassages()}>
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
              <ul className="nb-quotes-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
                            setQuoteModal({
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
                          onClick={() => void copyQuoteText(quote.text ?? "")}
                        >
                          Copiar texto
                        </button>
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => void removeQuote(quote)}
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
        ) : null}

        {!queue && !learn ? (
          <>
            {loadError ? (
              <p className="nb-empty" role="alert">
                No se pudo abrir tu cuaderno en este dispositivo.
              </p>
            ) : null}
            {words === null && !loadError ? (
              <p className="meta">Abriendo tu cuaderno…</p>
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
          </>
        ) : null}

        {(tab === "words" || tab === "today") && !queue && !learn ? (
          <section aria-label="Palabras guardadas">
            {learnPending.length > 0 ? (
              <section className="nb-review" aria-label="Palabras por aprender">
                <p className="eyebrow">Por aprender · {learnPending.length}</p>
                <p className="meta">
                  Primera vez que las ves con su significado; decide si ya las
                  conoces o si entran al repaso.
                </p>
                <div className="practice-modes" role="group" aria-label="Aprender">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => startLearn()}
                  >
                    Aprender
                  </button>
                </div>
              </section>
            ) : null}

            {languageFilter !== "all" || bookFilter !== "all" ? (
              <div className="nb-scope-notice">
                <span>
                  {bookFilter !== "all"
                    ? `Solo palabras de «${bookTitle(bookFilter)}»`
                    : `Solo palabras en ${languageName(languageFilter)}`}
                </span>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    setLanguageFilter("all");
                    setBookFilter("all");
                    setListLimit(GROUP_PAGE);
                  }}
                >
                  Ver todas
                </button>
              </div>
            ) : null}
            {words?.length === 0 ? (
              <p className="nb-empty">
                Aún no has apuntado palabras.
                <br />
                Toca cualquier palabra mientras lees y aparecerá aquí, con su oración.
              </p>
            ) : (
              <>
                <div className="nb-tools">
                  <label className="nb-search">
                    <span className="visually-hidden">Buscar en el cuaderno</span>
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setListLimit(GROUP_PAGE);
                      }}
                      placeholder="Buscar palabra, significado u oración…"
                      autoComplete="off"
                    />
                  </label>

                  <div className="nb-filters" role="group" aria-label="Filtrar palabras">
                    {FILTERS.map(({ id, label }) => {
                      const count = countForFilter(id);
                      if (id === "due" && count === 0 && filter !== "due") return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="theme-option"
                          data-active={filter === id || undefined}
                          aria-pressed={filter === id}
                          onClick={() => {
                            setFilter(id);
                            setListLimit(GROUP_PAGE);
                          }}
                        >
                          {label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  <details className="nb-more-filters">
                    <summary className="meta">
                      Más filtros
                      {activeExtraFiltersCount > 0
                        ? ` · ${activeExtraFiltersCount} activo${activeExtraFiltersCount === 1 ? "" : "s"}`
                        : ""}
                    </summary>
                    <div className="nb-more-filters-content">
                      {availableLanguages.length > 1 ? (
                        <div
                          className="nb-filters nb-filters--lang"
                          role="group"
                          aria-label="Filtrar por idioma"
                        >
                          <button
                            type="button"
                            className="theme-option"
                            data-active={languageFilter === "all" || undefined}
                            aria-pressed={languageFilter === "all"}
                            onClick={() => {
                              setLanguageFilter("all");
                              setBookFilter("all");
                              setListLimit(GROUP_PAGE);
                            }}
                          >
                            Todos ({all.length})
                          </button>
                          {availableLanguages.map((lang) => {
                            const count = all.filter((w) => (w.language || "es") === lang).length;
                            return (
                              <button
                                key={lang}
                                type="button"
                                className="theme-option"
                                data-active={languageFilter === lang || undefined}
                                aria-pressed={languageFilter === lang}
                                onClick={() => {
                                  setLanguageFilter(lang);
                                  setBookFilter("all");
                                  setListLimit(GROUP_PAGE);
                                }}
                              >
                                {languageName(lang)} ({count})
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {books.length > 0 ? (
                        <div className="nb-book-filter">
                          <label htmlFor="nb-book-select" className="visually-hidden">
                            Filtrar por libro
                          </label>
                          <select
                            id="nb-book-select"
                            className="nb-select"
                            value={bookFilter}
                            onChange={(event) => {
                              setBookFilter(event.target.value);
                              setListLimit(GROUP_PAGE);
                            }}
                          >
                            <option value="all">
                              {languageFilter === "all"
                                ? "Todos los libros"
                                : `Todos los libros en ${languageName(languageFilter)}`}
                            </option>
                            {availableBooks.map((b) => (
                              <option key={b.hash} value={b.hash}>
                                {b.title ?? b.name} {b.language ? `(${b.language.toUpperCase()})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}

                      <div className="nb-filters" role="group" aria-label="Ordenar palabras">
                        {ORDERS.map(({ id, label }) => (
                          <button
                            key={id}
                            type="button"
                            className="theme-option"
                            data-active={order === id || undefined}
                            aria-pressed={order === id}
                            onClick={() => {
                              setOrder(id);
                              setListLimit(GROUP_PAGE);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>

                  <details className="nb-export">
                    <summary className="meta">Exportar</summary>
                    <div className="nb-export-menu">
                      <button type="button" className="btn--quiet" onClick={exportCsv}>
                        CSV
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={exportAnkiCloze}
                        title="Exportar para Anki con supresión de partes (Cloze) en la oración del libro"
                      >
                        Para Anki
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={exportMarkdownNotebook}
                        title="Exportar cuaderno completo en Markdown para Obsidian, Notion o PKM"
                      >
                        Cuaderno (.md)
                      </button>
                    </div>
                  </details>
                </div>

                {filtered.length === 0 ? (
                  <p className="meta">
                    {query ? `Nada coincide con «${query}».` : "Nada en este filtro por ahora."}
                  </p>
                ) : order === "libro" ? (
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
                          {hash ? (
                            <>
                              <button
                                type="button"
                                className="btn--quiet nb-group-export"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerHaptic("selection");
                                  setGlossaryBookHash(hash);
                                }}
                                title={`Explorar glosario de ${bookTitle(hash)}`}
                                aria-label={`Explorar glosario de ${bookTitle(hash)}`}
                              >
                                Glosario
                              </button>
                              <button
                                type="button"
                                className="btn--quiet nb-group-export"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerHaptic("selection");
                                  void downloadBookMarkdown(hash, bookTitle(hash));
                                }}
                                title={`Exportar ficha en Markdown de ${bookTitle(hash)}`}
                                aria-label={`Exportar ficha en Markdown de ${bookTitle(hash)}`}
                              >
                                Ficha (.md)
                              </button>
                            </>
                          ) : null}
                        </h2>
                        {isCollapsed ? null : (
                          <ul className="nb-words">
                            {shown.map((word) => (
                              <WordRow
                                key={word.key}
                                word={word}
                                state={stateOf(word)}
                                isOpen={openWords.has(word.key)}
                                onToggle={() => toggleWordOpen(word.key)}
                                canLearn={isLearnPending(word, knownKeys, exposure)}
                                onLearn={() => startLearn(word)}
                                onRemove={() => void remove(word)}
                                onSpeak={() => void speakWord(word.form, word.language)}
                                bookTitle={bookTitle(word.bookHash)}
                                onQuickGame={() => handleQuickGame(word)}
                              />
                            ))}
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
                ) : (
                  <>
                    <ul className="nb-words">
                      {shownWords.map((word) => (
                        <WordRow
                          key={word.key}
                          word={word}
                          state={stateOf(word)}
                          isOpen={openWords.has(word.key)}
                          onToggle={() => toggleWordOpen(word.key)}
                          canLearn={isLearnPending(word, knownKeys, exposure)}
                          onLearn={() => startLearn(word)}
                          onRemove={() => void remove(word)}
                          onSpeak={() => void speakWord(word.form, word.language)}
                          bookTitle={bookTitle(word.bookHash)}
                          onQuickGame={() => handleQuickGame(word)}
                        />
                      ))}
                    </ul>
                    {flatWords.length > shownWords.length ? (
                      <button
                        type="button"
                        className="btn--quiet nb-more"
                        onClick={() => setListLimit((curr) => curr + GROUP_PAGE)}
                      >
                        Mostrar {Math.min(GROUP_PAGE, flatWords.length - shownWords.length)} más
                      </button>
                    ) : null}
                  </>
                )}
              </>
            )}
          </section>
        ) : null}

        {learn ? (
          learn.items.length === 0 ? (
            <div className="nb-done">
              <p className="nb-done-title">Aprender terminado.</p>
              <p className="meta">
                {learn.total}{" "}
                {learn.total === 1 ? "palabra vista" : "palabras vistas"}.
              </p>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setLearn(null)}
              >
                Ver el cuaderno
              </button>
            </div>
          ) : (
            <div className="nb-practice">
              <PracticeCompanionHeader
                pose={catPose}
                speech={catSpeech}
                combo={combo}
                mode={companionMode}
                onModeChange={updateCompanionMode}
                bookTitle={learn.items[0].bookTitle}
              />
              <p className="meta nb-practice-meta">Primera exposición</p>
              <div className="index-card nb-card">
                <div className="game-book-eco-row">
                  <span className="game-book-eco-pill">
                    {learn.items[0].bookTitle
                      ? `📖 Eco de: ${learn.items[0].bookTitle}`
                      : "📖 De tus lecturas recientes"}
                  </span>
                </div>
                <p className="nb-card-front">
                  <strong>{learn.items[0].form}</strong>
                  <button
                    type="button"
                    className="btn--pronounce"
                    aria-label={`Pronunciar ${learn.items[0].form}`}
                    title="Escuchar pronunciación"
                    onClick={() => void speakWord(learn.items[0].form, learn.items[0].language)}
                  >
                    <Icon name="speaker" size={16} />
                  </button>
                  {learn.items[0].pos ? (
                    <span className="card-pos"> · {learn.items[0].pos}</span>
                  ) : null}
                </p>
                {learn.items[0].lemma && learn.items[0].lemma !== learn.items[0].form ? (
                  <p className="meta">de «{learn.items[0].lemma}»</p>
                ) : null}
                {learn.items[0].context ? (
                  <PracticeContext
                    key={learn.items[0].key}
                    text={learn.items[0].context}
                    target={learn.items[0].form}
                    language={learn.items[0].language}
                  />
                ) : null}
                {learn.revealed ? (
                  learn.items[0].meaning ? (
                    <p className="nb-card-back">{learn.items[0].meaning}</p>
                  ) : (
                    <>
                      <p className="nb-card-back meta">
                        Sin significado guardado.
                      </p>
                      {hasSession && useAi ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={learnBusy === "enrich"}
                          onClick={() => void learnEnrich()}
                        >
                          {learnBusy === "enrich"
                            ? "Consultando…"
                            : "Definir con IA"}
                        </button>
                      ) : (
                        <p className="meta">
                          {hasSession
                            ? "Las definiciones con IA están apagadas; actívalas en Cuenta."
                            : "Inicia sesión para definirla con IA."}
                        </p>
                      )}
                    </>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() =>
                      setLearn({ ...learn, revealed: true })
                    }
                    ref={revealButtonRef}
                  >
                    Mostrar significado
                  </button>
                )}
              </div>
              {learn.revealed ? (
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(learnBusy)}
                    onClick={() => void learnKnown()}
                  >
                    Ya la conozco
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={Boolean(learnBusy) || !learn.items[0].meaning}
                    title={
                      learn.items[0].meaning
                        ? undefined
                        : "Necesita un significado para entrar al repaso"
                    }
                    onClick={() => void learnKeep()}
                  >
                    Quiero aprenderla
                  </button>
                </div>
              ) : null}
              {learnError ? (
                <p className="status" role="alert">
                  {learnError}
                </p>
              ) : null}
              <button
                type="button"
                className="btn--quiet nb-quit"
                onClick={() => setLearn(null)}
              >
                Terminar por ahora
              </button>
            </div>
          )
        ) : null}

        {queue && !current ? (
          <div className="nb-done">
            <PracticeCompanionHeader
              pose="celebrate"
              speech={`¡Repaso terminado! Afianzaste ${queue.total} ${queue.total === 1 ? "palabra" : "palabras"} para tu próximo capítulo 🐾`}
              combo={combo}
              mode={companionMode}
              onModeChange={updateCompanionMode}
            />
            <p className="nb-done-title">Repaso terminado.</p>
            <p className="meta">
              {queue.total} {queue.total === 1 ? "palabra repasada" : "palabras repasadas"}.
              {Number.isFinite(nextDue) && finishedAt !== null
                ? ` Vuelve en ${formatInterval(nextDue - finishedAt)}.`
                : " Nada pendiente por ahora."}
            </p>

            {companion?.enabled && companion.state ? (
              <div className="nb-done-progress">
                <div className="nb-done-stats">
                  <span className="nb-done-badge">
                    ⭐ {Math.round(companion.state.xp)} XP
                  </span>
                  <span className="nb-done-level">
                    Nivel: {levelProgress(companion.state.xp).name}
                  </span>
                </div>
                {levelProgress(companion.state.xp).ceil !== null ? (
                  <div
                    className="nb-done-bar"
                    role="progressbar"
                    aria-valuenow={Math.round(
                      levelProgress(companion.state.xp).ratio * 100,
                    )}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="nb-done-fill"
                      style={{
                        inlineSize: `${Math.round(
                          levelProgress(companion.state.xp).ratio * 100,
                        )}%`,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap", justifyContent: "center", marginTop: "var(--s-3)" }}>
              <button
                type="button"
                className="btn btn--primary game-return-reading-btn"
                onClick={onClose}
              >
                Volver a mi lectura
              </button>
              <button type="button" className="btn--quiet" onClick={() => setQueue(null)}>
                Ver el cuaderno
              </button>
            </div>
          </div>
        ) : null}

        {current ? (
          <div className="nb-practice">
            <PracticeCompanionHeader
              pose={catPose}
              speech={catSpeech}
              combo={combo}
              mode={companionMode}
              onModeChange={updateCompanionMode}
              onAskHint={hasSession && current.mode !== "write" ? askCatHint : undefined}
              hintBusy={hintBusy}
              hintText={hintText}
              progress={{
                current: queue.total - queue.items.length + 1,
                total: queue.total,
              }}
              bookTitle={current.word.bookTitle}
              instruction={
                current.mode === "scramble"
                  ? "Toca las fichas en orden para completar la palabra del pasaje."
                  : current.mode === "syntax"
                    ? "Ordena los fragmentos con sentido para reconstruir la frase literaria."
                    : current.mode === "grammar"
                      ? "Observa la escena e identifica qué papel cumple la palabra."
                      : current.mode === "match"
                        ? "Empareja cada término con su significado correspondiente."
                        : undefined
              }
            />
            <div className="nb-practice-progress-row">
              <span className="game-book-eco-pill">
                {current.word.bookTitle
                  ? `📖 Eco de: ${current.word.bookTitle}`
                  : "📖 De tus lecturas recientes"}
              </span>
              <span className="nb-practice-counter meta">
                {MODES.find((m) => m.id === current.mode)?.label ? `${MODES.find((m) => m.id === current.mode)?.label} · ` : ""}
                {queue.total - queue.items.length + 1} de {queue.total}
              </span>
            </div>

            {current.mode === "match" ? (
              <>
                <div className="match-header-tracker">
                  <span>Parejas: {matchDone.size} de {tanda.length}</span>
                  <div className="match-dots" aria-hidden="true">
                    {tanda.map((item, idx) => (
                      <span
                        key={item.word.key}
                        className={`match-dot${matchDone.size > idx ? " is-done" : ""}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="match-board">
                  <div className="match-col" role="group" aria-label="Palabras">
                    {matchLeft.map((item) => (
                      <button
                        key={item.word.key}
                        type="button"
                        className={`btn match-option${
                          matchDone.has(item.word.key) ? " is-done" : ""
                        }`}
                        aria-pressed={matchSel === item.word.key}
                        disabled={matchDone.has(item.word.key) || grading}
                        onClick={() =>
                          setMatchSel(matchSel === item.word.key ? null : item.word.key)
                        }
                      >
                        {item.word.form}
                      </button>
                    ))}
                  </div>
                  <div className="match-col" role="group" aria-label="Significados">
                    {matchRight.map((item) => (
                      <button
                        key={item.word.key}
                        type="button"
                        className={`btn match-option${
                          matchDone.has(item.word.key) ? " is-done" : ""
                        }${matchFlash === item.word.key ? " is-wrong" : ""}`}
                        disabled={matchDone.has(item.word.key) || grading}
                        onClick={() => pickMeaning(item.word.key)}
                        title={item.word.meaning ?? undefined}
                      >
                        {conciseMeaning(item.word.meaning ?? "", 68)}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="meta nb-keys-hint">Toca una palabra y luego su significado.</p>
              </>
            ) : current.mode === "scramble" ? (
              <WordScrambleGame
                key={current.word.key}
                targetWord={current.word.form}
                meaning={current.word.meaning}
                pos={current.word.pos}
                context={current.word.context}
                language={current.word.language}
                disabled={grading}
                hintText={hintText}
                hintBusy={hintBusy}
                onAskHint={hasSession ? askCatHint : undefined}
                onSolve={() => {
                  setCombo((prev) => {
                    const next = prev + 1;
                    setCatPose("celebrate");
                    setCatSpeech(
                      next >= 3 ? `¡En racha! x${next} 🔥` : "¡Palabra descifrada! ✨🎯",
                    );
                    return next;
                  });
                  void recordReview(
                    {
                      language: current.word.language,
                      form: current.word.form,
                      kind: "word",
                      rating: "correct",
                      hints: 0,
                    },
                    captureDbScope(),
                  ).catch(() => {});
                  void grade(current, EXERCISE_RATING.correct);
                }}
                onWrong={() => {
                  if (current.adaptiveChallenge && current.adaptiveChallenge.level > 1) {
                    const rescued = rescueChallenge(current.adaptiveChallenge, scopedWords);
                    setQueue((prev) => {
                      if (!prev) return prev;
                      const nextItems = [...prev.items];
                      nextItems[0] = { ...current, mode: "choose", adaptiveChallenge: rescued };
                      return { ...prev, items: nextItems };
                    });
                    setCatPose("greet");
                    setCatSpeech("¡No pasa nada! El gato te ayuda: inténtalo en contexto 🐾");
                    setHintText(rescued.hint ?? null);
                    setCombo(0);
                    return;
                  }
                  setCatPose("greet");
                  setCatSpeech("Casi... ¡revisa el orden de las letras! 🐾");
                  setCombo(0);
                }}
              />
            ) : current.mode === "grammar" ? (
              <GrammarGame
                key={current.word.key}
                targetWord={current.word.form}
                meaning={current.word.meaning}
                pos={current.word.pos}
                context={current.word.context}
                language={current.word.language}
                disabled={grading}
                hintText={hintText}
                hintBusy={hintBusy}
                onAskHint={hasSession ? askCatHint : undefined}
                onSolve={() => {
                  setCombo((prev) => {
                    const next = prev + 1;
                    setCatPose("celebrate");
                    setCatSpeech(
                      next >= 3 ? `¡Gramática en racha! x${next} 🔥` : "¡Categoría acertada! 🏛️✨",
                    );
                    return next;
                  });
                  void recordReview(
                    {
                      language: current.word.language,
                      form: current.word.form,
                      kind: "word",
                      rating: "correct",
                      hints: 0,
                    },
                    captureDbScope(),
                  ).catch(() => {});
                  void grade(current, EXERCISE_RATING.correct);
                }}
                onWrong={() => {
                  if (current.adaptiveChallenge && current.adaptiveChallenge.level > 1) {
                    const rescued = rescueChallenge(current.adaptiveChallenge, scopedWords);
                    setQueue((prev) => {
                      if (!prev) return prev;
                      const nextItems = [...prev.items];
                      nextItems[0] = { ...current, mode: "choose", adaptiveChallenge: rescued };
                      return { ...prev, items: nextItems };
                    });
                    setCatPose("greet");
                    setCatSpeech("¡Tranquilo! Vamos a ver la palabra en su oración 🐾");
                    setHintText(rescued.hint ?? null);
                    setCombo(0);
                    return;
                  }
                  setCatPose("greet");
                  setCatSpeech("Casi... revisa la función de la palabra 🐾");
                  setCombo(0);
                }}
              />
            ) : current.mode === "syntax" ? (
              <SentenceBuilderGame
                key={current.word.key}
                targetWord={current.word.form}
                meaning={current.word.meaning}
                sentence={current.word.context ?? ""}
                language={current.word.language}
                disabled={grading}
                hintText={hintText}
                hintBusy={hintBusy}
                onAskHint={hasSession ? askCatHint : undefined}
                onSolve={() => {
                  setCombo((prev) => {
                    const next = prev + 1;
                    setCatPose("celebrate");
                    setCatSpeech(
                      next >= 3 ? `¡Sintaxis en racha! x${next} 🔥` : "¡Oración ordenada! 🎯✨",
                    );
                    return next;
                  });
                  void recordReview(
                    {
                      language: current.word.language,
                      form: current.word.form,
                      kind: "word",
                      rating: "correct",
                      hints: 0,
                    },
                    captureDbScope(),
                  ).catch(() => {});
                  void grade(current, EXERCISE_RATING.correct);
                }}
                onWrong={() => {
                  if (current.adaptiveChallenge && current.adaptiveChallenge.level > 1) {
                    const rescued = rescueChallenge(current.adaptiveChallenge, scopedWords);
                    setQueue((prev) => {
                      if (!prev) return prev;
                      const nextItems = [...prev.items];
                      nextItems[0] = { ...current, mode: "choose", adaptiveChallenge: rescued };
                      return { ...prev, items: nextItems };
                    });
                    setCatPose("greet");
                    setCatSpeech("¡No pasa nada! Reconozcamos la palabra primero 🐾");
                    setHintText(rescued.hint ?? null);
                    setCombo(0);
                    return;
                  }
                  setCatPose("greet");
                  setCatSpeech("Revisa el orden de las palabras 🐾");
                  setCombo(0);
                }}
              />
            ) : current.mode === "write" ? (
              <>
                <div className="index-card nb-card">
                  <p className="nb-card-front">
                    Escribe una oración con «<strong>{current.word.form}</strong>»
                  </p>
                  {current.word.meaning ? (
                    <p className="meta">Significado: {current.word.meaning}</p>
                  ) : null}
                </div>

                <div className="write-box">
                  <label className="visually-hidden" htmlFor="nb-write-input">
                    Tu oración con «{current.word.form}»
                  </label>
                  <textarea
                    id="nb-write-input"
                    ref={writeAreaRef}
                    value={writeText}
                    rows={3}
                    disabled={grading}
                    autoComplete="off"
                    placeholder="Escribe aquí tu oración…"
                    onChange={(event) => {
                      setWriteText(event.target.value);
                      // La revisión y la calificación hablaban del texto
                      // anterior; si la oración cambia se descartan.
                      setVerifyResult(null);
                      setVerifyError("");
                      setWritePick(null);
                    }}
                  />
                </div>

                {hasSession && useAi ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={!writeText.trim() || verifying || grading}
                    onClick={() => void checkWriteSentence()}
                  >
                    {verifying ? "Revisando…" : "Comprobar con IA"}
                  </button>
                ) : null}

                {verifyResult?.feedback ? (
                  <p className="verify-feedback" role="status">
                    {verifyResult.feedback}
                  </p>
                ) : null}
                {verifyError ? (
                  <p className="status" role="alert">
                    {verifyError}
                  </p>
                ) : null}

                {/* Con sesión y la IA encendida la autocalificación
                    aparece tras revisar (o tras el error de la IA);
                    sin una de las dos va directa. El texto vacío no
                    califica. */}
                {!hasSession || !useAi || verifyResult || verifyError ? (
                  <div
                    className="practice-grades write-grades"
                    role="group"
                    aria-label="Calificar tu oración"
                  >
                    <div className="grade-col">
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={writePick === "again"}
                        disabled={!writeText.trim() || grading}
                        onClick={() => setWritePick("again")}
                      >
                        Otra vez
                      </button>
                    </div>
                    <div className="grade-col">
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={writePick === "good"}
                        disabled={!writeText.trim() || grading}
                        onClick={() => setWritePick("good")}
                      >
                        Bien
                      </button>
                    </div>
                  </div>
                ) : null}

                {writePick ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    ref={continueRef}
                    disabled={grading}
                    onClick={() =>
                      void grade(
                        current,
                        writePick === "good" ? Rating.Good : Rating.Again,
                      )
                    }
                  >
                    Continuar
                  </button>
                ) : null}
              </>
            ) : EXERCISE_MODES.has(current.mode) ? (
              <>
                <div className="index-card nb-card">
                  <div className="game-book-eco-row">
                    <span className="game-book-eco-pill">
                      {current.word.bookTitle
                        ? `📖 Eco de: ${current.word.bookTitle}`
                        : "📖 De tus lecturas recientes"}
                    </span>
                  </div>
                  {current.mode === "choose" ? (
                    <>
                      {cloze ? (
                        <PracticeContext
                          key={`${current.word.key}:choose`}
                          text={cloze}
                          target="_____"
                          language={current.word.language}
                        />
                      ) : null}
                      <p className="meta">Toca la palabra que falta.</p>
                    </>
                  ) : current.mode === "context" ? (
                    <>
                      {/* La palabra NO se oculta: se mide reconocer el
                          sentido en una oración nueva del catálogo. */}
                      {current.item?.sentence ? (
                        <PracticeContext
                          key={`${current.word.key}:context`}
                          text={current.item.sentence}
                          target={current.word.form}
                          language={current.word.language}
                        />
                      ) : null}
                      <p className="meta">
                        ¿Qué significa «{current.word.form}» en esta oración?
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="nb-card-front">
                        <strong>{current.word.form}</strong>
                        <button
                          type="button"
                          className="btn--pronounce"
                          aria-label={`Pronunciar ${current.word.form}`}
                          title="Escuchar pronunciación"
                          onClick={() => void speakWord(current.word.form, current.word.language)}
                        >
                          <Icon name="speaker" size={16} />
                        </button>
                        {current.word.pos ? (
                          <span className="card-pos"> · {current.word.pos}</span>
                        ) : null}
                      </p>
                      {current.word.context ? (
                        <PracticeContext
                          key={`${current.word.key}:sense`}
                          text={current.word.context}
                          target={current.word.form}
                          language={current.word.language}
                        />
                      ) : null}
                      <p className="meta">¿Qué acepción corresponde aquí?</p>
                    </>
                  )}
                </div>

                <div
                  className="choice-list"
                  role="group"
                  aria-label={current.mode === "choose" ? "Opciones de palabra" : "Acepciones"}
                >
                  {current.mode === "choose"
                    ? choiceOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={`btn choice-option${
                            answered
                              ? option.key === current.word.key
                                ? " is-correct"
                                : answered.picked === option.key
                                  ? " is-wrong"
                                  : ""
                              : ""
                          }`}
                          disabled={Boolean(answered) || grading}
                          onClick={() =>
                            answerOption(option.key, option.key === current.word.key)
                          }
                        >
                          {option.form}
                        </button>
                      ))
                    : senseLikeOptions.map((label, index) => (
                        <button
                          key={index}
                          type="button"
                          className={`btn choice-option${
                            answered
                              ? index === senseLikeAnswer
                                ? " is-correct"
                                : answered.picked === String(index)
                                  ? " is-wrong"
                                  : ""
                              : ""
                          }`}
                          disabled={Boolean(answered) || grading}
                          onClick={() =>
                            answerOption(String(index), index === senseLikeAnswer)
                          }
                        >
                          {label}
                        </button>
                      ))}
                </div>

                {answered ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    ref={continueRef}
                    disabled={grading}
                    onClick={() =>
                      void grade(
                        current,
                        answered.correct ? EXERCISE_RATING.correct : EXERCISE_RATING.wrong,
                      )
                    }
                  >
                    Continuar
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="index-card nb-card">
                  {current.mode === "form" ? (
                    <p className="nb-card-front">{current.word.meaning}</p>
                  ) : current.mode === "cloze" || current.mode === "clozeNew" ? (
                    (current.mode === "clozeNew" ? clozeNewText : cloze) ? (
                      <PracticeContext
                        key={`${current.word.key}:${current.mode}`}
                        text={(current.mode === "clozeNew" ? clozeNewText : cloze) ?? ""}
                        target="_____"
                        language={current.word.language}
                      />
                    ) : null
                  ) : (
                    <>
                      <p className="nb-card-front">
                        <strong>{current.word.form}</strong>
                        <button
                          type="button"
                          className="btn--pronounce"
                          aria-label={`Pronunciar ${current.word.form}`}
                          title="Escuchar pronunciación"
                          onClick={() => void speakWord(current.word.form, current.word.language)}
                        >
                          <Icon name="speaker" size={16} />
                        </button>
                        {current.word.pos ? (
                          <span className="card-pos"> · {current.word.pos}</span>
                        ) : null}
                      </p>
                      {current.word.context ? (
                        <PracticeContext
                          key={`${current.word.key}:meaning`}
                          text={current.word.context}
                          target={current.word.form}
                          language={current.word.language}
                        />
                      ) : null}
                    </>
                  )}

                  {revealed ? (
                    <p className="nb-card-back">
                      {current.mode === "meaning" ? (
                        (current.word.meaning ?? "Sin significado guardado.")
                      ) : (
                        <>
                          <strong>{current.word.form}</strong>
                          <button
                            type="button"
                            className="btn--pronounce"
                            aria-label={`Pronunciar ${current.word.form}`}
                            title="Escuchar pronunciación"
                            onClick={() => void speakWord(current.word.form, current.word.language)}
                          >
                            <Icon name="speaker" size={16} />
                          </button>
                          {(current.mode === "cloze" || current.mode === "clozeNew") &&
                          current.word.meaning
                            ? ` — ${current.word.meaning}`
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
              </>
            )}

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

      {quoteModal ? (
        <QuoteCardModal
          text={quoteModal.text}
          bookTitle={quoteModal.bookTitle}
          author={quoteModal.author}
          chapterTitle={quoteModal.chapterTitle}
          alreadySaved={true}
          onClose={() => setQuoteModal(null)}
        />
      ) : null}
      {glossaryBookHash ? (
        <BookGlossaryModal
          bookHash={glossaryBookHash}
          bookTitle={bookTitle(glossaryBookHash)}
          onClose={() => setGlossaryBookHash(null)}
          onWordSaved={(savedWord) => {
            setWords((prev) =>
              prev
                ? [savedWord, ...prev.filter((w) => w.key !== savedWord.key)]
                : [savedWord],
            );
          }}
        />
      ) : null}
    </div>
  );
}

export default Vocabulary;

