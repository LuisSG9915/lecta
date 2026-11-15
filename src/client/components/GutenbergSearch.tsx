import { useCallback, useEffect, useRef, useState } from "react";
import { coverPalette } from "../lib/cover";
import {
  CatalogAuthError,
  catalogCoverUrl,
  type CatalogBook,
} from "../lib/catalog";
import {
  captureDbScope,
  loadSessionValue,
  saveSessionValue,
} from "../lib/idb";
import {
  searchGutenberg,
  type GutenbergSearchPage,
  type GutenbergSearchParams,
} from "../lib/gutenberg";
import Sheet from "./Sheet";
import type { ShelfItem } from "./Shelf";

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
  // añadir libro (misma validación, dedup y sincronización). Puede
  // resolver con el hash del libro guardado — la tarjeta lo usa para
  // ofrecer «Abrir» en vez de volver a descargarlo.
  onGet: (item: CatalogBook) => Promise<unknown> | void;
  // Acción para ir a Perfil a iniciar sesión (el 401 del EPUB pg-).
  onOpenAccount?: () => void;
  // Búsqueda controlada: «Libros gratuitos» tiene un solo campo para
  // este panel y para el riel curado. Si viene definida no se pinta
  // el input propio.
  query?: string;
  // Estantería visible: un pg- ya obtenido (mismo hash) ofrece
  // «Abrir» en vez de «Obtener».
  library?: ShelfItem[];
  onOpen?: (item: ShelfItem) => void;
  // Inyectable para pruebas.
  fetchSearch?: (
    params: GutenbergSearchParams,
    signal?: AbortSignal,
  ) => Promise<GutenbergSearchPage | null>;
};

const SEARCH_DEBOUNCE_MS = 350;

// Mapa id pg- → hash del libro guardado: sobrevive entre visitas
// para que una tarjeta ya obtenida ofrezca «Abrir» sin volver a
// bajar el EPUB. JSON tolerante: una entrada rota no rompe nada.
const OWNED_KEY = "gutenbergOwned:v1";

const parseOwned = (raw: string): Record<string, string> => {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const [id, hash] of Object.entries(data)) {
      if (typeof hash === "string" && hash) out[id] = hash;
    }
    return out;
  } catch {
    return {};
  }
};

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
  query: queryProp,
  library,
  onOpen,
  fetchSearch = searchGutenberg,
}: Props) {
  const [innerQuery, setInnerQuery] = useState("");
  // Con `query` controlada el texto viene del campo compartido de la
  // pestaña; sin ella se usa el estado interno (pruebas sueltas).
  const query = queryProp ?? innerQuery;
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
  // Portadas pg- traídas bajo demanda por el worker: si una falla se
  // marca y esa tarjeta conserva la portada tipográfica.
  const [coverBroken, setCoverBroken] = useState<Set<string>>(new Set());
  // id pg- → hash del libro ya guardado en este dispositivo.
  const [owned, setOwned] = useState<Record<string, string>>({});
  // Tarjeta abierta en la hoja de vista previa.
  const [previewBook, setPreviewBook] = useState<CatalogBook | null>(null);

  // El mapa «ya lo tienes» se lee una vez al montar; se actualiza al
  // obtener un libro nuevo (en get, no aquí).
  useEffect(() => {
    let cancelled = false;
    void loadSessionValue(OWNED_KEY, captureDbScope())
      .then((raw) => {
        if (!cancelled && raw) setOwned(parseOwned(raw));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
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

  const get = async (book: CatalogBook, closePreview = false) => {
    if (getting) return;
    setGetting(book.id);
    setAuthBook(null);
    setErrorBook(null);
    try {
      const result = await onGet(book);
      // El padre devuelve el hash del libro guardado: la tarjeta pasa
      // a ofrecer «Abrir» sin volver a descargar el EPUB.
      if (typeof result === "string" && result) {
        const next = { ...owned, [book.id]: result };
        setOwned(next);
        void saveSessionValue(
          OWNED_KEY,
          JSON.stringify(next),
          captureDbScope(),
        ).catch(() => undefined);
      }
      if (closePreview) setPreviewBook(null);
    } catch (err) {
      if (err instanceof CatalogAuthError) setAuthBook(book.id);
      else setErrorBook(book.id);
    } finally {
      setGetting(null);
    }
  };

  // El libro ya está en la estantería si guardamos su hash y la
  // biblioteca actual lo contiene (pudo borrarse en otro dispositivo:
  // entonces vuelve a ofrecer «Obtener»).
  const ownedItemOf = (book: CatalogBook): ShelfItem | undefined => {
    const hash = owned[book.id];
    return hash ? library?.find((item) => item.hash === hash) : undefined;
  };

  // Sin texto, sin tema y en «Todos» los idiomas la lista es un riel
  // de descubrimiento (como el catálogo curado); en cuanto hay una
  // búsqueda o filtro activo pasa a cuadrícula para leerla entera.
  const browseMode =
    !debouncedQuery.trim() && topic === null && lang === "";

  // La portada real (bajo demanda por el worker) con caída a la
  // tipográfica generada: un solo markup para tarjeta y vista previa.
  const coverNode = (book: CatalogBook, alt: string) => {
    const palette = coverPalette(book.id);
    if (book.cover && !coverBroken.has(book.id)) {
      return (
        <img
          className="cover"
          src={catalogCoverUrl(book.id)}
          alt={alt}
          loading="lazy"
          onError={() =>
            setCoverBroken((prev) => new Set(prev).add(book.id))
          }
        />
      );
    }
    return (
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
    );
  };

  return (
    <section
      className="gutenberg-search"
      aria-label="Más clásicos de dominio público"
    >
      <h3 className="eyebrow shelf-eyebrow">
        Más clásicos de dominio público
      </h3>

      {/* Con el buscador compartido de la pestaña el campo ya está
          arriba: aquí solo quedan los filtros, plegados. */}
      {queryProp === undefined ? (
        <>
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
            onChange={(event) => setInnerQuery(event.target.value)}
          />
        </>
      ) : null}

      <details className="discover-more-filters">
        <summary className="meta">
          Más filtros
          {lang !== "" || topic !== null
            ? ` · ${
                (lang !== "" ? 1 : 0) + (topic !== null ? 1 : 0)
              } activo${lang !== "" && topic !== null ? "s" : ""}`
            : ""}
        </summary>
        <div className="discover-more-filters-content">
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
        </div>
      </details>

      {status === "loading" ? (
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
        <ul
          className={`discover-rail${browseMode ? "" : " discover-rail--grid"}`}
          aria-busy={status === "loading"}
        >
          {books.map((book) => {
            const ownedItem = ownedItemOf(book);
            return (
              <li key={book.id} className="discover-book">
                <button
                  type="button"
                  className="discover-cover discover-cover--action"
                  onClick={() => setPreviewBook(book)}
                  aria-label={`Ver vista previa de ${book.title}`}
                >
                  {coverNode(book, "")}
                </button>
                <div className="discover-meta">
                  <button
                    type="button"
                    className="discover-title discover-title--action"
                    title={book.title}
                    onClick={() => setPreviewBook(book)}
                  >
                    {book.title}
                  </button>
                  <p className="meta">{book.author}</p>
                  {book.language ? (
                    <p className="meta discover-facts">
                      {book.language === "es" ? "Español" : "Inglés"}
                    </p>
                  ) : null}
                </div>
                {ownedItem && onOpen ? (
                  <button
                    type="button"
                    className="btn discover-action"
                    onClick={() => onOpen(ownedItem)}
                  >
                    Abrir
                  </button>
                ) : ownedItem ? (
                  <p className="meta">Ya está en tu estantería.</p>
                ) : authBook === book.id ? (
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

      {previewBook ? (
        <Sheet
          label={`Vista previa de ${previewBook.title}`}
          onClose={() => setPreviewBook(null)}
        >
          <div className="discover-preview">
            <div className="discover-preview-cover">
              {coverNode(previewBook, `Portada de ${previewBook.title}`)}
            </div>
            <div className="discover-preview-body">
              <h3 className="discover-preview-title">
                {previewBook.title}
              </h3>
              <p className="meta">{previewBook.author}</p>
              {previewBook.language ? (
                <p className="meta discover-facts">
                  {previewBook.language === "es" ? "Español" : "Inglés"}
                </p>
              ) : null}
              {previewBook.synopsis ? (
                <p className="discover-preview-synopsis">
                  {previewBook.synopsis}
                </p>
              ) : null}
              {previewBook.subjects?.length ? (
                <p className="meta discover-facts">
                  {previewBook.subjects.slice(0, 3).join(" · ")}
                </p>
              ) : null}
              {(() => {
                const ownedItem = ownedItemOf(previewBook);
                if (ownedItem && onOpen) {
                  return (
                    <button
                      type="button"
                      className="btn discover-action"
                      onClick={() => {
                        onOpen(ownedItem);
                        setPreviewBook(null);
                      }}
                    >
                      Abrir
                    </button>
                  );
                }
                if (ownedItem) {
                  return (
                    <p className="meta">Ya está en tu estantería.</p>
                  );
                }
                if (authBook === previewBook.id) {
                  return (
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
                  );
                }
                return (
                  <button
                    type="button"
                    className="btn discover-action"
                    onClick={() => void get(previewBook, true)}
                    disabled={getting !== null}
                  >
                    {getting === previewBook.id
                      ? "Obteniendo…"
                      : "Obtener libro"}
                  </button>
                );
              })()}
              {errorBook === previewBook.id ? (
                <p className="meta" role="alert">
                  No se pudo descargar. Inténtalo de nuevo.
                </p>
              ) : null}
            </div>
          </div>
        </Sheet>
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
