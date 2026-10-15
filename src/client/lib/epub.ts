// foliate-js y zip.js solo se cargan al abrir un libro: imports
// dinámicos para no inflar el chunk inicial. Los tipos quedan estáticos.
import type { FileEntry } from "@zip.js/zip.js";
import type { EPUB } from "foliate-js/epub.js";

export type EpubBook = Awaited<ReturnType<EPUB["init"]>>;
export type EpubTocItem = NonNullable<EpubBook["toc"]>[number];

type EpubLoader = {
  loadText: (name: string) => Promise<string>;
  loadBlob: (name: string, type?: string) => Promise<Blob | null>;
  getSize: (name: string) => number;
};

export async function createEpubLoader(file: Blob) {
  const { BlobReader, BlobWriter, TextWriter, ZipReader } = await import(
    "@zip.js/zip.js"
  );
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const files = entries.filter((entry): entry is FileEntry => !entry.directory);
  const entriesByName = new Map(files.map((entry) => [entry.filename, entry]));

  const loader: EpubLoader = {
    loadText: async (name) => (await entriesByName.get(name)?.getData(new TextWriter())) ?? "",
    loadBlob: async (name, type) =>
      (await entriesByName.get(name)?.getData(new BlobWriter(type))) ?? null,
    getSize: (name) => entriesByName.get(name)?.uncompressedSize ?? 0,
  };

  return { loader, close: () => reader.close() };
}

export async function openEpub(file: Blob) {
  const { EPUB } = await import("foliate-js/epub.js");
  const { loader, close } = await createEpubLoader(file);
  const book = await new EPUB(loader).init();
  // loadBlob sale del loader del zip: EPUB no lo expone en su tipo.
  return { book, close, loadBlob: loader.loadBlob };
}

// ---------- Texto del EPUB ----------

// Los guiones blandos (\u00AD) que traen algunos EPUB son marcas de
// corte invisibles: aunque el guionado esté apagado siguen dentro del
// texto y ensucian todo lo que se deriva de él — la palabra que sale
// al tocarla, la oración de contexto, los anclas de posición, las
// marcas y el análisis de vocabulario. Se retiran siempre al cargar
// la sección, con cualquier ajuste: el toggle «Guiones» decide solo
// la separación automática del navegador (hyphens: auto), no la
// presencia de estos caracteres. Así el textContent queda idéntico
// en todos los dispositivos y los anclas guardadas siguen casando.
export function stripSoftHyphens(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (text.data.includes("\u00AD"))
      text.data = text.data.replace(/\u00AD/g, "");
    node = walker.nextNode();
  }
}

// ---------- Imágenes del EPUB ----------

// Rutas con esquema propio (http:, data:) o relativas al host no viven
// en el zip: se respetan tal cual. Las demás son rutas internas del
// EPUB y hay que servirlas como blob.
const EXTERNAL_SRC = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

type ImageJob = {
  src: string;
  set: (url: string) => void;
};

// Sustituye las rutas internas del EPUB por blob: URLs. Primero quita
// los `src`/`href` que no resuelven (una petición al origen por cada
// imagen sería 404 seguro), luego las rellena en segundo plano: el
// texto ya se pintó y la lectura nunca espera por una imagen.
//
// `urls` es la bolsa del llamador: se vacía (revocando las URL de la
// sección anterior) y se rellena con las nuevas, que el llamador
// revoca al desmontar.
export async function hydrateSectionImages(
  root: ParentNode,
  section: { resolveHref: (href: string) => string },
  loadBlob: (name: string) => Promise<Blob | null>,
  urls: string[],
  options: {
    isCurrent: () => boolean;
    onSettled?: () => void;
  },
) {
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);

  const pending: ImageJob[] = [];
  for (const img of root.querySelectorAll("img")) {
    const raw = img.getAttribute("src") ?? "";
    if (!raw || EXTERNAL_SRC.test(raw)) continue;
    img.removeAttribute("src");
    pending.push({ src: raw, set: (url) => img.setAttribute("src", url) });
  }
  // Portadas y figuras envueltas en <svg><image>.
  for (const image of root.querySelectorAll("image")) {
    const raw =
      image.getAttribute("xlink:href") ?? image.getAttribute("href") ?? "";
    if (!raw || EXTERNAL_SRC.test(raw)) continue;
    image.removeAttribute("xlink:href");
    image.removeAttribute("href");
    pending.push({ src: raw, set: (url) => image.setAttribute("href", url) });
  }
  if (!pending.length) return;

  const cache = new Map<string, Promise<string | null>>();
  const urlFor = (src: string) => {
    let job = cache.get(src);
    if (!job) {
      job = loadBlob(section.resolveHref(src))
        .then((blob) => {
          if (!blob) return null;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return url;
        })
        .catch(() => null);
      cache.set(src, job);
    }
    return job;
  };

  await Promise.allSettled(
    pending.map(({ src, set }) =>
      urlFor(src).then((url) => {
        if (url && options.isCurrent()) set(url);
      }),
    ),
  );
  if (options.isCurrent()) options.onSettled?.();
}

export const flattenMetadataValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return flattenMetadataValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return flattenMetadataValue(record.name ?? Object.values(record)[0]);
  }
  return "";
};

export const flattenToc = (items: EpubTocItem[]): EpubTocItem[] =>
  items.flatMap((item) => [item, ...(item.subitems ? flattenToc(item.subitems) : [])]);

export const getBookTitle = (book: EpubBook) =>
  flattenMetadataValue(book.metadata?.title) || "Libro sin título";

export const getBookAuthor = (book: EpubBook) =>
  flattenMetadataValue(book.metadata?.author) || flattenMetadataValue(book.metadata?.creator);

export const normalizeLanguage = (raw: unknown): string => {
  if (typeof raw !== "string") return "es";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "es";
  const primary = trimmed.split(/[-_]/)[0]?.trim();
  if (!primary || primary === "und" || primary === "zxx" || primary === "mul") return "es";
  if (primary === "spa") return "es";
  if (primary === "eng") return "en";
  if (primary === "fra" || primary === "fre") return "fr";
  if (primary === "deu" || primary === "ger") return "de";
  if (primary === "ita") return "it";
  if (primary === "por") return "pt";
  if (/^[a-z]{2,3}$/.test(primary)) return primary;
  return "es";
};

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

// Detección heurística rápida de idioma (inglés vs español) analizando
// palabras funcionales y stopwords distintivas en una muestra de texto.
export function detectLanguageFromText(text: string): "es" | "en" | null {
  if (!text || text.length < 30) return null;
  const words = text.toLowerCase().match(/\b[a-záéíóúüñ]+\b/g) ?? [];
  if (words.length < 8) return null;

  const englishMarkers = new Set([
    "the", "and", "that", "have", "for", "not", "with", "you", "this", "but",
    "his", "from", "they", "say", "her", "she", "will", "one", "all", "would",
    "there", "their", "what", "out", "about", "who", "which", "when", "make",
    "can", "like", "time", "just", "him", "know", "take", "people", "into",
    "year", "your", "good", "some", "could", "them", "see", "other", "than",
    "then", "now", "look", "only", "come", "its", "over", "think", "also",
    "was", "were", "been", "had", "has", "are", "is", "my", "our", "how",
    "or", "in", "to", "on", "at", "by", "as", "if", "an",
  ]);

  const spanishMarkers = new Set([
    "de", "la", "que", "el", "en", "los", "del", "se", "las", "por",
    "un", "para", "con", "una", "su", "al", "lo", "como", "más",
    "pero", "sus", "le", "ya", "fue", "este", "ha", "sí", "porque",
    "esta", "son", "entre", "cuando", "muy", "sin", "sobre", "también",
    "hasta", "hay", "donde", "quien", "desde", "todo", "nos",
    "durante", "todos", "uno", "les", "ni", "contra", "otros", "ese",
    "había", "tiene", "estaba", "está", "estos", "estas", "hacia",
  ]);

  let enScore = 0;
  let esScore = 0;

  for (const w of words) {
    if (englishMarkers.has(w)) enScore++;
    if (spanishMarkers.has(w)) esScore++;
  }

  if (enScore === 0 && esScore === 0) return null;
  if (enScore > esScore * 1.5 && enScore >= 3) return "en";
  if (esScore > enScore * 1.5 && esScore >= 3) return "es";
  return null;
}

export const getBookLanguage = (book: EpubBook): string =>
  normalizeLanguage(flattenMetadataValue(book.metadata?.language));

import { detectBookLanguage as detectSharedBookLanguage } from "../../shared/epub-meta";

export { detectSharedBookLanguage };

// Detecta el idioma del libro combinando metadatos OPF y análisis
// heurístico del texto si los metadatos faltan o declaran "und" (indeterminado).
export async function detectBookLanguage(
  bookOrOpf?: EpubBook | string,
  sampleText?: string,
): Promise<string> {
  if (typeof bookOrOpf === "string" || (!bookOrOpf && sampleText)) {
    return detectSharedBookLanguage(bookOrOpf, sampleText);
  }
  const book = bookOrOpf as EpubBook;
  const rawLang = flattenMetadataValue(book?.metadata?.language);
  const trimmed = typeof rawLang === "string" ? rawLang.trim().toLowerCase() : "";
  const isAmbiguous = !trimmed || trimmed === "und" || trimmed === "zxx" || trimmed === "mul";

  if (!isAmbiguous) {
    const norm = normalizeLanguage(rawLang);
    if (norm) return norm;
  }

  // Comprobar descripción si existe
  const desc = flattenMetadataValue(book?.metadata?.description);
  const descDetected = detectLanguageFromText(desc);
  if (descDetected) return descDetected;

  // Muestrear las primeras secciones de lectura reales del libro
  const sections = book?.sections ?? [];
  for (let i = 0; i < Math.min(sections.length, 4); i++) {
    try {
      const doc = await sections[i]?.createDocument?.();
      const content = doc?.body?.textContent ?? "";
      const textDetected = detectLanguageFromText(content);
      if (textDetected) return textDetected;
    } catch {
      // Ignorar fallo de sección en la heurística
    }
  }

  return normalizeLanguage(rawLang) || "es";
}
