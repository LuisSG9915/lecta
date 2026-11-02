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
import Icon from "./Icon";

type Props = {
  /** Al adjuntar: el padre guarda la guía y refresca la estantería. */
  onAttached?: (hash: string, guide?: unknown) => void;
};

export default function CommunityShelf({ onAttached }: Props) {
  const [books, setBooks] = useState<CommunityBook[] | null>(null);
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    if (!books) return [];
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q),
    );
  }, [books, query]);

  const attach = async (book: CommunityBook) => {
    setAttaching(book.hash);
    setError("");
    const result = await attachCommunityBook(book.hash);
    setAttaching(null);
    if (result.ok) {
      onAttached?.(book.hash, result.guide);
    } else {
      setError("No se pudo agregar la guía. Revisa tu conexión.");
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
          <ul className="shelf-community-grid">
            {filtered.map((book) => (
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
        </>
      )}
    </section>
  );
}
