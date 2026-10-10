// Parser y extractor de capítulos EPUB en servidor para la vista Kindle / E-ink.
// Sin dependencias pesadas: lee el ZIP con DecompressionStream nativo
// y extrae secciones limpias sin JavaScript para dispositivos de tinta electrónica.

export type EpubSpineItem = {
  id: string;
  href: string;
  fullPath: string;
  mediaType: string;
};

export type EpubParsed = {
  title: string;
  author: string;
  language: string;
  opfPath: string;
  spine: EpubSpineItem[];
  toc: { title: string; href: string }[];
};

export type ChapterResult = {
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  contentHtml: string;
  sectionIndex: number;
  totalSections: number;
};

type ZipEntryInfo = {
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export function resolveZipPath(baseDir: string, relativePath: string): string {
  const cleanRel = relativePath.replace(/^\//, "");
  const parts = [
    ...(baseDir ? baseDir.split("/").filter(Boolean) : []),
    ...cleanRel.split("/"),
  ];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

export function parseZipEntries(bytes: Uint8Array): Map<string, ZipEntryInfo> | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

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

  return entries;
}

export async function readZipEntryBytes(
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

export async function readZipEntryText(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntryInfo,
): Promise<string | null> {
  const data = await readZipEntryBytes(bytes, view, entry);
  return data ? new TextDecoder().decode(data) : null;
}

export async function parseEpub(bytes: Uint8Array): Promise<EpubParsed | null> {
  const entries = parseZipEntries(bytes);
  if (!entries) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. container.xml
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

  // Metadata
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const langMatch = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);

  const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : "Sin título";
  const author = authorMatch ? decodeXmlEntities(authorMatch[1]) : "Autor desconocido";
  const language = langMatch ? decodeXmlEntities(langMatch[1]) : "es";

  // Manifest items: id -> { href, mediaType }
  const manifest = new Map<string, { href: string; mediaType: string }>();
  const itemRegex = /<item\b([^>]+)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(opfXml)) !== null) {
    const tag = match[1];
    const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    const typeMatch = tag.match(/\bmedia-type=["']([^"']+)["']/i);
    if (idMatch && hrefMatch) {
      manifest.set(idMatch[1], {
        href: hrefMatch[1],
        mediaType: typeMatch ? typeMatch[1] : "",
      });
    }
  }

  // Spine: ordered itemrefs
  const spine: EpubSpineItem[] = [];
  const spineRegex = /<itemref\b([^>]+)\/?>/gi;
  while ((match = spineRegex.exec(opfXml)) !== null) {
    const tag = match[1];
    const idrefMatch = tag.match(/\bidref=["']([^"']+)["']/i);
    if (idrefMatch) {
      const id = idrefMatch[1];
      const item = manifest.get(id);
      if (item) {
        spine.push({
          id,
          href: item.href,
          fullPath: resolveZipPath(opfDir, item.href),
          mediaType: item.mediaType,
        });
      }
    }
  }

  // TOC (opcional: busca nav o ncx para títulos de capítulos)
  const toc: { title: string; href: string }[] = [];

  return {
    title,
    author,
    language,
    opfPath,
    spine,
    toc,
  };
}

export function sanitizeKindleHtml(
  rawHtml: string,
  chapterDir: string,
  bookHash: string,
): { title: string; contentHtml: string } {
  // Extrae título de <title> o del primer encabezado <h1>/<h2>
  const titleTagMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let chapterTitle = titleTagMatch ? decodeXmlEntities(titleTagMatch[1]) : "";

  // Extraer el cuerpo
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let content = bodyMatch ? bodyMatch[1] : rawHtml;

  // Si no había <title>, buscar el primer encabezado
  if (!chapterTitle) {
    const hMatch = content.match(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/i);
    if (hMatch) {
      chapterTitle = decodeXmlEntities(hMatch[1].replace(/<[^>]+>/g, ""));
    }
  }

  // 1. Quitar soft hyphens (\u00AD)
  content = content.replace(/\u00AD/g, "");

  // 2. Eliminar etiquetas no deseadas o peligrosas
  content = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "");

  // 3. Eliminar eventos inline (onclick, onerror, onload, etc.)
  content = content.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 4. Neutralizar javascript: en enlaces
  content = content.replace(/\bhref\s*=\s*(["'])javascript:[^"']*\1/gi, 'href="#"');

  // 5. Reescribir rutas de imágenes relativas para servirlas vía el Worker
  content = content.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (_full, prefix, quote, srcVal) => {
      const trimmed = srcVal.trim();
      if (/^(https?:|data:|\/\/)/i.test(trimmed)) {
        return `${prefix}${quote}${trimmed}${quote}`;
      }
      const resolved = resolveZipPath(chapterDir, trimmed);
      const resourceUrl = `/k/read/${encodeURIComponent(bookHash)}/resource?path=${encodeURIComponent(resolved)}`;
      return `${prefix}${quote}${resourceUrl}${quote}`;
    },
  );

  // Quitar atributos srcset que puedan romper la carga en navegadores viejos
  content = content.replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  return {
    title: chapterTitle || "Capítulo",
    contentHtml: content.trim(),
  };
}

export async function getEpubChapter(
  bytes: Uint8Array,
  sectionIndex: number,
  bookHash: string,
): Promise<ChapterResult | null> {
  const epub = await parseEpub(bytes);
  if (!epub || epub.spine.length === 0) return null;

  const validIndex = Math.max(0, Math.min(sectionIndex, epub.spine.length - 1));
  const item = epub.spine[validIndex];
  if (!item) return null;

  const entries = parseZipEntries(bytes);
  if (!entries) return null;

  const entry = entries.get(item.fullPath);
  if (!entry) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawHtml = await readZipEntryText(bytes, view, entry);
  if (!rawHtml) return null;

  const chapterDir = item.fullPath.includes("/")
    ? item.fullPath.slice(0, item.fullPath.lastIndexOf("/"))
    : "";

  const { title: chapterTitle, contentHtml } = sanitizeKindleHtml(
    rawHtml,
    chapterDir,
    bookHash,
  );

  return {
    bookTitle: epub.title,
    bookAuthor: epub.author,
    chapterTitle,
    contentHtml,
    sectionIndex: validIndex,
    totalSections: epub.spine.length,
  };
}

export async function getEpubResource(
  bytes: Uint8Array,
  resourcePath: string,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const entries = parseZipEntries(bytes);
  if (!entries) return null;

  // Normalizar la ruta eliminando barras iniciales
  const cleanPath = resourcePath.replace(/^\/+/, "");
  const entry = entries.get(cleanPath);
  if (!entry) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = await readZipEntryBytes(bytes, view, entry);
  if (!data) return null;

  const ext = cleanPath.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    css: "text/css",
    xhtml: "application/xhtml+xml",
    html: "text/html",
  };

  const mimeType = mimeTypes[ext] || "application/octet-stream";
  return { data, mimeType };
}
