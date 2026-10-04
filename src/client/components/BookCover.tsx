import type { CSSProperties } from "react";
import { coverPalette, coverUrlFor, displayTitle } from "../lib/cover";
import type { StoredBook } from "../lib/idb";

type BookCoverProps = {
  book: StoredBook;
  className?: string;
};

// Portada real del EPUB o, si no trae, una portada tipográfica
// generada con una tinta elegida por el hash del libro.
export default function BookCover({ book, className }: BookCoverProps) {
  const title = displayTitle(book.name, book.title);

  if (book.cover) {
    return (
      <img
        className={`cover ${className ?? ""}`}
        src={coverUrlFor(book.cover)}
        alt={`Portada de ${title}`}
      />
    );
  }

  const palette = coverPalette(book.hash);
  const vars = {
    "--cover-paper": palette.paper,
    "--cover-ink": palette.ink,
    "--cover-accent": palette.accent,
  } as CSSProperties;

  return (
    <div
      className={`cover cover--generated ${className ?? ""}`}
      style={vars}
      role="img"
      aria-label={`Portada de ${title}`}
    >
      <span className="cover-frame">
        <span className="cover-title">{title}</span>
        <span className="cover-ornament" aria-hidden="true" />
        <span className="cover-author">{book.author ?? ""}</span>
      </span>
    </div>
  );
}
