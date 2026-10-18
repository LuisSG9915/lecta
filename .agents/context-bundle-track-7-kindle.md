# Track 7: Kindle & E-Ink Adaptive Pre-Chapter Vocabulary Priming

## Objective
Extend the scientific pre-chapter vocabulary priming space to the Kindle / E-Ink web reader (`src/worker/kindle/`) in 4 clean phases, respecting E-Ink hardware constraints (zero CSS animations/transitions, high-contrast monochrome, 44px+ tap targets, progressive enhancement with HTML forms) and `.agents/rules/lecta-zero-friction.md`.

## Phase Breakdown for gemini-3.8-flash

### Phase 1: Edge Lexical Extraction & Rasch ZPD Selector (`src/worker/kindle/epub-reader.ts`)
- Implement `estimateThetaFromD1Knowledge` using Rasch 1PL (`1 / (1 + exp(-(theta - beta)))`) over D1 `user_knowledge` records.
- Implement `selectKindleChapterPrimingWords` to select 3 to 5 optimal words per chapter using:
  `Utility = (1 - P(know)) * ln(1 + chapterFreq) * ZPD_Gaussian(theta, beta)`.
- Extract the exact chapter sentence (max 140 chars) via `extractCompactContextSentence`.
- Support both native language books (L1) and foreign language books (L2).

### Phase 2: Zero-Friction Routes, 1-Click Disable & D1 Sync (`src/worker/kindle/routes.ts`)
- When entering `page === 0` of a chapter and priming is enabled (neither `lecta_k_priming_off` nor `lecta_k_mute_:bookId` cookie is set, and `?primed=1` is not set), render the Kindle pre-chapter priming view if there are >= 1 high-utility words.
- Add `POST /kindle/priming/action` to handle:
  - `known`: Upsert `status = 'known'` in `user_knowledge` and recalibrate user theta upward.
  - `save`: Upsert `status = 'learning'` in `user_knowledge` and schedule in `user_reviews` (FSRS).
  - `mute_book`: Set cookie to hide priming for this `bookId` and redirect immediately to `?primed=1`.
  - `disable_all`: Set cookie to disable priming globally and redirect immediately to `?primed=1`.
- Add a toggle link in the Kindle reader top/bottom bar so the user can re-enable or disable pre-reading anytime.

### Phase 3: High-Contrast E-Ink UI & In-Chapter Anchors (`src/worker/kindle/views.ts`)
- Implement `renderKindleChapterPrimingView` with strict E-Ink CSS (`transition: none !important`, `#000` on `#fff`, 2px solid borders, 44px+ buttons) and progressive enhancement (`window.lectaKindleAction` via `fetch` to hide cards without full E-Ink page flash).
- Implement `injectKindlePrimedAnchors` so the 3–5 pre-read words appear in the chapter HTML with a dashed underline and compact inline gloss.

### Phase 4: Vitest Unit & Route Tests (`epub-reader.test.ts` & `routes.test.ts`)
- Add unit tests for `selectKindleChapterPrimingWords`, `estimateThetaFromD1Knowledge`, and `extractCompactContextSentence`.
- Add route tests in `routes.test.ts` verifying:
  1. Rendering of the pre-chapter view on chapter start.
  2. Immediate bypass when `?primed=1` or `mute_book` / `disable_all` is triggered.
  3. D1 `user_knowledge` updates when marking a word as `known` or `save`.


## Current Repository Files

### FILE: .agents/rules/lecta-zero-friction.md
```
---
trigger: always_on
description: Reglas de oro de simplicidad, 1-toque y arquitectura de Kitten TTS para Lecta.
---
# Reglas Inquebrantables de Lecta (Zero-Friction UX)

1. **Inteligencia Invisible (1-Toque)**: Ninguna función psicómetrica (Theta, FSRS, análisis sintáctico) debe mostrar jerga técnica ni bloquear la lectura con modales previos.
2. **Lectura en 0 Segundos**: Tocar un libro en `Shelf.tsx` abre directamente `Reader.tsx`. Prohibido interceptar con `Calibration.tsx`, `BookStart.tsx` o `SectionPreview.tsx` a pantalla completa.
3. **Un Solo Dock Inferior**: En `Reader.tsx` jamás deben coexistir dos barras flotantes inferiores. El Dock único muta suavemente entre Modo Lectura y Modo Audio/TTS.
4. **Kitten TTS Opcional y 100% Funcional**:
   - Por defecto, el TTS usa voces naturales inmediatas (`ttsSpeech.ts`, 0 MB).
   - `kittenTtsEngine.ts` y `kitten-tts.worker.ts` SE MANTIENEN como opción descargable ("Voz Neural HD Offline") almacenada en IndexedDB/CacheStorage tras consentimiento del usuario.
   - Prohibido incluir archivos `.onnx` pesados en el bundle principal del Worker de Cloudflare (< 25 MiB).
   - Implementar pre-síntesis (lookahead buffer de la oración N+1) en `kitten-tts.worker.ts` para eliminar silencios entre frases.
5. **Verificación Continua**: Después de cada cambio en componentes o librerías, ejecuta `pnpm test` (Vitest) y verifica que no existan regresiones de tipos con TypeScript.

```

### FILE: src/worker/kindle/epub-reader.ts
```
// Parser y extractor de capítulos EPUB en servidor para la vista Kindle / E-ink.
// Sin dependencias pesadas: lee el ZIP con DecompressionStream nativo
// y extrae secciones limpias sin JavaScript para dispositivos de tinta electrónica.

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

export function paginateChapter(contentHtml: string, maxCharsPerPage = 850): string[] {
  const rawBlocks = splitHtmlIntoBlocks(contentHtml);
  if (rawBlocks.length === 0) return [contentHtml || "<p>Sin contenido.</p>"];

  const expandedBlocks: string[] = [];
  for (const b of rawBlocks) {
    expandedBlocks.push(...splitLongParagraph(b, maxCharsPerPage));
  }

  const pages: string[] = [];
  let currentPageBlocks: string[] = [];
  let currentLen = 0;

  for (const block of expandedBlocks) {
    const blockLen = stripHtml(block).length || 50;
    if (currentPageBlocks.length > 0 && (currentLen + blockLen > maxCharsPerPage)) {
      pages.push(currentPageBlocks.join("\n"));
      currentPageBlocks = [block];
      currentLen = blockLen;
    } else {
      currentPageBlocks.push(block);
      currentLen += blockLen;
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
  currentUrl: string,
  savedWords: Set<string>,
  notedWordsMap?: Map<string, number>,
): string {
  const tokens = html.split(/(<[^>]+>)/g);
  let inAnchor = false;
  let inScriptOrStyle = false;

  const wordRegex = /([\p{L}\p{M}]{2,}(?:['’][\p{L}\p{M}]+)?)/gu;
  const safeUrl = currentUrl.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, "&amp;");
  const sep = safeUrl.includes("?") ? "&amp;" : "?";

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
          const href = `${safeUrl}${sep}lookup=${encodeURIComponent(lower)}`;
          let cls = isSaved ? "w saved" : "w";
          let sup = "";
          if (noteIndex != null) {
            cls += " w-lexicon";
            sup = `<sup>${noteIndex}</sup>`;
          }
          return `<a href="${href}" class="${cls}">${word}${sup}</a>`;
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

/**
 * Selecciona entre 3 y 5 palabras óptimas para mostrar en la antesala E-Ink del capítulo
 */
export function selectKindleChapterPrimingWords(
  chapterPlainText: string,
  lang: string,
  userState: KindleUserLexicalState,
  lexiconCatalog: Map<string, { beta: number; gloss: string; pos?: string }>,
  options: { maxWords?: number; isForeignLang?: boolean } = {}
): KindlePrimingWord[] {
  const maxWords = options.maxWords ?? 4;
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

  // 2. Puntuar cada candidato con Rasch + Zona de Desarrollo Próximo (ZPD)
  const scored: KindlePrimingWord[] = [];
  const targetOffset = isForeign ? 0.35 : 0.65;
  const sigma = isForeign ? 1.15 : 1.0;

  for (const [lemma, info] of freqMap.entries()) {
    const lexEntry = lexiconCatalog.get(lemma);
    if (!lexEntry || !lexEntry.gloss) continue;

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


```

### FILE: src/worker/kindle/epub-reader.test.ts
```
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeRaschMastery,
  estimateThetaFromD1Knowledge,
  extractChapterPrepCandidates,
  extractCompactContextSentence,
  extractPageWords,
  findSentenceWithWord,
  formatChapterHtmlForMode,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  resolveZipPath,
  sanitizeKindleHtml,
  selectKindleChapterPrimingWords,
  wrapWordsWithLinks,
  type KindleUserLexicalState,
} from "./epub-reader";

describe("epub-reader (Kindle E-ink)", () => {
  const minimalPath = resolve(__dirname, "../../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  describe("resolveZipPath", () => {
    it("resuelve rutas relativas y normaliza puntos", () => {
      expect(resolveZipPath("OEBPS", "chapter1.xhtml")).toBe("OEBPS/chapter1.xhtml");
      expect(resolveZipPath("OEBPS", "./chapter1.xhtml")).toBe("OEBPS/chapter1.xhtml");
      expect(resolveZipPath("OEBPS/text", "../images/cover.jpg")).toBe("OEBPS/images/cover.jpg");
      expect(resolveZipPath("", "META-INF/container.xml")).toBe("META-INF/container.xml");
      expect(resolveZipPath("OEBPS", "/images/fig.png")).toBe("OEBPS/images/fig.png");
    });
  });

  describe("parseEpub", () => {
    it("extrae metadatos, spine y rutas completas de minimal.epub", async () => {
      const epub = await parseEpub(minimalBytes);
      expect(epub).not.toBeNull();
      expect(epub?.title).toBe("Libro de prueba");
      expect(epub?.author).toBe("Equipo Lecta");
      expect(epub?.language).toBe("es");
      expect(epub?.spine.length).toBe(2);
      expect(epub?.spine[0]?.fullPath).toBe("OEBPS/chapter1.xhtml");
      expect(epub?.spine[1]?.fullPath).toBe("OEBPS/chapter2.xhtml");
    });

    it("devuelve null si los bytes no son un zip válido", async () => {
      const invalid = new Uint8Array([0, 1, 2, 3]);
      expect(await parseEpub(invalid)).toBeNull();
    });
  });

  describe("sanitizeKindleHtml", () => {
    it("elimina scripts, eventos on* y neutraliza enlaces javascript", () => {
      const raw = `
        <head><title>Prueba</title><script>alert('xss')</script></head>
        <body>
          <h1>Título</h1>
          <p>Texto</p>
          <img src="foto.jpg" onerror="alert(1)" />
          <a href="javascript:alert(2)">Peligro</a>
        </body>
      `;
      const { title, contentHtml } = sanitizeKindleHtml(raw, "OEBPS", "hash123");
      expect(title).toBe("Prueba");
      expect(contentHtml).not.toContain("<script>");
      expect(contentHtml).not.toContain("alert");
      expect(contentHtml).not.toContain("onerror");
      expect(contentHtml).toContain('href="#"');
      expect(contentHtml).toContain('/k/read/hash123/resource?path=OEBPS%2Ffoto.jpg');
    });
  });

  describe("getEpubChapter", () => {
    it("extrae el primer capítulo sanitizado con conteo de secciones", async () => {
      const result = await getEpubChapter(minimalBytes, 0, "test-book");
      expect(result).not.toBeNull();
      expect(result?.bookTitle).toBe("Libro de prueba");
      expect(result?.chapterTitle).toBe("Capítulo uno");
      expect(result?.sectionIndex).toBe(0);
      expect(result?.totalSections).toBe(2);
      expect(result?.contentHtml).toContain("La casa antigua tenía una puerta estrecha.");
      expect(result?.contentHtml).toContain("Luis leyó despacio una palabra difícil: perenne.");
      // Comprobar sanitización en minimal.epub:
      expect(result?.contentHtml).not.toContain("window.__xss");
      expect(result?.contentHtml).toContain('/k/read/test-book/resource?path=OEBPS%2Fx');
    });

    it("extrae el segundo capítulo correctamente", async () => {
      const result = await getEpubChapter(minimalBytes, 1, "test-book");
      expect(result).not.toBeNull();
      expect(result?.chapterTitle).toBe("Capítulo dos");
      expect(result?.sectionIndex).toBe(1);
      expect(result?.contentHtml).toContain("Otra sección para comprobar navegación.");
    });

    it("ajusta los índices fuera de rango al límite más cercano", async () => {
      const result = await getEpubChapter(minimalBytes, 99, "test-book");
      expect(result?.sectionIndex).toBe(1);
    });
  });

  describe("getEpubResource", () => {
    it("extrae un recurso interno del EPUB con el tipo MIME adecuado", async () => {
      const res = await getEpubResource(minimalBytes, "OEBPS/nav.xhtml");
      expect(res).not.toBeNull();
      expect(res?.mimeType).toBe("application/xhtml+xml");
      expect(res?.data.length).toBeGreaterThan(0);
    });

    it("devuelve null para recursos inexistentes", async () => {
      const res = await getEpubResource(minimalBytes, "no-existe.png");
      expect(res).toBeNull();
    });
  });

  describe("paginateChapter", () => {
    it("divide un texto largo en páginas de longitud controlada", () => {
      const paragraphs = Array.from(
        { length: 10 },
        (_, i) => `<p>Este es el párrafo número ${i + 1} con suficiente texto para simular lectura en tinta electrónica.</p>`,
      ).join("\n");

      // Con límite bajo (~200 chars), se generan múltiples páginas
      const pages = paginateChapter(paragraphs, 250);
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) {
        expect(page).toContain("<p>");
        expect(page).toContain("</p>");
      }
    });

    it("mantiene un texto corto en una sola página", () => {
      const short = "<p>Una sola línea breve.</p>";
      const pages = paginateChapter(short, 1600);
      expect(pages.length).toBe(1);
      expect(pages[0]).toBe(short);
    });
  });

  describe("extractPageWords", () => {
    it("extrae palabras candidatas descartando stopwords y signos", () => {
      const html = "<p>La casa antigua tenía una puerta estrecha y perenne.</p>";
      const words = extractPageWords(html, "es");
      expect(words).toContain("antigua");
      expect(words).toContain("puerta");
      expect(words).toContain("estrecha");
      expect(words).toContain("perenne");
      // Stopwords excluidas
      expect(words).not.toContain("la");
      expect(words).not.toContain("una");
      expect(words).not.toContain("y");
    });
  });

  describe("wrapWordsWithLinks", () => {
    it("envuelve palabras en enlaces de consulta inline respetando tags HTML y puntuación", () => {
      const html = '<p class="lead">La casa antigua.</p>';
      const saved = new Set(["antigua"]);
      const wrapped = wrapWordsWithLinks(
        html,
        "book123",
        "/k/read/book123?section=0&page=0",
        saved,
      );

      // Los atributos de las etiquetas no se tocan
      expect(wrapped).toContain('<p class="lead">');
      expect(wrapped).toContain('</p>');
      // La puntuación queda fuera
      expect(wrapped).toContain('</a>.');
      // Enlace ordinario a lookup en la misma página
      expect(wrapped).toContain('/k/read/book123?section=0&amp;page=0&amp;lookup=casa');
      // Palabra guardada lleva clase saved
      expect(wrapped).toContain('class="w saved"');
      expect(wrapped).toContain('>antigua</a>');
    });

    it("no re-envuelve texto que ya está dentro de un enlace <a>", () => {
      const html = '<p><a href="#nota">Nota al pie</a> y texto normal.</p>';
      const wrapped = wrapWordsWithLinks(html, "b1", "/k", new Set());
      expect(wrapped).toContain('<a href="#nota">Nota al pie</a>');
      expect(wrapped).toContain('/k?lookup=texto');
    });
  });

  describe("extractChapterPrepCandidates", () => {
    it("extrae candidatos descartando stopwords y palabras que solo aparecen en mayúsculas", () => {
      const html = "<p>Pedro y María visitaron la casa antigua y la fortaleza perenne.</p>";
      const candidates = extractChapterPrepCandidates(html, "es");
      expect(candidates).toContain("casa");
      expect(candidates).toContain("antigua");
      expect(candidates).toContain("fortaleza");
      expect(candidates).toContain("perenne");
      // "Pedro" y "María" solo aparecen con mayúscula -> se descartan como nombres propios
      expect(candidates).not.toContain("pedro");
      expect(candidates).not.toContain("maría");
      // Stopwords descartadas
      expect(candidates).not.toContain("la");
      expect(candidates).not.toContain("y");
      expect(candidates).toContain("visitaron");
    });
  });

  describe("findSentenceWithWord", () => {
    it("encuentra la oración que contiene una palabra específica", () => {
      const text = "Esta es la primera frase breve. La casa antigua tenía una puerta secreta de roble. Esta es la tercera.";
      const sentence = findSentenceWithWord(text, "antigua");
      expect(sentence).toBe("La casa antigua tenía una puerta secreta de roble.");
    });

    it("devuelve null si la palabra no está presente", () => {
      const text = "Frase simple sin coincidencias.";
      expect(findSentenceWithWord(text, "inexistente")).toBeNull();
    });
  });

  describe("formatChapterHtmlForMode", () => {
    it("deja el html sin cambios en modo clean o lexicon", () => {
      const html = "<p>Primer párrafo.</p><p>Segundo párrafo.</p>";
      expect(formatChapterHtmlForMode(html, "clean")).toBe(html);
      expect(formatChapterHtmlForMode(html, "lexicon")).toBe(html);
    });

    it("numera los párrafos con §1, §2 en modo paragraphs", () => {
      const html = "<p>Primer párrafo.</p><p>Segundo párrafo.</p>";
      const formatted = formatChapterHtmlForMode(html, "paragraphs");
      expect(formatted).toContain('<span class="p-num">§1</span>Primer párrafo.');
      expect(formatted).toContain('<span class="p-num">§2</span>Segundo párrafo.');
    });

    it("agrega p-guided en párrafos largos de más de 300 caracteres", () => {
      const longText = "A".repeat(350);
      const html = `<p>${longText}</p>`;
      const formatted = formatChapterHtmlForMode(html, "paragraphs");
      expect(formatted).toContain('class="p-guided"');
    });
  });

  describe("wrapWordsWithLinks con notedWordsMap (Modo Léxico)", () => {
    it("añade la clase w-lexicon y superíndice a las palabras anotadas", () => {
      const html = "<p>Un silencio perenne inundó la estancia.</p>";
      const noted = new Map<string, number>([["perenne", 1]]);
      const wrapped = wrapWordsWithLinks(html, "book123", "/k/read/book123", new Set(), noted);
      expect(wrapped).toContain('class="w w-lexicon"');
      expect(wrapped).toContain("perenne<sup>1</sup>");
    });
  });

  describe("computeRaschMastery", () => {
    it("devuelve 0.5 cuando theta es igual a beta", () => {
      expect(computeRaschMastery(1.5, 1.5)).toBeCloseTo(0.5);
      expect(computeRaschMastery(0.0, 0.0)).toBeCloseTo(0.5);
    });

    it("devuelve mayor a 0.5 cuando theta supera a beta", () => {
      expect(computeRaschMastery(2.0, 0.5)).toBeGreaterThan(0.5);
    });

    it("devuelve menor a 0.5 cuando theta es inferior a beta", () => {
      expect(computeRaschMastery(-1.0, 0.5)).toBeLessThan(0.5);
    });
  });

  describe("estimateThetaFromD1Knowledge", () => {
    it("devuelve 0.0 con registros vacíos", () => {
      expect(estimateThetaFromD1Knowledge([])).toBe(0.0);
    });

    it("incrementa theta cuando el usuario domina palabras difíciles", () => {
      const records = [
        { word: "efímero", status: "known", difficultyBeta: 1.2 },
        { word: "ubícuo", status: "known", difficultyBeta: 1.8 },
        { word: "perenne", status: "known", difficultyBeta: 1.5 },
      ];
      const theta = estimateThetaFromD1Knowledge(records);
      expect(theta).toBeGreaterThan(0.0);
    });

    it("disminuye theta si las palabras están en estado learning", () => {
      const records = [
        { word: "casa", status: "learning", difficultyBeta: 0.1 },
        { word: "libro", status: "learning", difficultyBeta: 0.2 },
        { word: "tiempo", status: "learning", difficultyBeta: 0.3 },
      ];
      const theta = estimateThetaFromD1Knowledge(records);
      expect(theta).toBeLessThan(0.0);
    });
  });

  describe("extractCompactContextSentence", () => {
    it("extrae la oración exacta cuando mide menos de 140 caracteres", () => {
      const text = "El gato dormía en el tejado. Una brisa fresca soplaba del norte.";
      const sentence = extractCompactContextSentence(text, "brisa");
      expect(sentence).toBe("Una brisa fresca soplaba del norte.");
    });

    it("trunca oraciones muy largas a un máximo centrado con elipsis", () => {
      const longSentence = "En un remoto confín del universo donde la oscuridad lo cubría todo y las estrellas parecían temblar ante el silencio absoluto, un viajero solitario contemplaba el horizonte infinito con melancólica serenidad.";
      const result = extractCompactContextSentence(longSentence, "viajero");
      expect(result.length).toBeLessThanOrEqual(140);
      expect(result).toContain("viajero");
      expect(result.startsWith("…") || result.endsWith("…")).toBe(true);
    });

    it("funciona con palabras que contienen tildes o caracteres especiales", () => {
      const text = "A la sombra de un frondoso árbol perenne descansaban los caminantes.";
      const sentence = extractCompactContextSentence(text, "árbol");
      expect(sentence).toContain("árbol");
    });

    it("devuelve cadena vacía si la palabra no se encuentra", () => {
      const text = "Texto sin la palabra clave.";
      expect(extractCompactContextSentence(text, "inexistente")).toBe("");
    });
  });

  describe("selectKindleChapterPrimingWords", () => {
    const sampleText = `
      El viejo marinero contemplaba la soledad del océano.
      La soledad era inmensa y un silencio perenne envolvía la embarcación.
      Sintió una honda afrenta al recordar las palabras del capitán.
      Aquella afrenta le quitaba el sueño. La soledad no le asustaba,
      pero el desamparo era difícil de sobrellevar.
    `;

    const userState: KindleUserLexicalState = {
      theta: 0.0,
      knownLemmas: new Set(["viejo", "mar"]),
      learningRetrievability: new Map([["palabra", 0.9]]),
    };

    const catalog = new Map([
      ["soledad", { beta: 0.6, gloss: "Carencia voluntaria o involuntaria de compañía.", pos: "sustantivo" }],
      ["perenne", { beta: 0.8, gloss: "Continuo, incesante, que no prescribe.", pos: "adjetivo" }],
      ["afrenta", { beta: 0.7, gloss: "Vergüenza y deshonor que resulta de algún dicho o hecho.", pos: "sustantivo" }],
      ["desamparo", { beta: 1.1, gloss: "Falta de amparo o protección.", pos: "sustantivo" }],
    ]);

    it("selecciona palabras óptimas ordenadas por utilidad según modelo Rasch y ZPD", () => {
      const selected = selectKindleChapterPrimingWords(sampleText, "es", userState, catalog, {
        maxWords: 4,
      });

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.length).toBeLessThanOrEqual(4);
      // Las palabras seleccionadas deben estar presentes en el catálogo y tener su contexto
      for (const w of selected) {
        expect(w.shortGloss.length).toBeGreaterThan(0);
        expect(w.contextSentence.length).toBeGreaterThan(0);
        expect(w.utilityScore).toBeGreaterThanOrEqual(0.2);
      }
      // Ordenadas de mayor a menor puntuación
      for (let i = 1; i < selected.length; i++) {
        expect(selected[i - 1].utilityScore).toBeGreaterThanOrEqual(selected[i].utilityScore);
      }
    });

    it("no incluye palabras marcadas en knownLemmas", () => {
      const stateWithKnown: KindleUserLexicalState = {
        theta: 0.0,
        knownLemmas: new Set(["soledad", "afrenta"]),
        learningRetrievability: new Map(),
      };
      const selected = selectKindleChapterPrimingWords(sampleText, "es", stateWithKnown, catalog);
      const lemmas = selected.map((s) => s.lemma);
      expect(lemmas).not.toContain("soledad");
      expect(lemmas).not.toContain("afrenta");
    });

    it("soporta selección en inglés (isForeignLang: true)", () => {
      const englishText = `
        She felt a lingering reluctance before entering the dark room.
        The lingering shadows made her hesitate.
        He whispered a quiet warning.
      `;
      const enCatalog = new Map([
        ["linger", { beta: 0.5, gloss: "To stay in a place longer than necessary.", pos: "verb" }],
        ["reluctance", { beta: 0.6, gloss: "Unwillingness or disinclination to do something.", pos: "noun" }],
        ["whisper", { beta: 0.3, gloss: "Speak very softly using one's breath without phonation.", pos: "verb" }],
      ]);
      const enUserState: KindleUserLexicalState = {
        theta: 0.2,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };

      const selected = selectKindleChapterPrimingWords(englishText, "en", enUserState, enCatalog, {
        maxWords: 3,
        isForeignLang: true,
      });

      expect(selected.length).toBeGreaterThan(0);
      expect(selected[0].lang).toBe("en");
    });

    it("descarta palabras cuya puntuación de utilidad sea menor a 0.20 o cuya probabilidad de desconocimiento sea baja", () => {
      const easyCatalog = new Map([
        ["soledad", { beta: -2.5, gloss: "Carencia de compañía.", pos: "sustantivo" }],
      ]);
      const highThetaState: KindleUserLexicalState = {
        theta: 2.0,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };
      const selected = selectKindleChapterPrimingWords(sampleText, "es", highThetaState, easyCatalog);
      // Para theta=2.0 y beta=-2.5, Rasch mastery es prácticamente 1.0 (unknownProb < 0.25), por lo que se descarta
      expect(selected).toHaveLength(0);
    });

    it("aplica lematización y extracción morfológica en inglés (-ing, -ed, -s)", () => {
      const text = "He was lingering in the shadows and whispered before knocking.";
      const enCatalog = new Map([
        ["linger", { beta: 0.6, gloss: "Stay longer than necessary", pos: "verb" }],
        ["whisper", { beta: 0.5, gloss: "Speak very softly without phonation", pos: "verb" }],
      ]);
      const userState: KindleUserLexicalState = {
        theta: 0.0,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };

      const selected = selectKindleChapterPrimingWords(text, "en", userState, enCatalog, {
        maxWords: 5,
        isForeignLang: true,
      });

      const lemmas = selected.map((s) => s.lemma);
      expect(lemmas).toContain("linger");
      expect(lemmas).toContain("whisper");
      // Formas superficiales reflejan el texto original
      const surfaces = selected.map((s) => s.surfaceForm);
      expect(surfaces).toContain("lingering");
      expect(surfaces).toContain("whispered");
    });
  });

  describe("computeRaschMastery y estimateThetaFromD1Knowledge (Robustez matemática)", () => {
    it("computeRaschMastery limita z entre -10 y 10 para evitar overflow o NaN", () => {
      expect(computeRaschMastery(100, 0)).toBeCloseTo(1.0, 4);
      expect(computeRaschMastery(-100, 0)).toBeCloseTo(0.0, 4);
      expect(computeRaschMastery(1.5, 1.5)).toBeCloseTo(0.5, 4);
    });

    it("estimateThetaFromD1Knowledge con registros vacíos devuelve 0.0", () => {
      expect(estimateThetaFromD1Knowledge([])).toBe(0.0);
    });

    it("estimateThetaFromD1Knowledge respeta los límites rígidos [-3.5, 4.0]", () => {
      const allKnown = Array.from({ length: 60 }, (_, i) => ({
        word: `word_${i}`,
        status: "known",
        difficultyBeta: 2.5,
      }));
      const highTheta = estimateThetaFromD1Knowledge(allKnown);
      expect(highTheta).toBeLessThanOrEqual(4.0);
      expect(highTheta).toBeGreaterThan(1.0);

      const allLearning = Array.from({ length: 60 }, (_, i) => ({
        word: `word_${i}`,
        status: "learning",
        difficultyBeta: -1.5,
      }));
      const lowTheta = estimateThetaFromD1Knowledge(allLearning);
      expect(lowTheta).toBeGreaterThanOrEqual(-3.5);
      expect(lowTheta).toBeLessThan(0.0);
    });
  });
});




```

### FILE: src/worker/kindle/routes.ts
```
// Rutas del portal Kindle y dispositivos E-ink para Lecta.
// Servidas íntegramente con HTML/CSS ligero generado en el Cloudflare Worker.

import { Hono, type Context } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "../db";
import { getSession } from "../session";
import { createAuth } from "../auth";
import { findEntries, findEntriesForForms, type LexiconEntryView } from "../lexicon";
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from "ts-fsrs";
import {
  estimateThetaFromD1Knowledge,
  extractChapterPrepCandidates,
  extractPageWords,
  findSentenceWithWord,
  formatChapterHtmlForMode,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  selectKindleChapterPrimingWords,
  stripHtml,
  wrapWordsWithLinks,
  type KindleUserLexicalState,
} from "./epub-reader";
import { ENGLISH_CORE_LEXICON } from "../../shared/english-core-lexicon";
import {
  renderChapterPrepView,
  renderHomeView,
  renderKindleChapterPrimingView,
  renderKindleLinkView,
  renderLoginView,
  renderReaderView,
  renderLookupView,
  renderPracticeView,
  type KindleBookItem,
  type KindleUser,
  type PageWordItem,
  type PrepWordItem,
  type InlineLookupResult,
  type CatPageNoteItem,
} from "./views";

export interface KindleCodeRecord {
  code: string;
  status: "pending" | "linked" | "consumed";
  userId: string | null;
  sessionToken: string | null;
  createdAt: number;
  expiresAt: number;
  redirectUrl?: string;
  userToken?: string | null;
}

export type KindleLinkRecord = KindleCodeRecord;

// Respaldo en memoria para tests unitarios donde c.env.DB no está presente
export const memoryCodeStore = new Map<string, KindleCodeRecord>();
export const kindleLinkCodes = memoryCodeStore;

const SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Sin I/1/O/0 para evitar confusión en tinta electrónica
const CODE_TTL_SECONDS = 600; // 10 minutos

export function generateFourCharKindleCode(): string {
  let code = "";
  const randomBytes = new Uint8Array(4);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 4; i++) {
    code += SAFE_CHARS[randomBytes[i] % SAFE_CHARS.length];
  }
  return code;
}

export function cleanExpiredKindleCodes() {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [code, rec] of memoryCodeStore.entries()) {
    if (rec.expiresAt < nowSec) {
      memoryCodeStore.delete(code);
    }
  }
}

export async function createKindleLinkCode(
  db?: D1Database,
  customCode?: string,
): Promise<KindleCodeRecord> {
  const nowSec = Math.floor(Date.now() / 1000);
  const code = (customCode ?? generateFourCharKindleCode()).toUpperCase();
  const record: KindleCodeRecord = {
    code,
    status: "pending",
    userId: null,
    sessionToken: null,
    userToken: null,
    createdAt: nowSec,
    expiresAt: nowSec + CODE_TTL_SECONDS,
  };

  memoryCodeStore.set(code, record);

  if (db && typeof db.prepare === "function") {
    try {
      await db
        .prepare(`DELETE FROM kindle_link_codes WHERE expires_at < ?`)
        .bind(nowSec)
        .run()
        .catch(() => {});

      await db
        .prepare(
          `INSERT INTO kindle_link_codes (code, status, user_id, session_token, created_at, expires_at)
           VALUES (?, 'pending', NULL, NULL, ?, ?)
           ON CONFLICT(code) DO UPDATE SET status = 'pending', user_id = NULL, session_token = NULL, created_at = excluded.created_at, expires_at = excluded.expires_at`,
        )
        .bind(code, nowSec, record.expiresAt)
        .run();
    } catch {
      // En tests con mocks parciales de D1, el Map en memoria mantiene el flujo vivo
    }
  }

  return record;
}

export async function linkKindleCodeFromMobile(params: {
  db?: D1Database;
  code: string;
  userId: string;
  sessionToken: string;
  redirectUrl?: string;
}): Promise<{ ok: boolean; error?: string; redirectUrl?: string }> {
  const cleanCode = params.code.trim().toUpperCase();
  const nowSec = Math.floor(Date.now() / 1000);

  if (!/^[A-Z0-9]{4}$/.test(cleanCode)) {
    return { ok: false, error: "El código debe tener 4 caracteres." };
  }

  // 1. Intentar actualizar en D1 si está disponible
  if (params.db && typeof params.db.prepare === "function") {
    try {
      const row = await params.db
        .prepare(
          `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = ? LIMIT 1`,
        )
        .bind(cleanCode)
        .first<{ code: string; status: string; expires_at?: number }>();

      if (row) {
        if ((row.expires_at != null && row.expires_at < nowSec) || (row.status && row.status !== "pending")) {
          return { ok: false, error: "Código expirado o ya utilizado." };
        }
        await params.db
          .prepare(
            `UPDATE kindle_link_codes
             SET status = 'linked', user_id = ?, session_token = ?
             WHERE code = ?`,
          )
          .bind(params.userId, params.sessionToken, cleanCode)
          .run();

        const mem = memoryCodeStore.get(cleanCode);
        if (mem) {
          mem.status = "linked";
          mem.userId = params.userId;
          mem.sessionToken = params.sessionToken;
          mem.userToken = params.sessionToken;
          if (params.redirectUrl) mem.redirectUrl = params.redirectUrl;
        } else {
          memoryCodeStore.set(cleanCode, {
            code: cleanCode,
            status: "linked",
            userId: params.userId,
            sessionToken: params.sessionToken,
            userToken: params.sessionToken,
            createdAt: nowSec,
            expiresAt: nowSec + CODE_TTL_SECONDS,
            redirectUrl: params.redirectUrl,
          });
        }
        return { ok: true, redirectUrl: params.redirectUrl };
      }
    } catch {
      // Fallback al store en memoria
    }
  }

  // 2. Fallback en memoria (tests unitarios o dev local sin migración corrida)
  const memRecord = memoryCodeStore.get(cleanCode);
  if (!memRecord || (memRecord.expiresAt && memRecord.expiresAt < nowSec) || memRecord.status !== "pending") {
    return { ok: false, error: "Código inválido o expirado." };
  }

  memRecord.status = "linked";
  memRecord.userId = params.userId;
  memRecord.sessionToken = params.sessionToken;
  memRecord.userToken = params.sessionToken;
  if (params.redirectUrl) memRecord.redirectUrl = params.redirectUrl;
  return { ok: true, redirectUrl: params.redirectUrl };
}

export async function consumeLinkedKindleCode(
  db: D1Database | undefined,
  code: string,
): Promise<{ status: "pending" | "linked" | "expired" | "not_found"; sessionToken?: string; userId?: string; redirectUrl?: string }> {
  const cleanCode = code.trim().toUpperCase();
  const nowSec = Math.floor(Date.now() / 1000);

  if (db && typeof db.prepare === "function") {
    try {
      const row = await db
        .prepare(
          `SELECT code, status, user_id, session_token, expires_at
           FROM kindle_link_codes WHERE code = ? LIMIT 1`,
        )
        .bind(cleanCode)
        .first<{
          code: string;
          status: string;
          user_id: string | null;
          session_token: string | null;
          expires_at?: number;
        }>();

      if (row) {
        if (row.expires_at != null && row.expires_at < nowSec) return { status: "expired" };
        if (row.status === "linked" && row.session_token) {
          const mem = memoryCodeStore.get(cleanCode);
          return {
            status: "linked",
            sessionToken: row.session_token,
            userId: row.user_id ?? undefined,
            redirectUrl: mem?.redirectUrl,
          };
        }
        return { status: "pending" };
      }
    } catch {
      // Fallback a memoria
    }
  }

  const mem = memoryCodeStore.get(cleanCode);
  if (!mem) return { status: "not_found" };
  if (mem.expiresAt && mem.expiresAt < nowSec) return { status: "expired" };
  if (mem.status === "linked" && (mem.sessionToken || mem.userToken)) {
    return {
      status: "linked",
      sessionToken: (mem.sessionToken || mem.userToken) as string,
      userId: mem.userId ?? undefined,
      redirectUrl: mem.redirectUrl,
    };
  }
  return { status: "pending" };
}

export async function handleKindleLinkPage(c: Context<{ Bindings: WorkerEnv }>) {
  cleanExpiredKindleCodes();
  const session = await getSession(c);
  if (session?.user) {
    return c.redirect("/k");
  }

  const queryCode = (c.req.query("code") || "").trim().toUpperCase();
  let code = "";
  if (queryCode && /^[A-Z0-9]{4}$/.test(queryCode)) {
    const mem = memoryCodeStore.get(queryCode);
    const nowSec = Math.floor(Date.now() / 1000);
    if (mem && mem.status === "pending" && mem.expiresAt > nowSec) {
      code = queryCode;
    } else if (c.env?.DB && typeof c.env.DB.prepare === "function") {
      try {
        const row = await c.env.DB.prepare(
          `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = ? AND status = 'pending' LIMIT 1`,
        ).bind(queryCode).first<{ code: string; status: string; expires_at?: number }>();
        if (row && (row.expires_at == null || row.expires_at > nowSec)) {
          code = queryCode;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!code) {
    const record = await createKindleLinkCode(c.env?.DB);
    code = record.code;
  }

  return c.html(renderKindleLinkView({ code, user: null }));
}

export async function handleKindleLinkAction(c: Context<{ Bindings: WorkerEnv }>) {
  cleanExpiredKindleCodes();
  const body = await c.req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  let userSessionToken = typeof body?.userSessionToken === "string" ? body.userSessionToken.trim() : "";

  const session = await getSession(c);
  if (!userSessionToken && session?.session?.token) {
    userSessionToken = session.session.token;
  }
  if (!userSessionToken) {
    const cookieHeader = c.req.header("cookie") || "";
    const match = cookieHeader.match(/(?:better-auth\.session_token|__Secure-better-auth\.session_token)=([^;]+)/);
    if (match) userSessionToken = match[1];
  }
  if (!userSessionToken && session?.user?.id) {
    userSessionToken = `token_${session.user.id}_${Date.now()}`;
  }

  // Redirigir a la página exacta del libro actual si el usuario tiene posición previa
  let redirectUrl = "/k";
  const userId = session?.user?.id;
  if (userId) {
    try {
      const pos = await withClient(c.env, (client) =>
        client.query(
          `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop"
           FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [userId],
        ).then((res) => res.rows[0]),
      );
      if (pos?.bookHash) {
        const sec = pos.sectionIndex != null ? Number(pos.sectionIndex) : 0;
        const page = pos.scrollTop != null ? Number(pos.scrollTop) : 0;
        redirectUrl = `/k/read/${encodeURIComponent(pos.bookHash)}?section=${sec}&page=${page}`;
      }
    } catch {
      /* ignore */
    }
  }

  const result = await linkKindleCodeFromMobile({
    db: c.env?.DB,
    code,
    userId: userId || "",
    sessionToken: userSessionToken,
    redirectUrl,
  });

  if (!result.ok) {
    return c.json({ error: result.error || "Código inválido o expirado" }, 400);
  }

  return c.json({ success: true, redirectUrl });
}

export async function handleKindleStatus(c: Context<{ Bindings: WorkerEnv }>) {
  cleanExpiredKindleCodes();
  const code = (c.req.query("code") || "").trim().toUpperCase();
  if (!code) {
    return c.json({ error: "Código no proporcionado" }, 400);
  }

  const result = await consumeLinkedKindleCode(c.env?.DB, code);

  const isHtml =
    c.req.query("redirect") === "1" ||
    (c.req.header("accept") || "").includes("text/html");

  if (result.status === "not_found") {
    if (isHtml) {
      return c.redirect("/kindle");
    }
    return c.json({ error: "Código no encontrado" }, 404);
  }

  if (result.status === "expired") {
    if (isHtml) {
      return c.redirect("/kindle?error=expired");
    }
    return c.json({ error: "Código expirado", status: "expired" }, 400);
  }

  if (result.status === "linked" && result.sessionToken) {
    c.header(
      "Set-Cookie",
      `better-auth.session_token=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );

    let redirectUrl = result.redirectUrl || "/k";

    // Si aún no apunta a un libro específico y tenemos userId,
    // buscamos en lecta_user_positions (005_user_positions.sql)
    if ((!result.redirectUrl || redirectUrl === "/k") && result.userId) {
      try {
        const pos = await withClient(c.env, (client) =>
          client.query(
            `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop"
             FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            [result.userId],
          ).then((res) => res.rows[0]),
        );
        if (pos?.bookHash) {
          const sec = pos.sectionIndex != null ? Number(pos.sectionIndex) : 0;
          const page = pos.scrollTop != null ? Number(pos.scrollTop) : 0;
          redirectUrl = `/k/read/${encodeURIComponent(pos.bookHash)}?section=${sec}&page=${page}`;
        }
      } catch {
        /* ignore */
      }
    }

    if (isHtml) {
      return c.redirect(redirectUrl);
    }
    return c.json({ linked: true, redirectUrl });
  }

  if (isHtml) {
    return c.redirect(`/kindle?code=${encodeURIComponent(code)}&pending=1`);
  }

  return c.json({ linked: false, status: result.status });
}

/**
 * POST /kindle/priming/action y POST /k/priming/action
 * Maneja acciones sin requerir JS complejo en navegadores E-Ink:
 * - action = 'known': Marca palabra como conocida en user_knowledge y sube theta
 * - action = 'save': Guarda palabra en user_knowledge ('learning') y agenda en user_reviews (FSRS)
 * - action = 'mute_book': Desactiva pre-lectura para este libro
 * - action = 'disable_all': Desactiva pre-lectura globalmente
 */
export async function handleKindlePrimingAction(c: Context<{ Bindings: WorkerEnv }>) {
  const formData = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const action = String(formData["action"] || "");
  const bookId = String(formData["bookId"] || "");
  const chapterIndex = Number(formData["chapter"] ?? formData["section"] ?? 0);
  const lemma = String(formData["lemma"] || "").trim().toLowerCase();
  const lang = String(formData["lang"] || "es").slice(0, 2).toLowerCase();
  const returnUrl = String(
    formData["returnUrl"] || `/k/read/${encodeURIComponent(bookId)}?section=${chapterIndex}`,
  );

  const session = await getSession(c).catch(() => null);
  const userId =
    session?.user?.id ||
    (typeof (c as any).get === "function" ? (c as any).get("userId") : undefined);
  const db = c.env?.DB;
  const now = Date.now();

  if (userId) {
    if (action === "known" && lemma) {
      if (db && typeof db.prepare === "function") {
        await db
          .prepare(
            `INSERT INTO user_knowledge (user_id, word, lang, status, encounters, updated_at)
             VALUES (?1, ?2, ?3, 'known', 1, ?4)
             ON CONFLICT(user_id, word, lang)
             DO UPDATE SET status = 'known', encounters = encounters + 1, updated_at = ?4`,
          )
          .bind(userId, lemma, lang, now)
          .run()
          .catch(() => {});
      }
      if (getConnectionString(c.env)) {
        await withClient(c.env, (client) =>
          client.query(
            `INSERT INTO lecta_user_knowledge
               (user_id, language, lemma, known, source, updated_at, deleted)
             VALUES ($1, $2, $3, true, 'kindle_prep', $4, false)
             ON CONFLICT (user_id, language, lemma) DO UPDATE SET
               known = true,
               source = 'kindle_prep',
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, now],
          ),
        ).catch(() => {});
      }
    } else if (action === "save" && lemma) {
      if (db && typeof db.prepare === "function") {
        await db
          .prepare(
            `INSERT INTO user_knowledge (user_id, word, lang, status, encounters, updated_at)
             VALUES (?1, ?2, ?3, 'learning', 1, ?4)
             ON CONFLICT(user_id, word, lang)
             DO UPDATE SET status = 'learning', encounters = encounters + 1, updated_at = ?4`,
          )
          .bind(userId, lemma, lang, now)
          .run()
          .catch(() => {});

        // Inicializar repaso espaciado FSRS en user_reviews
        await db
          .prepare(
            `INSERT INTO user_reviews (user_id, word, next_review_at, stability, difficulty, reps, lapses, state, updated_at)
             VALUES (?1, ?2, ?3, 1.5, 5.0, 0, 0, 'new', ?3)
             ON CONFLICT(user_id, word) DO NOTHING`,
          )
          .bind(userId, lemma, now + 86_400_000)
          .run()
          .catch(() => {});
      }
      if (getConnectionString(c.env)) {
        await withClient(c.env, async (client) => {
          await client.query(
            `INSERT INTO lecta_user_knowledge
               (user_id, language, lemma, known, source, updated_at, deleted)
             VALUES ($1, $2, $3, false, 'kindle_prep', $4, false)
             ON CONFLICT (user_id, language, lemma) DO UPDATE SET
               known = false,
               source = 'kindle_prep',
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, now],
          ).catch(() => {});
          await client.query(
            `INSERT INTO lecta_user_words
               (user_id, language, form, lemma, pos, meaning, context, book_hash, saved_at, updated_at, deleted)
             VALUES ($1, $2, $3, $3, NULL, NULL, NULL, $4, $5, $5, false)
             ON CONFLICT (user_id, language, form) DO UPDATE SET
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, bookId || null, now],
          ).catch(() => {});
        }).catch(() => {});
      }
    }
  }

  if (action === "mute_book" && bookId) {
    c.header(
      "Set-Cookie",
      `lecta_k_mute_${encodeURIComponent(bookId)}=1; Path=/; Max-Age=31536000; SameSite=Lax`,
      { append: true },
    );
    const sep = returnUrl.includes("?") ? "&" : "?";
    const target = returnUrl.includes("primed=1") ? returnUrl : `${returnUrl}${sep}primed=1`;
    return c.redirect(target, 303);
  }

  if (action === "disable_all") {
    c.header(
      "Set-Cookie",
      `lecta_k_priming_off=1; Path=/; Max-Age=31536000; SameSite=Lax`,
      { append: true },
    );
    const sep = returnUrl.includes("?") ? "&" : "?";
    const target = returnUrl.includes("primed=1") ? returnUrl : `${returnUrl}${sep}primed=1`;
    return c.redirect(target, 303);
  }

  if (action === "enable_all") {
    c.header(
      "Set-Cookie",
      `lecta_k_priming_off=0; Path=/; Max-Age=0; SameSite=Lax`,
      { append: true },
    );
    return c.redirect(returnUrl, 303);
  }

  return c.redirect(returnUrl, 303);
}

export const kindleRoutes = new Hono<{ Bindings: WorkerEnv }>();

kindleRoutes.get("/kindle", handleKindleLinkPage);
kindleRoutes.get("/link", handleKindleLinkPage);
kindleRoutes.get("/verify", handleKindleStatus);
kindleRoutes.get("/api/kindle/status", handleKindleStatus);
kindleRoutes.post("/api/kindle/link", handleKindleLinkAction);
kindleRoutes.post("/priming/action", handleKindlePrimingAction);
kindleRoutes.post("/kindle/priming/action", handleKindlePrimingAction);

// Cabeceras anti-caché para todas las vistas HTML del Kindle:
// garantiza que al refrescar en el Kindle siempre se vean los últimos cambios.
kindleRoutes.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type");
  if (contentType?.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    c.res.headers.set("Expires", "0");
  }
});

// 1. Estantería principal
kindleRoutes.get("/", async (c) => {
  const session = await getSession(c);
  const user: KindleUser | null = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  if (!user || !c.env.BOOKS) {
    return c.html(renderHomeView({ user: null, books: [] }));
  }

  // Listar libros del usuario en R2
  const listed = await c.env.BOOKS.list({ prefix: `books/${user.id}/` }).catch(() => null);
  const objects = listed?.objects ?? [];

  // Obtener posiciones guardadas para mostrar el progreso
  const positionRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop", progress
         FROM lecta_user_positions WHERE user_id = $1`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );

  const positionMap = new Map<string, { sectionIndex: number; pageIndex: number; progress: number }>();
  if (Array.isArray(positionRows)) {
    for (const row of positionRows) {
      positionMap.set(row.bookHash, {
        sectionIndex: Number(row.sectionIndex) || 0,
        pageIndex: Number(row.scrollTop) || 0,
        progress: row.progress != null ? Number(row.progress) : 0,
      });
    }
  }

  const books: KindleBookItem[] = await Promise.all(
    objects.map(async (obj) => {
      const hash = obj.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
      let title = obj.customMetadata?.title || "";
      let author = obj.customMetadata?.author || "";
      let sections = Number(obj.customMetadata?.sections) || 0;

      // Si el libro remoto no tiene título o autor guardado en los metadatos de R2,
      // lo extraemos directamente del archivo EPUB para que se muestre correctamente.
      if (!title || !author || !sections) {
        try {
          const r2Obj = await c.env.BOOKS!.get(obj.key);
          if (r2Obj) {
            const data = new Uint8Array(await r2Obj.arrayBuffer());
            const parsed = await parseEpub(data);
            if (parsed) {
              title = title || parsed.title;
              author = author || parsed.author;
              sections = sections || parsed.spine.length;

              // Actualiza los metadatos en R2 para que las siguientes peticiones sean inmediatas
              const saveMetaPromise = c.env.BOOKS!.put(obj.key, data, {
                httpMetadata: { contentType: "application/epub+zip" },
                customMetadata: {
                  name: obj.customMetadata?.name || `${title}.epub`,
                  title,
                  author,
                  sections: String(sections),
                },
              }).catch(() => null);

              try {
                c.executionCtx.waitUntil(saveMetaPromise);
              } catch {
                void saveMetaPromise;
              }
            }
          }
        } catch {
          // Ignorar fallos de lectura
        }
      }

      if (!title) {
        title = obj.customMetadata?.name?.replace(/\.epub$/i, "") || "Libro sin título";
      }
      if (!author) {
        author = "Autor desconocido";
      }

      const pos = positionMap.get(hash);

      return {
        hash,
        title,
        author,
        sections,
        currentSection: pos ? pos.sectionIndex : null,
        currentPage: pos ? pos.pageIndex : null,
        progressPercent: pos ? pos.progress : null,
      };
    }),
  );

  return c.html(renderHomeView({ user, books }));
});

// 2. Iniciar sesión - Formulario
kindleRoutes.get("/login", async (c) => {
  const session = await getSession(c);
  if (session?.user) {
    return c.redirect("/k");
  }
  const returnTo = c.req.query("returnTo") || "/k";
  const email = c.req.query("email") || "";
  return c.html(renderLoginView({ user: null, email, returnTo }));
});

// 2. Iniciar sesión - Procesar credenciales con Better Auth
kindleRoutes.post("/login", async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/k")
    ? body.returnTo
    : "/k";

  if (!email || !password) {
    return c.html(
      renderLoginView({
        user: null,
        error: "Introduce tu correo y contraseña.",
        email,
        returnTo,
      }),
      400,
    );
  }

  if (!getConnectionString(c.env)) {
    return c.html(
      renderLoginView({
        user: null,
        error: "El servicio de autenticación no está disponible.",
        email,
        returnTo,
      }),
      503,
    );
  }

  const baseURL = c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
  const authReq = new Request(new URL("/api/auth/sign-in/email", baseURL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: new URL(baseURL).origin,
    },
    body: JSON.stringify({ email, password }),
  });

  let authRes: Response;
  try {
    authRes = await createAuth(c.env, baseURL).handler(authReq);
  } catch {
    return c.html(
      renderLoginView({
        user: null,
        error: "Error al comunicarse con el servidor de acceso.",
        email,
        returnTo,
      }),
      500,
    );
  }

  if (!authRes.ok) {
    return c.html(
      renderLoginView({
        user: null,
        error: "Correo electrónico o contraseña incorrectos.",
        email,
        returnTo,
      }),
      401,
    );
  }

  // Extraer las cookies establecidas por Better Auth y redirigir
  const headers = new Headers();
  const rawCookies = authRes.headers.getSetCookie
    ? authRes.headers.getSetCookie()
    : [authRes.headers.get("set-cookie")].filter((x): x is string => Boolean(x));

  for (const cookie of rawCookies) {
    headers.append("Set-Cookie", cookie);
  }
  headers.set("Location", returnTo);

  return new Response(null, { status: 302, headers });
});

// 3. Cerrar sesión
kindleRoutes.get("/logout", async (c) => {
  const baseURL = c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
  const authReq = new Request(new URL("/api/auth/sign-out", baseURL), {
    method: "POST",
    headers: c.req.raw.headers,
  });

  const authRes = await createAuth(c.env, baseURL).handler(authReq).catch(() => null);
  const headers = new Headers();

  if (authRes) {
    const rawCookies = authRes.headers.getSetCookie
      ? authRes.headers.getSetCookie()
      : [authRes.headers.get("set-cookie")].filter((x): x is string => Boolean(x));
    for (const cookie of rawCookies) {
      headers.append("Set-Cookie", cookie);
    }
  }

  // Eliminar explícitamente la cookie por seguridad
  headers.append(
    "Set-Cookie",
    "better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
  );
  headers.set("Location", "/k");

  return new Response(null, { status: 302, headers });
});

// 4. Lector de capítulos
kindleRoutes.get("/read/:hash", async (c) => {
  const session = await getSession(c);
  const hash = c.req.param("hash");

  if (!session?.user) {
    return c.redirect(`/k/login?returnTo=${encodeURIComponent(c.req.url)}`);
  }

  if (!c.env.BOOKS) {
    return c.html("<h1>Error</h1><p>El almacenamiento no está configurado.</p>", 503);
  }

  const user = { id: session.user.id, email: session.user.email, name: session.user.name };
  const requestedSection = c.req.query("section") ?? c.req.query("chapter");
  const requestedPage = c.req.query("page");
  const savedWord = c.req.query("savedWord");
  const markedKnown = c.req.query("markedKnown");
  const lookupWord = c.req.query("lookup")?.trim() || "";
  const isPrep = c.req.query("prep") === "1";
  const rawMode = c.req.query("mode");
  const rawSize = c.req.query("size");
  const rawGloss = c.req.query("gloss");
  const mode = (rawMode as "clean" | "paragraphs" | "lexicon") || "clean";
  const size = (rawSize as "sm" | "md" | "lg" | "xl") || "md";
  const gloss = rawGloss !== "0";
  const querySuffix = `${rawMode ? `&mode=${encodeURIComponent(rawMode)}` : ""}${rawSize ? `&size=${encodeURIComponent(rawSize)}` : ""}${rawGloss !== undefined ? `&gloss=${encodeURIComponent(rawGloss)}` : ""}`;
  const renderQuerySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&gloss=${gloss ? "1" : "0"}`;

  // Si no se especifica la sección en la URL, cargar la última posición guardada (sección y página)
  if (requestedSection === undefined) {
    const lastPos = await withClient(c.env, (client) =>
      client
        .query(
          `SELECT section_index AS "sectionIndex", scroll_top AS "scrollTop" FROM lecta_user_positions
           WHERE user_id = $1 AND book_hash = $2`,
          [user.id, hash],
        )
        .then((res) => res.rows[0])
        .catch(() => null),
    );

    const targetSection = lastPos ? Number(lastPos.sectionIndex) || 0 : 0;
    const targetPage = lastPos && lastPos.scrollTop != null ? Math.max(0, Number(lastPos.scrollTop) || 0) : 0;
    return c.redirect(`/k/read/${encodeURIComponent(hash)}?section=${targetSection}&page=${targetPage}${querySuffix}`);
  }

  const sectionIndex = Math.max(0, parseInt(requestedSection, 10) || 0);

  // Descargar el EPUB de R2
  const key = `books/${user.id}/${hash}.epub`;
  const r2Obj = await c.env.BOOKS.get(key);
  if (!r2Obj) {
    return c.html(
      `<h1>Libro no encontrado</h1><p>No se encontró este libro en tu cuenta.</p><p><a href="/k">Volver a la biblioteca</a></p>`,
      404,
    );
  }

  const data = new Uint8Array(await r2Obj.arrayBuffer());
  const chapter = await getEpubChapter(data, sectionIndex, hash);
  if (!chapter) {
    return c.html(
      `<h1>Error de lectura</h1><p>No se pudo procesar el contenido de este libro.</p><p><a href="/k">Volver a la biblioteca</a></p>`,
      500,
    );
  }

  // Vista de preparación previa al capítulo («Antes de leer»)
  if (isPrep) {
    const cleanText = stripHtml(chapter.contentHtml);
    const candidateForms = extractChapterPrepCandidates(chapter.contentHtml, "es");

    const queryRes = await withClient(c.env, (client) =>
      Promise.all([
        client
          .query(
            `SELECT LOWER(lemma) AS lemma FROM lecta_user_knowledge
             WHERE user_id = $1 AND language = 'es' AND known = true AND deleted = false`,
            [user.id],
          )
          .then((res) => res.rows)
          .catch(() => []),
        client
          .query(
            `SELECT LOWER(form) AS form FROM lecta_user_words
             WHERE user_id = $1 AND deleted = false`,
            [user.id],
          )
          .then((res) => res.rows)
          .catch(() => []),
      ]),
    );

    const knownRows = queryRes ? queryRes[0] : [];
    const savedRows = queryRes ? queryRes[1] : [];

    const knownSet = new Set<string>();
    for (const row of knownRows) {
      if (row.lemma) knownSet.add(row.lemma);
    }
    const savedSet = new Set<string>();
    for (const row of savedRows) {
      if (row.form) savedSet.add(row.form);
    }

    const filteredCandidates = candidateForms.filter((f) => !knownSet.has(f));

    const entriesMap: Record<string, import("../lexicon").LexiconEntryView[]> =
      filteredCandidates.length > 0
        ? ((await withClient(c.env, (client) =>
            findEntriesForForms(client, "es", filteredCandidates.slice(0, 150)),
          ).catch(() => ({}))) ?? {})
        : {};

    const prepItems: PrepWordItem[] = [];
    const seenLemmas = new Set<string>();

    for (const form of filteredCandidates) {
      const entries = entriesMap[form];
      if (!entries || entries.length === 0) continue;
      const entry = entries[0];
      const lemmaLower = (entry.lemma || form).toLowerCase();
      if (knownSet.has(lemmaLower)) continue;
      if (seenLemmas.has(lemmaLower)) continue;

      const firstMeaning = entry.senses && entry.senses.length > 0
        ? entry.senses[0].definition?.trim()
        : null;
      if (!firstMeaning) continue;

      seenLemmas.add(lemmaLower);
      const isSaved = savedSet.has(form) || savedSet.has(lemmaLower);
      const example = findSentenceWithWord(cleanText, form);

      prepItems.push({
        form,
        lemma: entry.lemma || form,
        pos: entry.pos || null,
        meaning: firstMeaning,
        exampleSentence: example,
        saved: isSaved,
        zipf: entry.zipf,
      });
    }

    // Ordenar: primero las que ya tiene guardadas en Cuaderno, luego por rareza (zipf menor primero)
    prepItems.sort((a, b) => {
      if (a.saved && !b.saved) return -1;
      if (!a.saved && b.saved) return 1;
      const zipfA = a.zipf ?? 999;
      const zipfB = b.zipf ?? 999;
      return zipfA - zipfB;
    });

    const topWords = prepItems.slice(0, 7);

    let savedNotice: string | null = null;
    if (savedWord) {
      savedNotice = `✓ Palabra «${savedWord}» guardada en tu Cuaderno.`;
    } else if (markedKnown) {
      savedNotice = `✓ Palabra «${markedKnown}» marcada como conocida.`;
    }

    const nextUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=0`;
    const prevUrl = chapter.sectionIndex > 0
      ? `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex - 1}&page=last`
      : `/k`;

    return c.html(
      renderChapterPrepView({
        user,
        bookHash: hash,
        bookTitle: chapter.bookTitle,
        bookAuthor: chapter.bookAuthor,
        chapterTitle: chapter.chapterTitle,
        sectionIndex: chapter.sectionIndex,
        totalSections: chapter.totalSections,
        words: topWords,
        savedNotice,
        nextUrl,
        prevUrl,
      }),
    );
  }

  // Paginación del capítulo en pantallas discretas
  const pages = paginateChapter(chapter.contentHtml);
  const totalPages = pages.length;

  let pageIndex = 0;
  if (requestedPage === "last") {
    pageIndex = Math.max(0, totalPages - 1);
  } else if (requestedPage !== undefined) {
    pageIndex = Math.min(Math.max(0, parseInt(requestedPage, 10) || 0), totalPages - 1);
  }

  const isPrimed = c.req.query("primed") === "1";
  const cookieHeader = c.req.header("cookie") || "";
  const isPrimingOff = cookieHeader.includes("lecta_k_priming_off=1");
  const isBookMuted = cookieHeader.includes(`lecta_k_mute_${encodeURIComponent(hash)}=1`);

  // Antesala de pre-lectura adaptativa (solo al inicio del capítulo en página 0)
  if (
    pageIndex === 0 &&
    requestedPage !== "last" &&
    !isPrep &&
    !lookupWord &&
    !savedWord &&
    !markedKnown &&
    !isPrimed &&
    !isPrimingOff &&
    !isBookMuted
  ) {
    const bookLang = (chapter.language || "es").slice(0, 2).toLowerCase();
    const cleanText = stripHtml(chapter.contentHtml);

    // 1. Cargar historial del usuario para estimar theta y lemas conocidos
    let d1Rows: Array<{ word: string; status: string; difficultyBeta?: number }> = [];
    if (c.env?.DB && typeof c.env.DB.prepare === "function") {
      try {
        const res = await c.env.DB.prepare(
          `SELECT word, status FROM user_knowledge WHERE user_id = ? AND lang = ?`,
        )
          .bind(user.id, bookLang)
          .all<{ word: string; status: string }>();
        if (res?.results) {
          d1Rows = res.results.map((r) => ({
            word: r.word.toLowerCase(),
            status: r.status,
          }));
        }
      } catch {
        /* fallback */
      }
    }

    const pgKnowledge =
      (getConnectionString(c.env)
        ? await withClient(c.env, (client) =>
            client
              .query<{ lemma: string; known: boolean }>(
                `SELECT LOWER(lemma) AS lemma, known FROM lecta_user_knowledge
                 WHERE user_id = $1 AND language = $2 AND deleted = false`,
                [user.id, bookLang],
              )
              .then((res) => res.rows)
              .catch(() => []),
          )
        : []) ?? [];

    const knowledgeRecords: Array<{ word: string; status: string; difficultyBeta?: number }> = [...d1Rows];
    const knownLemmas = new Set<string>();
    const learningRetrievability = new Map<string, number>();

    for (const r of d1Rows) {
      if (r.status === "known") knownLemmas.add(r.word);
      else if (r.status === "learning") learningRetrievability.set(r.word, 0.5);
    }

    for (const row of pgKnowledge) {
      const status = row.known ? "known" : "learning";
      knowledgeRecords.push({ word: row.lemma, status });
      if (row.known) knownLemmas.add(row.lemma);
      else learningRetrievability.set(row.lemma, 0.5);
    }

    const theta = estimateThetaFromD1Knowledge(knowledgeRecords);
    const userState: KindleUserLexicalState = {
      theta,
      knownLemmas,
      learningRetrievability,
    };

    // 2. Construir catálogo léxico relevante para este capítulo
    const lexiconCatalog = new Map<string, { beta: number; gloss: string; pos?: string }>();

    if (bookLang === "en") {
      for (const [w, item] of Object.entries(ENGLISH_CORE_LEXICON)) {
        lexiconCatalog.set(w, {
          beta: 0.6,
          gloss: item.translation ? `${item.translation}: ${item.definition}` : item.definition,
          pos: item.pos,
        });
      }
    } else {
      const candidateForms = extractChapterPrepCandidates(chapter.contentHtml, "es");
      const filtered = candidateForms.filter((f) => !knownLemmas.has(f)).slice(0, 100);
      if (filtered.length > 0 && getConnectionString(c.env)) {
        const entriesMap: Record<string, import("../lexicon").LexiconEntryView[]> =
          (await withClient(c.env, (client) =>
            findEntriesForForms(client, "es", filtered),
          ).catch(() => ({}))) as Record<string, import("../lexicon").LexiconEntryView[]>;

        for (const [form, entries] of Object.entries(entriesMap)) {
          if (Array.isArray(entries) && entries.length > 0) {
            const entry = entries[0];
            const gloss = entry.senses?.[0]?.definition?.trim();
            if (gloss) {
              const lemma = (entry.lemma || form).toLowerCase();
              lexiconCatalog.set(lemma, {
                beta: entry.zipf ? Math.max(0.1, 5.0 - entry.zipf) : 0.6,
                gloss,
                pos: entry.pos || undefined,
              });
            }
          }
        }
      }
    }

    // 3. Seleccionar palabras óptimas según Rasch + ZPD
    const primingWords = selectKindleChapterPrimingWords(
      cleanText,
      bookLang,
      userState,
      lexiconCatalog,
      { maxWords: 5, isForeignLang: bookLang !== "es" },
    );

    if (primingWords.length > 0) {
      let savedNotice: string | null = null;
      if (savedWord) {
        savedNotice = `✓ Palabra «${savedWord}» guardada en tu Cuaderno.`;
      } else if (markedKnown) {
        savedNotice = `✓ Palabra «${markedKnown}» marcada como conocida.`;
      }

      const readUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=0&primed=1${renderQuerySuffix}`;
      return c.html(
        renderKindleChapterPrimingView({
          user,
          bookId: hash,
          bookHash: hash,
          bookTitle: chapter.bookTitle,
          bookAuthor: chapter.bookAuthor,
          chapterTitle: chapter.chapterTitle,
          chapterIndex: chapter.sectionIndex,
          sectionIndex: chapter.sectionIndex,
          totalSections: chapter.totalSections,
          bookLang,
          lang: bookLang,
          isForeignLang: bookLang !== "es",
          words: primingWords,
          readUrl,
          savedNotice,
        }),
      );
    }
  }

  const rawPageHtml = pages[pageIndex] || "<p>Sin contenido.</p>";

  // Obtener palabras guardadas y conocimiento del usuario
  const [savedWordsRows, knownWordsRows] = (await withClient(c.env, (client) =>
    Promise.all([
      client
        .query<{ form: string }>(
          `SELECT LOWER(form) AS form FROM lecta_user_words
           WHERE user_id = $1 AND deleted = false`,
          [user.id],
        )
        .then((res) => res.rows)
        .catch(() => []),
      client
        .query<{ lemma: string }>(
          `SELECT LOWER(lemma) AS lemma FROM lecta_user_knowledge
           WHERE user_id = $1 AND language = 'es' AND known = true AND deleted = false`,
          [user.id],
        )
        .then((res) => res.rows)
        .catch(() => []),
    ]),
  )) ?? [[], []];

  const savedWordsSet = new Set<string>();
  if (Array.isArray(savedWordsRows)) {
    for (const row of savedWordsRows) {
      if (row.form) savedWordsSet.add(row.form);
    }
  }

  const knownSet = new Set<string>();
  if (Array.isArray(knownWordsRows)) {
    for (const row of knownWordsRows) {
      if (row.lemma) knownSet.add(row.lemma);
    }
  }

  const currentUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=${pageIndex}${renderQuerySuffix}`;

  // Extraer palabras candidatas de esta página
  const candidateWords = extractPageWords(rawPageHtml, "es");
  const pageWords: PageWordItem[] = candidateWords.map((form) => ({
    form,
    saved: savedWordsSet.has(form.toLowerCase()),
  }));

  // Extraer hasta 4 palabras desconocidas para las Notas del Gato
  const unknownCandidates = candidateWords.filter((w) => !knownSet.has(w.toLowerCase()));
  const catNotes: CatPageNoteItem[] = [];
  if (unknownCandidates.length > 0) {
    const entriesMap: Record<string, LexiconEntryView[]> =
      (await withClient(c.env, (client) =>
        findEntriesForForms(client, "es", unknownCandidates.slice(0, 50)),
      ).catch(() => ({}))) ?? {};

    const seenLemmas = new Set<string>();
    let noteIdx = 1;
    for (const form of unknownCandidates) {
      const entries = entriesMap?.[form] || entriesMap?.[form.toLowerCase()];
      if (!entries || entries.length === 0) continue;
      const entry = entries[0];
      const lemma = entry.lemma || form;
      const lemmaLower = lemma.toLowerCase();
      if (knownSet.has(lemmaLower) || seenLemmas.has(lemmaLower)) continue;
      const firstMeaning = entry.senses?.[0]?.definition?.trim();
      if (!firstMeaning) continue;

      seenLemmas.add(lemmaLower);
      catNotes.push({
        form,
        lemma,
        pos: entry.pos || null,
        meaning: firstMeaning,
        noteIndex: noteIdx++,
        saved: savedWordsSet.has(form.toLowerCase()) || savedWordsSet.has(lemmaLower),
      });
      if (catNotes.length >= 4) break;
    }
  }

  const notedWordsMap = new Map<string, number>();
  if (mode === "lexicon") {
    for (const note of catNotes) {
      notedWordsMap.set(note.form.toLowerCase(), note.noteIndex);
    }
  }

  // Formatear texto según modo y enlazar palabras interactivas
  const formattedHtml = formatChapterHtmlForMode(rawPageHtml, mode);
  const interactivePageHtml = wrapWordsWithLinks(
    formattedHtml,
    hash,
    currentUrl,
    savedWordsSet,
    mode === "lexicon" ? notedWordsMap : undefined,
  );

  // Consulta de definición en línea si se pulsó una palabra
  let lookupResult: InlineLookupResult | null = null;
  if (lookupWord) {
    try {
      const entries = await withClient(c.env, (client) =>
        findEntries(client, "es", lookupWord.toLowerCase()),
      );
      lookupResult = {
        word: lookupWord,
        entries: entries || [],
      };
    } catch {
      lookupResult = {
        word: lookupWord,
        entries: [],
      };
    }
  }

  // Guardar la posición de lectura actualizada y registrar actividad en la base de datos
  const pageRatio = totalPages > 1 ? pageIndex / (totalPages - 1) : 0;
  const progress = chapter.totalSections > 1
    ? Math.min(1, Math.max(0, (chapter.sectionIndex + pageRatio) / (chapter.totalSections - 1)))
    : pageRatio;

  const now = Date.now();
  const savePositionPromise = withClient(c.env, async (client) => {
    await client.query(
      `INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
         section_index = excluded.section_index,
         scroll_top = excluded.scroll_top,
         ratio = excluded.ratio,
         progress = excluded.progress,
         updated_at = excluded.updated_at
       WHERE lecta_user_positions.updated_at <= excluded.updated_at`,
      [user.id, hash, chapter.sectionIndex, pageIndex, pageRatio, progress, now],
    );
    const actId = `k_${hash}_${chapter.sectionIndex}_${pageIndex}_${now}`;
    await client.query(
      `INSERT INTO lecta_user_activity (user_id, id, book_hash, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [user.id, actId, hash, Math.max(0, now - 60000), now],
    ).catch(() => null);
  }).catch(() => null);

  try {
    c.executionCtx.waitUntil(savePositionPromise);
  } catch {
    await savePositionPromise;
  }

  let savedNotice: string | null = null;
  if (savedWord) {
    savedNotice = `¡Guardé «${savedWord}» en tu cuaderno! 🐾`;
  } else if (markedKnown) {
    savedNotice = `¡Anotado! Ya conoces «${markedKnown}». 🐾`;
  }

  return c.html(
    renderReaderView({
      user,
      bookHash: hash,
      bookTitle: chapter.bookTitle,
      bookAuthor: chapter.bookAuthor,
      chapterTitle: chapter.chapterTitle,
      contentHtml: interactivePageHtml,
      sectionIndex: chapter.sectionIndex,
      totalSections: chapter.totalSections,
      pageIndex,
      totalPages,
      pageWords,
      savedNotice,
      lookupResult,
      mode,
      size,
      gloss,
      catNotes,
      primingOff: isPrimingOff || isBookMuted,
    }),
  );
});

// 5. Servidor de recursos e imágenes del EPUB
kindleRoutes.get("/read/:hash/resource", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.text("No autorizado", 401);
  }

  const hash = c.req.param("hash");
  const resourcePath = c.req.query("path");
  if (!resourcePath) {
    return c.text("Ruta de recurso faltante", 400);
  }

  if (!c.env.BOOKS) {
    return c.text("Almacenamiento no configurado", 503);
  }

  const key = `books/${session.user.id}/${hash}.epub`;
  const r2Obj = await c.env.BOOKS.get(key);
  if (!r2Obj) {
    return c.text("Libro no encontrado", 404);
  }

  const data = new Uint8Array(await r2Obj.arrayBuffer());
  const resource = await getEpubResource(data, resourcePath);
  if (!resource) {
    return c.text("Recurso no encontrado en el EPUB", 404);
  }

  return new Response(resource.data as unknown as BodyInit, {
    headers: {
      "Content-Type": resource.mimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// 6. Diccionario y consulta de definiciones
kindleRoutes.get("/lookup", async (c) => {
  const session = await getSession(c);
  const user = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  const query = c.req.query("q")?.trim() || "";
  const saved = c.req.query("saved") === "1";
  const returnTo = c.req.query("returnTo") || "/k";
  const bookHash = c.req.query("bookHash") || "";

  let entries: import("../lexicon").LexiconEntryView[] | null = null;
  if (query) {
    try {
      entries = (await withClient(c.env, (client) =>
        findEntries(client, "es", query.toLowerCase()),
      )) ?? [];
    } catch {
      entries = [];
    }
  }

  return c.html(
    renderLookupView({
      user,
      query,
      entries,
      saved,
      returnTo,
      bookHash,
    }),
  );
});

// 7. Guardar palabra en el Cuaderno
kindleRoutes.post("/vocab/add", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const form = typeof body.form === "string" ? body.form.trim() : "";
  let lemma = typeof body.lemma === "string" ? body.lemma.trim() : form;
  let pos = typeof body.pos === "string" ? body.pos.trim() : null;
  let meaning = typeof body.meaning === "string" ? body.meaning.trim() : null;
  const bookHash = typeof body.bookHash === "string" ? body.bookHash.trim() : null;
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  if (!form) {
    return c.redirect(returnTo);
  }

  // Si no se proporcionó significado, buscarlo en el catálogo léxico
  if (!meaning) {
    try {
      const entries = await withClient(c.env, (client) =>
        findEntries(client, "es", form.toLowerCase()),
      );
      if (entries && entries.length > 0) {
        lemma = entries[0].lemma || lemma;
        pos = entries[0].pos || pos;
        meaning = entries[0].senses[0]?.definition || null;
      }
    } catch {
      // Ignorar fallo de búsqueda
    }
  }

  const now = Date.now();
  await withClient(c.env, async (client) => {
    await client.query(
      `INSERT INTO lecta_user_words
         (user_id, language, form, lemma, pos, meaning, context, book_hash, saved_at, updated_at, deleted)
       VALUES ($1, 'es', $2, $3, $4, $5, NULL, $6, $7, $7, false)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma,
         pos = excluded.pos,
         meaning = excluded.meaning,
         book_hash = COALESCE(excluded.book_hash, lecta_user_words.book_hash),
         updated_at = excluded.updated_at,
         deleted = false`,
      [session.user.id, form, lemma, pos, meaning, bookHash, now],
    );
  }).catch(() => null);

  // Si la petición vino del lector directamente, volver al lector con aviso de confirmación
  if (returnTo.includes("/k/read/")) {
    const separator = returnTo.includes("?") ? "&" : "?";
    return c.redirect(`${returnTo}${separator}savedWord=${encodeURIComponent(form)}`);
  }

  const redirectUrl = `/k/lookup?q=${encodeURIComponent(form)}&saved=1&returnTo=${encodeURIComponent(returnTo)}&bookHash=${encodeURIComponent(bookHash || "")}`;
  return c.redirect(redirectUrl);
});

// 8. Marcar palabra como conocida o desconocida en la preparación
kindleRoutes.post("/knowledge/mark", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const lemma = typeof body.lemma === "string" ? body.lemma.trim().toLowerCase() : "";
  const known = body.known === "1" || body.known === "true";
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  if (lemma) {
    const now = Date.now();
    await withClient(c.env, (client) =>
      client.query(
        `INSERT INTO lecta_user_knowledge
           (user_id, language, lemma, known, source, updated_at, deleted)
         VALUES ($1, 'es', $2, $3, 'kindle_prep', $4, false)
         ON CONFLICT (user_id, language, lemma) DO UPDATE SET
           known = excluded.known,
           source = excluded.source,
           updated_at = excluded.updated_at,
           deleted = false`,
        [session.user.id, lemma, known, now],
      ),
    ).catch(() => null);
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  return c.redirect(`${returnTo}${separator}markedKnown=${encodeURIComponent(lemma)}`);
});

// 9. Práctica rápida de vocabulario E-ink
kindleRoutes.get("/practice", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect(`/k/login?returnTo=${encodeURIComponent(c.req.url)}`);
  }

  const user = { id: session.user.id, email: session.user.email, name: session.user.name };
  const qIndex = Math.max(0, parseInt(c.req.query("q") || "0", 10) || 0);
  const correctCount = Math.max(0, parseInt(c.req.query("score") || "0", 10) || 0);
  const bookHash = c.req.query("bookHash") || "";
  const returnTo = c.req.query("returnTo") || (bookHash ? `/k/read/${encodeURIComponent(bookHash)}` : "/k");
  const isDone = c.req.query("done") === "1" || qIndex >= 3;

  if (isDone) {
    return c.html(
      renderPracticeView({
        user,
        isFinished: true,
        correctCount,
        totalQuestions: 3,
        returnTo,
        bookHash,
      }),
    );
  }

  // Cargar palabras guardadas del usuario para practicar
  const wordsRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT form, lemma, pos, meaning, card FROM lecta_user_words
         WHERE user_id = $1 AND deleted = false AND meaning IS NOT NULL
         ORDER BY updated_at DESC LIMIT 15`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );

  const FALLBACK_WORDS = [
    { form: "perenne", lemma: "perenne", pos: "adjetivo", meaning: "Que dura indefinidamente o no se extingue." },
    { form: "inefable", lemma: "inefable", pos: "adjetivo", meaning: "Que no se puede explicar con palabras." },
    { form: "prístino", lemma: "prístino", pos: "adjetivo", meaning: "Antiguo, primero, primitivo o inalterado." },
    { form: "efímero", lemma: "efímero", pos: "adjetivo", meaning: "Que dura un solo día o que es pasajero y breve." },
  ];

  const pool = Array.isArray(wordsRows) && wordsRows.length >= 3 ? wordsRows : FALLBACK_WORDS;
  const targetWord = pool[qIndex % pool.length];

  const otherMeanings = pool
    .filter((w) => w.lemma !== targetWord.lemma && w.meaning !== targetWord.meaning)
    .map((w) => w.meaning);

  const fallbackDistractors = [
    "Dicho de una persona o cosa que se encuentra en todas partes a la vez.",
    "Sosiego, tranquilidad y templanza del ánimo ante las dificultades.",
    "Sentimiento de afecto o nostalgia profunda por el pasado.",
  ];

  const distractor1 = otherMeanings[0] || fallbackDistractors[0];
  const distractor2 = otherMeanings[1] || fallbackDistractors[1];

  const correctKey: "A" | "B" | "C" = qIndex === 0 ? "B" : qIndex === 1 ? "A" : "C";
  const optionsList: { key: "A" | "B" | "C"; text: string; correct: boolean }[] = [];
  if (correctKey === "A") {
    optionsList.push(
      { key: "A", text: targetWord.meaning, correct: true },
      { key: "B", text: distractor1, correct: false },
      { key: "C", text: distractor2, correct: false },
    );
  } else if (correctKey === "B") {
    optionsList.push(
      { key: "A", text: distractor1, correct: false },
      { key: "B", text: targetWord.meaning, correct: true },
      { key: "C", text: distractor2, correct: false },
    );
  } else {
    optionsList.push(
      { key: "A", text: distractor1, correct: false },
      { key: "B", text: distractor2, correct: false },
      { key: "C", text: targetWord.meaning, correct: true },
    );
  }

  return c.html(
    renderPracticeView({
      user,
      question: {
        word: targetWord.form,
        lemma: targetWord.lemma || targetWord.form,
        pos: targetWord.pos,
        options: optionsList,
        questionIndex: qIndex,
        totalQuestions: 3,
      },
      correctCount,
      totalQuestions: 3,
      returnTo,
      bookHash,
    }),
  );
});

// 10. Responder pregunta de práctica
kindleRoutes.post("/practice/answer", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const word = typeof body.word === "string" ? body.word.trim() : "";
  const selectedOption = typeof body.selectedOption === "string" ? body.selectedOption.trim() : "";
  const questionIndex = parseInt(String(body.questionIndex || "0"), 10) || 0;
  const totalQuestions = parseInt(String(body.totalQuestions || "3"), 10) || 3;
  let correctCount = parseInt(String(body.correctCount || "0"), 10) || 0;
  const bookHash = typeof body.bookHash === "string" ? body.bookHash.trim() : "";
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  const expectedKey = questionIndex === 0 ? "B" : questionIndex === 1 ? "A" : "C";
  const isCorrect = selectedOption === expectedKey;
  if (isCorrect) {
    correctCount++;
  }

  const now = Date.now();
  const rating = isCorrect ? "good" : "again";
  const reviewId = `kr_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const actId = `ka_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const eventId = `ke_${now}_${Math.random().toString(36).slice(2, 8)}`;

  await withClient(c.env, async (client) => {
    // 1. FSRS en lecta_user_words
    const existing = await client
      .query(`SELECT card FROM lecta_user_words WHERE user_id = $1 AND form = $2`, [
        session.user.id,
        word,
      ])
      .then((res) => res.rows[0]?.card)
      .catch(() => null);

    const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
    let cardObj: Card;
    try {
      cardObj =
        existing && typeof existing === "object"
          ? (existing as Card)
          : createEmptyCard(new Date(now));
      cardObj.due = new Date(cardObj.due);
      if (cardObj.last_review) cardObj.last_review = new Date(cardObj.last_review);
    } catch {
      cardObj = createEmptyCard(new Date(now));
    }

    const scheduled = scheduler.next(
      cardObj,
      new Date(now),
      isCorrect ? Rating.Good : Rating.Again,
    );
    const updatedCard = scheduled.card;

    await client
      .query(
        `UPDATE lecta_user_words SET card = $1, updated_at = $2 WHERE user_id = $3 AND form = $4`,
        [JSON.stringify(updatedCard), now, session.user.id, word],
      )
      .catch(() => null);

    // 2. Insertar en lecta_user_reviews
    await client
      .query(
        `INSERT INTO lecta_user_reviews (user_id, id, language, form, kind, rating, hints, created_at)
         VALUES ($1, $2, 'es', $3, 'practice', $4, 0, $5)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, reviewId, word, rating, now],
      )
      .catch(() => null);

    // 3. Registrar actividad en lecta_user_activity
    await client
      .query(
        `INSERT INTO lecta_user_activity (user_id, id, book_hash, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, actId, bookHash || "practice", Math.max(0, now - 30000), now],
      )
      .catch(() => null);

    // 4. Registrar evento de compañero en lecta_user_companion_events
    const eventPayload = {
      id: eventId,
      at: now,
      dayKey: new Date(now).toISOString().slice(0, 10),
      kind: "review",
      rating,
    };
    await client
      .query(
        `INSERT INTO lecta_user_companion_events (user_id, id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, eventId, JSON.stringify(eventPayload)],
      )
      .catch(() => null);
  }).catch(() => null);

  const nextIndex = questionIndex + 1;
  const isFinished = nextIndex >= totalQuestions;

  const redirectUrl = isFinished
    ? `/k/practice?done=1&score=${correctCount}&bookHash=${encodeURIComponent(bookHash)}&returnTo=${encodeURIComponent(returnTo)}`
    : `/k/practice?q=${nextIndex}&score=${correctCount}&bookHash=${encodeURIComponent(bookHash)}&returnTo=${encodeURIComponent(returnTo)}`;

  return c.redirect(redirectUrl);
});



```

### FILE: src/worker/kindle/routes.test.ts
```
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

const getSessionMock = vi.hoisted(() => vi.fn());
const authHandlerMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({
    handler: (...args: unknown[]) => authHandlerMock(...args),
    api: { getSession: getSessionMock },
  }),
}));

vi.mock("../db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db")>();
  return {
    ...original,
    getConnectionString: () => "postgres://mock",
    withClient: async (_env: unknown, callback: (client: { query: typeof dbQueryMock }) => Promise<unknown>) =>
      callback({ query: dbQueryMock }),
  };
});

describe("Kindle Routes (/k and /kindle)", () => {
  const minimalPath = resolve(__dirname, "../../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  const mockBooksBucket = {
    list: vi.fn(async () => ({
      objects: [
        {
          key: "books/user-1/mock-hash-1.epub",
          customMetadata: {
            title: "Libro de prueba",
            author: "Equipo Lecta",
            sections: "2",
          },
        },
      ],
    })),
    get: vi.fn(async (key: string) => {
      if (key.includes("mock-hash-1")) {
        return {
          arrayBuffer: async () => minimalBytes.buffer.slice(
            minimalBytes.byteOffset,
            minimalBytes.byteOffset + minimalBytes.byteLength,
          ),
        };
      }
      return null;
    }),
  };

  const env = {
    DATABASE_URL: "postgres://mock",
    BOOKS: mockBooksBucket as unknown,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({ rows: [] });
  });

  describe("Portal Kindle y vinculación por código de 4 letras", () => {
    it("GET /kindle sin sesión genera y muestra el código de 4 letras para e-readers", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Vincular tu Kindle");
      expect(html).toMatch(/[A-Z0-9]{4}/);
    });

    it("GET /kindle con sesión redirige a /k", async () => {
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
    });

    it("POST /api/kindle/link vincula el código con la sesión del usuario", async () => {
      // 1. Obtener código
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Vincular desde móvil
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "mock-session-tok-123" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);
      const linkJson = (await linkRes.json()) as { success: boolean };
      expect(linkJson.success).toBe(true);

      // 3. Kindle consulta estado
      const statusRes = await app.request(`/api/kindle/status?code=${code}`, {}, env);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as { linked: boolean };
      expect(statusJson.linked).toBe(true);
      expect(statusRes.headers.get("set-cookie")).toContain("better-auth.session_token");
    });

    it("utiliza c.env.DB cuando está disponible para registrar y vincular códigos D1", async () => {
      const mockD1Rows = new Map<string, Record<string, unknown>>();
      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: vi.fn(async () => {
              if (sql.includes("INSERT INTO kindle_link_codes")) {
                mockD1Rows.set(args[0] as string, {
                  code: args[0],
                  status: "pending",
                  created_at: Math.floor(Date.now() / 1000),
                });
              } else if (sql.includes("UPDATE kindle_link_codes")) {
                const [userId, userToken, code] = args;
                const existing = mockD1Rows.get(code as string) || { code };
                mockD1Rows.set(code as string, {
                  ...existing,
                  status: "linked",
                  user_id: userId,
                  session_token: userToken,
                });
              }
              return { success: true };
            }),
            first: vi.fn(async () => {
              const code = args[0] as string;
              return mockD1Rows.get(code) || null;
            }),
          }),
        })),
      };

      const d1Env = {
        ...env,
        DB: mockDb as unknown as D1Database,
      };

      // 1. Generar código con D1
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, d1Env);
      expect(kindleRes.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO kindle_link_codes"),
      );

      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Vincular código
      getSessionMock.mockResolvedValueOnce({
        user: { id: "d1-user", email: "d1@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "d1-session-token" }),
        },
        d1Env,
      );
      expect(linkRes.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE kindle_link_codes"),
      );

      // 3. Consultar estado desde Kindle
      const statusRes = await app.request(`/api/kindle/status?code=${code}`, {}, d1Env);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as { linked: boolean };
      expect(statusJson.linked).toBe(true);
      expect(statusRes.headers.get("set-cookie")).toContain("d1-session-token");
    });

    it("muestra el botón físico HTML 'Ya ingresé el código en mi celular → Entrar' en la pantalla de vinculación", async () => {
      getSessionMock.mockResolvedValueOnce(null);
      const res = await app.request("/kindle", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Ya ingresé el código en mi celular → Entrar");
      expect(html).toContain("/api/kindle/status?code=");
      expect(html).toContain("redirect=1");
    });

    it("al confirmar código vinculado vía botón físico (?redirect=1) establece cookie y redirige a la última posición leída", async () => {
      // 1. Crear código
      getSessionMock.mockResolvedValueOnce(null);
      const kindleRes = await app.request("/kindle", {}, env);
      const html = await kindleRes.text();
      const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
      const code = codeMatch ? codeMatch[1] : "";
      expect(code).toHaveLength(4);

      // 2. Simular posición previa en lecta_user_positions
      dbQueryMock.mockResolvedValueOnce({
        rows: [{ bookHash: "ultimo-libro", sectionIndex: 3, scrollTop: 1 }],
      });

      // 3. Vincular desde móvil
      getSessionMock.mockResolvedValueOnce({
        user: { id: "user-lector", email: "lector@example.com" },
      });
      const linkRes = await app.request(
        "/api/kindle/link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, userSessionToken: "token-lector-abc" }),
        },
        env,
      );
      expect(linkRes.status).toBe(200);

      // 4. Kindle pulsa botón físico con redirect=1
      const buttonClickRes = await app.request(`/api/kindle/status?code=${code}&redirect=1`, {}, env);
      expect(buttonClickRes.status).toBe(302);
      expect(buttonClickRes.headers.get("set-cookie")).toContain("token-lector-abc");
      expect(buttonClickRes.headers.get("Location")).toContain("/k/read/ultimo-libro");
      expect(buttonClickRes.headers.get("Location")).toContain("section=3");
      expect(buttonClickRes.headers.get("Location")).toContain("page=1");
    });

    it("/kindle/read/123 redirige a /k/read/123", async () => {
      const res = await app.request("/kindle/read/123", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/123");
    });
  });

  describe("GET /k (Estantería)", () => {
    it("para usuarios no autenticados muestra la bienvenida y el enlace para entrar", async () => {
      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Lecta para Kindle y E-ink");
      expect(html).toContain("Iniciar sesión");
    });

    it("para usuarios con sesión muestra su lista de libros y progreso", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [{ bookHash: "mock-hash-1", sectionIndex: 0, progress: 0.5 }],
      });

      const res = await app.request("/k", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Mis Libros");
      expect(html).toContain("Libro de prueba");
      expect(html).toContain("Equipo Lecta");
      expect(html).toContain("Continuar lectura");
      expect(html).toContain("Cerrar sesión");
    });
  });

  describe("GET y POST /k/login", () => {
    it("GET /k/login muestra el formulario para invitados", async () => {
      const res = await app.request("/k/login", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Iniciar sesión en Lecta");
      expect(html).toContain('name="email"');
      expect(html).toContain('name="password"');
    });

    it("GET /k/login redirige a /k si ya hay sesión iniciada", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/login", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
    });

    it("POST /k/login rechaza petición sin credenciales", async () => {
      const formData = new FormData();
      formData.append("email", "");
      formData.append("password", "");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Introduce tu correo y contraseña.");
    });

    it("POST /k/login muestra error si Better Auth rechaza las credenciales", async () => {
      authHandlerMock.mockResolvedValue(new Response("{}", { status: 401 }));

      const formData = new FormData();
      formData.append("email", "bad@example.com");
      formData.append("password", "wrong");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("Correo electrónico o contraseña incorrectos.");
    });

    it("POST /k/login establece la cookie de sesión y redirige a /k si es correcto", async () => {
      authHandlerMock.mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: {
            "set-cookie": "better-auth.session_token=mock-token; Path=/; HttpOnly",
          },
        }),
      );

      const formData = new FormData();
      formData.append("email", "good@example.com");
      formData.append("password", "correct");

      const res = await app.request("/k/login", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
      expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=mock-token");
    });
  });

  describe("GET /k/logout", () => {
    it("elimina la cookie de sesión y redirige a /k", async () => {
      authHandlerMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const res = await app.request("/k/logout", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k");
      expect(res.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });
  });

  describe("GET /k/read/:hash", () => {
    it("redirige al login si no hay sesión iniciada", async () => {
      const res = await app.request("/k/read/mock-hash-1", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("sin parámetro section, consulta la última posición y redirige incluyendo la página", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [{ sectionIndex: 1, scrollTop: 2 }],
      });

      const res = await app.request("/k/read/mock-hash-1", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/k/read/mock-hash-1?section=1&page=2");
    });

    it("con section=0 muestra el capítulo 1 paginado con cabecera compacta y botón para pasar página", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/mock-hash-1?section=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      // Cabecera compacta con título y autor
      expect(html).toContain("reader-header");
      expect(html).toContain("Libro de prueba");
      expect(html).toContain("Equipo Lecta");
      // Las palabras se convierten en enlaces a consulta inline en la misma página
      expect(html).toContain("lookup=antigua");
      expect(html).toContain("lookup=estrecha");
      expect(html).toContain("lookup=perenne");
      // Botón directo para pasar página o avanzar al siguiente capítulo
      expect(html).toMatch(/Siguiente (página|capítulo) →/);
      // El contenido del libro se presenta limpio sin cajas inferiores de vocabulario
      expect(html).toContain("epub-content");
      expect(html).toContain("turn-page-bar");
    });

    it("con parámetro lookup muestra la definición inline sin salir del libro", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
          },
        ],
      });

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&lookup=perenne", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("inline-lookup-card");
      expect(html).toContain("perenne");
      expect(html).toContain("adjetivo");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("✕ Cerrar");
      expect(html).toContain("+ Guardar en mi Cuaderno");
    });

    it("con prep=1 muestra la preparación previa al capítulo con palabras y botón de comenzar capítulo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
            queried_form: "perenne",
          },
        ],
      });

      const res = await app.request("/k/read/mock-hash-1?section=0&prep=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer");
      expect(html).toContain("Capítulo uno");
      expect(html).toContain("Comenzar capítulo 1 →");
      expect(html).toContain("section=0&amp;page=0");
    });

    it("con mode=paragraphs muestra la clase mode-paragraphs y números de párrafo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&mode=paragraphs", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-paragraphs");
      expect(html).toContain("p-num");
    });

    it("con mode=lexicon muestra la clase mode-lexicon", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&mode=lexicon", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("mode-lexicon");
      expect(html).toContain("[ Modo Léxico ]");
    });
  });

  describe("GET /k/read/:hash/resource", () => {
    it("sirve un recurso del EPUB con su MIME type", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/mock-hash-1/resource?path=OEBPS/nav.xhtml", {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/xhtml+xml");
    });
  });

  describe("GET /k/lookup (Diccionario)", () => {
    it("muestra la barra de búsqueda del diccionario", async () => {
      const res = await app.request("/k/lookup", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Diccionario de Lecta");
    });

    it("muestra definiciones cuando se encuentra la palabra", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      // Mock findEntries
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            entry_id: "1001",
            lemma: "perenne",
            pos: "adjetivo",
            freq_rank: 500,
            zipf: 4.5,
            definition: "Que dura indefinidamente.",
            example: "Un árbol de hoja perenne.",
            sense_order: 1,
          },
        ],
      });

      const res = await app.request("/k/lookup?q=perenne", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("perenne");
      expect(html).toContain("adjetivo");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("+ Guardar en mi Cuaderno");
    });
  });

  describe("POST /k/vocab/add (Guardar en Cuaderno)", () => {
    it("guarda la palabra desde el lector y redirige de vuelta al lector con savedWord", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "perenne");
      formData.append("lemma", "perenne");
      formData.append("pos", "adjetivo");
      formData.append("meaning", "Que dura indefinidamente.");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/mock-hash-1?section=0&page=0");
      expect(location).toContain("savedWord=perenne");

      // Verificar que se insertó en la base de datos
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "perenne", "perenne", "adjetivo"]),
      );
    });

    it("guarda la palabra desde el diccionario y redirige a /k/lookup con saved=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("form", "perenne");
      formData.append("lemma", "perenne");
      formData.append("pos", "adjetivo");
      formData.append("meaning", "Que dura indefinidamente.");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/lookup?q=perenne");

      const res = await app.request("/k/vocab/add", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/lookup");
      expect(location).toContain("saved=1");
      expect(location).toContain("q=perenne");
    });
  });

  describe("POST /k/knowledge/mark", () => {
    it("marca un lema como conocido e inserta en lecta_user_knowledge", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("lemma", "perenne");
      formData.append("known", "1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&prep=1");

      const res = await app.request("/k/knowledge/mark", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/read/mock-hash-1?section=0&prep=1");
      expect(location).toContain("markedKnown=perenne");

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_knowledge"),
        expect.arrayContaining(["user-1", "perenne", true]),
      );
    });
  });

  describe("GET y POST /k/practice (Práctica de Vocabulario)", () => {
    it("GET /k/practice redirige a login si no hay sesión iniciada", async () => {
      const res = await app.request("/k/practice", {}, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("/k/login");
    });

    it("GET /k/practice muestra pantalla de práctica para usuario autenticado", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });
      dbQueryMock.mockResolvedValue({
        rows: [
          {
            form: "perenne",
            meaning: "Que dura indefinidamente.",
            card: null,
          },
        ],
      });

      const res = await app.request("/k/practice", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Práctica");
    });

    it("POST /k/practice/answer procesa respuesta y redirige a la siguiente pregunta", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("word", "perenne");
      formData.append("selectedOption", "B");
      formData.append("questionIndex", "0");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "0");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/practice?q=1");
      expect(location).toContain("score=1");
    });

    it("POST /k/practice/answer al terminar redirige con done=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("word", "perenne");
      formData.append("selectedOption", "C");
      formData.append("questionIndex", "2");
      formData.append("totalQuestions", "3");
      formData.append("correctCount", "2");
      formData.append("bookHash", "mock-hash-1");
      formData.append("returnTo", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/practice/answer", { method: "POST", body: formData }, env);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("/k/practice?done=1");
      expect(location).toContain("score=3");
    });
  });

  describe("Espacio de Pre-lectura Adaptativo (Fase 2)", () => {
    it("POST /kindle/priming/action con action=known actualiza user_knowledge", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "known");
      formData.append("lemma", "perenne");
      formData.append("lang", "es");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toContain("/k/read/mock-hash-1");
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_knowledge"),
        expect.arrayContaining(["user-1", "es", "perenne"]),
      );
    });

    it("POST /kindle/priming/action con action=save actualiza user_knowledge y cuaderno", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "save");
      formData.append("lemma", "soledad");
      formData.append("lang", "es");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO lecta_user_words"),
        expect.arrayContaining(["user-1", "es", "soledad"]),
      );
    });

    it("POST /kindle/priming/action con action=mute_book fija cookie y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "mute_book");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_mock-hash-1=1");
      expect(res.headers.get("Location")).toContain("primed=1");
    });

    it("POST /kindle/priming/action con action=disable_all fija cookie global y redirige con primed=1", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "disable_all");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_priming_off=1");
      expect(res.headers.get("Location")).toContain("primed=1");
    });

    it("GET /k/read con primed=1 omite la antesala y muestra directamente el texto", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0&primed=1", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read con cookie lecta_k_priming_off=1 omite la antesala", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request(
        "/k/read/mock-hash-1?section=0&page=0",
        { headers: { Cookie: "lecta_k_priming_off=1" } },
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read con cookie lecta_k_mute_<bookId>=1 omite la antesala para este libro", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const res = await app.request(
        "/k/read/mock-hash-1?section=0&page=0",
        { headers: { Cookie: "lecta_k_mute_mock-hash-1=1" } },
        env,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Capítulo uno");
      expect(html).toContain(">estrecha<");
      expect(html).not.toContain("Comenzar a leer capítulo 1 →");
    });

    it("GET /k/read en página 0 muestra la antesala de pre-lectura cuando hay palabras candidatas en el catálogo", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      dbQueryMock.mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("lexicon_")) {
          return Promise.resolve({
            rows: [
              {
                queried_form: "perenne",
                entry_id: "101",
                lemma: "perenne",
                pos: "adjetivo",
                zipf: 3.5,
                definition: "Que dura indefinidamente.",
                sense_order: 1,
              },
              {
                queried_form: "estrecha",
                entry_id: "102",
                lemma: "estrecho",
                pos: "adjetivo",
                zipf: 4.0,
                definition: "Que tiene poca anchura.",
                sense_order: 1,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await app.request("/k/read/mock-hash-1?section=0&page=0", {}, env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Antes de leer · Capítulo uno");
      expect(html).toContain("Comenzar a leer capítulo →");
      expect(html).toContain("✓ Ya la sé");
      expect(html).toContain("+ Repasar");
      expect(html).toContain("Ocultar en este libro");
      expect(html).toContain("Desactivar siempre");
      expect(html).toContain("window.lectaKindleAction");
    });

    it("POST /kindle/priming/action con action=enable_all limpia cookie lecta_k_priming_off", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "enable_all");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/kindle/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_priming_off=0");
    });

    it("POST /k/priming/action y POST /kindle/priming/action son equivalentes", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1", email: "lector@example.com" },
      });

      const formData = new FormData();
      formData.append("action", "mute_book");
      formData.append("bookId", "mock-hash-1");
      formData.append("chapter", "0");
      formData.append("returnUrl", "/k/read/mock-hash-1?section=0&page=0");

      const res = await app.request("/k/priming/action", { method: "POST", body: formData }, env);
      expect(res.status).toBe(303);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("lecta_k_mute_mock-hash-1=1");
    });
  });
});


```

### FILE: src/worker/kindle/views.ts
```
// Plantillas HTML generadas en servidor para la interfaz Kindle / E-ink de Lecta.
// Cero JavaScript en el cliente, alto contraste, objetivos táctiles amplios
// y tipografía optimizada para pantallas de tinta electrónica.

import type { LexiconEntryView } from "../lexicon";
import type { KindlePrimingWord } from "./epub-reader";

export type KindleUser = {
  id: string;
  email: string;
  name?: string | null;
};

export type KindleBookItem = {
  hash: string;
  title: string;
  author: string;
  sections: number;
  currentSection?: number | null;
  currentPage?: number | null;
  progressPercent?: number | null;
};

export type PageWordItem = {
  form: string;
  saved: boolean;
};

export type InlineLookupResult = {
  word: string;
  entries: LexiconEntryView[] | null;
  saved?: boolean;
};

export type PrepWordItem = {
  form: string;
  lemma: string;
  pos: string | null;
  meaning: string;
  exampleSentence?: string | null;
  saved: boolean;
  zipf?: number | null;
};

export type CatPageNoteItem = {
  form: string;
  lemma: string;
  pos: string | null;
  meaning: string;
  noteIndex: number;
  saved: boolean;
  known?: boolean;
};

export type PracticeQuestionItem = {
  word: string;
  lemma: string;
  pos: string | null;
  options: { key: "A" | "B" | "C"; text: string; correct: boolean }[];
  questionIndex: number;
  totalQuestions: number;
};

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderKindleCatSvg(mood: string, equippedItems: string[] = []): string {
  const isHappy = mood === "happy" || mood === "celebrating";
  const isCurious = mood === "curious";
  const isReading = mood === "reading";
  const hasScarf = equippedItems.some((i) => i.toLowerCase().includes("scarf"));

  // Expresión de los ojos (trazo limpio de tinta electrónica)
  let eyesSvg: string;
  if (isHappy) {
    eyesSvg = `
      <path d="M28 38 Q33 33 38 38" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
      <path d="M42 38 Q47 33 52 38" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
    `;
  } else if (isReading) {
    eyesSvg = `
      <path d="M28 37 Q33 42 38 39" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
      <path d="M42 39 Q47 42 52 37" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
    `;
  } else if (isCurious) {
    eyesSvg = `
      <circle cx="33" cy="37" r="4.5" fill="#000000" />
      <circle cx="47" cy="37" r="3" fill="#000000" />
    `;
  } else {
    eyesSvg = `
      <circle cx="33" cy="37" r="3.5" fill="#000000" />
      <circle cx="47" cy="37" r="3.5" fill="#000000" />
    `;
  }

  const mouthSvg = isHappy
    ? `<path d="M36 45 Q38 48 40 45 Q42 48 44 45" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" />`
    : `<path d="M37 45 Q40 47 43 45" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" />`;

  let scarfSvg = "";
  if (hasScarf) {
    scarfSvg = `
      <!-- Bufanda Kindle -->
      <path d="M26 53 Q40 58 54 53 L53 61 Q40 66 27 61 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <path d="M43 60 L43 74 L50 74 L50 59 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <line x1="43" y1="64" x2="50" y2="64" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="68" x2="50" y2="68" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="72" x2="50" y2="72" stroke="#000000" stroke-width="1.5" />
      <line x1="32" y1="56" x2="35" y2="60" stroke="#000000" stroke-width="1.5" />
      <line x1="37" y1="57" x2="40" y2="61" stroke="#000000" stroke-width="1.5" />
    `;
  }

  let extraSvg = "";
  if (isReading) {
    extraSvg = `
      <!-- Libro abierto en regazo -->
      <path d="M28 66 L40 63 L52 66 L52 74 L40 71 L28 74 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <line x1="40" y1="63" x2="40" y2="71" stroke="#000000" stroke-width="2" />
      <line x1="31" y1="68" x2="37" y2="67" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="67" x2="49" y2="68" stroke="#000000" stroke-width="1.5" />
    `;
  } else if (mood === "celebrating") {
    extraSvg = `
      <!-- Destellos de celebración -->
      <path d="M16 22 L18 16 L20 22 L26 24 L20 26 L18 32 L16 26 L10 24 Z" fill="#000000" />
      <path d="M60 20 L62 15 L64 20 L69 22 L64 24 L62 29 L60 24 L55 22 Z" fill="#000000" />
    `;
  }

  return `
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Gato Lecta (${escapeHtml(mood)})" role="img">
      <!-- Orejas -->
      <polygon points="22,32 15,14 34,22" fill="#ffffff" stroke="#000000" stroke-width="2" stroke-linejoin="round" />
      <polygon points="58,32 65,14 46,22" fill="#ffffff" stroke="#000000" stroke-width="2" stroke-linejoin="round" />
      <!-- Cabeza -->
      <ellipse cx="40" cy="38" rx="22" ry="19" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <!-- Ojos -->
      ${eyesSvg}
      <!-- Nariz -->
      <polygon points="38,42 42,42 40,44" fill="#000000" stroke="#000000" stroke-width="1" />
      <!-- Boca -->
      ${mouthSvg}
      <!-- Bigotes -->
      <line x1="16" y1="39" x2="27" y2="40" stroke="#000000" stroke-width="1.5" />
      <line x1="15" y1="44" x2="26" y2="43" stroke="#000000" stroke-width="1.5" />
      <line x1="64" y1="39" x2="53" y2="40" stroke="#000000" stroke-width="1.5" />
      <line x1="65" y1="44" x2="54" y2="43" stroke="#000000" stroke-width="1.5" />
      <!-- Cuerpo / Pecho -->
      <path d="M25 54 Q40 56 55 54 L58 75 Q40 78 22 75 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <!-- Patitas -->
      <ellipse cx="32" cy="74" rx="5" ry="3" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <ellipse cx="48" cy="74" rx="5" ry="3" fill="#ffffff" stroke="#000000" stroke-width="2" />
      ${scarfSvg}
      ${extraSvg}
    </svg>
  `.trim();
}

const KINDLE_CSS = `
  *, *:before, *:after {
    box-sizing: border-box;
    transition: none !important;
    animation: none !important;
    box-shadow: none !important;
    background-image: none !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: Georgia, "Bookerly", "Amazon Ember", serif;
    font-size: 19px;
    line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 14px 16px;
  }
  header.top-bar {
    border-bottom: 2px solid #000000;
    padding-bottom: 10px;
    margin-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .brand {
    font-size: 1.4rem;
    font-weight: bold;
    text-decoration: none;
    color: #000000;
    letter-spacing: -0.5px;
  }
  .nav-links a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border: 1.5px solid #000000;
    text-decoration: none;
    color: #000000;
    font-size: 0.95rem;
    margin-left: 4px;
    background: #ffffff;
    min-height: 44px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 16px;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    text-align: center;
    min-height: 52px;
    line-height: 1.2;
    box-sizing: border-box;
  }
  .btn-primary {
    background: #000000;
    color: #ffffff;
  }
  .btn-sm {
    padding: 6px 12px;
    font-size: 0.9rem;
    min-height: 44px;
  }
  .btn:disabled, .btn.disabled {
    border-color: #888888;
    color: #888888;
    cursor: not-allowed;
    background: #f4f4f4;
  }
  .card {
    border: 2px solid #000000;
    padding: 16px;
    margin-bottom: 16px;
    background: #ffffff;
  }
  .form-group {
    margin-bottom: 14px;
  }
  .form-group label {
    display: block;
    font-weight: bold;
    margin-bottom: 6px;
  }
  .form-control {
    width: 100%;
    padding: 10px 12px;
    font-size: 1.05rem;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
    font-family: inherit;
  }
  .alert {
    border: 2px solid #000000;
    padding: 12px 14px;
    margin-bottom: 16px;
    font-weight: bold;
  }
  .alert-error {
    background: #000000;
    color: #ffffff;
  }
  .alert-success {
    background: #f0f0f0;
    border-style: dashed;
  }
  /* Lector */
  .reader-meta {
    border-bottom: 1px solid #000000;
    padding-bottom: 8px;
    margin-bottom: 16px;
    font-size: 0.95rem;
  }
  .reader-title {
    font-size: 1.15rem;
    font-weight: bold;
    margin: 0;
  }
  .reader-author {
    font-style: italic;
    color: #444444;
  }
  .chapter-heading {
    font-size: 1.5rem;
    margin: 1.2rem 0 1rem;
    text-align: center;
  }
  .epub-content {
    font-size: 1.18rem;
    line-height: 1.58;
    text-align: justify;
    text-justify: inter-word;
    word-break: break-word;
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  .epub-content p {
    margin: 0;
    text-indent: 1.35em;
  }
  .epub-content > p:first-of-type,
  .epub-content h1 + p,
  .epub-content h2 + p,
  .epub-content h3 + p,
  .epub-content hr + p {
    text-indent: 0;
  }
  .epub-content img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 14px auto;
    filter: grayscale(100%);
  }
  .pagination-nav {
    border-top: 2px solid #000000;
    margin-top: 22px;
    padding-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pagination-nav-top {
    border-top: none;
    border-bottom: 1px solid #000000;
    margin-top: 0;
    margin-bottom: 16px;
    padding-top: 0;
    padding-bottom: 10px;
  }
  .pagination-info {
    font-weight: bold;
    font-size: 0.95rem;
    text-align: center;
    flex-grow: 1;
  }
  /* Enlaces de palabras interactivas */
  a.w {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  a.w:hover, a.w:active {
    background-color: #dcdcdc;
  }
  a.w.saved {
    border-bottom: 1px dotted #444444;
  }
  /* Sección de vocabulario de la página */
  .page-vocab-box {
    margin-top: 22px;
    padding: 12px 14px;
    border: 2px solid #000000;
    background: #fafafa;
  }
  .page-vocab-title {
    font-size: 1rem;
    font-weight: bold;
    margin: 0 0 10px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid #000000;
  }
  .page-vocab-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .vocab-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid #000000;
    background: #ffffff;
    font-size: 0.9rem;
    line-height: 1.2;
  }
  .vocab-chip.saved {
    background: #e8e8e8;
    border-style: dashed;
  }
  .vocab-chip a.vocab-link {
    color: #000000;
    text-decoration: underline;
  }
  .vocab-inline-form {
    display: inline;
    margin: 0;
    padding: 0;
  }
  .btn-xs {
    padding: 3px 8px;
    font-size: 0.8rem;
    min-height: 28px;
    line-height: 1.2;
    border: 1px solid #000000;
    background: #000000;
    color: #ffffff;
    cursor: pointer;
    font-weight: bold;
  }
  .quick-lookup-box {
    margin-top: 24px;
    padding: 14px;
    border: 2px solid #000000;
    background: #fbfbfb;
  }
  .quick-lookup-form {
    display: flex;
    gap: 8px;
  }
  .quick-lookup-form input {
    flex-grow: 1;
  }
  /* Diccionario */
  .sense-list {
    margin: 10px 0 16px 20px;
    padding: 0;
  }
  .sense-item {
    margin-bottom: 10px;
  }
  .sense-example {
    font-style: italic;
    color: #444444;
    display: block;
    margin-top: 4px;
  }
  footer.footer-bar {
    margin-top: 40px;
    border-top: 1px solid #888888;
    padding-top: 12px;
    font-size: 0.85rem;
    text-align: center;
    color: #444444;
  }
  /* Lector dedicado E-ink */
  .reader-body {
    background: #ffffff;
    color: #000000;
  }
  .reader-container {
    max-width: 660px;
    margin: 0 auto;
    padding: 10px 22px 20px 22px;
  }
  .reader-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #dcdcdc;
    margin-bottom: 16px;
    font-size: 0.82rem;
    line-height: 1.2;
    color: #444444;
  }
  .reader-back-btn {
    display: inline-block;
    color: #222222;
    text-decoration: none;
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .reader-back-btn:hover {
    text-decoration: underline;
  }
  .reader-header-info {
    flex-grow: 1;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 8px;
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .reader-header-title {
    font-weight: bold;
    color: #111111;
  }
  .reader-header-sep {
    margin: 0 4px;
    color: #888888;
  }
  .reader-header-author {
    color: #555555;
    font-style: normal;
  }
  .reader-header-meta {
    font-size: 0.8rem;
    white-space: nowrap;
    color: #222222;
  }
  .reader-header-prep {
    font-size: 0.78rem;
    color: #111111;
    text-decoration: none;
    border: 1px solid #888888;
    padding: 2px 7px;
    margin-left: 6px;
    background: #ffffff;
  }
  /* Tarjeta de definición en línea */
  .inline-lookup-card {
    border: 1px solid #111111;
    border-left: 4px solid #000000;
    background: #ffffff;
    padding: 12px 16px;
    margin-bottom: 18px;
  }
  .inline-lookup-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid #e0e0e0;
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .inline-lookup-word {
    font-family: Georgia, serif;
    font-weight: bold;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
  }
  .inline-lookup-pos {
    font-style: italic;
    font-size: 0.88rem;
    color: #555555;
    margin-left: 8px;
  }
  .inline-lookup-close {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid #888888;
    color: #333333;
    background: #fbfbfb;
    text-decoration: none;
    font-size: 0.78rem;
  }
  .inline-lookup-def {
    font-size: 0.98rem;
    line-height: 1.5;
    margin-bottom: 8px;
    color: #111111;
  }
  /* Modos de lectura */
  .mode-selector {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    align-items: center;
  }
  .mode-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 6px 12px;
    border: 1.5px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-size: 0.88rem;
  }
  .mode-tab.is-active {
    background: #000000;
    color: #ffffff;
    border: 2px solid #000000;
    font-weight: bold;
  }
  .size-selector {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
    align-items: center;
  }
  .size-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    min-width: 38px;
    padding: 4px 8px;
    border: 1.5px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-size: 0.82rem;
    font-weight: bold;
  }
  .size-btn.is-active {
    background: #000000;
    color: #ffffff;
  }
  /* Estilos según modo */
  .epub-content.mode-clean p {
    margin: 0;
    text-indent: 1.35em;
  }
  .epub-content.mode-clean > p:first-of-type,
  .epub-content.mode-clean h1 + p,
  .epub-content.mode-clean h2 + p {
    text-indent: 0;
  }
  .epub-content.mode-paragraphs p {
    margin: 0 0 1.4em 0;
    text-indent: 0;
    line-height: 1.6;
  }
  .epub-content.mode-paragraphs .p-num {
    font-size: 0.8em;
    font-weight: bold;
    color: #000000;
    margin-right: 6px;
    user-select: none;
  }
  .epub-content.mode-paragraphs p.p-guided {
    border-left: 2px solid #000000;
    padding-left: 10px;
    margin-left: -2px;
  }
  .epub-content.mode-lexicon p {
    margin: 0 0 0.8em 0;
    text-indent: 1.2em;
  }
  .epub-content.mode-lexicon > p:first-of-type {
    text-indent: 0;
  }
  /* Palabras en modo léxico */
  a.w.w-lexicon {
    border-bottom: 2px dotted #000000;
    text-decoration: none;
    font-weight: bold;
  }
  a.w.w-lexicon sup {
    font-size: 0.72em;
    line-height: 0;
    vertical-align: super;
    font-weight: bold;
    margin-left: 1px;
  }
  /* Tamaños de fuente */
  .epub-content.size-sm { font-size: 1.0rem; line-height: 1.5; }
  .epub-content.size-md { font-size: 1.18rem; line-height: 1.58; }
  .epub-content.size-lg { font-size: 1.35rem; line-height: 1.65; }
  .epub-content.size-xl { font-size: 1.55rem; line-height: 1.72; }

  /* Bloque de Notas del Gato */
  .cat-notes-box {
    margin-top: 24px;
    border: 2px solid #000000;
    padding: 14px 16px;
    background: #ffffff;
  }
  .cat-notes-title {
    font-size: 1.08rem;
    font-weight: bold;
    border-bottom: 2px solid #000000;
    padding-bottom: 6px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cat-note-item {
    border-bottom: 1px solid #000000;
    padding: 10px 0;
  }
  .cat-note-item:last-child {
    border-bottom: none;
  }
  .cat-note-term {
    font-weight: bold;
    font-size: 1.05rem;
  }
  .cat-note-pos {
    font-style: italic;
    font-size: 0.88rem;
    margin-left: 6px;
    color: #444444;
  }
  .cat-note-def {
    margin: 4px 0 8px 0;
    font-size: 0.95rem;
    line-height: 1.4;
  }
  .cat-note-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  /* Barra para pasar página con un toque ergonómica (25% / 50% / 25%) */
  .turn-page-bar {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin-top: 24px;
    padding-top: 14px;
    border-top: 2px solid #000000;
    width: 100%;
  }
  .turn-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 8px;
    border: 2px solid #000000;
    text-decoration: none;
    font-weight: bold;
    font-size: 0.95rem;
    cursor: pointer;
    min-height: 52px;
    text-align: center;
    box-sizing: border-box;
  }
  .turn-btn-prev {
    background: #ffffff;
    color: #000000;
    flex: 0 0 25%;
    width: 25%;
  }
  .turn-page-indicator {
    flex: 0 0 50%;
    width: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.88rem;
    font-weight: bold;
    color: #000000;
    padding: 4px 6px;
    text-align: center;
    border: 2px solid #000000;
    background: #ffffff;
    box-sizing: border-box;
    min-height: 52px;
    line-height: 1.3;
  }
  .turn-btn-next {
    background: #000000;
    color: #ffffff;
    flex: 0 0 25%;
    width: 25%;
    letter-spacing: 0.02em;
  }
  .turn-btn.disabled {
    border-color: #888888;
    color: #888888;
    background: #ffffff;
    cursor: not-allowed;
  }
  /* Preparación previa al capítulo (Glosario de apertura) */
  .prep-title {
    font-size: 1.35rem;
    font-weight: bold;
    margin: 12px 0 6px 0;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .prep-subtitle {
    font-size: 0.95rem;
    color: #555555;
    margin-bottom: 16px;
    line-height: 1.45;
  }
  .prep-word-card {
    border: none;
    border-bottom: 1px solid #d5d5d5;
    padding: 14px 0;
    background: transparent;
  }
  .prep-word-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .prep-word-term {
    font-family: Georgia, serif;
    font-size: 1.2rem;
    font-weight: bold;
  }
  .prep-word-pos {
    font-style: italic;
    font-size: 0.85rem;
    color: #666666;
    margin-left: 6px;
  }
  .prep-word-def {
    font-size: 0.98rem;
    line-height: 1.45;
    margin-bottom: 6px;
    color: #111111;
  }
  .prep-word-example {
    font-size: 0.88rem;
    font-style: italic;
    color: #333333;
    padding: 4px 10px;
    border-left: 2px solid #888888;
    margin: 6px 0 8px 0;
  }
  .prep-word-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .badge-saved {
    font-size: 0.8rem;
    font-weight: normal;
    color: #222222;
    border: 1px solid #555555;
    padding: 2px 6px;
  }
  .prep-empty-card {
    border: 1px dashed #999999;
    padding: 20px;
    text-align: center;
    margin: 24px 0;
    font-size: 1rem;
    color: #333333;
  }
  .reader-header-prep {
    font-size: 0.8rem;
    color: #000000;
    text-decoration: underline;
    margin-left: 8px;
    font-weight: normal;
  }
`;

function renderBaseHtml(options: {
  title: string;
  user: KindleUser | null;
  bodyHtml: string;
  returnTo?: string;
}): string {
  const { title, user, bodyHtml } = options;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Lecta Kindle</title>
  <style>${KINDLE_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="top-bar">
      <a href="/k" class="brand">Lecta <span style="font-size:0.8rem; font-weight:normal;">[Kindle]</span></a>
      <nav class="nav-links">
        <a href="/k">Biblioteca</a>
        <a href="/k/practice">Práctica</a>
        <a href="/k/lookup">Diccionario</a>
        ${
          user
            ? `<a href="/k/logout">Cerrar sesión (${escapeHtml(user.email.split("@")[0] || "cuenta")})</a>`
            : `<a href="/k/login">Iniciar sesión</a>`
        }
      </nav>
    </header>

    <main>
      ${bodyHtml}
    </main>

    <footer class="footer-bar">
      Lecta E-ink Edition · Sincronizado en la nube
    </footer>
  </div>
</body>
</html>`;
}

export function renderHomeView(options: {
  user: KindleUser | null;
  books: KindleBookItem[];
}): string {
  const { user, books } = options;

  let bodyHtml: string;

  if (!user) {
    bodyHtml = `
      <div class="card" style="text-align:center; padding: 24px 16px;">
        <h1 style="margin-top:0;">Lecta para Kindle y E-ink</h1>
        <p>Lee tu biblioteca sin sobrecargar el procesador del Kindle. Páginas limpias, sincronización automática de posición y consulta rápida de definiciones.</p>
        <p style="margin-top: 20px;">
          <a href="/kindle" class="btn btn-primary" style="font-size: 1.15rem; padding: 12px 24px; display: inline-block;">Vincular con código (1 toque)</a>
          <br /><br />
          <a href="/k/login" style="font-size: 0.95rem; color: #555; text-decoration: underline;">O entrar con correo y contraseña</a>
        </p>
      </div>
    `;
  } else {
    const booksHtml = books.length === 0
      ? `
        <div class="card">
          <p><strong>Aún no tienes libros en tu estantería.</strong></p>
          <p>Sube tus libros en formato EPUB desde tu ordenador o móvil en la versión principal de Lecta, y aparecerán aquí automáticamente.</p>
        </div>
      `
      : books
        .map((b) => {
          const sectionNum = (b.currentSection ?? 0) + 1;
          const totalSec = b.sections || 1;
          const percent = b.progressPercent != null ? Math.round(b.progressPercent * 100) : null;
          const progressText = percent !== null
            ? `Sección ${sectionNum} de ${totalSec} (${percent}%)`
            : `Sin empezar · ${totalSec} secciones`;

          const targetSec = b.currentSection ?? 0;
          const targetPg = b.currentPage ?? 0;
          const isAtStart =
            (b.currentSection == null || b.currentSection === 0) &&
            (b.currentPage == null || b.currentPage === 0) &&
            (b.progressPercent == null || b.progressPercent === 0);
          const readUrl = isAtStart
            ? `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&page=0`
            : `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&page=${targetPg}`;
          const readLabel = isAtStart ? "Comenzar lectura →" : "Continuar lectura →";

          return `
            <div class="card">
              <h2 style="margin:0 0 6px 0; font-size:1.25rem;">${escapeHtml(b.title)}</h2>
              <p style="margin:0 0 10px 0; font-style:italic; color:#444;">${escapeHtml(b.author || "Autor desconocido")}</p>
              <p style="margin:0 0 14px 0; font-size:0.95rem;"><strong>Progreso:</strong> ${escapeHtml(progressText)}</p>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <a href="${readUrl}" class="btn btn-primary">${readLabel}</a>
                <a href="/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&prep=1" class="btn btn-sm">📖 Antes de leer</a>
              </div>
            </div>
          `;
        })
        .join("");

    bodyHtml = `
      <div style="margin-bottom: 20px;">
        <h1 style="margin: 0 0 6px 0; font-size: 1.5rem;">Mis Libros</h1>
        <p style="margin: 0; color: #444; font-size: 0.95rem;">Selecciona un libro para reanudar donde lo dejaste:</p>
      </div>
      ${booksHtml}
    `;
  }

  return renderBaseHtml({
    title: "Biblioteca",
    user,
    bodyHtml,
  });
}

export function renderLoginView(options: {
  user: KindleUser | null;
  error?: string | null;
  email?: string;
  returnTo?: string;
}): string {
  const { user, error, email = "", returnTo = "/k" } = options;

  const errorBox = error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : "";

  const bodyHtml = `
    <div class="card" style="max-width: 500px; margin: 0 auto;">
      <h1 style="margin-top:0; font-size:1.4rem;">Iniciar sesión en Lecta</h1>
      <p style="font-size:0.95rem; color:#444;">Introduce tu correo y contraseña registrados en Lecta para acceder a tus libros y notas:</p>

      ${errorBox}

      <form method="POST" action="/k/login">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />

        <div class="form-group">
          <label for="email">Correo electrónico:</label>
          <input type="email" id="email" name="email" class="form-control" value="${escapeHtml(email)}" required autofocus />
        </div>

        <div class="form-group">
          <label for="password">Contraseña:</label>
          <input type="password" id="password" name="password" class="form-control" required />
        </div>

        <div style="margin-top: 18px;">
          <button type="submit" class="btn btn-primary" style="width: 100%;">Entrar a mi biblioteca</button>
        </div>
      </form>
    </div>
  `;

  return renderBaseHtml({
    title: "Iniciar sesión",
    user,
    bodyHtml,
  });
}

export function renderKindleLinkView(options: {
  code: string;
  user?: KindleUser | null;
}): string {
  const { code, user = null } = options;

  const bodyHtml = `
    <div class="card" style="max-width: 520px; margin: 2rem auto; text-align: center; padding: 2.5rem 1.5rem;">
      <h1 style="font-size: 1.6rem; margin-top: 0; color: #111;">Vincular tu Kindle</h1>
      <p style="color: #444; font-size: 1rem; line-height: 1.5; margin: 1rem 0;">
        Introduce este código de 4 letras en tu celular o PC (donde tengas abierta tu sesión de Lecta en <strong>Cuenta → Conectar mi Kindle</strong>):
      </p>
      <div style="font-size: 3.5rem; font-weight: bold; letter-spacing: 0.6rem; margin: 1.5rem 0; color: #d97706; font-family: monospace;">
        ${escapeHtml(code)}
      </div>

      <div style="margin: 1.8rem 0 1rem 0;">
        <a href="/api/kindle/status?code=${encodeURIComponent(code)}&redirect=1" class="btn btn-primary" style="display: block; width: 100%; font-size: 1.1rem; padding: 12px; text-decoration: none;">
          Ya ingresé el código en mi celular → Entrar
        </a>
      </div>

      <p style="color: #666; font-size: 0.9rem; margin-top: 1.2rem;">
        O espera unos segundos; el dispositivo se conectará automáticamente.<br/>
        <a href="/k/login" style="display: inline-block; margin-top: 1rem; color: #555; text-decoration: underline;">O inicia sesión con correo y contraseña</a>
      </p>
    </div>
    <script>
      (function poll() {
        fetch('/api/kindle/status?code=${encodeURIComponent(code)}')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data && data.linked) {
              window.location.href = data.redirectUrl || '/k';
            } else {
              setTimeout(poll, 4000);
            }
          })
          .catch(function() {
            setTimeout(poll, 4000);
          });
      })();
    </script>
    <noscript>
      <meta http-equiv="refresh" content="5" />
    </noscript>
  `;

  return renderBaseHtml({
    title: "Vincular Kindle",
    user,
    bodyHtml,
  });
}

export function renderReaderView(options: {
  user: KindleUser | null;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  contentHtml: string;
  sectionIndex: number;
  totalSections: number;
  pageIndex: number;
  totalPages: number;
  pageWords?: PageWordItem[];
  savedNotice?: string | null;
  lookupResult?: InlineLookupResult | null;
  mode?: "clean" | "paragraphs" | "lexicon";
  size?: "sm" | "md" | "lg" | "xl";
  gloss?: boolean;
  catNotes?: CatPageNoteItem[];
  primingOff?: boolean;
}): string {
  const {
    user,
    bookHash,
    bookTitle,
    bookAuthor,
    chapterTitle,
    contentHtml,
    sectionIndex,
    totalSections,
    pageIndex,
    totalPages,
    savedNotice,
    lookupResult,
    mode = "clean",
    size = "md",
    gloss = true,
    catNotes = [],
    primingOff = false,
  } = options;

  const querySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&gloss=${gloss ? "1" : "0"}`;
  const cleanPageUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex}${querySuffix}`;

  const prevUrl =
    pageIndex > 0
      ? `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex - 1}${querySuffix}`
      : sectionIndex > 0
        ? `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex - 1}&page=last${querySuffix}`
        : null;

  let nextUrl: string | null = null;
  if (pageIndex < totalPages - 1) {
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex + 1}${querySuffix}`;
  } else if (sectionIndex < totalSections - 1) {
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex + 1}&page=0${querySuffix}`;
  }

  const hasPrev = prevUrl !== null;
  const hasNext = nextUrl !== null;

  const flashHtml = savedNotice
    ? `<div class="alert alert-success">${escapeHtml(savedNotice)}</div>`
    : "";

  let lookupHtml = "";
  if (lookupResult) {
    const firstEntry = lookupResult.entries && lookupResult.entries.length > 0 ? lookupResult.entries[0] : null;
    const firstMeaning = firstEntry?.senses[0]?.definition || null;

    lookupHtml = `
      <div class="inline-lookup-card">
        <div class="inline-lookup-header">
          <div>
            <span class="inline-lookup-word">${escapeHtml(lookupResult.word)}</span>
            ${firstEntry?.pos ? `<span class="inline-lookup-pos">(${escapeHtml(firstEntry.pos)})</span>` : ""}
          </div>
          <a href="${escapeHtml(cleanPageUrl)}" class="inline-lookup-close" title="Cerrar definición">✕ Cerrar</a>
        </div>
        <div class="inline-lookup-def">
          ${firstMeaning ? escapeHtml(firstMeaning) : "<em>Definición no encontrada en el catálogo.</em>"}
        </div>
        ${
          firstEntry?.senses[0]?.example
            ? `<div class="sense-example" style="font-size:0.85rem; margin-bottom:6px;">«${escapeHtml(firstEntry.senses[0].example)}»</div>`
            : ""
        }
        ${
          user && firstMeaning
            ? `
              <form method="POST" action="/k/vocab/add" style="margin-top:6px;">
                <input type="hidden" name="form" value="${escapeHtml(lookupResult.word)}" />
                <input type="hidden" name="lemma" value="${escapeHtml(firstEntry?.lemma || lookupResult.word)}" />
                <input type="hidden" name="pos" value="${escapeHtml(firstEntry?.pos || "")}" />
                <input type="hidden" name="meaning" value="${escapeHtml(firstMeaning)}" />
                <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                <button type="submit" class="btn btn-sm btn-primary" style="padding:6px 12px; font-size:0.85rem; min-height:44px;">+ Guardar en mi Cuaderno</button>
              </form>
            `
            : ""
        }
      </div>
    `;
  }

  // Bloque "🐾 Notas del Gato en esta página"
  let catNotesHtml = "";
  if ((mode === "lexicon" || gloss) && catNotes && catNotes.length > 0) {
    catNotesHtml = `
      <div class="cat-notes-box">
        <div class="cat-notes-title">
          <span>🐾 Notas del Gato en esta página</span>
        </div>
        <div class="cat-notes-list">
          ${catNotes
            .map(
              (n) => `
            <div class="cat-note-item">
              <div>
                <span class="cat-note-term"><sup>${n.noteIndex}</sup> ${escapeHtml(n.form)}</span>
                ${n.pos ? `<span class="cat-note-pos">(${escapeHtml(n.pos)})</span>` : ""}
                ${n.saved ? `<span class="badge-saved" style="margin-left:6px;">✓ En tu Cuaderno</span>` : ""}
              </div>
              <div class="cat-note-def">${escapeHtml(n.meaning)}</div>
              <div class="cat-note-actions">
                <form method="POST" action="/k/knowledge/mark" style="display:inline;">
                  <input type="hidden" name="lemma" value="${escapeHtml(n.lemma)}" />
                  <input type="hidden" name="known" value="1" />
                  <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                  <button type="submit" class="btn btn-sm" style="min-height:44px; padding:6px 12px; font-size:0.85rem;">[ ✓ Ya la sé ]</button>
                </form>
                ${
                  !n.saved
                    ? `
                  <form method="POST" action="/k/vocab/add" style="display:inline;">
                    <input type="hidden" name="form" value="${escapeHtml(n.form)}" />
                    <input type="hidden" name="lemma" value="${escapeHtml(n.lemma)}" />
                    <input type="hidden" name="pos" value="${escapeHtml(n.pos || "")}" />
                    <input type="hidden" name="meaning" value="${escapeHtml(n.meaning)}" />
                    <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                    <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                    <button type="submit" class="btn btn-sm btn-primary" style="min-height:44px; padding:6px 12px; font-size:0.85rem;">[ ★ A mi cuaderno ]</button>
                  </form>
                `
                    : ""
                }
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  const baseParamUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bookTitle)} (${sectionIndex + 1}/${totalSections} — ${pageIndex + 1}/${totalPages}) — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body">
  <div class="reader-container">
    <header class="reader-header">
      <a href="/k" class="reader-back-btn">← Biblioteca</a>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        Cap. ${sectionIndex + 1}/${totalSections}
        <a href="/k/practice?bookHash=${encodeURIComponent(bookHash)}&amp;returnTo=${encodeURIComponent(cleanPageUrl)}" class="reader-header-prep" title="Practicar vocabulario">🎯 Práctica</a>
        <a href="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" class="reader-header-prep" title="Ver vocabulario del capítulo">📖 Prep</a>
        ${
          primingOff
            ? `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="enable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="reader-header-prep" style="background:#ffffff; border:1px solid #888888; cursor:pointer;" title="Reactivar antesala">✨ Antesala</button></form>`
            : `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="disable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="reader-header-prep" style="background:#ffffff; border:1px solid #888888; cursor:pointer;" title="Silenciar antesala">✨ Antesala</button></form>`
        }
      </div>
    </header>

    <div class="mode-selector">
      <span style="font-size:0.85rem; font-weight:bold; margin-right:4px;">Modo:</span>
      <a href="${baseParamUrl}&amp;mode=clean&amp;size=${size}&amp;gloss=${gloss ? 1 : 0}" class="mode-tab ${mode === "clean" ? "is-active" : ""}">[ Modo Limpio ]</a>
      <a href="${baseParamUrl}&amp;mode=paragraphs&amp;size=${size}&amp;gloss=${gloss ? 1 : 0}" class="mode-tab ${mode === "paragraphs" ? "is-active" : ""}">[ Modo Párrafos ]</a>
      <a href="${baseParamUrl}&amp;mode=lexicon&amp;size=${size}&amp;gloss=${gloss ? 1 : 0}" class="mode-tab ${mode === "lexicon" ? "is-active" : ""}">[ Modo Léxico ]</a>
      <div class="size-selector">
        <span style="font-size:0.82rem; margin-right:2px;">Letra:</span>
        <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=sm&amp;gloss=${gloss ? 1 : 0}" class="size-btn ${size === "sm" ? "is-active" : ""}">P</a>
        <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=md&amp;gloss=${gloss ? 1 : 0}" class="size-btn ${size === "md" ? "is-active" : ""}">M</a>
        <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=lg&amp;gloss=${gloss ? 1 : 0}" class="size-btn ${size === "lg" ? "is-active" : ""}">G</a>
        <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=xl&amp;gloss=${gloss ? 1 : 0}" class="size-btn ${size === "xl" ? "is-active" : ""}">XG</a>
      </div>
    </div>

    ${flashHtml}

    ${lookupHtml}

    ${pageIndex === 0 && chapterTitle ? `<h2 class="chapter-heading">${escapeHtml(chapterTitle)}</h2>` : ""}

    <div class="epub-content mode-${escapeHtml(mode)} size-${escapeHtml(size)}">
      ${contentHtml}
    </div>

    ${catNotesHtml}

    <nav class="turn-page-bar">
      ${
        hasPrev && prevUrl
          ? `<a href="${escapeHtml(prevUrl)}" class="turn-btn turn-btn-prev">[ ← Anterior ]</a>`
          : `<span class="turn-btn turn-btn-prev disabled">[ ← Anterior ]</span>`
      }
      <div class="turn-page-indicator">
        Pág. ${pageIndex + 1} de ${totalPages} · Cap. ${sectionIndex + 1}${chapterTitle ? `: ${escapeHtml(chapterTitle)}` : ""}
      </div>
      ${
        hasNext && nextUrl
          ? `<a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next">[ ${
              pageIndex === totalPages - 1 && sectionIndex < totalSections - 1
                ? "Siguiente capítulo →"
                : "Siguiente página →"
            } ]</a>`
          : `<span class="turn-btn turn-btn-next disabled">[ Fin del libro ]</span>`
      }
    </nav>
  </div>
</body>
</html>`;
}

export function renderChapterPrepView(options: {
  user: KindleUser | null;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  sectionIndex: number;
  totalSections: number;
  words: PrepWordItem[];
  savedNotice?: string | null;
  nextUrl: string;
  prevUrl?: string | null;
}): string {
  const {
    user,
    bookHash,
    bookTitle,
    bookAuthor,
    chapterTitle,
    sectionIndex,
    totalSections,
    words,
    savedNotice,
    nextUrl,
    prevUrl,
  } = options;

  const flashHtml = savedNotice
    ? `<div class="flash flash-success">${escapeHtml(savedNotice)}</div>`
    : "";

  const wordsHtml =
    words.length > 0
      ? `<div class="prep-word-list">
          ${words
            .map(
              (w) => `
            <div class="prep-word-card">
              <div class="prep-word-header">
                <div>
                  <span class="prep-word-term">${escapeHtml(w.form)}</span>
                  ${w.pos ? `<span class="prep-word-pos">(${escapeHtml(w.pos)})</span>` : ""}
                </div>
                ${w.saved ? `<span class="badge-saved">✓ En tu Cuaderno</span>` : ""}
              </div>
              <div class="prep-word-def">
                ${escapeHtml(w.meaning)}
              </div>
              ${
                w.exampleSentence
                  ? `<div class="prep-word-example">«${escapeHtml(w.exampleSentence)}»</div>`
                  : ""
              }
              <div class="prep-word-actions">
                ${
                  user && !w.saved
                    ? `
                      <form method="POST" action="/k/vocab/add" style="display:inline;">
                        <input type="hidden" name="form" value="${escapeHtml(w.form)}" />
                        <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
                        <input type="hidden" name="pos" value="${escapeHtml(w.pos || "")}" />
                        <input type="hidden" name="meaning" value="${escapeHtml(w.meaning)}" />
                        <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                        <input type="hidden" name="returnTo" value="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" />
                        <button type="submit" class="btn-xs" style="padding:4px 10px; font-size:0.85rem; background:#000000; color:#ffffff; border:none; cursor:pointer;">+ Guardar</button>
                      </form>
                    `
                    : ""
                }
                ${
                  user
                    ? `
                      <form method="POST" action="/k/knowledge/mark" style="display:inline;">
                        <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
                        <input type="hidden" name="known" value="1" />
                        <input type="hidden" name="returnTo" value="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" />
                        <button type="submit" class="btn-xs" style="padding:4px 9px; font-size:0.82rem; background:#ffffff; color:#333333; border:1px solid #777777; cursor:pointer;">Ya la conozco</button>
                      </form>
                    `
                    : ""
                }
              </div>
            </div>
          `,
            )
            .join("")}
        </div>`
      : `<div class="prep-empty-card">
          <p>✓ No se detectaron palabras complejas desconocidas en este capítulo.</p>
          <p style="margin-top: 8px;">¡Todo listo para empezar la lectura!</p>
        </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antes de leer: ${escapeHtml(chapterTitle || `Capítulo ${sectionIndex + 1}`)} — ${escapeHtml(bookTitle)} — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body">
  <div class="reader-container">
    <header class="reader-header">
      <a href="/k" class="reader-back-btn">← Biblioteca</a>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        Cap. ${sectionIndex + 1}/${totalSections}
      </div>
    </header>

    ${flashHtml}

    <div class="prep-header">
      <h1 class="prep-title">Vocabulario de apertura · ${escapeHtml(chapterTitle || `Capítulo ${sectionIndex + 1}`)}</h1>
      <p class="prep-subtitle">
        Palabras seleccionadas para enriquecer tu lectura antes de comenzar este capítulo (${words.length} palabras clave):
      </p>
    </div>

    <div style="margin-bottom: 20px;">
      <a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next" style="display:block; text-align:center; text-decoration:none; padding:13px 18px; font-size:1.05rem;">
        Comenzar capítulo ${sectionIndex + 1} →
      </a>
    </div>

    ${wordsHtml}

    <nav class="turn-page-bar" style="margin-top: 24px;">
      ${
        prevUrl
          ? `<a href="${escapeHtml(prevUrl)}" class="turn-btn turn-btn-prev">← Anterior</a>`
          : `<a href="/k" class="turn-btn turn-btn-prev">← Biblioteca</a>`
      }
      <div class="turn-page-indicator">
        Cap. ${sectionIndex + 1} de ${totalSections}
      </div>
      <a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next">
        Comenzar capítulo ${sectionIndex + 1} →
      </a>
    </nav>
  </div>
</body>
</html>`;
}

export function renderLookupView(options: {
  user: KindleUser | null;
  query: string;
  entries: LexiconEntryView[] | null;
  saved?: boolean;
  returnTo?: string;
  bookHash?: string;
}): string {
  const { user, query, entries, saved, returnTo = "/k", bookHash = "" } = options;

  const backLink = returnTo
    ? `<p><a href="${escapeHtml(returnTo)}" class="btn btn-sm">← Volver al libro</a></p>`
    : "";

  let resultHtml = "";

  if (saved) {
    resultHtml += `<div class="alert alert-success">✓ Palabra «${escapeHtml(query)}» guardada en tu Cuaderno de Lecta.</div>`;
  }

  if (query && entries !== null) {
    if (entries.length === 0) {
      resultHtml += `
        <div class="card">
          <p>No se encontraron definiciones para «<strong>${escapeHtml(query)}</strong>» en el catálogo.</p>
        </div>
      `;
    } else {
      for (const entry of entries) {
        const firstMeaning = entry.senses[0]?.definition ?? "";
        resultHtml += `
          <div class="card">
            <h2 style="margin: 0 0 6px 0; font-size: 1.4rem;">
              ${escapeHtml(entry.lemma)}
              ${entry.pos ? `<span style="font-weight:normal; font-size:1rem; font-style:italic; color:#444;">(${escapeHtml(entry.pos)})</span>` : ""}
            </h2>

            <ol class="sense-list">
              ${entry.senses
                .map(
                  (s) => `
                <li class="sense-item">
                  ${escapeHtml(s.definition)}
                  ${s.example ? `<span class="sense-example">«${escapeHtml(s.example)}»</span>` : ""}
                </li>
              `,
                )
                .join("")}
            </ol>

            ${
              user && firstMeaning
                ? `
              <form method="POST" action="/k/vocab/add">
                <input type="hidden" name="form" value="${escapeHtml(query)}" />
                <input type="hidden" name="lemma" value="${escapeHtml(entry.lemma)}" />
                <input type="hidden" name="pos" value="${escapeHtml(entry.pos || "")}" />
                <input type="hidden" name="meaning" value="${escapeHtml(firstMeaning)}" />
                <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
                <button type="submit" class="btn btn-primary btn-sm">+ Guardar en mi Cuaderno</button>
              </form>
            `
                : ""
            }
          </div>
        `;
      }
    }
  }

  const bottomBackLink = returnTo
    ? `<p style="margin-top: 20px;"><a href="${escapeHtml(returnTo)}" class="btn btn-primary" style="width: 100%;">← Volver al libro</a></p>`
    : "";

  const bodyHtml = `
    ${backLink}

    <div class="card">
      <h1 style="margin-top:0; font-size: 1.3rem;">Diccionario de Lecta</h1>
      <form action="/k/lookup" method="GET" class="quick-lookup-form">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
        <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
        <input type="text" name="q" class="form-control" value="${escapeHtml(query)}" placeholder="Escribe una palabra..." required autofocus />
        <button type="submit" class="btn btn-primary">Buscar</button>
      </form>
    </div>

    ${resultHtml}

    ${bottomBackLink}
  `;

  return renderBaseHtml({
    title: query ? `Definición de ${query}` : "Diccionario",
    user,
    bodyHtml,
    returnTo,
  });
}

export function renderPracticeView(options: {
  user: KindleUser | null;
  question?: PracticeQuestionItem | null;
  isFinished?: boolean;
  correctCount?: number;
  totalQuestions?: number;
  returnTo?: string;
  bookHash?: string;
  equippedItems?: string[];
}): string {
  const {
    user,
    question,
    isFinished,
    correctCount = 0,
    totalQuestions = 3,
    returnTo = "/k",
    bookHash = "",
    equippedItems = [],
  } = options;

  let bodyHtml: string;

  if (isFinished) {
    const earnedXp = correctCount * 15;
    bodyHtml = `
      <div class="card" style="text-align: center; padding: 24px 16px;">
        <div style="margin-bottom: 16px;">
          ${renderKindleCatSvg("celebrating", equippedItems)}
        </div>
        <h1 style="margin-top: 0; font-size: 1.5rem;">¡Sesión de Práctica Completada!</h1>
        <p style="font-size: 1.1rem; margin: 12px 0;">
          Acertaste <strong>${correctCount} de ${totalQuestions}</strong> palabras.
        </p>
        <p style="font-size: 1rem; color: #333; margin-bottom: 24px;">
          Tu compañero ronronea con satisfacción (+${earnedXp} XP para el gato).
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px; max-width: 380px; margin: 0 auto;">
          <a href="${escapeHtml(returnTo)}" class="btn btn-primary" style="font-size: 1.1rem;">[ Volver a leer → ]</a>
          <a href="/k/practice${bookHash ? `?bookHash=${encodeURIComponent(bookHash)}` : ""}" class="btn">[ Practicar 3 más ]</a>
          <a href="/k" class="btn">[ Ir a la Biblioteca ]</a>
        </div>
      </div>
    `;
  } else if (question) {
    bodyHtml = `
      <div class="card" style="padding: 20px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000000; padding-bottom: 10px; margin-bottom: 16px;">
          <span style="font-weight: bold; font-size: 0.95rem;">
            Palabra ${question.questionIndex + 1} de ${question.totalQuestions}
          </span>
          <span style="font-size: 0.85rem; color: #444;">
            Aciertos: ${correctCount}
          </span>
        </div>

        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
          <div>${renderKindleCatSvg("curious", equippedItems)}</div>
          <div>
            <span style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555;">Pregunta de vocabulario</span>
            <h2 style="margin: 2px 0 0 0; font-size: 1.5rem;">
              «${escapeHtml(question.word)}»
            </h2>
            ${question.pos ? `<span style="font-style: italic; font-size: 0.9rem; color: #444;">(${escapeHtml(question.pos)})</span>` : ""}
          </div>
        </div>

        <p style="font-size: 1.05rem; margin: 0 0 16px 0; font-weight: bold;">
          ¿Cuál es la definición correcta?
        </p>

        <form method="POST" action="/k/practice/answer">
          <input type="hidden" name="word" value="${escapeHtml(question.word)}" />
          <input type="hidden" name="lemma" value="${escapeHtml(question.lemma)}" />
          <input type="hidden" name="questionIndex" value="${question.questionIndex}" />
          <input type="hidden" name="totalQuestions" value="${question.totalQuestions}" />
          <input type="hidden" name="correctCount" value="${correctCount}" />
          <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
          <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />

          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${question.options
              .map(
                (opt) => `
              <button type="submit" name="selectedOption" value="${opt.key}" class="btn" style="min-height: 56px; text-align: left; justify-content: flex-start; padding: 12px 14px; font-size: 0.98rem; line-height: 1.35; width: 100%;">
                <span style="display: inline-block; min-width: 32px; font-weight: bold; font-size: 1.05rem;">[ ${opt.key} ]</span>
                <span style="flex: 1;">${escapeHtml(opt.text)}</span>
              </button>
            `,
              )
              .join("")}
          </div>
        </form>
      </div>

      <div style="margin-top: 14px; text-align: center;">
        <a href="${escapeHtml(returnTo)}" style="color: #444; font-size: 0.9rem; text-decoration: underline;">
          Saltar práctica y volver a la lectura
        </a>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="card" style="text-align: center; padding: 24px 16px;">
        <h2>No hay palabras pendientes para practicar</h2>
        <p>¡Tu cuaderno está al día! Puedes volver a tu libro o explorar tu biblioteca.</p>
        <p style="margin-top: 18px;">
          <a href="/k" class="btn btn-primary">[ Ir a la Biblioteca ]</a>
        </p>
      </div>
    `;
  }

  return renderBaseHtml({
    title: "Práctica de Vocabulario",
    user,
    bodyHtml,
    returnTo,
  });
}

export interface KindleChapterPrimingViewProps {
  bookId: string;
  bookTitle: string;
  chapterIndex: number;
  chapterTitle: string;
  bookLang: string;
  isForeignLang: boolean;
  words: KindlePrimingWord[];
  bookAuthor?: string;
  readUrl?: string;
  currentUrl?: string;
  user?: KindleUser | null;
  bookHash?: string;
  sectionIndex?: number;
  totalSections?: number;
  lang?: string;
  savedNotice?: string | null;
}

export type KindlePrimingViewParams = KindleChapterPrimingViewProps;

export function renderKindleChapterPrimingView(props: KindleChapterPrimingViewProps): string {
  const bookId = props.bookId || props.bookHash || "";
  const bookTitle = props.bookTitle || "";
  const chapterIndex = props.chapterIndex ?? props.sectionIndex ?? 0;
  const chapterTitle = props.chapterTitle || `Capítulo ${chapterIndex + 1}`;
  const bookLang = props.bookLang || props.lang || "es";
  const isForeignLang = props.isForeignLang ?? (bookLang !== "es");
  const words = props.words || [];

  const startReadingUrl =
    props.readUrl ||
    `/kindle/read/${encodeURIComponent(bookId)}?chapter=${chapterIndex}&page=0&primed=1`;
  const currentUrl =
    props.currentUrl ||
    `/kindle/read/${encodeURIComponent(bookId)}?chapter=${chapterIndex}&page=0`;

  const cardsHtml = words
    .map(
      (w) => `
      <li class="k-priming-card" id="k-word-${escapeHtml(w.lemma)}">
        <div class="k-priming-card__header">
          <div class="k-priming-card__term">
            <strong class="k-priming-card__surface">${escapeHtml(w.surfaceForm)}</strong>${w.partOfSpeech ? `<span class="k-priming-card__pos">(${escapeHtml(w.partOfSpeech)})</span>` : ""}
          </div>
          <div class="k-priming-card__actions">
            <form method="POST" action="/kindle/priming/action" class="k-inline-form" onsubmit="return window.lectaKindleAction(event, this, '${escapeHtml(w.lemma)}', 'known')">
              <input type="hidden" name="action" value="known" />
              <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
              <input type="hidden" name="chapter" value="${chapterIndex}" />
              <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
              <input type="hidden" name="lang" value="${escapeHtml(bookLang)}" />
              <input type="hidden" name="returnUrl" value="${escapeHtml(currentUrl)}" />
              <button type="submit" class="k-btn k-btn--small">✓ Ya la sé</button>
            </form>
            <form method="POST" action="/kindle/priming/action" class="k-inline-form" onsubmit="return window.lectaKindleAction(event, this, '${escapeHtml(w.lemma)}', 'save')">
              <input type="hidden" name="action" value="save" />
              <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
              <input type="hidden" name="chapter" value="${chapterIndex}" />
              <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
              <input type="hidden" name="lang" value="${escapeHtml(bookLang)}" />
              <input type="hidden" name="returnUrl" value="${escapeHtml(currentUrl)}" />
              <button type="submit" class="k-btn k-btn--small k-btn--outline">+ Repasar</button>
            </form>
          </div>
        </div>
        <p class="k-priming-card__gloss">${escapeHtml(w.shortGloss)}</p>${
          w.contextSentence
            ? `<blockquote class="k-priming-card__quote">«${escapeHtml(w.contextSentence)}»</blockquote>`
            : ""
        }
      </li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Antes de leer · ${escapeHtml(chapterTitle)}</title>
  <style>
    /* E-Ink High Contrast Zero-Flicker Styles */
    * { box-sizing: border-box; transition: none !important; animation: none !important; }
    body {
      margin: 0;
      padding: 16px 20px;
      background: #ffffff;
      color: #000000;
      font-family: Georgia, "Bookerly", "Literata", serif;
      line-height: 1.45;
    }
    .k-topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #000000;
      padding-bottom: 10px;
      margin-bottom: 16px;
      font-family: sans-serif;
      font-size: 14px;
    }
    .k-badge {
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1.5px solid #000;
      padding: 2px 8px;
    }
    .k-title {
      font-size: 22px;
      margin: 0 0 6px 0;
      font-weight: bold;
    }
    .k-subtitle {
      font-size: 15px;
      margin: 0 0 16px 0;
    }
    .k-priming-list {
      list-style: none;
      padding: 0;
      margin: 0 0 20px 0;
    }
    .k-priming-card {
      border: 2px solid #000000;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .k-priming-card__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }
    .k-priming-card__surface {
      font-size: 19px;
    }
    .k-priming-card__pos {
      font-size: 14px;
      font-style: italic;
      margin-left: 4px;
    }
    .k-priming-card__gloss {
      margin: 4px 0 8px 0;
      font-size: 16px;
      font-weight: bold;
    }
    .k-priming-card__quote {
      margin: 0;
      padding-left: 10px;
      border-left: 3px solid #000000;
      font-size: 14px;
      font-style: italic;
    }
    .k-inline-form { display: inline-block; margin: 0; }
    .k-btn {
      min-height: 44px;
      padding: 8px 14px;
      font-size: 15px;
      font-family: sans-serif;
      font-weight: bold;
      background: #000000;
      color: #ffffff;
      border: 2px solid #000000;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .k-btn--outline {
      background: #ffffff;
      color: #000000;
    }
    .k-btn--small {
      min-height: 38px;
      padding: 6px 10px;
      font-size: 14px;
    }
    .k-btn--full {
      width: 100%;
      min-height: 50px;
      font-size: 18px;
      margin-bottom: 16px;
    }
    .k-footer-Prefs {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      border-top: 1px solid #000000;
      padding-top: 12px;
    }
  </style>
</head>
<body>
  <header class="k-topbar">
    <span>${escapeHtml(bookTitle)}</span>
    <span class="k-badge">${isForeignLang ? `Idioma: ${escapeHtml(bookLang.toUpperCase())}` : "Pre-lectura"} · ${words.length} palabras</span>
  </header>

  <main>
    <h1 class="k-title">${escapeHtml(chapterTitle)}</h1>
    <p class="k-subtitle">Conoce estas palabras clave antes de empezar para leer el capítulo sin pausas.</p>

    <a href="${escapeHtml(startReadingUrl)}" class="k-btn k-btn--full">
      Comenzar a leer capítulo →
    </a>

    <ul class="k-priming-list">
      ${cardsHtml}
    </ul>

    <div class="k-footer-Prefs">
      <form method="POST" action="/kindle/priming/action" class="k-inline-form">
        <input type="hidden" name="action" value="mute_book" />
        <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
        <input type="hidden" name="chapter" value="${chapterIndex}" />
        <input type="hidden" name="returnUrl" value="${escapeHtml(startReadingUrl)}" />
        <button type="submit" class="k-btn k-btn--outline k-btn--small">Ocultar en este libro</button>
      </form>

      <form method="POST" action="/kindle/priming/action" class="k-inline-form">
        <input type="hidden" name="action" value="disable_all" />
        <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
        <input type="hidden" name="chapter" value="${chapterIndex}" />
        <input type="hidden" name="returnUrl" value="${escapeHtml(startReadingUrl)}" />
        <button type="submit" class="k-btn k-btn--outline k-btn--small">Desactivar siempre</button>
      </form>
    </div>
  </main>

  <script>
    // Mejora progresiva E-Ink: evita recargar toda la página al marcar palabras
    window.lectaKindleAction = function(ev, formEl, lemma, actionType) {
      if (!window.fetch) return true;
      ev.preventDefault();
      var card = document.getElementById('k-word-' + lemma);
      if (card && actionType === 'known') {
        card.style.display = 'none';
      } else if (card && actionType === 'save') {
        var btn = formEl.querySelector('button');
        if (btn) { btn.textContent = '✓ Guardada'; btn.disabled = true; }
      }
      var data = new FormData(formEl);
      fetch(formEl.action, { method: 'POST', body: data });
      return false;
    };
  </script>
</body>
</html>`;
}

/**
 * Inyecta un anclaje sutil en el HTML del capítulo para las 3-5 palabras pre-vistas
 */
export function injectKindlePrimedAnchors(
  chapterHtml: string,
  primedWords: KindlePrimingWord[],
): string {
  if (!primedWords.length) return chapterHtml;
  let output = chapterHtml;

  for (const item of primedWords) {
    const escaped = item.surfaceForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Solo ancla la primera aparición fuera de etiquetas HTML
    const regex = new RegExp(`(^|>[^<]*?)\\b(${escaped})\\b`, "i");
    output = output.replace(
      regex,
      `$1<span style="border-bottom: 1.5px dashed #000; font-weight: 500;">$2</span> <small style="font-family: sans-serif; font-size: 0.78em;">[${escapeHtml(item.shortGloss)}]</small>`,
    );
  }

  return output;
}


```

### FILE: src/shared/word-form.ts
```
// Qué cuenta como palabra candidata a vocabulario. Compartido entre
// el segmentador (worker), el análisis de capítulo y la hoja de
// preparación para que ningún token espurio —dígitos, puntuación
// residual, siglas cortas— llegue a sugerirse.

// Solo letras del español (con tildes, ñ y ü) y al menos tres
// caracteres: «1», «10», «3,5», «sí», «él» o «a1b» no son
// vocabulario que se aprende.
const WORD_TOKEN = /^[a-záéíóúüñ]{3,}$/i;

export function isWordToken(form: string): boolean {
  return WORD_TOKEN.test(form.trim());
}

// Raíces candidatas de un adverbio en «-mente»: la base sin el
// sufijo («perfectamente» → «perfecta») y, si termina en -a, la forma
// masculina del lema («perfecta» → «perfecto») por si la tabla de
// formas no enlaza el femenino. Bases de menos de tres letras se
// descartan («mente» misma queda en «», «demente» en «de») — no hay
// adjetivo tan corto que derive adverbios.
export function menteBaseForms(form: string): string[] {
  if (!form.endsWith("mente")) return [];
  const root = form.slice(0, -"mente".length);
  if (root.length < 3) return [];
  return root.endsWith("a") ? [root, `${root.slice(0, -1)}o`] : [root];
}

export type ContextualPos = "sustantivo" | "verbo" | null;

const ES_DETERMINERS = new Set([
  "el", "la", "los", "las",
  "un", "una", "unos", "unas",
  "mi", "tu", "su", "mis", "tus", "sus",
  "este", "esta", "estos", "estas",
  "ese", "esa", "esos", "esas",
  "aquel", "aquella", "aquellos", "aquellas",
  "ningún", "ningun", "ninguna", "ningunos", "ningunas",
  "algún", "algun", "alguna", "algunos", "algunas",
  "cada", "cualquier", "cualesquier",
  "otro", "otra", "otros", "otras",
  "mucho", "mucha", "muchos", "muchas",
  "poco", "poca", "pocos", "pocas",
  "tanto", "tanta", "tantos", "tantas",
  "demasiado", "demasiada", "demasiados", "demasiadas",
  "del", "al", "sendos", "sendas",
  "nuestro", "nuestra", "nuestros", "nuestras",
  "vuestro", "vuestra", "vuestros", "vuestras",
]);

const EN_DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those",
  "my", "your", "his", "her", "its", "our", "their",
  "every", "each", "any", "no", "of", "some", "many",
  "much", "few", "several", "all", "both",
]);

const ES_VERB_MARKERS = new Set([
  "me", "te", "se", "nos", "os", "le", "les",
  "yo", "tú", "él", "ella", "usted", "ustedes",
  "nosotros", "nosotras", "vosotros", "vosotras", "ellos", "ellas",
  "he", "has", "ha", "hemos", "habéis", "habeis", "han",
  "había", "habias", "habia", "habíamos", "habian", "habían",
  "suelo", "suele", "suelen",
  "debo", "debe", "deben",
  "quiero", "quiere", "quieren",
  "puedo", "puede", "pueden",
  "voy", "va", "van",
]);

const EN_VERB_MARKERS = new Set([
  "i", "you", "he", "she", "it", "we", "they",
  "will", "did", "do", "does", "would", "could", "should",
  "can", "must", "might", "may", "to",
]);

/**
 * Infiere la categoría gramatical más probable ('sustantivo' o 'verbo')
 * de una palabra en su oración hábitat a partir de su vecindad sintáctica inmediata.
 */
export function inferContextualPos(
  targetWord: string,
  contextSentence?: string | null,
  language = "es",
): ContextualPos {
  if (!targetWord || !contextSentence?.trim()) return null;

  const cleanTarget = targetWord.trim().toLowerCase();
  if (!cleanTarget) return null;

  const normalizedSentence = contextSentence
    .toLowerCase()
    .replace(/[¿?¡!«»“”"()[\],;:.\-–—\n\r\t]/g, " ");

  const tokens = normalizedSentence.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const targetIdx = tokens.findIndex((t) => t === cleanTarget);
  if (targetIdx <= 0) return null;

  const prevToken = tokens[targetIdx - 1];
  const prevPrevToken = targetIdx >= 2 ? tokens[targetIdx - 2] : null;

  const isEnglish = language === "en";
  const determiners = isEnglish ? EN_DETERMINERS : ES_DETERMINERS;
  const verbMarkers = isEnglish ? EN_VERB_MARKERS : ES_VERB_MARKERS;

  // 1. Regla Sustantivo/Adjetivo: precedido por un determinante (directo o con modificador intermedio)
  if (determiners.has(prevToken)) {
    return "sustantivo";
  }

  if (prevPrevToken && determiners.has(prevPrevToken)) {
    return "sustantivo";
  }

  // 2. Regla Verbo: precedido por un marcador verbal / pronombre proclítico
  if (verbMarkers.has(prevToken)) {
    return "verbo";
  }

  if (
    prevPrevToken &&
    verbMarkers.has(prevPrevToken) &&
    (prevToken === "no" || prevToken === "ya" || prevToken === "nunca" || prevToken === "jamás" || prevToken === "not")
  ) {
    return "verbo";
  }

  return null;
}

const COMMON_LEXICAL_FAMILIES: Record<string, string[]> = {
  afrenta: ["afrentar", "afrentoso", "afrentado"],
  afrentar: ["afrenta", "afrentoso", "afrentado"],
  lector: ["lectura", "leer", "legible"],
  leer: ["lector", "lectura", "legible"],
  lectura: ["lector", "leer", "legible"],
  caminar: ["camino", "caminante", "caminata"],
  camino: ["caminar", "caminante", "caminata"],
  sombra: ["sombrío", "ensombrecer", "asombrar"],
  sombrío: ["sombra", "ensombrecer", "asombrar"],
  luz: ["luminoso", "iluminar", "lucidez"],
  luminoso: ["luz", "iluminar", "lucidez"],
  noche: ["nocturno", "anochecer", "trasnochar"],
  nocturno: ["noche", "anochecer", "trasnochar"],
  tierra: ["terrestre", "enterrar", "desterrar"],
  mar: ["marino", "marejada", "marinero"],
  fuego: ["fogoso", "hoguera", "fogonazo"],
  muerte: ["mortal", "morir", "inmortal"],
  vida: ["vital", "vivir", "revivir"],
  viento: ["ventisca", "ventarrón", "ventilar"],
  dolor: ["doloroso", "doler", "adolorido"],
  amor: ["amoroso", "enamorar", "desamor"],
  memoria: ["memorable", "conmemorar", "rememorar"],
  olvido: ["olvidar", "olvidadizo", "inolvidable"],
  pensar: ["pensamiento", "pensativo", "repensar"],
  silencio: ["silencioso", "silenciar", "ensordecedor"],
  soledad: ["solitario", "desolado", "solo"],
  tiempo: ["temporal", "intemporal", "temporada"],
  palabra: ["palabrería", "palabrero", "parlamento"],
};

/**
 * Devuelve hasta 3 términos emparentados morfológicamente (familia léxica).
 */
export function findLexicalFamily(word: string, language = "es"): string[] {
  const clean = word.trim().toLowerCase();
  if (clean.length < 3) return [];

  if (language === "es") {
    const direct = COMMON_LEXICAL_FAMILIES[clean];
    if (direct) {
      return direct.filter((w) => w !== clean).slice(0, 3);
    }

    // Reglas morfológicas productivas del español
    let candidates: string[] = [];
    if (clean.endsWith("amiento") || clean.endsWith("imiento")) {
      const root = clean.slice(0, -7);
      candidates = [`${root}ar`, `${root}ado`, `${root}ador`];
    } else if (clean.endsWith("ación") || clean.endsWith("acion")) {
      const root = clean.slice(0, -5);
      candidates = [`${root}ar`, `${root}ado`, `${root}ativo`];
    } else if (clean.endsWith("oso") || clean.endsWith("osa")) {
      const root = clean.slice(0, -3);
      candidates = [`${root}ar`, `${root}a`, `${root}idad`];
    } else if (clean.endsWith("ar")) {
      const root = clean.slice(0, -2);
      candidates = [`${root}ado`, `${root}ador`, `${root}ación`];
    } else if (clean.endsWith("er") || clean.endsWith("ir")) {
      const root = clean.slice(0, -2);
      candidates = [`${root}ido`, `${root}iente`, `${root}imiento`];
    } else if (clean.endsWith("a") || clean.endsWith("o")) {
      const root = clean.slice(0, -1);
      candidates = [`${root}ar`, `${root}oso`, `${root}ado`];
    }

    return Array.from(new Set(candidates))
      .filter((w) => w !== clean && w.length >= 3)
      .slice(0, 3);
  }

  // Fallback simple para inglés
  if (language === "en") {
    if (clean.endsWith("ing")) {
      const root = clean.slice(0, -3);
      return [`${root}ed`, `${root}er`, root].filter((w) => w !== clean && w.length >= 3).slice(0, 3);
    }
    if (clean.endsWith("ed")) {
      const root = clean.slice(0, -2);
      return [`${root}ing`, `${root}er`, root].filter((w) => w !== clean && w.length >= 3).slice(0, 3);
    }
  }

  return [];
}

/**
 * Genera formas base o lemas candidatos para buscar una palabra flexionada
 * en el diccionario local (español o inglés).
 */
export function generateLookupCandidates(word: string, language = "es"): string[] {
  const clean = word.trim().toLowerCase();
  if (!clean) return [];

  const candidates: string[] = [clean];

  if (language === "en") {
    // 1. -ies (> 4 letras) -> -y (ej. memories -> memory)
    if (clean.endsWith("ies") && clean.length > 4) {
      candidates.push(`${clean.slice(0, -3)}y`);
    }

    // 2. -ied (> 4 letras) -> -y (ej. replied -> reply)
    if (clean.endsWith("ied") && clean.length > 4) {
      candidates.push(`${clean.slice(0, -3)}y`);
    }

    // 3. -ing (> 5 letras) -> sin ing, con e final, sin consonante duplicada
    if (clean.endsWith("ing") && clean.length > 5) {
      const root = clean.slice(0, -3);
      candidates.push(root);
      candidates.push(`${root}e`);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        candidates.push(root.slice(0, -1));
      }
    }

    // 4. -ed (> 4 letras) -> sin ed, sin d, sin consonante duplicada
    if (clean.endsWith("ed") && clean.length > 4) {
      const rootNoEd = clean.slice(0, -2);
      candidates.push(rootNoEd);
      candidates.push(clean.slice(0, -1)); // sin d (loved -> love)
      if (rootNoEd.length >= 3 && rootNoEd[rootNoEd.length - 1] === rootNoEd[rootNoEd.length - 2]) {
        candidates.push(rootNoEd.slice(0, -1));
      }
    }

    // 5. -ly (> 4 letras) -> sin ly, o -ily -> -y
    if (clean.endsWith("ly") && clean.length > 4) {
      candidates.push(clean.slice(0, -2));
      if (clean.endsWith("ily") && clean.length > 4) {
        candidates.push(`${clean.slice(0, -3)}y`);
      }
    }

    // 6. -es (> 3 letras) -> sin es o sin s
    if (clean.endsWith("es") && clean.length > 3) {
      candidates.push(clean.slice(0, -2));
      candidates.push(clean.slice(0, -1));
    }

    // 7. -s (> 3 letras, excluyendo -ss) -> sin s
    if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3) {
      candidates.push(clean.slice(0, -1));
    }
  } else {
    // Español
    for (const base of menteBaseForms(clean)) {
      candidates.push(base);
    }
  }

  return Array.from(new Set(candidates)).filter((c) => c.length >= 2);
}

/**
 * Normaliza una forma superficial a su lema base más probable para consulta o comparación.
 */
export function normalizeWordForm(word: string, language = "es"): string {
  const clean = word.trim().toLowerCase();
  if (!clean) return "";
  const lang = language.slice(0, 2).toLowerCase();

  if (lang === "en") {
    // 1. -ies / -ied (> 4 letras) -> -y (memories -> memory, replied -> reply)
    if ((clean.endsWith("ies") || clean.endsWith("ied")) && clean.length > 4) {
      return `${clean.slice(0, -3)}y`;
    }
    // 2. -ly / -ily (> 4 letras) -> base / -y (reluctantly -> reluctant, happily -> happy)
    if (clean.endsWith("ly") && clean.length > 4) {
      if (clean.endsWith("ily")) return `${clean.slice(0, -3)}y`;
      return clean.slice(0, -2);
    }
    // 3. -ing (> 5 letras) -> base / desduplicación consonante (lingering -> linger, running -> run)
    if (clean.endsWith("ing") && clean.length > 5) {
      const root = clean.slice(0, -3);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        return root.slice(0, -1);
      }
      return root;
    }
    // 4. -ed (> 4 letras) -> base / desduplicación consonante (whispered -> whisper, stopped -> stop)
    if (clean.endsWith("ed") && clean.length > 4) {
      const root = clean.slice(0, -2);
      if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
        return root.slice(0, -1);
      }
      return root;
    }
    // 5. -es (> 4 letras) -> base (watches -> watch)
    if (clean.endsWith("es") && clean.length > 4) {
      if (clean.endsWith("shes") || clean.endsWith("ches") || clean.endsWith("sses") || clean.endsWith("xes")) {
        return clean.slice(0, -2);
      }
      return clean.slice(0, -1);
    }
    // 6. -s (> 3 letras) -> base (shadows -> shadow)
    if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3) {
      return clean.slice(0, -1);
    }
    return clean;
  }

  // Español
  if (clean.endsWith("mente") && clean.length > 6) {
    const bases = menteBaseForms(clean);
    if (bases.length > 0) return bases[bases.length - 1];
  }

  return clean;
}


```

### FILE: src/shared/stopwords.ts
```
// Palabras funcionales del español (artículos, preposiciones, conjunciones,
// pronombres, auxiliares y sus formas comunes): no son vocabulario que se
// aprende, así que se excluyen del análisis de "palabras difíciles" y del
// enriquecimiento por IA. Compartido entre cliente y worker.
export const SPANISH_STOPWORDS = [
  // artículos y contracciones
  "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "al", "del",
  // preposiciones
  "a", "de", "en", "ante", "bajo", "con", "contra", "desde", "durante",
  "entre", "hacia", "hasta", "para", "por", "según", "sin", "sobre", "tras",
  // conjunciones
  "y", "e", "o", "u", "ni", "pero", "mas", "sino", "si", "que", "como",
  "porque", "pues", "aunque", "mientras", "cuando", "donde", "cuanto",
  // pronombres personales y átonos
  "yo", "tú", "él", "ella", "usted", "nosotros", "nosotras", "vosotros",
  "vosotras", "ellos", "ellas", "ustedes", "me", "te", "se", "nos", "os",
  "le", "les",
  // posesivos y demostrativos
  "mi", "tu", "su", "mis", "tus", "sus", "nuestro", "nuestra", "nuestros",
  "nuestras", "vuestro", "vuestra", "vuestros", "vuestras", "este", "esta",
  "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "aquella",
  "aquellos", "aquellas", "esto", "eso", "aquello", "cuyo", "cuya",
  "cuyos", "cuyas",
  // indefinidos y cuantificadores
  "todo", "toda", "todos", "todas", "otro", "otra", "otros", "otras",
  "mismo", "misma", "mismos", "mismas", "algo", "nada", "alguien", "nadie",
  "quien", "quienes", "cual", "cuales", "cualquier", "cualesquiera", "cada",
  "mucho", "mucha", "muchos", "muchas", "poco", "poca", "pocos", "pocas",
  "bastante", "demasiado", "menos", "tanto", "tanta", "tantos", "tantas",
  "tan", "varios", "varias", "algún", "alguno", "alguna", "algunos",
  "algunas", "ningún", "ninguno", "ninguna", "ningunos", "ningunas",
  "ambos", "ambas", "demás", "tal", "tales",
  // numerales en texto: cardinales, ordinales y múltiplos
  "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
  "veintiún", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho",
  "veintinueve", "treinta", "cuarenta", "cincuenta", "sesenta",
  "setenta", "ochenta", "noventa", "cien", "ciento", "cientos",
  "cienta", "cientas", "doscientos", "doscientas", "trescientos",
  "trescientas", "cuatrocientos", "cuatrocientas", "quinientos",
  "quinientas", "seiscientos", "seiscientas", "setecientos",
  "setecientas", "ochocientos", "ochocientas", "novecientos",
  "novecientas", "mil", "millón", "millones", "billón", "billones",
  "trillón", "trillones", "primer", "primero", "primera", "segundo",
  "segunda", "tercer", "tercero", "tercera", "cuarto", "cuarta",
  "quinto", "quinta", "sexto", "sexta", "séptimo", "séptima", "octavo",
  "octava", "noveno", "novena", "décimo", "décima", "undécimo",
  "duodécimo", "vigésimo", "centésimo",
  // saludos e interjecciones
  "hola", "adiós", "chao", "chau", "eh", "ah", "oh", "uh", "ay", "uy",
  "uf", "ajá", "mmm", "ey", "hey", "olé", "bravo", "ojalá", "vale",
  "venga", "dale", "ándale", "andale", "órale", "híjole", "bah", "ejem",
  // adverbios locativos, temporales y de modo frecuentes
  "más", "muy", "ya", "no", "sí", "también", "tampoco", "solo", "siquiera",
  "así", "aquí", "ahí", "allí", "acá", "allá", "ahora", "después",
  "antes", "luego", "entonces", "siempre", "nunca", "jamás", "casi",
  "acaso", "quizá", "quizás", "incluso", "además", "apenas", "abajo",
  "arriba", "atrás", "delante", "detrás", "adelante", "adentro",
  "afuera", "dentro", "fuera", "cerca", "lejos", "encima", "debajo",
  "alrededor", "enfrente", "ayer", "hoy", "mañana", "anoche",
  "anteayer", "antier", "aún", "aun", "todavía", "recién", "enseguida",
  "despacio", "pronto", "tarde", "temprano", "obstante", "asimismo",
  "aparte",
  // auxiliares y formas comunes de ser/estar/haber
  "ser", "estar", "haber", "es", "son", "soy", "eres", "somos", "era",
  "eran", "fue", "fueron", "será", "está", "están", "estoy", "estás",
  "estaba", "hay", "ha", "han", "he", "has", "hemos", "había",
];

// Palabras funcionales del inglés (artículos, preposiciones, pronombres,
// conjunciones, auxiliares, números y adverbios gramaticales comunes).
export const ENGLISH_STOPWORDS = [
  // artículos
  "the", "a", "an",
  // preposiciones
  "of", "in", "to", "for", "with", "on", "at", "from", "by", "about",
  "as", "into", "like", "through", "after", "over", "between", "out",
  "against", "during", "without", "before", "under", "around", "among",
  "upon", "off", "across", "behind", "beyond", "within", "along",
  "towards", "toward", "near", "despite", "above", "below", "throughout",
  // conjunciones
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though",
  "while", "whereas", "if", "unless", "whether", "since", "than",
  // pronombres personales, reflexivos y posesivos
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "mine",
  "yours", "hers", "ours", "theirs", "myself", "yourself", "himself",
  "herself", "itself", "ourselves", "yourselves", "themselves",
  // demostrativos e interrogativos/relativos
  "this", "that", "these", "those", "who", "whom", "whose", "which",
  "what", "whatever", "whoever", "whomever", "whichever",
  // indefinidos y cuantificadores
  "all", "some", "any", "no", "every", "each", "both", "either", "neither",
  "another", "other", "others", "such", "someone", "somebody", "something",
  "anyone", "anybody", "anything", "everyone", "everybody", "everything",
  "nobody", "nothing", "none", "many", "much", "few", "fewer", "little",
  "more", "most", "less", "least", "several", "enough",
  // numerales cardinales y ordinales
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
  "billion", "first", "second", "third", "fourth", "fifth", "last", "next",
  // auxiliares, modales y formas de be / have / do
  "be", "am", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing", "done",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  // contracciones frecuentes normalizadas
  "don", "doesn", "didn", "won", "wouldn", "can", "couldn", "shouldn",
  "isn", "aren", "wasn", "weren", "hasn", "haven", "hadn",
  // adverbios locativos, temporales y de modo comunes
  "not", "too", "very", "also", "just", "only", "now", "then", "there",
  "here", "where", "when", "why", "how", "again", "always", "never",
  "sometimes", "often", "already", "still", "ever", "even", "rather",
  "quite", "almost", "together", "well", "back", "away", "far", "soon",
  "today", "yesterday", "tomorrow", "tonight", "perhaps", "maybe",
  // saludos e interjecciones comunes
  "hello", "hi", "hey", "bye", "goodbye", "yes", "yeah", "yep", "nope",
  "oh", "ah", "wow", "please", "thanks", "thank",
];

const spanishStopwordSet = new Set(SPANISH_STOPWORDS);
const englishStopwordSet = new Set(ENGLISH_STOPWORDS);

export function isStopword(form: string, language: "es" | "en" | string = "es"): boolean {
  const normalized = form.trim().toLowerCase();
  if (language === "en") return englishStopwordSet.has(normalized);
  if (language === "es") return spanishStopwordSet.has(normalized);
  return false;
}

```

### FILE: db/migrations/007_user_knowledge.sql
```
-- Modelo de conocimiento por cuenta: qué lemas sabe el lector y
-- cuáles no. Una fila por (user_id, language, lemma); `source` dice de
-- dónde vino la evidencia (calibración inicial, «ya la conozco» o
-- inferida de sus actos) y updated_at arbitra entre dispositivos como
-- en vocabulario y anotaciones, con lápidas para propagar borrados.
CREATE TABLE IF NOT EXISTS lecta_user_knowledge (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  language STRING NOT NULL,
  lemma STRING NOT NULL,
  known BOOL NOT NULL,
  source STRING NOT NULL,
  updated_at INT8 NOT NULL,
  deleted BOOL NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, language, lemma)
);

```

### FILE: db/migrations/004_user_reviews.sql
```
-- Historial de repasos por cuenta (append-only, como la actividad).
-- La clave es (user_id, id) y el cliente manda el uuid que generó al
-- cerrar el repaso; el servidor solo inserta los que faltan.
CREATE TABLE IF NOT EXISTS lecta_user_reviews (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id STRING NOT NULL,
  language STRING NOT NULL,
  form STRING NOT NULL,
  kind STRING NOT NULL,
  rating STRING NOT NULL,
  hints INT4 NOT NULL DEFAULT 0,
  created_at INT8 NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS lecta_user_reviews_user ON lecta_user_reviews (user_id);

-- Acepción elegida al guardar: (entry_id, sense_order) identifica la
-- fila de lexicon_senses; meaning queda como copia para repaso offline.
ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS sense_entry_id INT8;
ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS sense_order INT4;

```

Return the updated files in JSON format: { "files": [ { "path": "string", "content": "string" } ] } preserving all existing functionality and tests.