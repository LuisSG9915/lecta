// Modelo puro del Cuaderno: tipos, constantes y reglas de clasificación,
// elegibilidad y búsqueda. Sin React ni efectos: lo comparten Vocabulary, los
// hooks de sesión y los componentes del Cuaderno.
import { isDue, Rating, type Card, type Grade } from "./fsrs-light";
import type { SavedWord } from "./idb";
import type { LexiconEntry, LexiconItem } from "./lexicon";
import { blankWordInContext, type AdaptiveChallenge } from "./practice";
import { isGrammarEligible, isSentenceEligible } from "./grammar";
import type { MarkLevel } from "./word-level";
import type { ReviewKind, ReviewRating } from "../../shared/reading-data";
import type { IconName } from "../components/Icon";

/** `verifyError` cuando la revisión IA pide Lecta+ (la tarjeta pinta PlanNote). */
export const VERIFY_PLAN_REQUIRED = "plan-required";

export type PracticeMode =
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
export type FilterId = (typeof FILTERS)[number]["id"];
export type OrderId = (typeof ORDERS)[number]["id"];

// Un item de la cola de repaso: la palabra y el modo con el que toca
// (en la mezcla «Repasar hoy» cada una puede traer un modo distinto).
// «sense» además carga la ficha completa y el índice de su acepción;
// «context» y «clozeNew» cargan el ítem de ejercicio del catálogo.
export type QueueItem = {
  word: SavedWord;
  mode: PracticeMode;
  entry?: LexiconEntry;
  correctIndex?: number;
  item?: LexiconItem;
  adaptiveChallenge?: AdaptiveChallenge;
};

export const MODES: { id: PracticeMode; label: string }[] = [
  { id: "meaning", label: "Significado" },
  { id: "form", label: "Palabra" },
  { id: "cloze", label: "Oración" },
  { id: "choose", label: "Elegir palabra" },
  { id: "match", label: "Parejas" },
  { id: "scramble", label: "Descifrar" },
  { id: "grammar", label: "Categoría" },
  { id: "syntax", label: "Ordenar frase" },
  { id: "sense", label: "Acepción" },
  { id: "context", label: "Contexto" },
  { id: "clozeNew", label: "Oración nueva" },
  { id: "write", label: "Escribir" },
];

// Modos que no usan la autovaloración Espacio/1–4: los de opciones se
// responden con sus botones y «escribir» tiene el foco en el textarea.
export const EXERCISE_MODES: ReadonlySet<PracticeMode> = new Set([
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
export const MATCH_TANDA = 4;

// Modos de práctica ya construidos que no caben en la fila principal
// de «Elegir modo libre»: se despliegan con «Más formas de practicar». Todos
// salen de reviewWords — nunca de palabras sin exponer.
/**
 * Modos que gastan IA o catálogo de pago: en free quedan apagados con
 * PlanNote. El resto (hueco, descifrar, ordenar, parejas, significado,
 * palabra, elegir, categoría) es local y libre.
 */
export const PLUS_ONLY_MODES: readonly PracticeMode[] = ["sense", "context", "clozeNew"];
export const isPlusOnlyMode = (mode: PracticeMode): boolean => PLUS_ONLY_MODES.includes(mode);

export const EXTRA_MODES: {
  id: PracticeMode;
  name: string;
  hint: string;
  icon: IconName;
}[] = [
  { id: "meaning", name: "Significado", hint: "Significado → palabra", icon: "quote" },
  { id: "form", name: "Palabra", hint: "Palabra → significado", icon: "notebook" },
  { id: "choose", name: "Elegir palabra", hint: "Completa el hueco", icon: "search" },
  { id: "grammar", name: "Categoría", hint: "Rol en la frase", icon: "sliders" },
  { id: "sense", name: "Acepción", hint: "Elige el sentido", icon: "bookmark" },
  { id: "context", name: "Contexto", hint: "Oración nueva (IA)", icon: "book" },
  { id: "clozeNew", name: "Oración nueva", hint: "Escribe el hueco (IA)", icon: "sparkle" },
  { id: "write", name: "Escribir", hint: "Frase propia", icon: "highlight" },
];

// Modo de repaso → tipo de anotación en el historial (reviews.kind).
export const KIND_BY_MODE: Record<PracticeMode, ReviewKind> = {
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
export const mapMode = (mode: PracticeMode): ReviewKind => KIND_BY_MODE[mode];

// Calificación FSRS → valor del historial (reviews.rating).
export const ratingString = (rating: Grade): ReviewRating => {
  if (rating === Rating.Again) return "again";
  if (rating === Rating.Hard) return "hard";
  if (rating === Rating.Easy) return "easy";
  return "good";
};

// `seedFor` vive en practice.ts (junto a shuffleStable); se reexporta aquí
// para sus importadores de siempre.
export { seedFor } from "./practice";

export const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: "Otra vez", key: "1" },
  { rating: Rating.Hard, label: "Difícil", key: "2" },
  { rating: Rating.Good, label: "Bien", key: "3" },
  { rating: Rating.Easy, label: "Fácil", key: "4" },
];

export const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "due", label: "Para hoy" },
  { id: "new", label: "Nuevas" },
  { id: "learning", label: "En Práctica" },
  { id: "settled", label: "Dominadas" },
] as const;

export const ORDERS = [
  { id: "fecha", label: "Fecha" },
  { id: "libro", label: "Libro" },
  { id: "estado", label: "Estado" },
] as const;

export const GROUP_PAGE = 50;
export const UNDO_MS = 5000;

// Sanitiza valores de estabilidad provenientes de tarjetas importadas o remotas
export function safeStability(s: unknown): number {
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0;
}

// Nivel de estabilidad FSRS en 4 segmentos para el indicador visual (Hueco 3.2)
export function getStabilitySegments(s: unknown): number {
  const clean = safeStability(s);
  if (clean >= 14) return 4;
  if (clean >= 7) return 3;
  if (clean >= 2) return 2;
  if (clean > 0.5) return 1;
  return 0;
}

// Ciclo de vida de una palabra en el cuaderno: UNA sola clasificación para las
// píldoras del héroe, los filtros, las filas y el encabezado («por aprender»),
// así sus números siempre cuadran.
//   pending → todavía no pasó por la ficha de «Aprender» (isLearnPending): es
//             exactamente lo que el encabezado llama «por aprender».
//   known   → declarada «ya la conozco»: no se examina ni se repasa.
export type WordLifecycle = { pending: boolean; known: boolean };

//   new       → sin exponer (la misma cuenta que «por aprender»)
//   learning  → ya presentada y en práctica (S < 14 días, o sin repasos aún)
//   settled   → dominada (S ≥ 14 días) o declarada conocida
// «due» no es una etapa sino un estado de agenda: se superpone a «learning» y
// «settled» (una dominada puede tocar repaso hoy), nunca a «new» ni a las
// conocidas.
export type WordStage = "new" | "learning" | "settled";
export const wordStage = (word: SavedWord, life: WordLifecycle): WordStage => {
  if (life.pending) return "new";
  if (life.known) return "settled";
  return safeStability(word.card?.stability) >= 14 ? "settled" : "learning";
};

// Etiqueta de estado de cada FILA (en singular: es una palabra) según el ciclo
// de vida y la estabilidad FSRS (S). Los plurales («Nuevas», «Dominadas») son
// de las píldoras y los filtros, que cuentan palabras.
export const stateOf = (
  word: SavedWord,
  life: WordLifecycle,
): { label: string; level: MarkLevel | "due" } => {
  const stage = wordStage(word, life);
  if (stage === "new") return { label: "Nueva", level: "new" };
  if (!life.known && isDue(word.card)) return { label: "Para hoy", level: "due" };
  if (stage === "learning") return { label: "En Práctica", level: "learning" };
  return { label: "Dominada", level: "settled" };
};

export const STATE_RANK: Record<string, number> = { due: 0, new: 1, learning: 2, settled: 3 };

export const matchesFilter = (
  word: SavedWord,
  filter: FilterId,
  life: WordLifecycle,
): boolean => {
  if (filter === "all") return true;
  if (filter === "due") return !life.pending && !life.known && isDue(word.card);
  return wordStage(word, life) === filter;
};

export const RETENTION_CHECK_MIN_AGE_DAYS = 30;

export const retentionCheckAged = (card: Card | undefined, now = new Date()) =>
  card?.last_review != null &&
  new Date(card.last_review).getTime() <= now.getTime() - RETENTION_CHECK_MIN_AGE_DAYS * 86_400_000;

export const clozeTextFor = (word: SavedWord) =>
  word.context ? blankWordInContext(word.context, word.form, word.language) : null;

// Cada modo necesita su materia prima: no repasar «significado» sin
// significado guardado ni «oración» sin contexto donde ocultar la
// palabra. «sense» pide una acepción guardada; que la ficha tenga
// varias se comprueba al armar la cola (necesita conexión). Los modos
// B «contexto» y «oración nueva» piden la acepción completa (entryId
// + senseOrder): el conteo muestra candidatas y las que no tengan
// ítem caen al armar la cola, igual que «acepción».
export const isEligible = (word: SavedWord, mode: PracticeMode) => {
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

export const norm = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Texto normalizado de cada palabra, calculado una vez por lista (no por tecla).
export const searchHaystack = (word: SavedWord) =>
  norm([word.form, word.lemma, word.meaning, word.context].filter(Boolean).join(" "));

export const matchesQuery = (haystack: string, query: string) => {
  if (!query) return true;
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
};

// Origen de la palabra para el filtro del Cuaderno: se deduce del
// mediaKind del libro local al que pertenece (las obras de pantalla
// no suben a la nube, así que el mapa solo existe en este dispositivo).
// Sin libro local o sin mediaKind → «Libros», que es el caso común.
export type WordOrigin = "books" | "series" | "movies";

export const wordOrigin = (
  word: Pick<SavedWord, "bookHash">,
  mediaKindByHash: ReadonlyMap<string, "movie" | "tv">,
): WordOrigin => {
  const kind = word.bookHash
    ? mediaKindByHash.get(word.bookHash)
    : undefined;
  if (kind === "tv") return "series";
  if (kind === "movie") return "movies";
  return "books";
};

