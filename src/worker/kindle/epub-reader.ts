// Parser y extractor de capítulos EPUB en servidor para la vista Kindle / E-ink.
// Sin dependencias pesadas: lee el ZIP con DecompressionStream nativo
// y extrae secciones limpias sin JavaScript para dispositivos de tinta electrónica.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { isStopword } from "../../shared/stopwords";
import { isWordToken, normalizeWordForm } from "../../shared/word-form";

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
  language?: string;
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
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
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

  // 2. Eliminar por completo etiquetas ejecutables o con contenido
  // activo. Se quita el bloque entero, no solo la etiqueta.
  const dangerousTags = "script|style|iframe|object|embed|form|svg|math";
  content = content.replace(
    new RegExp("<(" + dangerousTags + ")\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>", "gi"),
    "",
  );
  content = content.replace(
    new RegExp("<\\/?(" + dangerousTags + ")\\b[^>]*>", "gi"),
    "",
  );

  // 3. Quitar atributos on* y neutralizar URL peligrosas, incluidas las
  // ofuscadas con entidades, espacios o caracteres de control.
  content = content.replace(
    /<([a-z][a-z0-9:-]*)([^>]*)>/gi,
    (_tag, name: string, attrs: string) => {
      const cleaned = attrs
        .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(
          /\s+(href|src|xlink:href|action|formaction|poster|background|srcdoc)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
          (
            full,
            attr: string,
            doubleQuoted?: string,
            singleQuoted?: string,
            unquoted?: string,
          ) => {
            const raw = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
            const normalized = Array.from(decodeXmlEntities(raw))
              .filter((char) => char.charCodeAt(0) > 0x20)
              .join("")
              .toLowerCase();
            return /^(?:javascript|vbscript|data:text\/html)/.test(normalized)
              ? " " + attr + '="#"'
              : full;
          },
        );
      return "<" + name + cleaned + ">";
    },
  );


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
    language: epub.language || "es",
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

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&[a-z0-9#]+;/gi, " ").trim();
}

export function splitHtmlIntoBlocks(html: string): string[] {
  let clean = html.replace(/<!--[\s\S]*?-->/g, "").trim();

  // Desenvolver recursivamente contenedores (div, section, article) que encierran bloques hijos
  let prev = "";
  const containerRegex = /<(?:div|section|article|header|footer|main)\b[^>]*>([\s\S]*?)<\/(?:div|section|article|header|footer|main)>/gi;
  const childBlockRegex = /<(?:p|h[1-6]|blockquote|ul|ol|table|figure|div|section)\b/i;

  let iterations = 0;
  while (clean !== prev && iterations < 5) {
    prev = clean;
    clean = clean.replace(containerRegex, (full, inner) => {
      if (childBlockRegex.test(inner)) {
        return inner.trim();
      }
      return full;
    });
    iterations++;
  }

  // Extraer bloques independientes
  const blockRegex = /<(?:p|h[1-6]|blockquote|ul|ol|table|figure|div)\b[\s\S]*?<\/(?:p|h[1-6]|blockquote|ul|ol|table|figure|div)>|<(?:img|hr)\b[^>]*\/?>/gi;
  const blocks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(clean)) !== null) {
    const intervening = clean.slice(lastIndex, match.index).trim();
    if (intervening) {
      const stripped = stripHtml(intervening);
      if (stripped.length > 0) {
        blocks.push(`<p>${intervening}</p>`);
      }
    }
    blocks.push(match[0].trim());
    lastIndex = match.index + match[0].length;
  }

  const trailing = clean.slice(lastIndex).trim();
  if (trailing) {
    const stripped = stripHtml(trailing);
    if (stripped.length > 0) {
      blocks.push(`<p>${trailing}</p>`);
    }
  }

  if (blocks.length === 0 && clean.length > 0) {
    blocks.push(`<p>${clean}</p>`);
  }

  return blocks;
}

function splitLongParagraph(blockHtml: string, maxLen = 850): string[] {
  const pMatch = blockHtml.match(/^<p\b([^>]*)>([\s\S]*?)<\/p>$/i);
  if (!pMatch) return [blockHtml];
  const attrs = pMatch[1];
  const content = pMatch[2];
  const textLen = stripHtml(content).length;
  if (textLen <= maxLen) return [blockHtml];

  // Dividir en límites de oraciones (. , ! , ? )
  const sentences = content.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && (current.length + sentence.length > maxLen)) {
      parts.push(`<p${attrs}>${current.trim()}</p>`);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) {
    parts.push(`<p${attrs}>${current.trim()}</p>`);
  }

  return parts.length > 0 ? parts : [blockHtml];
}

export type KindleFontSize = "sm" | "md" | "lg" | "xl";

export type PaginateOptions = {
  size?: KindleFontSize;
  maxCharsPerPage?: number;
  layout?: "paged" | "scroll";
};

export const KINDLE_PAGE_BUDGETS: Record<KindleFontSize, { standard: number; pageZero: number }> = {
  sm: { standard: 620, pageZero: 520 },
  md: { standard: 480, pageZero: 390 },
  lg: { standard: 360, pageZero: 280 },
  xl: { standard: 260, pageZero: 190 },
};

export const KINDLE_SCROLL_BUDGET = 1200;
export const BLOCK_BREAK_PENALTY = 45;

function countBlockClosures(html: string): number {
  const matches = html.match(/<\/(?:p|blockquote|li)>/gi);
  return matches ? matches.length : 0;
}

export function paginateChapter(
  contentHtml: string,
  options?: number | PaginateOptions,
): string[] {
  let size: KindleFontSize = "md";
  let maxCharsPerPage: number | undefined;
  let isScroll = false;

  if (typeof options === "number") {
    maxCharsPerPage = options;
  } else if (options && typeof options === "object") {
    size = options.size || "md";
    maxCharsPerPage = options.maxCharsPerPage;
    isScroll = options.layout === "scroll";
  }

  const standardBudget = isScroll
    ? (maxCharsPerPage ?? KINDLE_SCROLL_BUDGET)
    : (maxCharsPerPage ?? KINDLE_PAGE_BUDGETS[size].standard);

  const pageZeroBudget = isScroll
    ? standardBudget
    : (maxCharsPerPage ?? KINDLE_PAGE_BUDGETS[size].pageZero);

  const rawBlocks = splitHtmlIntoBlocks(contentHtml);
  if (rawBlocks.length === 0) return [contentHtml || "<p>Sin contenido.</p>"];

  const expandedBlocks: string[] = [];
  for (const b of rawBlocks) {
    expandedBlocks.push(...splitLongParagraph(b, standardBudget));
  }

  const pages: string[] = [];
  let currentPageBlocks: string[] = [];
  let currentWeight = 0;

  for (const block of expandedBlocks) {
    const rawLen = stripHtml(block).length || 50;
    const closures = countBlockClosures(block);
    const blockWeight = rawLen + closures * BLOCK_BREAK_PENALTY;

    const currentLimit = pages.length === 0 ? pageZeroBudget : standardBudget;

    if (currentPageBlocks.length > 0 && currentWeight + blockWeight > currentLimit) {
      pages.push(currentPageBlocks.join("\n"));
      currentPageBlocks = [block];
      currentWeight = blockWeight;
    } else {
      currentPageBlocks.push(block);
      currentWeight += blockWeight;
    }
  }

  if (currentPageBlocks.length > 0) {
    pages.push(currentPageBlocks.join("\n"));
  }

  return pages.length > 0 ? pages : [contentHtml];
}

export function extractPageWords(pageHtml: string, language = "es"): string[] {
  const text = stripHtml(pageHtml);
  const wordRegex = /[\p{L}\p{M}]{3,}/gu;
  const matches = text.match(wordRegex) || [];

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const match of matches) {
    const lower = match.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    if (!isWordToken(match)) continue;
    if (isStopword(lower, language)) continue;

    candidates.push(match);
  }

  return candidates;
}

export function formatChapterHtmlForMode(
  html: string,
  mode: "clean" | "paragraphs" | "lexicon",
): string {
  if (mode !== "paragraphs") return html;

  let pIndex = 1;
  return html.replace(/<p(\b[^>]*)>([\s\S]*?)<\/p>/gi, (_match, attrs, content) => {
    const textLen = stripHtml(content).length;
    const isLong = textLen > 250;
    const classAttrMatch = attrs.match(/\bclass="([^"]*)"/i);
    let newAttrs: string;
    const addedClass = isLong ? "p-guided" : "";
    if (classAttrMatch) {
      const existing = classAttrMatch[1];
      const combined = `${existing} ${addedClass}`.trim();
      newAttrs = attrs.replace(/\bclass="[^"]*"/i, `class="${combined}"`);
    } else if (addedClass) {
      newAttrs = `${attrs} class="${addedClass}"`;
    } else {
      newAttrs = attrs;
    }
    const numSpan = `<span class="p-num">§${pIndex}</span>`;
    pIndex++;
    return `<p${newAttrs}>${numSpan}${content}</p>`;
  });
}

export function wrapWordsWithLinks(
  html: string,
  _bookHash: string,
  _currentUrl: string,
  savedWords: Set<string>,
  notedWordsMap?: Map<string, number>,
): string {
  const tokens = html.split(/(<[^>]+>)/g);
  let inAnchor = false;
  let inScriptOrStyle = false;

  const wordRegex = /([\p{L}\p{M}]{2,}(?:['’][\p{L}\p{M}]+)?)/gu;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i % 2 === 1) {
      if (/^<a\b/i.test(token)) {
        inAnchor = true;
      } else if (/^<\/a>/i.test(token)) {
        inAnchor = false;
      } else if (/^<(script|style)\b/i.test(token)) {
        inScriptOrStyle = true;
      } else if (/^<\/(script|style)>/i.test(token)) {
        inScriptOrStyle = false;
      }
    } else {
      if (!inAnchor && !inScriptOrStyle && token.length > 0) {
        tokens[i] = token.replace(wordRegex, (word) => {
          const lower = word.toLowerCase();
          const isSaved = savedWords.has(lower);
          const noteIndex = notedWordsMap?.get(lower);
          let cls = isSaved ? "w saved" : "w";
          let sup = "";
          if (noteIndex != null) {
            cls += " w-lexicon";
            sup = `<sup>${noteIndex}</sup>`;
          }
          return `<span class="${cls}" data-w="${lower}">${word}${sup}</span>`;
        });
      }
    }
  }

  return tokens.join("");
}

export function extractChapterPrepCandidates(
  chapterHtml: string,
  language = "es",
): string[] {
  const text = stripHtml(chapterHtml);
  const wordRegex = /[\p{L}\p{M}]{3,}/gu;
  const matches = text.match(wordRegex) || [];

  const capitalized = new Set<string>();
  const lowercased = new Set<string>();

  for (const word of matches) {
    const first = word.charAt(0);
    const lower = word.toLowerCase();
    if (first.toLowerCase() === first) {
      lowercased.add(lower);
    } else {
      capitalized.add(lower);
    }
  }

  const capitalOnly = new Set<string>();
  for (const form of capitalized) {
    if (!lowercased.has(form)) capitalOnly.add(form);
  }

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const match of matches) {
    const lower = match.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    if (!isWordToken(match)) continue;
    if (isStopword(lower, language)) continue;
    if (capitalOnly.has(lower)) continue;

    candidates.push(lower);
  }

  return candidates;
}

export function findSentenceWithWord(text: string, word: string): string | null {
  const lowerWord = word.toLowerCase();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const clean = s.trim().replace(/\s+/g, " ");
    if (clean.length < 10 || clean.length > 280) continue;
    const words: string[] = clean.toLowerCase().match(/[\p{L}\p{M}]{2,}/gu) || [];
    if (words.includes(lowerWord)) {
      return clean;
    }
  }
  return null;
}

export interface KindlePrimingWord {
  lemma: string;
  surfaceForm: string;
  lang: string;
  beta: number;
  chapterFrequency: number;
  shortGloss: string;
  contextSentence: string;
  partOfSpeech?: string;
  utilityScore: number;
}

export interface KindleUserLexicalState {
  theta: number;
  knownLemmas: Set<string>;
  learningRetrievability: Map<string, number>; // lemma -> R (0..1)
}

/**
 * Calcula la probabilidad de dominio según el modelo logístico de Rasch (1PL)
 */
export function computeRaschMastery(theta: number, beta: number): number {
  const z = Math.max(-10, Math.min(10, theta - beta));
  return 1 / (1 + Math.exp(-z));
}

/**
 * Estima el parámetro theta del lector para el idioma dado a partir de sus registros en D1 (user_knowledge)
 */
export function estimateThetaFromD1Knowledge(
  records: Array<{ word: string; status: string; difficultyBeta?: number }>
): number {
  let theta = 0.0;
  let uncertainty = 1.0;

  for (const row of records) {
    const beta = row.difficultyBeta ?? 0.5;
    const outcome = row.status === 'known' ? 1 : 0;
    const expected = computeRaschMastery(theta, beta);
    const k = 0.18 * Math.max(0.3, uncertainty);
    theta = Math.max(-3.5, Math.min(4.0, theta + k * (outcome - expected)));
    uncertainty = Math.max(0.25, uncertainty * 0.96);
  }

  return Number(theta.toFixed(4));
}

/**
 * Extrae la oración exacta del capítulo (máx. 140 caracteres) donde aparece la palabra
 */
export function extractCompactContextSentence(chapterPlainText: string, surfaceForm: string): string {
  const escaped = surfaceForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unicodeRegex = new RegExp(`([^.!?\\n]*(?<=^|[^\\p{L}\\p{M}\\d_])${escaped}(?=$|[^\\p{L}\\p{M}\\d_])[^.!?\\n]*[.!?]?)`, 'iu');
  let match = chapterPlainText.match(unicodeRegex);
  if (!match || !match[1]) {
    const fallbackRegex = new RegExp(`([^.!?\\n]*\\b${escaped}\\b[^.!?\\n]*[.!?]?)`, 'i');
    match = chapterPlainText.match(fallbackRegex);
  }
  if (!match || !match[1]) return '';

  const sentence = match[1].trim().replace(/\s+/g, ' ');
  if (sentence.length <= 140) return sentence;

  const idx = sentence.toLowerCase().indexOf(surfaceForm.toLowerCase());
  const start = Math.max(0, idx - 55);
  const end = Math.min(sentence.length, idx + surfaceForm.length + 55);
  return `${start > 0 ? '…' : ''}${sentence.slice(start, end).trim()}${end < sentence.length ? '…' : ''}`;
}

let cachedZipfTable: Map<string, number> | null = null;

export function loadZipfTable(): Map<string, number> {
  if (cachedZipfTable) return cachedZipfTable;
  const map = new Map<string, number>();

  try {
    const candidatePaths = [
      resolve(process.cwd(), "public/lexicon/lemmas-freq-es.tsv.gz"),
      resolve(__dirname, "../../../public/lexicon/lemmas-freq-es.tsv.gz"),
    ];

    let foundPath: string | null = null;
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (foundPath) {
      const buffer = readFileSync(foundPath);
      const text = new TextDecoder().decode(gunzipSync(buffer));
      const lines = text.split("\n");
      for (const line of lines) {
        const tabIdx = line.indexOf("\t");
        if (tabIdx > 0) {
          const lemma = line.slice(0, tabIdx).trim().toLowerCase();
          const z = parseFloat(line.slice(tabIdx + 1));
          if (!isNaN(z)) {
            map.set(lemma, z);
          }
        }
      }
    }
  } catch {
    // Si no está disponible en el entorno o runtime, continúa con mapa vacío
  }

  cachedZipfTable = map;
  return map;
}

export function getZipfFrequency(word: string, lang = "es"): number | null {
  if (lang !== "es") return null;
  const table = loadZipfTable();
  return table.get(word.toLowerCase()) ?? null;
}

/**
 * Selecciona entre 3 y 5 palabras de verdadero valor pedagógico para la antesala E-Ink.
 * Aplica una compuerta estricta de frecuencia léxica descartando cualquier lema o forma con Zipf >= 4.0.
 */
export function selectKindleChapterPrimingWords(
  chapterPlainText: string,
  lang: string,
  userState: KindleUserLexicalState,
  lexiconCatalog: Map<string, { beta: number; gloss: string; pos?: string; zipf?: number | null }>,
  options: { maxWords?: number; isForeignLang?: boolean } = {}
): KindlePrimingWord[] {
  const maxWords = options.maxWords ?? 5;
  const isForeign = options.isForeignLang ?? false;
  const normalizedLang = lang.slice(0, 2).toLowerCase() || 'es';

  // 1. Contabilizar frecuencias y primera forma superficial en el capítulo
  const freqMap = new Map<string, { count: number; surface: string }>();
  const rawTokens = chapterPlainText.split(/[^\p{L}\p{M}'-]+/u).filter(Boolean);

  for (const token of rawTokens) {
    if (token.length < 4) continue;
    const lemma = normalizeWordForm(token.toLowerCase(), normalizedLang);
    if (!lemma || isStopword(lemma, normalizedLang)) continue;
    if (userState.knownLemmas.has(lemma)) continue;

    const prev = freqMap.get(lemma);
    if (prev) {
      prev.count += 1;
    } else {
      freqMap.set(lemma, { count: 1, surface: token });
    }
  }

  // 2. Puntuar cada candidato con Rasch + Zona de Desarrollo Próximo (ZPD) y compuerta Zipf < 4.0
  const scored: KindlePrimingWord[] = [];
  const targetOffset = isForeign ? 0.35 : 0.65;
  const sigma = isForeign ? 1.15 : 1.0;

  for (const [lemma, info] of freqMap.entries()) {
    const lexEntry = lexiconCatalog.get(lemma);
    if (!lexEntry || !lexEntry.gloss) continue;

    // Compuerta de frecuencia léxica estricta: descartar palabras cotidianas con Zipf >= 4.0
    // (casa, hombre, puerta, dijo/decir, noche, etc.)
    const fileZipf = getZipfFrequency(lemma, normalizedLang) ?? getZipfFrequency(info.surface, normalizedLang);
    const candidateZipf = lexEntry.zipf ?? fileZipf;
    if (candidateZipf != null && candidateZipf >= 4.0) {
      continue;
    }

    const pKnown = userState.learningRetrievability.has(lemma)
      ? userState.learningRetrievability.get(lemma)!
      : computeRaschMastery(userState.theta, lexEntry.beta);

    const unknownProb = 1 - pKnown;
    if (unknownProb < 0.25) continue;

    const freqWeight = Math.log(1 + info.count);
    const diff = lexEntry.beta - (userState.theta + targetOffset);
    const zpdWeight = Math.exp(-(diff * diff) / (2 * sigma * sigma));

    const utilityScore = unknownProb * freqWeight * zpdWeight;
    if (utilityScore < 0.20) continue;

    scored.push({
      lemma,
      surfaceForm: info.surface,
      lang: normalizedLang,
      beta: lexEntry.beta,
      chapterFrequency: info.count,
      shortGloss: lexEntry.gloss,
      partOfSpeech: lexEntry.pos,
      contextSentence: extractCompactContextSentence(chapterPlainText, info.surface),
      utilityScore: Number(utilityScore.toFixed(4)),
    });
  }

  return scored
    .sort((a, b) => b.utilityScore - a.utilityScore)
    .slice(0, maxWords);
}

