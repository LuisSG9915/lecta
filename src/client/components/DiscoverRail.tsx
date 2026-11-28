import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverPalette } from "../lib/cover";
import {
  catalogCoverUrl,
  catalogVocab,
  describeCatalogBook,
  ENGLISH_LADDER_TIERS,
  englishLadderTier,
  entriesByFormOf,
  formatBookLength,
  formatCoverageScannerSummary,
  getBookAffinityBadge,
  getBookMoodTags,
  isShortStory,
  listCatalog,
  manifestBookForms,
  type CatalogBook,
  type EnglishLadderTier,
} from "../lib/catalog";
import { normalizeSearchText } from "../lib/search-text";
import { getLanguageTheta } from "../lib/profile-models";
import {
  compareBookCoverages,
  coverageIsReliable,
  coverageLanguageOf,
  coverageOfBook,
  COVERAGE_UNMEASURED_LABEL,
  createCoverageInputsLoader,
  inputsForCoverage,
  type BookCoverage,
  type CoverageInputs,
} from "../lib/coverage";
import { captureDbScope, type DbScope } from "../lib/idb";
import Sheet from "./Sheet";
import type { ShelfItem } from "./Shelf";

// «Descubre»: el riel del catálogo público bajo la estantería. Nunca
// bloquea — sin índice (ni red ni caché) la sección entera no se
// pinta. Las coberturas se calculan en local con el manifiesto de cada
// libro, traídos de uno en uno para no competir con la lectura; con
// saveData no se piden y las tarjetas se muestran sin insignia.

type DiscoverRailProps = {
  // La estantería visible: `epubSha256` del ítem del catálogo casa con
  // el hash del libro guardado → la tarjeta ofrece «Abrir» en vez de
  // «Obtener», sin descargar para comprobarlo.
  library: ShelfItem[];
  onOpen: (book: ShelfItem) => void;
  // «Obtener»: el padre baja el EPUB y lo pasa al flujo normal de
  // añadir libro (misma validación, dedup y sincronización).
  // Puede resolver con el hash del libro guardado (lo ignora aquí;
  // «Más clásicos» lo usa para ofrecer «Abrir»).
  onGet: (item: CatalogBook) => Promise<unknown> | void;
  // Inyectables para pruebas. loadInputs puede devolver null: sin
  // perfil medible (o sin red) el riel queda sin insignias.
  fetchIndex?: typeof listCatalog;
  fetchVocab?: typeof catalogVocab;
  loadInputs?: (
    language: string,
    scope?: DbScope,
  ) => Promise<CoverageInputs | null>;
  // Sube al cerrar la calibración o al guardar palabras: las coberturas
  // ya medidas se recalculan con el perfil nuevo sin re-bajar manifiestos.
  vocabVersion?: number;
  // Búsqueda controlada por el padre («Libros gratuitos» tiene un solo
  // campo para este riel y para Gutenberg): si viene definida no se
  // pinta el input propio y una búsqueda sin coincidencias oculta la
  // sección entera para dejar el lugar a los clásicos.
  query?: string;
};

// El riel muestra esta franja; «Ver todos» despliega el resto en
// cuadrícula y solo entonces se miden las coberturas que faltan.
const DISCOVER_RAIL_LIMIT = 12;

type CoverageSource = {
  forms: string[];
  entriesByForm: ReturnType<typeof entriesByFormOf>;
  occurrences?: Record<string, number>;
};

export const DISCOVER_MOOD_FILTERS = [
  "Todos",
  "Lecturas de 10 min",
  "Cuentos y teatro",
  "Poesía y Modernismo",
  "Vocabulario Elevado",
];

// «Ritmo» = la misma afinidad que pinta la tarjeta (cobertura medida si
// ya llegó; si no, la dificultad/θ del idioma). El valor filtra por tono.
export const DISCOVER_PACE_FILTERS = [
  { value: "all", label: "Todo ritmo" },
  { value: "relaxed", label: "Lectura relajada" },
  { value: "ideal", label: "Ideal para tu ritmo" },
  { value: "supported", label: "Con apoyo" },
] as const;

type PaceFilter = (typeof DISCOVER_PACE_FILTERS)[number]["value"];

export default function DiscoverRail({
  library,
  onOpen,
  onGet,
  fetchIndex = listCatalog,
  fetchVocab = catalogVocab,
  loadInputs = inputsForCoverage,
  vocabVersion = 0,
  query: controlledQuery,
}: DiscoverRailProps) {
  const [books, setBooks] = useState<CatalogBook[] | null>(null);
  const [coverages, setCoverages] = useState<Map<string, BookCoverage>>(
    new Map(),
  );
  const [confidenceByLang, setConfidenceByLang] = useState<
    Map<string, CoverageInputs["confidence"]>
  >(new Map());
  const [getting, setGetting] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [coverBroken, setCoverBroken] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<string>("Todos");
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);
  const [englishTier, setEnglishTier] = useState<EnglishLadderTier | "all">("all");
  const [paceFilter, setPaceFilter] = useState<PaceFilter>("all");
  const [previewBook, setPreviewBook] = useState<CatalogBook | null>(null);
  const [previewExamples, setPreviewExamples] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  // Con `query` controlada el texto viene del buscador compartido de
  // la pestaña; sin ella se usa el estado interno de siempre.
  const effectiveQuery = controlledQuery ?? query;
  const cancelledRef = useRef(false);
  const sourcesRef = useRef(new Map<string, CoverageSource>());
  const inputsByLangRef = useRef(new Map<string, CoverageInputs>());
  const attemptedRef = useRef(new Set<string>());
  const inputsLoaderRef = useRef<{
    version: number;
    load: NonNullable<DiscoverRailProps["loadInputs"]>;
    loader: ReturnType<typeof createCoverageInputsLoader>;
  } | null>(null);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void fetchIndex(scope).then((index) => {
      if (cancelled || !index?.books.length) return;
      setBooks(index.books);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchIndex]);

  // Perfil de cobertura: un cargador por (vocabVersion, loadInputs) para
  // no releer IndexedDB en cada cambio de filtro ni al recorrer el
  // catálogo; al subir vocabVersion se crea uno nuevo y se recalcula.
  const getInputsLoader = useCallback(() => {
    const current = inputsLoaderRef.current;
    if (
      !current ||
      current.version !== vocabVersion ||
      current.load !== loadInputs
    ) {
      const loader = createCoverageInputsLoader(captureDbScope(), loadInputs);
      inputsLoaderRef.current = {
        version: vocabVersion,
        load: loadInputs,
        loader,
      };
      return loader;
    }
    return current.loader;
  }, [vocabVersion, loadInputs]);

  // Filtrado por tag / estado de ánimo y búsqueda (título o autor), en
  // el orden curado del índice: es la base estable de qué medir y qué
  // pintar; el orden final lo decide `ordered` con las coberturas.
  const baseFiltered = useMemo(() => {
    if (!books) return [];
    const q = normalizeSearchText(effectiveQuery);
    return books.filter(
      (b) =>
        (activeFilter === "Todos" ||
          (activeFilter === "Lecturas de 10 min"
            ? isShortStory(b)
            : getBookMoodTags(b).includes(activeFilter))) &&
        (!languageFilter || coverageLanguageOf(b.language) === languageFilter) &&
        (!q ||
          normalizeSearchText(b.title).includes(q) ||
          normalizeSearchText(b.author).includes(q)),
    );
  }, [books, activeFilter, languageFilter, effectiveQuery]);

  // Idiomas presentes en TODO el índice (no solo lo filtrado): las
  // píldoras de idioma solo aparecen cuando hay más de uno.
  const catalogLanguages = useMemo(() => {
    if (!books) return [];
    return [
      ...new Set(books.map((book) => coverageLanguageOf(book.language))),
    ].sort();
  }, [books]);

  const thetaByLang = useMemo(() => {
    const map = new Map<string, number>();
    for (const lang of catalogLanguages) map.set(lang, getLanguageTheta(lang));
    return map;
  }, [catalogLanguages]);

  // Mismo criterio que la tarjeta: cobertura medida si el perfil la
  // sostiene; si no, la dificultad/θ del idioma. Se usa para el filtro
  // de ritmo sin duplicar la lógica de la insignia.
  const affinityTone = useCallback(
    (book: CatalogBook) => {
      const lang = coverageLanguageOf(book.language);
      const coverage = coverages.get(book.id);
      const confidence = confidenceByLang.get(lang) ?? "low";
      const value =
        coverage && confidence !== "low" ? coverage.percent : book.difficulty;
      return getBookAffinityBadge(
        book.language || "es",
        value,
        thetaByLang.get(lang) ?? getLanguageTheta(lang),
      ).tone;
    },
    [coverages, confidenceByLang, thetaByLang],
  );

  // Solo se miden los libros que el lector puede ver: la franja del
  // riel o, al desplegar la cuadrícula, todo lo filtrado. El conjunto
  // no depende de las coberturas, así que medir no reordena el objetivo.
  const coverageTargets = useMemo(
    () => (expanded ? baseFiltered : baseFiltered.slice(0, DISCOVER_RAIL_LIMIT)),
    [baseFiltered, expanded],
  );

  // Trae los manifiestos que faltan de los objetivos visibles y mide
  // cada uno en cuanto llega. De uno en uno y con guarda saveData para
  // no competir con la lectura; un manifiesto fallido no apaga el resto.
  useEffect(() => {
    if (!books?.length || coverageTargets.length === 0) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const scope = captureDbScope();
    const inputsFor = getInputsLoader();
    void (async () => {
      for (const book of coverageTargets) {
        if (cancelled) return;
        if (sourcesRef.current.has(book.id) || attemptedRef.current.has(book.id)) {
          continue;
        }
        const lang = coverageLanguageOf(book.language);
        const inputs = await inputsFor(lang);
        if (cancelled) return;
        // Sin perfil medible no se gasta la descarga del manifiesto ni
        // se marca como intentado: si vocabVersion trae evidencia nueva,
        // este mismo libro vuelve a la cola y sí se mide.
        if (!inputs) continue;
        inputsByLangRef.current.set(lang, inputs);
        if (!cancelledRef.current)
          setConfidenceByLang((prev) =>
            prev.get(lang) === inputs.confidence
              ? prev
              : new Map(prev).set(lang, inputs.confidence),
          );
        attemptedRef.current.add(book.id);
        const manifest = await fetchVocab(book.id, scope).catch(() => null);
        if (cancelled) return;
        // Un manifiesto que no baja no apaga el resto del riel.
        if (!manifest) continue;
        const source: CoverageSource = {
          forms: manifestBookForms(manifest),
          entriesByForm: entriesByFormOf(manifest),
          occurrences: manifest.occurrences,
        };
        sourcesRef.current.set(book.id, source);
        const coverage = coverageOfBook(
          source.forms,
          source.entriesByForm,
          inputs,
          source.occurrences,
        );
        if (cancelled) return;
        setCoverages((prev) => {
          const next = new Map(prev);
          next.set(book.id, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [books, coverageTargets, fetchVocab, getInputsLoader]);

  // Al cambiar vocabVersion (o el cargador de perfil) se recalculan las
  // coberturas con los manifiestos ya en memoria: sin red y sin perder
  // el orden estable del catálogo.
  useEffect(() => {
    if (!books?.length || sourcesRef.current.size === 0) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const inputsFor = getInputsLoader();
    void (async () => {
      const bookById = new Map(books.map((book) => [book.id, book]));
      for (const [id, source] of sourcesRef.current) {
        if (cancelled) return;
        const book = bookById.get(id);
        if (!book) continue;
        const lang = coverageLanguageOf(book.language);
        const inputs = await inputsFor(lang);
        if (cancelled) return;
        if (!inputs) continue;
        inputsByLangRef.current.set(lang, inputs);
        if (!cancelledRef.current)
          setConfidenceByLang((prev) =>
            prev.get(lang) === inputs.confidence
              ? prev
              : new Map(prev).set(lang, inputs.confidence),
          );
        const coverage = coverageOfBook(
          source.forms,
          source.entriesByForm,
          inputs,
          source.occurrences,
        );
        if (cancelled) return;
        setCoverages((prev) => {
          const next = new Map(prev);
          next.set(id, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [books, getInputsLoader]);

  const ownedByHash = useMemo(
    () => new Map(library.map((book) => [book.hash, book])),
    [library],
  );

  // Orden: con insignia medida primero, de más cobertura a menos; los
  // demás conservan el orden curado del índice.
  const ordered = useMemo(() => {
    if (!books) return [];
    const measured: CatalogBook[] = [];
    const rest: CatalogBook[] = [];
    for (const book of books) {
      (coverages.has(book.id) ? measured : rest).push(book);
    }
    measured.sort((a, b) =>
      compareBookCoverages(coverages.get(a.id)!, coverages.get(b.id)!),
    );
    return [...measured, ...rest];
  }, [books, coverages]);

  const baseFilteredIds = useMemo(
    () => new Set(baseFiltered.map((book) => book.id)),
    [baseFiltered],
  );
  const filtered = useMemo(
    () =>
      ordered.filter(
        (book) =>
          baseFilteredIds.has(book.id) &&
          (paceFilter === "all" || affinityTone(book) === paceFilter) &&
          (languageFilter !== "en" ||
            englishTier === "all" ||
            englishLadderTier(book, coverages.get(book.id)) === englishTier),
      ),
    [ordered, baseFilteredIds, paceFilter, affinityTone, languageFilter, englishTier, coverages],
  );
  const visible = expanded ? filtered : filtered.slice(0, DISCOVER_RAIL_LIMIT);

  if (!books) return null;
  // Con búsqueda controlada y sin coincidencias en el catálogo
  // curado, esta sección cede el lugar a «Más clásicos» en vez de
  // mostrar un vacío redundante bajo el mismo campo de búsqueda.
  if (
    controlledQuery != null &&
    controlledQuery.trim() !== "" &&
    filtered.length === 0
  ) {
    return null;
  }

  const get = async (book: CatalogBook, closePreview = false) => {
    if (getting) return;
    setGetting(book.id);
    setErrorId(null);
    try {
      await onGet(book);
      if (closePreview) setPreviewBook(null);
    } catch {
      if (!cancelledRef.current) setErrorId(book.id);
    } finally {
      if (!cancelledRef.current) setGetting(null);
    }
  };

  // Presentación compartida entre la tarjeta y la hoja de vista previa:
  // una sola fuente para cobertura, afinidad, portada y datos duros.
  const viewOf = (book: CatalogBook) => {
    const coverage = coverages.get(book.id);
    const owned = book.epubSha256
      ? ownedByHash.get(book.epubSha256)
      : undefined;
    const lang = coverageLanguageOf(book.language);
    const confidence = confidenceByLang.get(lang) ?? "low";
    const palette = coverPalette(book.id);
    const showCover = book.cover && !coverBroken.has(book.id);
    const userTheta =
      thetaByLang.get(lang) ?? getLanguageTheta(book.language || "es");
    const affinity = getBookAffinityBadge(
      book.language || "es",
      coverage && confidence !== "low" ? coverage.percent : book.difficulty,
      userTheta,
    );
    const facts = [
      book.language?.slice(0, 2).toUpperCase(),
      formatBookLength(book.wordCount),
    ]
      .filter(Boolean)
      .join(" · ");
    return { coverage, owned, confidence, palette, showCover, affinity, facts };
  };

  // Lemas del Cuaderno presentes en el libro, solo si el manifiesto y
  // el perfil ya están en memoria (la vista previa no baja nada). Lee
  // refs: solo puede llamarse desde efectos/handlers, nunca en render.
  const cuadernoExamples = (book: CatalogBook): string[] => {
    const source = sourcesRef.current.get(book.id);
    const inputs = inputsByLangRef.current.get(
      coverageLanguageOf(book.language),
    );
    if (!source || !inputs) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const form of source.forms) {
      for (const entry of source.entriesByForm[form] ?? []) {
        const lemma = entry.lemma?.toLowerCase();
        if (!lemma || seen.has(lemma)) continue;
        if (inputs.saved.has(form) || inputs.saved.has(lemma)) {
          seen.add(lemma);
          out.push(entry.lemma);
          if (out.length >= 5) return out;
        }
      }
    }
    return out;
  };

  const previewView = previewBook ? viewOf(previewBook) : null;
  const previewScannerSummary =
    previewBook && previewView?.coverage && coverageIsReliable(previewView.coverage)
      ? formatCoverageScannerSummary(previewView.coverage, previewBook.wordCount)
      : null;

  // Abre la vista previa calculando los ejemplos del Cuaderno en el
  // handler: los refs ya están llenos cuando el lector toca la tarjeta.
  const openPreview = (book: CatalogBook) => {
    setPreviewExamples(cuadernoExamples(book));
    setPreviewBook(book);
  };

  return (
    <section aria-label="Descubre" className="discover">
      <div className="discover-head">
        <h2 className="eyebrow shelf-eyebrow">Descubre</h2>
        <div className="discover-filters" role="group" aria-label="Filtros de catálogo">
          {DISCOVER_MOOD_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`discover-filter-pill${activeFilter === filter ? " discover-filter-pill--active" : ""}`}
              onClick={() => setActiveFilter(filter)}
              aria-pressed={activeFilter === filter}
            >
              {filter}
            </button>
          ))}
          {catalogLanguages.includes("en") ? (
            <button
              type="button"
              className={`discover-filter-pill${languageFilter === "en" ? " discover-filter-pill--active" : ""}`}
              onClick={() => {
                setLanguageFilter(languageFilter === "en" ? null : "en");
                setEnglishTier("all");
              }}
              aria-pressed={languageFilter === "en"}
            >
              Escalera en inglés
            </button>
          ) : null}
        </div>
      </div>

      {/* Idioma y ritmo son filtros secundarios: viven plegados en
          «Más filtros» para que la pestaña no apile cinco filas de
          píldoras. El estado de ánimo queda visible porque es la
          selección editorial principal del riel. */}
      <details className="discover-more-filters">
        <summary className="meta">
          Más filtros
          {languageFilter !== null || paceFilter !== "all"
            ? ` · ${
                (languageFilter !== null ? 1 : 0) +
                (paceFilter !== "all" ? 1 : 0)
              } activo${
                (languageFilter !== null ? 1 : 0) +
                  (paceFilter !== "all" ? 1 : 0) ===
                1
                  ? ""
                  : "s"
              }`
            : ""}
        </summary>
        <div className="discover-more-filters-content">
          {catalogLanguages.length > 1 ? (
            <div
              className="discover-filters"
              role="group"
              aria-label="Filtrar por idioma"
            >
              <button
                type="button"
                className={`discover-filter-pill${languageFilter === null ? " discover-filter-pill--active" : ""}`}
                aria-pressed={languageFilter === null}
                onClick={() => {
                  setLanguageFilter(null);
                  setEnglishTier("all");
                }}
              >
                Todos
              </button>
              {catalogLanguages.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`discover-filter-pill${languageFilter === lang ? " discover-filter-pill--active" : ""}`}
                  aria-pressed={languageFilter === lang}
                  onClick={() => {
                    setLanguageFilter(lang);
                    setEnglishTier("all");
                  }}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className="discover-filters"
            role="group"
            aria-label="Filtrar por ritmo"
          >
            {DISCOVER_PACE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`discover-filter-pill${paceFilter === filter.value ? " discover-filter-pill--active" : ""}`}
                aria-pressed={paceFilter === filter.value}
                onClick={() => setPaceFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </details>

      {languageFilter === "en" ? (
        <div
          className="discover-filters discover-english-ladder"
          role="group"
          aria-label="Escalera de inglés"
        >
          <button
            type="button"
            className={`discover-filter-pill${englishTier === "all" ? " discover-filter-pill--active" : ""}`}
            aria-pressed={englishTier === "all"}
            onClick={() => setEnglishTier("all")}
          >
            Todos los niveles
          </button>
          {ENGLISH_LADDER_TIERS.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className={`discover-filter-pill${englishTier === tier.id ? " discover-filter-pill--active" : ""}`}
              aria-pressed={englishTier === tier.id}
              onClick={() => setEnglishTier(tier.id)}
            >
              {tier.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="discover-toolbar">
        {controlledQuery === undefined ? (
          <input
            type="search"
            className="shelf-community-search"
            placeholder="Buscar por título o autor"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar en libros gratuitos"
          />
        ) : null}
        {filtered.length > DISCOVER_RAIL_LIMIT ? (
          <button
            type="button"
            className="btn--quiet discover-view-toggle"
            aria-pressed={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "Ver en riel" : `Ver todos (${filtered.length})`}
          </button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <p className="meta">Sin libros que coincidan con la búsqueda.</p>
      ) : null}

      <ul className={`discover-rail${expanded ? " discover-rail--grid" : ""}`}>
        {visible.map((book) => {
          const { coverage, owned, palette, showCover, affinity, facts } =
            viewOf(book);
          return (
            <li key={book.id} className="discover-book">
              <button
                type="button"
                className="discover-cover discover-cover--action"
                onClick={() => openPreview(book)}
                aria-label={`Ver vista previa de ${book.title}`}
              >
                {showCover ? (
                  <img
                    className="cover"
                    src={catalogCoverUrl(book.id)}
                    alt=""
                    loading="lazy"
                    onError={() =>
                      setCoverBroken((prev) => new Set(prev).add(book.id))
                    }
                  />
                ) : (
                  <span
                    className="cover cover--generated"
                    role="img"
                    aria-label={`Portada de ${book.title}`}
                    style={
                      {
                        "--cover-paper": palette.paper,
                        "--cover-ink": palette.ink,
                        "--cover-accent": palette.accent,
                      } as React.CSSProperties
                    }
                  >
                    <span className="cover-frame">
                      <span className="cover-title">{book.title}</span>
                      <span className="cover-ornament" aria-hidden="true" />
                      <span className="cover-author">{book.author}</span>
                    </span>
                  </span>
                )}
                {coverage ? (
                  coverageIsReliable(coverage) ? (
                    <span
                      className="discover-badge"
                      title={`Conoces aproximadamente el ${coverage.percent}% del vocabulario de este libro`}
                    >
                      ~{coverage.percent}%
                    </span>
                  ) : (
                    <span
                      className="discover-badge"
                      title="El catálogo aún no puede medir la mayoría de las palabras de este libro"
                    >
                      {COVERAGE_UNMEASURED_LABEL}
                    </span>
                  )
                ) : null}
              </button>
              <div className="discover-meta">
                {/* Una sola etiqueta por libro (la afinidad personalizada):
                    con dos o tres apiladas los títulos y botones «Obtener»
                    del riel quedaban desalineados entre columnas. La
                    categoría sigue accesible en los filtros de arriba. */}
                <span
                  className="book-affinity-pill"
                  data-tone={affinity.tone}
                  title={affinity.description}
                >
                  {affinity.label}
                </span>
                <button
                  type="button"
                  className="discover-title discover-title--action"
                  title={book.title}
                  onClick={() => openPreview(book)}
                >
                  {book.title}
                </button>
                <p className="meta">{book.author}</p>
                {facts ? <p className="meta discover-facts">{facts}</p> : null}
                {coverage?.newWordsCount != null && coverage.newWordsCount > 0 ? (
                  <p className="meta discover-new-words">
                    +{coverage.newWordsCount} palabras útiles
                  </p>
                ) : null}
                {coverage?.reencuentrosCount != null && coverage.reencuentrosCount > 0 ? (
                  <p className="meta discover-reencuentros">
                    Repite {coverage.reencuentrosCount}{" "}
                    {coverage.reencuentrosCount === 1 ? "palabra" : "palabras"} de tu Herbario
                  </p>
                ) : null}
              </div>
              {owned ? (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => onOpen(owned)}
                >
                  Abrir
                </button>
              ) : (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => void get(book)}
                  disabled={getting !== null}
                >
                  {getting === book.id ? "Descargando…" : "Obtener"}
                </button>
              )}
              {errorId === book.id ? (
                <p className="meta" role="alert">
                  No se pudo descargar. Inténtalo de nuevo.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {previewBook && previewView ? (
        <Sheet
          label={`Vista previa de ${previewBook.title}`}
          onClose={() => setPreviewBook(null)}
        >
          <div className="discover-preview">
            <div className="discover-preview-cover">
              {previewView.showCover ? (
                <img
                  className="cover"
                  src={catalogCoverUrl(previewBook.id)}
                  alt={`Portada de ${previewBook.title}`}
                  onError={() =>
                    setCoverBroken((prev) =>
                      new Set(prev).add(previewBook.id),
                    )
                  }
                />
              ) : (
                <div
                  className="cover cover--generated"
                  role="img"
                  aria-label={`Portada de ${previewBook.title}`}
                  style={
                    {
                      "--cover-paper": previewView.palette.paper,
                      "--cover-ink": previewView.palette.ink,
                      "--cover-accent": previewView.palette.accent,
                    } as React.CSSProperties
                  }
                >
                  <span className="cover-frame">
                    <span className="cover-title">{previewBook.title}</span>
                    <span className="cover-ornament" aria-hidden="true" />
                    <span className="cover-author">{previewBook.author}</span>
                  </span>
                </div>
              )}
            </div>
            <div className="discover-preview-body">
              <span
                className="book-affinity-pill"
                data-tone={previewView.affinity.tone}
                title={previewView.affinity.description}
              >
                {previewView.affinity.label}
              </span>
              <h3 className="discover-preview-title">{previewBook.title}</h3>
              <p className="meta">{previewBook.author}</p>
              {previewView.facts ? (
                <p className="meta discover-facts">{previewView.facts}</p>
              ) : null}
              {previewBook.wordCount ? (
                <p className="meta discover-facts">
                  ≈ {previewBook.wordCount.toLocaleString("es-MX")} palabras
                </p>
              ) : null}
              {previewView.coverage ? (
                coverageIsReliable(previewView.coverage) ? (
                  <p className="meta discover-preview-coverage">
                    {previewScannerSummary ??
                      `~${previewView.coverage.percent}% del vocabulario ya lo conoces`}
                  </p>
                ) : (
                  <p className="meta discover-preview-coverage">
                    {COVERAGE_UNMEASURED_LABEL}
                  </p>
                )
              ) : null}
              {previewView.coverage?.newWordsCount != null &&
              previewView.coverage.newWordsCount > 0 ? (
                <p className="meta discover-new-words">
                  +{previewView.coverage.newWordsCount} palabras útiles
                  {previewScannerSummary ? " en todo el libro" : ""}
                </p>
              ) : null}
              {previewView.coverage?.reencuentrosCount != null &&
              previewView.coverage.reencuentrosCount > 0 ? (
                <p className="meta discover-reencuentros">
                  Repite {previewView.coverage.reencuentrosCount}{" "}
                  {previewView.coverage.reencuentrosCount === 1
                    ? "palabra"
                    : "palabras"}{" "}
                  de tu Herbario
                </p>
              ) : null}
              {previewExamples.length ? (
                <p className="meta discover-preview-cuaderno">
                  Del Herbario: {previewExamples.join(", ")}
                </p>
              ) : null}
              <p className="discover-preview-synopsis">
                {describeCatalogBook(previewBook)}
              </p>
              {previewView.owned ? (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => {
                    onOpen(previewView.owned!);
                    setPreviewBook(null);
                  }}
                >
                  Abrir
                </button>
              ) : (
                <button
                  type="button"
                  className="btn discover-action"
                  onClick={() => void get(previewBook, true)}
                  disabled={getting !== null}
                >
                  {getting === previewBook.id ? "Descargando…" : "Obtener libro"}
                </button>
              )}
              {errorId === previewBook.id ? (
                <p className="meta" role="alert">
                  No se pudo descargar. Inténtalo de nuevo.
                </p>
              ) : null}
            </div>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
