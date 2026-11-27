// Utilidades puras de presentación de libros sin dependencias pesadas.
// Separadas de epub-meta/epub/cover para no arrastrar stopwords, foliate
// ni zip al grafo estático de arranque.

export function isHashLikeIdentifier(value?: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^(?:libro\s+|book\s+)?[a-f0-9]{8,64}(?:\.epub)?$/i.test(trimmed);
}

export function humanizeFilename(name?: string | null): string {
  if (!name || isHashLikeIdentifier(name)) return "";
  const withoutExt = name.trim().replace(/\.epub$/i, "").trim();
  if (!withoutExt || isHashLikeIdentifier(withoutExt)) return "";
  const cleaned = withoutExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || isHashLikeIdentifier(cleaned)) return "";
  return cleaned.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}

export function bookDisplayName(item: {
  title?: string | null;
  name?: string | null;
  author?: string | null;
  hash?: string | null;
  isRemoteOnly?: boolean;
}): string {
  // 1. item.title limpio (si no está vacío y !isHashLikeIdentifier(item.title))
  const cleanTitle = item.title?.trim();
  if (cleanTitle && !isHashLikeIdentifier(cleanTitle)) {
    return cleanTitle;
  }
  // 2. humanizeFilename(item.name) (si no está vacío)
  const humanized = humanizeFilename(item.name);
  if (humanized) {
    return humanized;
  }
  // 3. Si item.author es legible y no-hash: "Libro de " + item.author.trim()
  const cleanAuthor = item.author?.trim();
  if (cleanAuthor && !isHashLikeIdentifier(cleanAuthor)) {
    return `Libro de ${cleanAuthor}`;
  }
  // 4. Fallback seguro que jamás expone el hash
  return item.isRemoteOnly ? "Libro en la nube" : "Libro sin título";
}

export function displayTitle(name: string, title?: string): string {
  return bookDisplayName({ name, title });
}

export const languageName = (code: string): string => {
  const norm = code.trim().toLowerCase();
  switch (norm) {
    case "es":
      return "Español";
    case "en":
      return "Inglés";
    case "fr":
      return "Francés";
    case "de":
      return "Alemán";
    case "it":
      return "Italiano";
    case "pt":
      return "Portugués";
    case "ca":
      return "Catalán";
    case "gl":
      return "Gallego";
    case "eu":
      return "Euskera";
    default:
      return norm.toUpperCase();
  }
};
