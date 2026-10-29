import { useState, useEffect, type CSSProperties } from "react";
import {
  coverPalette,
  coverUrlFor,
  bookDisplayName,
  getRemoteCoverObjectUrl,
  setRemoteCoverCache,
} from "../lib/cover";
import { fetchBookCover } from "../lib/books";
import type { StoredBook } from "../lib/idb";

// Solo los campos que la portada usa: la estantería también pasa
// ítems «solo en la nube», que no tienen el archivo del libro.
type BookCoverProps = {
  book: Pick<StoredBook, "hash" | "name" | "title" | "author" | "cover"> & {
    hasCover?: boolean;
    remoteOnly?: boolean;
  };
  className?: string;
  progress?: number;
  showRibbon?: boolean;
};

// Portada real del EPUB o, si no trae, una portada tipográfica
// generada con una tinta elegida por el hash del libro. Incluye
// efecto de volumen físico 3D, textura sutil de papel y cinta marcapáginas.
export default function BookCover({
  book,
  className,
  progress,
  showRibbon,
}: BookCoverProps) {
  const title = bookDisplayName(book);
  const [remoteCoverUrl, setRemoteCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!book.cover && book.hasCover) {
      void getRemoteCoverObjectUrl(book.hash).then((cached) => {
        if (cancelled) return;
        if (cached) {
          setRemoteCoverUrl(cached);
        } else {
          void fetchBookCover(book.hash).then(async (blob) => {
            if (cancelled || !blob) return;
            const url = await setRemoteCoverCache(book.hash, blob);
            if (!cancelled) setRemoteCoverUrl(url);
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [book.hash, book.cover, book.hasCover]);

  const effectiveCoverUrl = book.cover ? coverUrlFor(book.cover) : remoteCoverUrl;
  const hasRibbon = showRibbon ?? (progress !== undefined && progress > 0);
  const ribbonOffset =
    progress !== undefined
      ? Math.min(85, Math.max(15, Math.round(progress * 100)))
      : 50;

  if (effectiveCoverUrl) {
    return (
      <div
        className={`cover cover--3d cover--image ${className ?? ""}`}
        role="img"
        aria-label={`Portada de ${title}`}
      >
        <img
          className="cover-img"
          src={effectiveCoverUrl}
          alt={`Portada de ${title}`}
        />
        <span className="cover-spine-fold" aria-hidden="true" />
        <span className="cover-paper-texture" aria-hidden="true" />
        {hasRibbon ? (
          <span
            className="cover-bookmark-ribbon"
            style={{ "--ribbon-x": `${ribbonOffset}%` } as CSSProperties}
            aria-hidden="true"
          />
        ) : null}
      </div>
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
      className={`cover cover--3d cover--generated ${className ?? ""}`}
      style={vars}
      role="img"
      aria-label={`Portada de ${title}`}
    >
      <span className="cover-frame">
        <span className="cover-title">{title}</span>
        <span className="cover-ornament" aria-hidden="true" />
        <span className="cover-author">{book.author ?? ""}</span>
      </span>
      <span className="cover-spine-fold" aria-hidden="true" />
      <span className="cover-paper-texture" aria-hidden="true" />
      {hasRibbon ? (
        <span
          className="cover-bookmark-ribbon"
          style={{ "--ribbon-x": `${ribbonOffset}%` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
