// Sección «Comunidad» de la estantería (carga diferida): GUÍAS de
// vocabulario que otros lectores compartieron para acompañar la
// lectura en papel — nunca el libro electrónico (modelo A1: solo
// palabras, el EPUB no sale de la cuenta de quien lo compartió). Al
// adjuntar una, la estantería la muestra con el sello «Papel» y abre
// el índice del modo papel, jamás el lector.
import { useEffect, useMemo, useState } from "react";
import {
  attachCommunityBook,
  listCommunityBooks,
  type CommunityBook,
} from "../lib/books";
import { BOOK_GENRES } from "../../shared/book-genres";
import Icon from "./Icon";

type Props = {
  /** Al adjuntar: el padre guarda la guía y refresca la estantería. */
  onAttached?: (hash: string, guide?: unknown) => void;
};

// La estantería no se estira con el catálogo: colapsada muestra
// COLLAPSED_COUNT guías y el resto se revela con «Ver todas»; al
// buscar o filtrar se pintan todas las coincidencias.
const COLLAPSED_COUNT = 4;

export default function CommunityShelf({ onAttached }: Props) {
  const [books, setBooks] = useState<CommunityBook[] | null>(null);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listCommunityBooks().then((rows) => {
      if (!cancelled) setBooks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const q = query.trim().toLowerCase();
    return books.filter(
      (b) =>
        (!lang || b.language === lang) &&
        (!genre || b.genre === genre) &&
        (!q ||
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q)),
    );
  }, [books, query, lang, genre]);

  const narrowing = query.trim() !== "" || lang !== null || genre !== null;
  const visible =
    expanded || narrowing ? filtered : filtered.slice(0, COLLAPSED_COUNT);

  const attach = async (book: CommunityBook) => {
    setAttaching(book.hash);
    setError("");
    const result = await attachCommunityBook(book.hash);
    setAttaching(null);
    if (result.ok) {
      onAttached?.(book.hash, result.guide);
    } else {
      // El servidor dice el motivo (libro propio, guía retirada…) —
      // el mensaje de conexión solo aplica cuando no respondió nada.
      setError(result.error ?? "No se pudo agregar la guía. Revisa tu conexión.");
    }
  };

  // Sin comunidad todavía (o sin sesión): la sección se reduce a una
  // línea de invitación — nunca ocupa la estantería sin libros que dar.
  if (books === null) return null;

  return (
    <section className="shelf-community" aria-label="Guías de la comunidad">
      <h2 className="shelf-community-title">Comunidad</h2>
      <p className="meta shelf-community-hint">
        Guías de vocabulario que otros lectores compartieron — ayuda para
        leer tu libro en papel, no para leerlo aquí.
      </p>
      {books.length === 0 ? (
        <p className="meta shelf-community-empty">
          Todavía no hay guías compartidas. La tuya puede ser la primera:
          Opciones del libro → «Compartir a la comunidad».
        </p>
      ) : (
        <>
          {showGenrePills ? (
            <div
              className="shelf-community-filters"
              role="tablist"
              aria-label="Filtrar guías por género"
            >
              <button
                type="button"
                className={`discover-filter-pill${genre === null ? " discover-filter-pill--active" : ""}`}
                role="tab"
                aria-selected={genre === null}
                onClick={() => setGenre(null)}
              >
                Todos los géneros
              </button>
              {genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`discover-filter-pill${genre === g ? " discover-filter-pill--active" : ""}`}
                  role="tab"
                  aria-selected={genre === g}
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
              role="tablist"
              aria-label="Filtrar guías por idioma"
            >
              <button
                type="button"
                className={`discover-filter-pill${lang === null ? " discover-filter-pill--active" : ""}`}
                role="tab"
                aria-selected={lang === null}
                onClick={() => setLang(null)}
              >
                Todas
              </button>
              {languages.map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`discover-filter-pill${lang === language ? " discover-filter-pill--active" : ""}`}
                  role="tab"
                  aria-selected={lang === language}
                  onClick={() => setLang(language)}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          {books.length > 6 ? (
            <input
              type="search"
              className="shelf-community-search"
              placeholder="Buscar por título o autor"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar en la comunidad"
            />
          ) : null}
          {error ? <p className="shelf-community-error" role="alert">{error}</p> : null}
          {filtered.length === 0 ? (
            <p className="meta shelf-community-empty">
              Sin guías que coincidan con la búsqueda.
            </p>
          ) : null}
          <ul className="shelf-community-grid">
            {visible.map((book) => (
              <li key={book.hash} className="shelf-community-item">
                {/* Portada tipográfica: las guías no traen la imagen del
                    donante (la portada es del editorial). */}
                <span className="shelf-community-cover" aria-hidden="true">
                  <Icon name="book" size={20} />
                </span>
                <span className="shelf-community-info">
                  <span className="shelf-community-book-title">{book.title}</span>
                  {book.author ? (
                    <span className="meta shelf-community-author">{book.author}</span>
                  ) : null}
                  <span className="meta shelf-community-meta">
                    Guía de papel
                    {book.language ? ` · ${book.language.toUpperCase()}` : ""}
                    {book.genre ? ` · ${book.genre}` : ""}
                    {book.sharers > 1 ? ` · ${book.sharers} lectores` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn shelf-community-attach"
                  disabled={attaching !== null}
                  onClick={() => void attach(book)}
                >
                  {attaching === book.hash ? "Agregando…" : "Usar en papel"}
                </button>
              </li>
            ))}
          </ul>
          {!narrowing && filtered.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              className="btn--quiet shelf-community-more"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? "Ver menos"
                : `Ver todas las guías (${filtered.length})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
