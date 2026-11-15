// Hook extraído de Vocabulary.tsx (Fase 5, V1): la vista del Herbario — filtros,
// orden, búsqueda, ámbito por idioma/libro — y las listas derivadas (palabras
// en ámbito, ciclo de vida, conteos, pendientes de ficha, agrupación por libro).
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  isDue,
} from "../lib/fsrs";
import {
  type SavedWord,
  type StoredBook,
} from "../lib/idb";
import {
  isLearnPending,
  isWordKnownBy,
  knownKeysFor,
} from "../lib/learn";
import { bookDisplayName } from "../lib/cover";
import {
  type FilterId,
  type OrderId,
  type WordOrigin,
  FILTERS,
  GROUP_PAGE,
  type WordLifecycle,
  wordOrigin,
  wordStage,
  stateOf,
  STATE_RANK,
  matchesFilter,
  searchHaystack,
  matchesQuery,
} from "../lib/notebook-model";



import type { KnownWord } from "../lib/idb";
import type { LearnExposure } from "../lib/learn";

export type UseHerbarioViewArgs = {
  /** Todas las palabras cargadas (vacío mientras carga). */
  all: SavedWord[];
  books: Pick<
    StoredBook,
    "hash" | "name" | "title" | "author" | "language" | "mediaKind"
  >[];
  knowledge: KnownWord[];
  exposure: LearnExposure;
  initialBookFilter?: string;
};

export function useHerbarioView({
  all,
  books,
  knowledge,
  exposure,
  initialBookFilter,
}: UseHerbarioViewArgs) {
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
  const [filter, setFilter] = useState<FilterId>("all");
  const [order, setOrder] = useState<OrderId>("fecha");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [bookFilter, setBookFilter] = useState<string>(initialBookFilter ?? "all");
  const [originFilter, setOriginFilter] = useState<WordOrigin | "all">("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Obras de pantalla instaladas en este dispositivo: el origen de una
  // palabra se deduce del mediaKind de su libro local (nunca del sync).
  const mediaKindByHash = useMemo(() => {
    const map = new Map<string, "movie" | "tv">();
    for (const book of books) {
      if (book.mediaKind) map.set(book.hash, book.mediaKind);
    }
    return map;
  }, [books]);
  const hasScreenWorks = mediaKindByHash.size > 0;
  // Si ya no queda ninguna obra de pantalla el grupo se oculta: el
  // filtro queda inerte en vez de vaciar la lista sin aviso.
  const effectiveOriginFilter = hasScreenWorks ? originFilter : "all";

  const scopedWords = useMemo(() => {
    return all.filter((word) => {
      if (languageFilter !== "all" && (word.language || "es") !== languageFilter) {
        return false;
      }
      if (bookFilter !== "all" && word.bookHash !== bookFilter) {
        return false;
      }
      if (
        effectiveOriginFilter !== "all" &&
        wordOrigin(word, mediaKindByHash) !== effectiveOriginFilter
      ) {
        return false;
      }
      return true;
    });
  }, [
    all,
    languageFilter,
    bookFilter,
    effectiveOriginFilter,
    mediaKindByHash,
  ]);

  const activeScoped = useMemo(() => scopedWords.filter((w) => !w.deleted), [scopedWords]);

  const knownKeys = useMemo(() => knownKeysFor(knowledge), [knowledge]);
  // Un lema declarado «ya la conozco» sale del vocabulario activo: ni
  // la cola de Aprender ni el repaso lo vuelven a ofrecer, aunque la
  // palabra siga listada en el cuaderno.
  const isWordKnown = useCallback(
    (word: SavedWord) => isWordKnownBy(word, knownKeys),
    [knownKeys],
  );

  // Ciclo de vida único de cada palabra (ver WordLifecycle): pendiente de
  // ficha, o declarada conocida. Lo comparten píldoras, filtros, filas y orden.
  const lifecycle = useCallback(
    (word: SavedWord): WordLifecycle => ({
      pending: isLearnPending(word, knownKeys, exposure),
      known: isWordKnown(word),
    }),
    [knownKeys, exposure, isWordKnown],
  );

  // Estadísticas de progreso del cuaderno: las píldoras del héroe
  // cuentan con la misma clasificación (wordStage) que los filtros y
  // las filas, así el número de cada píldora coincide con su filtro.
  const progressStats = useMemo(() => {
    let settled = 0;
    let learning = 0;
    let newWords = 0;

    for (const w of activeScoped) {
      const stage = wordStage(w, lifecycle(w));
      if (stage === "settled") settled += 1;
      else if (stage === "learning") learning += 1;
      else newWords += 1;
    }

    return { total: activeScoped.length, settled, learning, newWords };
  }, [activeScoped, lifecycle]);
  const nextDueTs = useMemo(() => {
    const futureTimestamps = scopedWords
      .filter((w) => !w.deleted && w.card?.due && !isDue(w.card) && !isWordKnown(w))
      .map((w) => new Date(w.card!.due).getTime());
    return futureTimestamps.length > 0 ? Math.min(...futureTimestamps) : null;
  }, [scopedWords, isWordKnown]);
  const learnPending = useMemo(
    () => scopedWords.filter((word) => isLearnPending(word, knownKeys, exposure)),
    [scopedWords, knownKeys, exposure],
  );

  const bookTitle = (hash: string | undefined) => {
    if (!hash) return "Sin libro";
    const found = books.find((item) => item.hash === hash);
    return found ? bookDisplayName(found) : "Libro que ya no está";
  };
  const bookAuthor = (hash: string | undefined) => {
    if (!hash) return undefined;
    const found = books.find((item) => item.hash === hash);
    return found?.author;
  };
  const bookName = (hash: string | undefined) =>
    hash ? bookTitle(hash) : undefined;
  // Título visible del libro de una palabra: el copiado al guardarla
  // o el que resuelve la estantería por hash. Sin ninguno, undefined
  // y la interfaz muestra el genérico «De tus lecturas recientes».
  const wordBookTitle = (word: SavedWord) =>
    word.bookTitle || bookName(word.bookHash);


  // La búsqueda se difiere: teclear no espera a recalcular la lista.
  const deferredQuery = useDeferredValue(query);
  const searchIndex = useMemo(
    () => new Map(scopedWords.map((word) => [word.key, searchHaystack(word)])),
    [scopedWords],
  );
  const filtered = useMemo(
    () =>
      scopedWords.filter(
        (word) =>
          matchesFilter(word, filter, lifecycle(word)) &&
          matchesQuery(searchIndex.get(word.key) ?? "", deferredQuery),
      ),
    [scopedWords, filter, lifecycle, searchIndex, deferredQuery],
  );

  const byForm = (a: SavedWord, b: SavedWord) => a.form.localeCompare(b.form, "es");
  const stateRank = useCallback(
    (word: SavedWord) =>
      STATE_RANK[stateOf(word, lifecycle(word)).level] ?? 3,
    [lifecycle],
  );

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
  }, [filtered, order, stateRank]);

  const shownWords = flatWords.slice(0, listLimit);

  const activeExtraFiltersCount =
    (languageFilter !== "all" ? 1 : 0) +
    (bookFilter !== "all" ? 1 : 0) +
    (effectiveOriginFilter !== "all" ? 1 : 0) +
    (order !== "fecha" ? 1 : 0);

  const filterCounts = useMemo(() => {
    const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, 0])) as Record<
      FilterId,
      number
    >;
    for (const word of activeScoped) {
      const life = lifecycle(word);
      for (const { id } of FILTERS) if (matchesFilter(word, id, life)) counts[id] += 1;
    }
    return counts;
  }, [activeScoped, lifecycle]);
  const countForFilter = (id: FilterId) => filterCounts[id];

  const toggle = (set: Set<string>, key: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };


  return {
    activeExtraFiltersCount,
    activeScoped,
    availableBooks,
    availableLanguages,
    bookAuthor,
    bookFilter,
    bookName,
    bookTitle,
    byForm,
    collapsed,
    countForFilter,
    deferredQuery,
    expanded,
    filter,
    filterCounts,
    filtered,
    flatWords,
    groupEntries,
    groups,
    hasScreenWorks,
    isWordKnown,
    knownKeys,
    languageFilter,
    learnPending,
    lifecycle,
    listLimit,
    nextDueTs,
    openWords,
    order,
    originFilter,
    progressStats,
    query,
    scopedWords,
    searchIndex,
    setBookFilter,
    setCollapsed,
    setExpanded,
    setFilter,
    setLanguageFilter,
    setListLimit,
    setOpenWords,
    setOrder,
    setOriginFilter,
    setQuery,
    shownWords,
    stateRank,
    toggle,
    toggleWordOpen,
    wordBookTitle,
  };
}

export type UseHerbarioViewResult = ReturnType<typeof useHerbarioView>;
