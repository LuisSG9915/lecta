import { openEpub, getBookAuthor, getBookLanguage, getBookTitle } from "./epub";

export type BookMeta = {
  title: string;
  author: string;
  language: string;
  sectionCount: number;
  cover: Blob | null;
};

// Abre el EPUB solo para leer metadatos y portada; se usa en la
// estantería de forma perezosa y no compite con el lector.
export async function readBookMeta(file: Blob): Promise<BookMeta | null> {
  try {
    const { book, close } = await openEpub(file);
    try {
      const cover = (await book.getCover?.().catch(() => null)) ?? null;
      return {
        title: getBookTitle(book),
        author: getBookAuthor(book),
        language: getBookLanguage(book),
        sectionCount: book.sections.length,
        cover,
      };
    } finally {
      await close();
    }
  } catch {
    return null;
  }
}

// Portadas tipográficas: papel tintado + tinta, elegidas por el hash del
// libro para que dos libros sin portada no se vean iguales.
export type CoverPalette = { paper: string; ink: string; accent: string };

const COVER_PALETTES: CoverPalette[] = [
  { paper: "#E7D9BE", ink: "#3B2F25", accent: "#9E3A23" }, // arena
  { paper: "#E0C9BB", ink: "#402B22", accent: "#8A3320" }, // terracota
  { paper: "#CCD3C2", ink: "#2C3327", accent: "#43694D" }, // salvia
  { paper: "#C4CBD2", ink: "#232B33", accent: "#31455C" }, // pizarra
  { paper: "#D5C4CD", ink: "#352530", accent: "#6B3355" }, // ciruela
  { paper: "#E3D3AF", ink: "#3A2E1E", accent: "#8A6A1E" }, // ocre pálido
];

export function coverPalette(hash: string): CoverPalette {
  let acc = 0;
  for (let i = 0; i < hash.length && i < 16; i += 1) {
    acc = (acc * 33 + hash.charCodeAt(i)) >>> 0;
  }
  return COVER_PALETTES[acc % COVER_PALETTES.length];
}

export function displayTitle(name: string, title?: string) {
  if (title) return title;
  return name.replace(/\.epub$/i, "");
}

// Caché de object URLs para portadas: acotada a las últimas 40 para
// no acumular blobs, y evita recrear URLs en cada render.
const coverUrls = new Map<Blob, string>();

export function coverUrlFor(blob: Blob): string {
  const cached = coverUrls.get(blob);
  if (cached) return cached;
  if (coverUrls.size >= 40) {
    const [oldest] = coverUrls.keys();
    const url = coverUrls.get(oldest);
    coverUrls.delete(oldest);
    if (url) URL.revokeObjectURL(url);
  }
  const url = URL.createObjectURL(blob);
  coverUrls.set(blob, url);
  return url;
}
