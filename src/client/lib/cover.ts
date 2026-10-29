import { openEpub, getBookAuthor, getBookLanguage, getBookTitle, detectBookLanguage } from "./epub";
import { isHashLikeIdentifier, humanizeFilename } from "../../shared/epub-meta";

export { isHashLikeIdentifier, humanizeFilename };

export type BookMeta = {
  id?: string;
  hash?: string;
  name?: string;
  file?: Blob | File;
  title: string;
  author: string;
  language: string;
  sectionCount: number;
  cover: Blob | null;
};

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

// Abre el EPUB solo para leer metadatos y portada; se usa en la
// estantería de forma perezosa y no compite con el lector.
export async function readBookMeta(file: Blob): Promise<BookMeta | null> {
  try {
    const { book, close } = await openEpub(file);
    try {
      const cover = (await book.getCover?.().catch(() => null)) ?? null;
      const language = await detectBookLanguage(book).catch(() => getBookLanguage(book));
      return {
        title: getBookTitle(book),
        author: getBookAuthor(book),
        language,
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

// ==========================================
// Portadas remotas y optimización (Fase 3)
// ==========================================

const REMOTE_COVER_CACHE_NAME = "lecta-covers-v1";
const remoteCoverObjectUrls = new Map<string, string>();

function safeCreateBlobUrl(blob: Blob, fallbackId: string): string {
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(blob);
    }
  } catch {
    // Entornos sin soporte de Blob URL (como jsdom)
  }
  return `blob:cover-${fallbackId}`;
}

/**
 * Convierte y optimiza un Blob de portada a JPEG <= 400px de ancho y <= maxBytes.
 * En entornos sin soporte completo de 2D canvas (como jsdom), devuelve el blob original si no supera maxBytes.
 */
export async function coverToJpegBlob(cover: Blob, maxBytes = 300_000): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return cover;
  }

  return new Promise<Blob>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(cover);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(cover);
          return;
        }

        const maxW = 400;
        let w = img.width || 400;
        let h = img.height || 600;

        if (w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size <= maxBytes) {
              resolve(blob);
            } else {
              resolve(cover.size <= maxBytes ? cover : (blob ?? cover));
            }
          },
          "image/jpeg",
          0.82,
        );
      } catch {
        resolve(cover);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(cover);
    };

    img.src = url;
  }).catch(() => cover);
}

/**
 * Obtiene la URL de objeto para una portada remota cacheada en CacheStorage o memoria.
 */
export async function getRemoteCoverObjectUrl(hash: string): Promise<string | null> {
  const mem = remoteCoverObjectUrls.get(hash);
  if (mem) return mem;

  if (typeof caches === "undefined") return null;

  try {
    const cache = await caches.open(REMOTE_COVER_CACHE_NAME);
    const cachedResponse = await cache.match(`/covers/${hash}`);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const url = safeCreateBlobUrl(blob, hash);
      remoteCoverObjectUrls.set(hash, url);
      return url;
    }
  } catch {
    // CacheStorage no disponible
  }
  return null;
}

/**
 * Guarda una portada remota en CacheStorage y en memoria.
 */
export async function setRemoteCoverCache(hash: string, blob: Blob): Promise<string> {
  const url = safeCreateBlobUrl(blob, hash);
  remoteCoverObjectUrls.set(hash, url);

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(REMOTE_COVER_CACHE_NAME);
      await cache.put(
        `/covers/${hash}`,
        new Response(blob, {
          headers: {
            "Content-Type": blob.type || "image/jpeg",
            "Cache-Control": "private, max-age=86400, immutable",
          },
        }),
      );
    } catch {
      // Ignorar fallo de CacheStorage
    }
  }

  return url;
}
