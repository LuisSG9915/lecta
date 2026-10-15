import { isStopword } from "./stopwords";

export type ExtractedEpubMeta = {
  title?: string;
  author?: string;
  language?: string;
  sections?: number;
};

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
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length) return null;
  if (view.getUint32(localOffset, true) !== 0x04034b50) return null;

  const fileNameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const dataOffset = localOffset + 30 + fileNameLen + extraLen;
  if (dataOffset + entry.compressedSize > bytes.length) return null;

  const raw = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(raw);
  }
  if (entry.compressionMethod === 8) {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      void writer.write(raw as unknown as BufferSource);
      void writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      return new TextDecoder().decode(decompressed);
    } catch {
      return null;
    }
  }
  return null;
}

export async function extractEpubMeta(
  bytes: Uint8Array,
): Promise<ExtractedEpubMeta | null> {
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

  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const langMatch = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);

  let sections: number | undefined;
  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (spineMatch) {
    const itemrefs = spineMatch[1].match(/<itemref\b/gi);
    if (itemrefs) sections = itemrefs.length;
  }

  return {
    title: titleMatch ? decodeXmlEntities(titleMatch[1]) : undefined,
    author: authorMatch ? decodeXmlEntities(authorMatch[1]) : undefined,
    language: langMatch ? decodeXmlEntities(langMatch[1]) : detectBookLanguage(opfXml),
    sections,
  };
}

export function detectBookLanguage(opfXml?: string, sampleText?: string): "es" | "en" {
  if (opfXml) {
    const match = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
    const raw = (match ? decodeXmlEntities(match[1]) : opfXml).trim().toLowerCase();
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
