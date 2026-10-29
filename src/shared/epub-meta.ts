import { isStopword } from "./stopwords";

export type ExtractedEpubMeta = {
  title?: string;
  author?: string;
  language?: string;
  sections?: number;
};

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

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function cleanXmlContent(str: string): string {
  let content = str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  content = content.replace(/<[^>]+>/g, "");
  return decodeXmlEntities(content).replace(/\s+/g, " ").trim();
}

type ZipEntryInfo = {
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

async function readZipEntryText(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntryInfo,
): Promise<string | null> {
  const raw = await readZipEntryBytes(bytes, view, entry);
  if (!raw) return null;
  return new TextDecoder().decode(raw);
}

async function readZipEntryBytes(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntryInfo,
): Promise<Uint8Array | null> {
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length) return null;
  if (view.getUint32(localOffset, true) !== 0x04034b50) return null;

  const fileNameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const dataOffset = localOffset + 30 + fileNameLen + extraLen;
  if (dataOffset + entry.compressedSize > bytes.length) return null;

  const raw = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return raw;
  }
  if (entry.compressionMethod === 8) {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      void writer.write(raw as unknown as BufferSource);
      void writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(decompressed);
    } catch {
      return null;
    }
  }
  return null;
}

function parseZipEntries(bytes: Uint8Array): { view: DataView; entries: Map<string, ZipEntryInfo> } | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Buscar End of Central Directory (EOCD: 0x06054b50)
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);
  if (cdOffset >= bytes.length) return null;

  const entries = new Map<string, ZipEntryInfo>();
  let offset = cdOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < cdEntries && offset + 46 <= bytes.length; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    if (offset + 46 + fileNameLen > bytes.length) break;
    const fileName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLen));
    entries.set(fileName, {
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  return { view, entries };
}

function resolveZipPath(baseDir: string, relPath: string): string {
  const decoded = decodeURIComponent(relPath).replace(/\\/g, "/");
  const full = baseDir ? `${baseDir}/${decoded}` : decoded;
  const parts = full.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

export async function extractEpubMeta(
  bytes: Uint8Array,
): Promise<ExtractedEpubMeta | null> {
  const zip = parseZipEntries(bytes);
  if (!zip) return null;
  const { view, entries } = zip;

  // 1. Buscar META-INF/container.xml
  let opfPath: string | null = null;
  const containerEntry = entries.get("META-INF/container.xml");
  if (containerEntry) {
    const containerXml = await readZipEntryText(bytes, view, containerEntry);
    if (containerXml) {
      const match = containerXml.match(/full-path=["']([^"']+)["']/i);
      if (match) opfPath = match[1];
    }
  }

  // Si no se halló por container.xml, buscar el primer .opf en el índice
  if (!opfPath) {
    for (const name of entries.keys()) {
      if (name.toLowerCase().endsWith(".opf")) {
        opfPath = name;
        break;
      }
    }
  }
  if (!opfPath) return null;

  const opfEntry = entries.get(opfPath);
  if (!opfEntry) return null;

  const opfXml = await readZipEntryText(bytes, view, opfEntry);
  if (!opfXml) return null;

  const titleMatch =
    opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i) ??
    opfXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const authorMatch =
    opfXml.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i) ??
    opfXml.match(/<creator\b[^>]*>([\s\S]*?)<\/creator>/i);
  const langMatch =
    opfXml.match(/<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i) ??
    opfXml.match(/<language\b[^>]*>([\s\S]*?)<\/language>/i);

  let sections: number | undefined;
  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (spineMatch) {
    const itemrefs = spineMatch[1].match(/<itemref\b/gi);
    if (itemrefs) sections = itemrefs.length;
  }

  const title = titleMatch ? cleanXmlContent(titleMatch[1]) : undefined;
  const author = authorMatch ? cleanXmlContent(authorMatch[1]) : undefined;
  const rawLang = langMatch ? cleanXmlContent(langMatch[1]) : "";
  const language = detectBookLanguage(rawLang ? `<dc:language>${rawLang}</dc:language>` : opfXml);

  return {
    title: title || undefined,
    author: author || undefined,
    language: language || "es",
    sections,
  };
}

/**
 * Extrae la portada de un EPUB compatible con EPUB 2 y EPUB 3.
 */
export async function extractEpubCover(
  buffer: ArrayBuffer | Uint8Array,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = parseZipEntries(bytes);
  if (!zip) return null;
  const { view, entries } = zip;

  let opfPath: string | null = null;
  const containerEntry = entries.get("META-INF/container.xml");
  if (containerEntry) {
    const containerXml = await readZipEntryText(bytes, view, containerEntry);
    if (containerXml) {
      const match = containerXml.match(/full-path=["']([^"']+)["']/i);
      if (match) opfPath = match[1];
    }
  }

  if (!opfPath) {
    for (const name of entries.keys()) {
      if (name.toLowerCase().endsWith(".opf")) {
        opfPath = name;
        break;
      }
    }
  }
  if (!opfPath) return null;

  const opfEntry = entries.get(opfPath);
  if (!opfEntry) return null;

  const opfXml = await readZipEntryText(bytes, view, opfEntry);
  if (!opfXml) return null;

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  let coverHref: string | null = null;
  let mediaType = "image/jpeg";

  // 1. EPUB 3: item con properties="cover-image"
  const epub3Match = opfXml.match(
    /<item\b(?=[^>]*\bproperties=["'][^"']*\bcover-image\b[^"']*["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i,
  );
  if (epub3Match) {
    coverHref = epub3Match[1];
    const mtMatch = epub3Match[0].match(/media-type=["']([^"']+)["']/i);
    if (mtMatch) mediaType = mtMatch[1];
  }

  // 2. EPUB 2: <meta name="cover" content="COVER_ID">
  if (!coverHref) {
    const metaCoverMatch =
      opfXml.match(/<meta\b(?=[^>]*\bname=["']cover["'])(?=[^>]*\bcontent=["']([^"']+)["'])[^>]*>/i) ??
      opfXml.match(/<meta\b(?=[^>]*\bcontent=["']([^"']+)["'])(?=[^>]*\bname=["']cover["'])[^>]*>/i);

    if (metaCoverMatch) {
      const coverId = metaCoverMatch[1];
      const escapedId = coverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const itemMatch = opfXml.match(
        new RegExp(`<item\\b(?=[^>]*\\bid=["']${escapedId}["'])(?=[^>]*\\bhref=["']([^"']+)["'])[^>]*>`, "i"),
      );
      if (itemMatch) {
        coverHref = itemMatch[1];
        const mtMatch = itemMatch[0].match(/media-type=["']([^"']+)["']/i);
        if (mtMatch) mediaType = mtMatch[1];
      }
    }
  }

  // 3. Fallback: <item id="cover" ...> o id="cover-image"
  if (!coverHref) {
    const fallbackMatch = opfXml.match(
      /<item\b(?=[^>]*\bid=["']cover(?:-image)?["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i,
    );
    if (fallbackMatch) {
      coverHref = fallbackMatch[1];
      const mtMatch = fallbackMatch[0].match(/media-type=["']([^"']+)["']/i);
      if (mtMatch) mediaType = mtMatch[1];
    }
  }

  if (!coverHref) return null;

  const targetPath = resolveZipPath(opfDir, coverHref);
  let coverEntry = entries.get(targetPath);
  if (!coverEntry) {
    // Intento con búsqueda insensible a mayúsculas
    for (const [key, val] of entries.entries()) {
      if (key.toLowerCase() === targetPath.toLowerCase()) {
        coverEntry = val;
        break;
      }
    }
  }

  if (!coverEntry) return null;

  const data = await readZipEntryBytes(bytes, view, coverEntry);
  if (!data || data.byteLength > 300_000) return null;

  return { data, mediaType };
}

export function detectBookLanguage(opfXml?: string, sampleText?: string): "es" | "en" {
  if (opfXml) {
    const match = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
    const raw = (match ? cleanXmlContent(match[1]) : opfXml).trim().toLowerCase();
    const primary = raw.split(/[-_]/)[0]?.trim();
    if (primary === "en" || primary === "eng") return "en";
    if (primary === "es" || primary === "spa") return "es";
  }

  if (sampleText && sampleText.trim().length >= 10) {
    const words = sampleText.toLowerCase().match(/\b[a-záéíóúüñ]+\b/g) ?? [];
    let enScore = 0;
    let esScore = 0;
    for (const w of words) {
      if (isStopword(w, "en")) enScore++;
      if (isStopword(w, "es")) esScore++;
    }
    if (enScore > esScore && enScore >= 2) return "en";
    if (esScore > enScore && esScore >= 2) return "es";
  }

  return "es";
}
