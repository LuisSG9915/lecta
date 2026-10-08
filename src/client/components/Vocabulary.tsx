import { useEffect, useRef, useState } from "react";
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
  EXERCISE_RATING,
  modeForWord,
  pickDistractors,
  ratingToCorrect,
  shuffleStable,
} from "../lib/practice";
import { markLevel, type MarkLevel } from "../lib/word-level";
import { loadUseAi } from "../lib/ai-pref";
import { GamePanel } from "./GamePanel";
import { formatInterval } from "../lib/relative-time";
import {
  downloadBookMarkdown,
  downloadNotebookMarkdown,
  downloadText,
  passagesToCsv,
  wordsToAnkiTsv,
  wordsToCsv,
} from "../lib/export";
import { useModalBehavior } from "../lib/modal";
import { triggerHaptic } from "../lib/haptics";
import ReadingActivity from "./ReadingActivity";

type VocabularyProps = {
  onClose: () => void;
  // Solo se usa hash/título/nombre para nombrar libros: la estantería
  // manda ShelfItem, que no carga el archivo.
  books: Pick<StoredBook, "hash" | "name" | "title" | "author">[];
  // Sube cuando la sincronización trae intervalos nuevos; la pestaña
  // de actividad relee su progreso sin remontar el panel.
  activityVersion?: number;
};

type PracticeMode =
  | "meaning"
  | "form"
  | "cloze"
  | "choose"
  | "match"
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
};

const MODES: { id: PracticeMode; label: string; needs: string }[] = [
  { id: "meaning", label: "Significado", needs: "significado" },
  { id: "form", label: "Palabra", needs: "significado" },
  { id: "cloze", label: "Oración", needs: "oración" },
  { id: "choose", label: "Elegir palabra", needs: "oración" },
  { id: "match", label: "Parejas", needs: "significado" },
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

export default function Vocabulary({ onClose, books, activityVersion }: VocabularyProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);

  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"words" | "quotes" | "activity">("words");
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

  const all = words ?? [];
  const knownKeys = knownKeysFor(knowledge);
  // Un lema declarado «ya la conozco» sale del vocabulario activo: ni
  // la cola de Aprender ni el repaso lo vuelven a ofrecer, aunque la
  // palabra siga listada en el cuaderno.
  const isWordKnown = (word: SavedWord) =>
    knownKeys.has(knowledgeKey(word.language || "es", word.lemma ?? word.form)) ||
    (word.lemma != null &&
      knownKeys.has(knowledgeKey(word.language || "es", word.form)));
  const dueWords = all.filter((word) => isDue(word.card) && !isWordKnown(word));
  const dueCount = dueWords.length;
  const learnPending = all.filter((word) =>
    isLearnPending(word, knownKeys, exposure),
  );
  // «Elegir palabra» necesita cuaderno suficiente para armar
  // distractores (la palabra + 3 opciones); «parejas» necesita una
  // tanda completa de palabras con significado.
  const eligibleDue = (mode: PracticeMode) => {
    const count = dueWords.filter((word) => isEligible(word, mode)).length;
    if (mode === "choose" && all.length < 4) return 0;
    if (mode === "match" && count < MATCH_TANDA) return 0;
    return count;
  };

  const resetExercise = () => {
    setRevealed(false);
    setPreviews(null);
    setSaveError("");
    setAnswered(null);
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

  // La mezcla decide el modo por palabra (practice.ts): aquí solo se
  // descartan las que no se pueden ejercitar y se degrada «choose»
  // cuando no hay cuaderno suficiente para armar distractores.
  const buildMixItems = (): QueueItem[] =>
    dueWords.flatMap((word, index) => {
      let mode = modeForWord(word, index);
      if (mode === "choose" && all.length < 4) mode = "cloze";
      if ((mode === "cloze" || mode === "choose") && !clozeTextFor(word)) {
        mode = index % 2 === 0 ? "meaning" : "word";
      }
      if ((mode === "meaning" || mode === "word") && !word.meaning) return [];
      return [{ word, mode: mode === "word" ? "form" : mode }];
    });

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

  const startMix = () => {
    setPracticeNote("");
    const items = buildMixItems();
    if (items.length) beginQueue(items);
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
      triggerHaptic(rating === Rating.Easy ? 16 : rating === Rating.Good ? 12 : 8);
      setWords((list) => list?.map((w) => (w.key === word.key ? stored : w)) ?? list);
      setQueue((current) => {
        if (!current) return current;
        if (current.items.length === 1) setFinishedAt(Date.now());
        return { ...current, items: current.items.slice(1) };
      });
      setRevealed(false);
      setPreviews(null);
      setAnswered(null);
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
      const nextDone = new Set(matchDone).add(meaningKey);
      setMatchDone(nextDone);
      setMatchSel(null);
      if (tanda.length > 0 && nextDone.size === tanda.length)
        void finishMatchTanda(tanda, matchFails);
    } else {
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
  const mixCount = buildMixItems().length;

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
  const exportTsv = () =>
    downloadText(
      `cuaderno-lecta-${new Date().toISOString().slice(0, 10)}.txt`,
      wordsToAnkiTsv(filtered.filter((w) => !w.deleted), bookName),
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
        <h1 className="notebook-title">
          {learn ? "Aprender" : queue ? "Repaso" : "Cuaderno"}
        </h1>
        <span className="notebook-count">
          {learn
            ? `${Math.min(learn.total - learn.items.length + 1, learn.total)} de ${learn.total}`
            : queue
              ? `${Math.min(done + 1, queue.total)} de ${queue.total}`
              : words
                ? `${all.length} guardadas · ${dueCount} para hoy`
                : ""}
        </span>
      </header>

      <div className="notebook-main">
        {!queue && !learn ? (
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
              data-active={tab === "quotes" || undefined}
              aria-pressed={tab === "quotes"}
              onClick={() => setTab("quotes")}
            >
              Citas
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

        {tab === "activity" && !queue && !learn ? (
          <ReadingActivity books={books} words={all} activityVersion={activityVersion} />
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

        {tab === "words" && !queue && !learn ? <GamePanel /> : null}

        {(tab === "words" || queue) && !learn ? (
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

            {dueCount > 0 ? (
              <section className="nb-review" aria-label="Repaso de hoy">
                <p className="eyebrow">Repasar hoy · {dueCount}</p>
                {mixCount > 0 ? (
                  <>
                    <div className="practice-modes" role="group" aria-label="Modo de repaso">
                      <button type="button" className="btn btn--primary" onClick={startMix}>
                        Repasar hoy
                      </button>
                    </div>
                    <details className="practice-more">
                      <summary className="meta">Elegir un tipo de ejercicio específico</summary>
                      <div className="practice-modes practice-modes--sub" role="group" aria-label="Ejercicios específicos">
                        {MODES.map(({ id, label, needs }) => {
                          const count = eligibleDue(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              className="btn"
                              disabled={count === 0}
                              title={count === 0 ? `Sin pendientes con ${needs}` : undefined}
                              onClick={() => void startPractice(id)}
                            >
                              {label} · {count}
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  </>
                ) : (
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
                          onClick={() => void startPractice(id)}
                        >
                          {label} · {count}
                        </button>
                      );
                    })}
                  </div>
                )}
                {practiceNote ? <p className="meta">{practiceNote}</p> : null}
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
                  Pasajes CSV
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
                                {isLearnPending(word, knownKeys, exposure) ? (
                                  <button
                                    type="button"
                                    className="btn--quiet"
                                    aria-label={`Aprender ${word.form}`}
                                    onClick={() => startLearn(word)}
                                  >
                                    Aprender
                                  </button>
                                ) : null}
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
              <p className="meta nb-practice-meta">Primera exposición</p>
              <div className="index-card nb-card">
                <p className="nb-card-front">
                  <strong>{learn.items[0].form}</strong>
                  {learn.items[0].pos ? (
                    <span className="card-pos"> · {learn.items[0].pos}</span>
                  ) : null}
                </p>
                {learn.items[0].lemma && learn.items[0].lemma !== learn.items[0].form ? (
                  <p className="meta">de «{learn.items[0].lemma}»</p>
                ) : null}
                {learn.items[0].context ? (
                  <p className="card-context">“{learn.items[0].context}”</p>
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
              Modo {MODES.find((m) => m.id === current.mode)?.label.toLowerCase()}
            </p>

            {current.mode === "match" ? (
              <>
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
                      >
                        {item.word.meaning}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="meta nb-keys-hint">Toca una palabra y luego su significado.</p>
              </>
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
                  {current.mode === "choose" ? (
                    <>
                      <p className="card-context">“{cloze}”</p>
                      <p className="meta">Toca la palabra que falta.</p>
                    </>
                  ) : current.mode === "context" ? (
                    <>
                      {/* La palabra NO se oculta: se mide reconocer el
                          sentido en una oración nueva del catálogo. */}
                      <p className="card-context">“{current.item?.sentence}”</p>
                      <p className="meta">
                        ¿Qué significa «{current.word.form}» en esta oración?
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="nb-card-front">
                        <strong>{current.word.form}</strong>
                        {current.word.pos ? (
                          <span className="card-pos"> · {current.word.pos}</span>
                        ) : null}
                      </p>
                      {current.word.context ? (
                        <p className="card-context">“{current.word.context}”</p>
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
                    <p className="card-context">
                      “{current.mode === "clozeNew" ? clozeNewText : cloze}”
                    </p>
                  ) : (
                    <>
                      <p className="nb-card-front">
                        <strong>{current.word.form}</strong>
                        {current.word.pos ? (
                          <span className="card-pos"> · {current.word.pos}</span>
                        ) : null}
                      </p>
                      {current.word.context ? (
                        <p className="card-context">“{current.word.context}”</p>
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
