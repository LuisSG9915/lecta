// Sección «Comunidad» de la estantería (carga diferida): EPUBs que
// otros lectores compartieron, utilizables solo como ayuda del modo
// papel — nunca se abren en el lector. Al adjuntar uno, el servidor
// copia el archivo a la cuenta y la estantería lo muestra con el sello
// «Papel».
import { useEffect, useMemo, useState } from "react";
import {
  attachCommunityBook,
  communityCoverUrl,
  listCommunityBooks,
  type CommunityBook,
} from "../lib/books";
import Icon from "./Icon";

type Props = {
  /** Al adjuntar: el padre refresca la estantería (la copia aparece). */
  onAttached?: (hash: string) => void;
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
    const ok = await attachCommunityBook(book.hash);
    setAttaching(null);
    if (ok) {
      onAttached?.(book.hash);
    } else {
      setError("No se pudo agregar el libro. Revisa tu conexión.");
    }
  };

  // Sin comunidad todavía (o sin sesión): la sección se reduce a una
  // línea de invitación — nunca ocupa la estantería sin libros que dar.
  if (books === null) return null;

  return (
    <section className="shelf-community" aria-label="Libros de la comunidad">
      <h2 className="shelf-community-title">Comunidad</h2>
      <p className="meta shelf-community-hint">
        Libros que otros lectores compartieron — solo como ayuda para leer en papel.
      </p>
      {books.length === 0 ? (
        <p className="meta shelf-community-empty">
          Todavía no hay libros compartidos. El tuyo puede ser el primero:
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
                <span className="shelf-community-cover" aria-hidden="true">
                  {book.hasCover ? (
                    <img src={communityCoverUrl(book.hash)} alt="" loading="lazy" />
                  ) : (
                    <Icon name="book" size={20} />
                  )}
                </span>
                <span className="shelf-community-info">
                  <span className="shelf-community-book-title">{book.title}</span>
                  {book.author ? (
                    <span className="meta shelf-community-author">{book.author}</span>
                  ) : null}
                  <span className="meta shelf-community-meta">
                    {book.language ? `${book.language.toUpperCase()} · ` : ""}
                    {book.sharers > 1 ? `${book.sharers} lectores` : "1 lector"}
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
