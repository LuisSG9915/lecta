// Sección «Comunidad» de la estantería (carga diferida): GUÍAS de
// vocabulario que otros lectores compartieron para acompañar la
// lectura en papel — nunca el libro electrónico (modelo A1: solo
// palabras, el EPUB no sale de la cuenta de quien lo compartió). Al
// adjuntar una, la estantería la muestra con el sello «Papel» y abre
// el índice del modo papel, jamás el lector.
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  attachCommunityBook,
  fetchBookGuide,
  listCommunityBooksResult,
  type CommunityBook,
  type CommunityBooksResult,
} from "../lib/books";
import { coverPalette } from "../lib/cover";
import { normalizeSearchText } from "../lib/search-text";
import { BOOK_GENRES } from "../../shared/book-genres";
import {
  paperGuideSessionKey,
  sanitizePaperBookGuide,
  type PaperBookGuide,
} from "../../shared/paper-guide";
import { ExploreCommunityEmptyContext } from "./ExploreShelf";
import Sheet from "./Sheet";
import type { ShelfItem } from "./Shelf";
import {
  captureDbScope,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "../lib/idb";
import { batchLookup, type LexiconEntry } from "../lib/lexicon";
import { getBookAffinityBadge } from "../lib/catalog";
import {
  coverageIsReliable,
  coverageLanguageOf,
  coverageOfBook,
  COVERAGE_UNMEASURED_LABEL,
  createCoverageInputsLoader,
  inputsForCoverage,
  type BookCoverage,
  type CoverageInputs,
} from "../lib/coverage";

// Misma forma que el manifiesto del catálogo: forma → fichas del léxico.
type GuideEntries = Record<string, LexiconEntry[]>;
const lookupGuideForms = async (
  forms: string[],
  language: string,
  scope?: DbScope,
): Promise<GuideEntries> => {
  const result = await batchLookup(forms, language, scope);
  return result.ok ? result.entries : {};
};

type Props = {
  /** Al adjuntar: el padre guarda la guía y refresca la estantería. */
  onAttached?: (hash: string, guide?: unknown) => void;
  /** Hashes de libros que el lector ya tiene en su estantería. */
  ownedHashes?: ReadonlySet<string>;
  /** Aviso cuando la comunidad terminó de cargar sin guías disponibles. */
  onEmpty?: () => void;
  /** Libros propios elegibles para compartir su guía de papel. */
  shareableBooks?: ShelfItem[];
  /** Publica la guía de papel de un libro propio (shared = true). */
  onShareBook?: (book: ShelfItem, genre: string) => Promise<void> | void;
  /** Inyectables para pruebas. */
  fetchBooks?: () => Promise<CommunityBooksResult>;
  fetchGuide?: (hash: string, scope?: DbScope) => Promise<unknown | null>;
  loadInputs?: (
    language: string,
    scope?: DbScope,
  ) => Promise<CoverageInputs | null>;
  lookupForms?: (
    forms: string[],
    language: string,
    scope?: DbScope,
  ) => Promise<GuideEntries>;
};

// La comunidad se muestra en riel; «Ver todos» abre la cuadrícula y solo
// entonces se hidratan guías/coberturas del resto (mismo criterio que
// Descubre para no competir con la lectura).
const COMMUNITY_RAIL_LIMIT = 12;

export default function CommunityShelf({
  onAttached,
  ownedHashes,
  onEmpty,
  shareableBooks,
  onShareBook,
  fetchBooks = listCommunityBooksResult,
  fetchGuide = fetchBookGuide,
  loadInputs = inputsForCoverage,
  lookupForms = lookupGuideForms,
}: Props) {
  const notifyEmptyFromContext = useContext(ExploreCommunityEmptyContext);
  const [books, setBooks] = useState<CommunityBook[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [attachedHashes, setAttachedHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [guides, setGuides] = useState<Record<string, PaperBookGuide | null>>(
    {},
  );
  const [coverages, setCoverages] = useState<Map<string, BookCoverage>>(
    new Map(),
  );
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBookSel, setShareBookSel] = useState<ShelfItem | null>(null);
  const [shareGenre, setShareGenre] = useState("");
  const [sharing, setSharing] = useState(false);
  const attemptedGuideRef = useRef(new Set<string>());
  const attemptedCoverageRef = useRef(new Set<string>());
  const inputsLoaderRef = useRef<{
    load: NonNullable<Props["loadInputs"]>;
    loader: ReturnType<typeof createCoverageInputsLoader>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchBooks()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(true);
          setBooks([]);
          return;
        }
        setLoadError(false);
        // Recarga (p. ej. tras compartir): las guías/coberturas ya
        // medidas pueden haber cambiado — se vuelven a pedir.
        attemptedGuideRef.current.clear();
        attemptedCoverageRef.current.clear();
        setBooks(res.books);
        if (res.books.length === 0) {
          onEmpty?.();
          notifyEmptyFromContext?.();
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setBooks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchBooks, reloadToken, onEmpty, notifyEmptyFromContext]);

  const retryLoad = () => {
    setLoadError(false);
    setBooks(null);
    setReloadToken((t) => t + 1);
  };

  const languages = useMemo(() => {
    if (!books) return [];
    return [...new Set(books.map((b) => b.language).filter(Boolean))].sort();
  }, [books]);

  // Géneros presentes en el orden fijo de BOOK_GENRES: las pills no
  // brincan de lugar cuando cambia el catálogo.
  const genres = useMemo(() => {
    if (!books) return [];
    const present = new Set(books.map((b) => b.genre).filter(Boolean));
    return BOOK_GENRES.filter((g) => present.has(g));
  }, [books]);

  // La fila de géneros solo aparece cuando filtra de verdad: un solo
  // género en todo el catálogo no recorta nada — salvo que algunas
  // guías hayan quedado sin clasificar, donde sí distingue.
  const showGenrePills =
    !!books &&
    (genres.length > 1 ||
      (genres.length === 1 && books.some((b) => !b.genre)));

  const filtered = useMemo(() => {
    if (!books) return [];
    const q = normalizeSearchText(query);
    return books.filter(
      (b) =>
        (!lang || b.language === lang) &&
        (!genre || b.genre === genre) &&
        (!q ||
          normalizeSearchText(b.title).includes(q) ||
          normalizeSearchText(b.author).includes(q)),
    );
  }, [books, query, lang, genre]);

  const visible = useMemo(
    () => (expanded ? filtered : filtered.slice(0, COMMUNITY_RAIL_LIMIT)),
    [filtered, expanded],
  );

  // Un cargador de perfil por idioma para no releer IndexedDB por cada
  // guía; se recrea solo si cambia la función inyectada.
  const getInputsLoader = useCallback(() => {
    const current = inputsLoaderRef.current;
    if (!current || current.load !== loadInputs) {
      const loader = createCoverageInputsLoader(captureDbScope(), loadInputs);
      inputsLoaderRef.current = { load: loadInputs, loader };
      return loader;
    }
    return current.loader;
  }, [loadInputs]);

  // Hidratación ligera: solo las guías visibles (riel o cuadrícula
  // desplegada) y solo si no hay saveData. La guía se cachea en sesión
  // con la misma llave que usa el modo papel — es el mismo contrato A1.
  useEffect(() => {
    if (!visible.length) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const scope = captureDbScope();
    void (async () => {
      for (const book of visible) {
        if (cancelled || attemptedGuideRef.current.has(book.hash)) continue;
        attemptedGuideRef.current.add(book.hash);
        const key = paperGuideSessionKey(book.hash);
        let guide: PaperBookGuide | null = null;
        const cached = await loadSessionValue(key, scope).catch(() => null);
        if (cached) {
          try {
            guide = sanitizePaperBookGuide(JSON.parse(cached), book.hash);
          } catch {
            guide = null;
          }
        }
        if (!guide) {
          const raw = await fetchGuide(book.hash, scope).catch(() => null);
          guide = raw ? sanitizePaperBookGuide(raw, book.hash) : null;
          if (guide) {
            void saveSessionValue(key, JSON.stringify(guide), scope).catch(
              () => undefined,
            );
          }
        }
        if (cancelled) return;
        setGuides((prev) => ({ ...prev, [book.hash]: guide }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, fetchGuide]);

  // Cobertura por guía: formas únicas del índice de capítulos contra el
  // léxico del idioma de la guía, con el mismo perfil que el catálogo.
  useEffect(() => {
    const targets = visible.filter((book) => guides[book.hash]);
    if (!targets.length) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const scope = captureDbScope();
    const inputsFor = getInputsLoader();
    void (async () => {
      for (const book of targets) {
        if (cancelled || attemptedCoverageRef.current.has(book.hash)) continue;
        const guide = guides[book.hash];
        if (!guide) continue;
        attemptedCoverageRef.current.add(book.hash);
        const lang = coverageLanguageOf(book.language || guide.language);
        const inputs = await inputsFor(lang);
        if (cancelled) return;
        if (!inputs) continue;
        const forms = [
          ...new Set(guide.chapters.flatMap((ch) => ch.forms)),
        ];
        if (!forms.length) continue;
        const entries = await lookupForms(forms, lang, scope);
        if (cancelled) return;
        const coverage = coverageOfBook(forms, entries, inputs);
        if (cancelled) return;
        setCoverages((prev) => {
          const next = new Map(prev);
          next.set(book.hash, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, guides, getInputsLoader, lookupForms]);

  const attach = async (book: CommunityBook) => {
    setAttaching(book.hash);
    setError("");
    const result = await attachCommunityBook(book.hash);
    setAttaching(null);
    if (result.ok) {
      setAttachedHashes((prev) => new Set(prev).add(book.hash));
      onAttached?.(book.hash, result.guide);
      return true;
    }
    // El servidor dice el motivo (libro propio, guía retirada…) —
    // el mensaje de conexión solo aplica cuando no respondió nada.
    setError(result.error ?? "No se pudo agregar la guía. Revisa tu conexión.");
    return false;
  };

  const guideView = (book: CommunityBook) => {
    const guide = guides[book.hash] ?? null;
    const coverage = coverages.get(book.hash);
    const reliable = coverage ? coverageIsReliable(coverage) : false;
    const affinity =
      coverage && reliable
        ? getBookAffinityBadge(
            book.language || guide?.language || "es",
            coverage.percent > 10 ? coverage.percent : "supported",
          )
        : null;
    return {
      guide,
      coverage,
      reliable,
      affinity,
      palette: coverPalette(book.hash),
      isAdded:
        attachedHashes.has(book.hash) ||
        Boolean(ownedHashes?.has(book.hash)),
    };
  };

  const previewBook = books?.find((book) => book.hash === previewHash) ?? null;
  const previewView = previewBook ? guideView(previewBook) : null;

  const canShare = Boolean(onShareBook && shareableBooks?.length);
  const openShare = () => {
    const first = shareableBooks?.[0] ?? null;
    setShareBookSel(first);
    setShareGenre(first?.genre ?? "");
    setShareOpen(true);
  };
  const selectShareBook = (item: ShelfItem) => {
    setShareBookSel(item);
    setShareGenre(item.genre ?? "");
  };
  const confirmShare = async () => {
    if (!shareBookSel || !onShareBook || sharing) return;
    setSharing(true);
    try {
      await onShareBook(shareBookSel, shareGenre);
      setShareOpen(false);
      setReloadToken((t) => t + 1);
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className="shelf-community" aria-label="Guías de la comunidad">
      <h2 className="shelf-community-title">Comunidad</h2>
      <p className="meta shelf-community-hint">
        Guías de vocabulario que otros lectores compartieron — ayuda para
        leer tu libro en papel, no para leerlo aquí.
      </p>
      {canShare ? (
        <button
          type="button"
          className="btn--quiet shelf-community-share"
          onClick={openShare}
        >
          Compartir un libro tuyo
        </button>
      ) : null}
      {books === null ? (
        <p className="meta shelf-community-empty" role="status">
          Cargando guías de la comunidad…
        </p>
      ) : loadError ? (
        <p className="meta shelf-community-empty" role="alert">
          No se pudo cargar la comunidad. Revisa tu conexión.{" "}
          <button type="button" className="btn--quiet" onClick={retryLoad}>
            Reintentar
          </button>
        </p>
      ) : books.length === 0 ? (
        <div className="shelf-community-empty">
          <p className="meta">
            Todavía no hay guías compartidas. La tuya puede ser la primera.
          </p>
          {canShare ? (
            <button
              type="button"
              className="btn shelf-community-share-cta"
              onClick={openShare}
            >
              Compartir un libro tuyo
            </button>
          ) : (
            <p className="meta">
              Opciones del libro → «Compartir a la comunidad».
            </p>
          )}
        </div>
      ) : (
        <>
          {showGenrePills ? (
            <div
              className="shelf-community-filters"
              role="group"
              aria-label="Filtrar guías por género"
            >
              <button
                type="button"
                className={`discover-filter-pill${genre === null ? " discover-filter-pill--active" : ""}`}
                aria-pressed={genre === null}
                onClick={() => setGenre(null)}
              >
                Todos los géneros
              </button>
              {genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`discover-filter-pill${genre === g ? " discover-filter-pill--active" : ""}`}
                  aria-pressed={genre === g}
                  onClick={() => setGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          ) : null}
          {languages.length > 1 ? (
            <div
              className="shelf-community-filters"
              role="group"
              aria-label="Filtrar guías por idioma"
            >
              <button
                type="button"
                className={`discover-filter-pill${lang === null ? " discover-filter-pill--active" : ""}`}
                aria-pressed={lang === null}
                onClick={() => setLang(null)}
              >
                Todas
              </button>
              {languages.map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`discover-filter-pill${lang === language ? " discover-filter-pill--active" : ""}`}
                  aria-pressed={lang === language}
                  onClick={() => setLang(language)}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          <div className="discover-toolbar">
            <input
              type="search"
              className="shelf-community-search"
              placeholder="Buscar por título o autor"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar en la comunidad"
            />
            {filtered.length > COMMUNITY_RAIL_LIMIT ? (
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
          {error ? <p className="shelf-community-error" role="alert">{error}</p> : null}
          {filtered.length === 0 ? (
            <p className="meta shelf-community-empty">
              Sin guías que coincidan con la búsqueda.
            </p>
          ) : null}
          <ul className={`discover-rail${expanded ? " discover-rail--grid" : ""}`}>
            {visible.map((book) => {
              const { guide, coverage, reliable, affinity, palette, isAdded } =
                guideView(book);
              return (
                <li key={book.hash} className="discover-book">
                  <button
                    type="button"
                    className="discover-cover discover-cover--action"
                    onClick={() => setPreviewHash(book.hash)}
                    aria-label={`Ver vista previa de ${book.title}`}
                  >
                    {/* Portada tipográfica generada: las guías no traen la
                        imagen del donante (la portada es del editorial). */}
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
                    {coverage ? (
                      reliable ? (
                        <span
                          className="discover-badge"
                          title={`Conoces aproximadamente el ${coverage.percent}% del vocabulario de esta guía`}
                        >
                          ~{coverage.percent}%
                        </span>
                      ) : (
                        <span
                          className="discover-badge"
                          title="El catálogo aún no puede medir la mayoría de las palabras de esta guía"
                        >
                          {COVERAGE_UNMEASURED_LABEL}
                        </span>
                      )
                    ) : book.language ? (
                      <span className="discover-badge">
                        {book.language.toUpperCase()}
                      </span>
                    ) : null}
                  </button>
                  <div className="discover-meta">
                    {affinity ? (
                      <span
                        className="book-affinity-pill"
                        data-tone={affinity.tone}
                        title={affinity.description}
                      >
                        {affinity.label}
                      </span>
                    ) : null}
                    <div className="discover-tags" aria-label="Etiquetas">
                      <span className="discover-tag-pill">Guía de papel</span>
                      {book.genre ? (
                        <span className="discover-tag-pill">{book.genre}</span>
                      ) : null}
                      {guide ? (
                        <span className="discover-tag-pill">
                          {guide.chapters.length} cap.
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="discover-title discover-title--action"
                      title={book.title}
                      onClick={() => setPreviewHash(book.hash)}
                    >
                      {book.title}
                    </button>
                    <p className="meta">{book.author}</p>
                    {book.sharers > 1 ? (
                      <p className="meta">{book.sharers} lectores</p>
                    ) : null}
                    {coverage?.newWordsCount != null &&
                    coverage.newWordsCount > 0 ? (
                      <p className="meta discover-new-words">
                        +{coverage.newWordsCount} palabras útiles
                      </p>
                    ) : null}
                    {coverage?.reencuentrosCount != null &&
                    coverage.reencuentrosCount > 0 ? (
                      <p className="meta discover-reencuentros">
                        Repite {coverage.reencuentrosCount}{" "}
                        {coverage.reencuentrosCount === 1
                          ? "palabra"
                          : "palabras"}{" "}
                        de tu cuaderno
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn discover-action"
                    disabled={attaching !== null || isAdded}
                    onClick={() => void attach(book)}
                  >
                    {isAdded
                      ? "En tu estantería"
                      : attaching === book.hash
                        ? "Agregando…"
                        : "Usar en papel"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {previewBook && previewView ? (
        <Sheet
          label={`Vista previa de la guía de ${previewBook.title}`}
          onClose={() => setPreviewHash(null)}
        >
          <div className="discover-preview">
            <div className="discover-preview-cover">
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
            </div>
            <div className="discover-preview-body">
              {previewView.affinity ? (
                <span
                  className="book-affinity-pill"
                  data-tone={previewView.affinity.tone}
                  title={previewView.affinity.description}
                >
                  {previewView.affinity.label}
                </span>
              ) : null}
              <div className="discover-tags" aria-label="Etiquetas">
                <span className="discover-tag-pill">Guía de papel</span>
                {previewBook.genre ? (
                  <span className="discover-tag-pill">{previewBook.genre}</span>
                ) : null}
                <span className="discover-tag-pill">
                  {previewBook.language.toUpperCase()}
                </span>
                {previewBook.sharers > 1 ? (
                  <span className="discover-tag-pill">
                    {previewBook.sharers} lectores
                  </span>
                ) : null}
              </div>
              <h3 className="discover-preview-title">{previewBook.title}</h3>
              <p className="meta">{previewBook.author}</p>
              {previewView.guide ? (
                <p className="meta discover-facts">
                  {previewView.guide.chapters.length} capítulos ·{" "}
                  {new Set(
                    previewView.guide.chapters.flatMap((ch) => ch.forms),
                  ).size}{" "}
                  palabras clave
                </p>
              ) : previewBook.hash in guides ? (
                <p className="meta discover-facts">
                  No se pudo cargar el índice de capítulos.
                </p>
              ) : (
                <p className="meta discover-facts">Cargando índice…</p>
              )}
              {previewView.coverage ? (
                previewView.reliable ? (
                  <p className="meta discover-preview-coverage">
                    ~{previewView.coverage.percent}% del vocabulario ya lo
                    conoces
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
                </p>
              ) : null}
              {previewView.coverage?.reencuentrosCount != null &&
              previewView.coverage.reencuentrosCount > 0 ? (
                <p className="meta discover-reencuentros">
                  Repite {previewView.coverage.reencuentrosCount}{" "}
                  {previewView.coverage.reencuentrosCount === 1
                    ? "palabra"
                    : "palabras"}{" "}
                  de tu cuaderno
                </p>
              ) : null}
              {previewView.guide ? (
                <div className="discover-preview-chapters">
                  <p className="meta discover-preview-chapters-title">
                    Índice de capítulos
                  </p>
                  <ol>
                    {previewView.guide.chapters.map((ch, index) => (
                      <li key={ch.id}>
                        <span>
                          {index + 1}. {ch.label}
                        </span>
                        <span className="meta">{ch.forms.length} palabras</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <p className="meta discover-preview-note">
                Es una guía de papel: solo índice de palabras por capítulo,
                nunca el libro ni frases. Sirve para confirmar que coincide
                con tu edición.
              </p>
              {previewView.isAdded ? (
                <button type="button" className="btn discover-action" disabled>
                  En tu estantería
                </button>
              ) : (
                <button
                  type="button"
                  className="btn discover-action"
                  disabled={attaching !== null}
                  onClick={() => {
                    void attach(previewBook).then((ok) => {
                      if (ok) setPreviewHash(null);
                    });
                  }}
                >
                  {attaching === previewBook.hash
                    ? "Agregando…"
                    : "Usar en papel"}
                </button>
              )}
              {error ? (
                <p className="meta" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </Sheet>
      ) : null}

      {shareOpen ? (
        <Sheet
          label="Compartir guía para papel"
          onClose={() => setShareOpen(false)}
        >
          <div className="discover-preview">
            <div className="discover-preview-body">
              <h3 className="discover-preview-title">
                Comparte la guía de un libro tuyo
              </h3>
              <p className="meta">
                Solo viaja el índice de palabras por capítulo — nunca el EPUB
                ni frases del texto.
              </p>
              <div
                className="discover-preview-books"
                role="group"
                aria-label="Elige un libro para compartir"
              >
                {(shareableBooks ?? []).map((item) => (
                  <button
                    key={item.hash}
                    type="button"
                    className={`discover-share-book${shareBookSel?.hash === item.hash ? " discover-share-book--active" : ""}`}
                    aria-pressed={shareBookSel?.hash === item.hash}
                    onClick={() => selectShareBook(item)}
                  >
                    <span className="discover-share-book-title">
                      {item.title || item.name}
                    </span>
                    <span className="meta">
                      {item.author || "Autor desconocido"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="shelf-options-label">Género de la guía</p>
              <div className="shelf-genre-chips" role="group" aria-label="Género">
                {BOOK_GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`discover-filter-pill${shareGenre === g ? " discover-filter-pill--active" : ""}`}
                    aria-pressed={shareGenre === g}
                    onClick={() => setShareGenre((current) => (current === g ? "" : g))}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn discover-action"
                disabled={!shareBookSel || sharing}
                onClick={() => void confirmShare()}
              >
                {sharing ? "Compartiendo…" : "Compartir guía"}
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
