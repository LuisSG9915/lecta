import { useCallback, useEffect, useRef, useState } from "react";
import { coverPalette } from "../lib/cover";
import { CatalogAuthError, type CatalogBook } from "../lib/catalog";
import {
  searchGutenberg,
  type GutenbergSearchPage,
  type GutenbergSearchParams,
} from "../lib/gutenberg";

// «Más clásicos»: búsqueda en el índice propio de Project Gutenberg
// que vive en el worker (lecta_dev.gutenberg_books, migración 029).
// Cada resultado es un libro pg-: su EPUB se pide bajo demanda con
// sesión y cuota, así que el 401 se convierte en invitación a entrar
// en vez del error genérico de descarga.
//
// Se monta dentro de la pestaña «Libros gratuitos» de Explora, debajo
// del riel curado — la búsqueda es una puerta aparte al mismo catálogo
// público, no una variante del riel.

type Props = {
  // «Obtener»: el padre baja el EPUB pg- y lo pasa al flujo normal de
  // añadir libro (misma validación, dedup y sincronización).
  onGet: (item: CatalogBook) => Promise<void> | void;
  // Acción para ir a Perfil a iniciar sesión (el 401 del EPUB pg-).
  onOpenAccount?: () => void;
  // Inyectable para pruebas.
  fetchSearch?: (
    params: GutenbergSearchParams,
    signal?: AbortSignal,
  ) => Promise<GutenbergSearchPage | null>;
};

const SEARCH_DEBOUNCE_MS = 350;

// Temas de la vista en español → término de Gutenberg en inglés: los
// subjects del índice son el vocabulario anglosajón del catálogo.
const TOPIC_FILTERS = [
  { label: "Novela", term: "fiction" },
  { label: "Cuento", term: "short stories" },
  { label: "Poesía", term: "poetry" },
  { label: "Teatro", term: "drama" },
  { label: "Aventura", term: "adventure" },
  { label: "Misterio", term: "detective" },
  { label: "Historia", term: "history" },
  { label: "Filosofía", term: "philosophy" },
] as const;

const LANG_FILTERS = [
  { value: "", label: "Todos" },
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
] as const;

type LangFilter = (typeof LANG_FILTERS)[number]["value"];

export default function GutenbergSearch({
  onGet,
  onOpenAccount,
  fetchSearch = searchGutenberg,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [lang, setLang] = useState<LangFilter>("");
  const [topic, setTopic] = useState<string | null>(null);
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [getting, setGetting] = useState<string | null>(null);
  const [authBook, setAuthBook] = useState<string | null>(null);
  const [errorBook, setErrorBook] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // El texto libre espera 350 ms; los filtros se aplican al instante.
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setMoreError(false);
      if (append) {
        setLoadingMore(true);
      } else {
        setStatus("loading");
      }
      const result = await fetchSearch(
        {
          q: debouncedQuery,
          lang: lang || undefined,
          topic: topic ?? undefined,
          page: nextPage,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result) {
        if (append) {
          setLoadingMore(false);
          setMoreError(true);
        } else {
          setStatus("error");
        }
        return;
      }
      setBooks((prev) =>
        append ? [...prev, ...result.books] : result.books,
      );
      setPage(result.page);
      setHasMore(result.hasMore);
      setStatus("idle");
      setLoadingMore(false);
    },
    [debouncedQuery, lang, topic, fetchSearch],
  );

  // Montaje y cada cambio de búsqueda/filtros: página 0 nueva. La
  // carga sale por un microtask — un setState síncrono dentro del
  // efecto dispara renders en cascada (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => load(0, false));
    return () => abortRef.current?.abort();
  }, [load]);

  const get = async (book: CatalogBook) => {
    if (getting) return;
    setGetting(book.id);
    setAuthBook(null);
    setErrorBook(null);
    try {
      await onGet(book);
    } catch (err) {
      if (err instanceof CatalogAuthError) setAuthBook(book.id);
      else setErrorBook(book.id);
    } finally {
      setGetting(null);
    }
  };

  return (
    <section
      className="gutenberg-search"
      aria-label="Más clásicos de dominio público"
    >
      <h3 className="eyebrow shelf-eyebrow">
        Más clásicos de dominio público
      </h3>

      <label
        className="gutenberg-search-label"
        htmlFor="gutenberg-search-field"
      >
        Busca por título o autor
      </label>
      <input
        id="gutenberg-search-field"
        type="search"
        className="shelf-community-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div
        className="discover-filters"
        role="group"
        aria-label="Filtrar por idioma"
      >
        {LANG_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`discover-filter-pill${lang === filter.value ? " discover-filter-pill--active" : ""}`}
            aria-pressed={lang === filter.value}
            onClick={() => setLang(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div
        className="discover-filters"
        role="group"
        aria-label="Filtrar por tema"
      >
        {TOPIC_FILTERS.map((filter) => (
          <button
            key={filter.term}
            type="button"
            className={`discover-filter-pill${topic === filter.term ? " discover-filter-pill--active" : ""}`}
            aria-pressed={topic === filter.term}
            onClick={() =>
              setTopic((current) =>
                current === filter.term ? null : filter.term,
              )
            }
          >
            {filter.label}
          </button>
        ))}
      </div>

      {status === "loading" && books.length === 0 ? (
        <p className="meta" role="status">
          Buscando…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="meta" role="alert">
          No pudimos buscar ahora.{" "}
          <button
            type="button"
            className="btn--quiet"
            onClick={() => void load(0, false)}
          >
            Reintentar
          </button>
        </p>
      ) : null}
      {status === "idle" && books.length === 0 ? (
        <p className="meta">No encontramos libros con esa búsqueda.</p>
      ) : null}

      {books.length > 0 ? (
        <ul className="discover-rail discover-rail--grid">
          {books.map((book) => {
            const palette = coverPalette(book.id);
            return (
              <li key={book.id} className="discover-book">
                <div className="discover-cover">
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
                </div>
                <div className="discover-meta">
                  <p className="discover-title" title={book.title}>
                    {book.title}
                  </p>
                  <p className="meta">{book.author}</p>
                  {book.language ? (
                    <p className="meta discover-facts">
                      {book.language === "es" ? "Español" : "Inglés"}
                    </p>
                  ) : null}
                </div>
                {authBook === book.id ? (
                  <div>
                    <p className="meta">
                      Inicia sesión para obtener este libro.
                    </p>
                    {onOpenAccount ? (
                      <button
                        type="button"
                        className="btn discover-action"
                        onClick={onOpenAccount}
                      >
                        Iniciar sesión
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn discover-action"
                    onClick={() => void get(book)}
                    disabled={getting !== null}
                  >
                    {getting === book.id ? "Obteniendo…" : "Obtener"}
                  </button>
                )}
                {errorBook === book.id ? (
                  <p className="meta" role="alert">
                    No se pudo descargar. Inténtalo de nuevo.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          className="btn--quiet discover-view-toggle"
          onClick={() => void load(page + 1, true)}
          disabled={loadingMore || status === "loading"}
        >
          {loadingMore ? "Cargando…" : "Ver más"}
        </button>
      ) : null}
      {moreError ? (
        <p className="meta" role="alert">
          No pudimos cargar más. Inténtalo de nuevo.
        </p>
      ) : null}
    </section>
  );
}
