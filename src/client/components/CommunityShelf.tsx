// Sección «Comunidad» de la estantería (carga diferida): GUÍAS de
// vocabulario que otros lectores compartieron para acompañar la
// lectura en papel — nunca el libro electrónico (modelo A1: solo
// palabras, el EPUB no sale de la cuenta de quien lo compartió). Al
// adjuntar una, la estantería la muestra con el sello «Papel» y abre
// el índice del modo papel, jamás el lector.
import { useContext, useEffect, useMemo, useState } from "react";
import {
  attachCommunityBook,
  listCommunityBooksResult,
  type CommunityBook,
  type CommunityBooksResult,
} from "../lib/books";
import { coverPalette } from "../lib/cover";
import { normalizeSearchText } from "../lib/search-text";
import { BOOK_GENRES } from "../../shared/book-genres";
import { ExploreCommunityEmptyContext } from "./ExploreShelf";

type Props = {
  /** Al adjuntar: el padre guarda la guía y refresca la estantería. */
  onAttached?: (hash: string, guide?: unknown) => void;
  /** Hashes de libros que el lector ya tiene en su estantería. */
  ownedHashes?: ReadonlySet<string>;
  /** Aviso cuando la comunidad terminó de cargar sin guías disponibles. */
  onEmpty?: () => void;
  /** Inyectable para pruebas. */
  fetchBooks?: () => Promise<CommunityBooksResult>;
};

export default function CommunityShelf({
  onAttached,
  ownedHashes,
  onEmpty,
  fetchBooks = listCommunityBooksResult,
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

  const attach = async (book: CommunityBook) => {
    setAttaching(book.hash);
    setError("");
    const result = await attachCommunityBook(book.hash);
    setAttaching(null);
    if (result.ok) {
      setAttachedHashes((prev) => new Set(prev).add(book.hash));
      onAttached?.(book.hash, result.guide);
    } else {
      // El servidor dice el motivo (libro propio, guía retirada…) —
      // el mensaje de conexión solo aplica cuando no respondió nada.
      setError(result.error ?? "No se pudo agregar la guía. Revisa tu conexión.");
    }
  };

  return (
    <section className="shelf-community" aria-label="Guías de la comunidad">
      <h2 className="shelf-community-title">Comunidad</h2>
      <p className="meta shelf-community-hint">
        Guías de vocabulario que otros lectores compartieron — ayuda para
        leer tu libro en papel, no para leerlo aquí.
      </p>
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
        <p className="meta shelf-community-empty">
          Todavía no hay guías compartidas. La tuya puede ser la primera:
          Opciones del libro → «Compartir a la comunidad».
        </p>
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
          <input
            type="search"
            className="shelf-community-search"
            placeholder="Buscar por título o autor"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar en la comunidad"
          />
          {error ? <p className="shelf-community-error" role="alert">{error}</p> : null}
          {filtered.length === 0 ? (
            <p className="meta shelf-community-empty">
              Sin guías que coincidan con la búsqueda.
            </p>
          ) : null}
          <ul className="discover-rail">
            {filtered.map((book) => {
              const palette = coverPalette(book.hash);
              const isAdded =
                attachedHashes.has(book.hash) ||
                Boolean(ownedHashes?.has(book.hash));
              return (
                <li key={book.hash} className="discover-book">
                  <div className="discover-cover">
                    {/* Portada tipográfica generada: las guías no traen la
                        imagen del donante (la portada es del editorial). */}
                    <div
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
                    </div>
                    {book.language ? (
                      <span className="discover-badge">
                        {book.language.toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                  <div className="discover-meta">
                    <div className="discover-tags" aria-label="Etiquetas">
                      <span className="discover-tag-pill">Guía de papel</span>
                      {book.genre ? (
                        <span className="discover-tag-pill">{book.genre}</span>
                      ) : null}
                    </div>
                    <p className="discover-title" title={book.title}>
                      {book.title}
                    </p>
                    <p className="meta">{book.author}</p>
                    {book.sharers > 1 ? (
                      <p className="meta">{book.sharers} lectores</p>
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
    </section>
  );
}
