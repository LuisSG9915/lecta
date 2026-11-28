import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";

export interface ExtractedArticle {
  title: string;
  author?: string;
  language: string;
  sourceHost: string;
  paragraphs: string[];
}

export type ArticleImportErrorCode =
  | "LECTA_PLUS_REQUIRED"
  | "RATE_LIMIT"
  | "INVALID_URL"
  | "UNSUPPORTED"
  | "TOO_LARGE"
  | "EMPTY"
  | "NETWORK";

export class ArticleImportError extends Error {
  constructor(
    message: string,
    public readonly code: ArticleImportErrorCode = "NETWORK",
  ) {
    super(message);
    this.name = "ArticleImportError";
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function articleSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Extrae el texto limpio de un artículo en memoria vía `/api/articles/extract`
 * (sin almacenar HTML ni párrafos en el servidor).
 */
export async function fetchExtractedArticle(
  url: string,
  scope?: DbScope,
): Promise<ExtractedArticle> {
  let response: Response;
  try {
    response = await accountFetch(
      "/api/articles/extract",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      },
      scope,
    );
  } catch {
    throw new ArticleImportError("No hay conexión para traer ese enlace.", "NETWORK");
  }

  let payload: { error?: string; code?: string } & Partial<ExtractedArticle> = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const msg = payload.error || "No se pudo importar ese artículo.";
    if (response.status === 402 || payload.code === "LECTA_PLUS_REQUIRED") {
      throw new ArticleImportError(msg, "LECTA_PLUS_REQUIRED");
    }
    if (response.status === 429) throw new ArticleImportError(msg, "RATE_LIMIT");
    if (response.status === 400) throw new ArticleImportError(msg, "INVALID_URL");
    if (response.status === 415) throw new ArticleImportError(msg, "UNSUPPORTED");
    if (response.status === 413) throw new ArticleImportError(msg, "TOO_LARGE");
    if (response.status === 422) throw new ArticleImportError(msg, "EMPTY");
    throw new ArticleImportError(msg, "NETWORK");
  }

  if (!payload.title || !Array.isArray(payload.paragraphs) || payload.paragraphs.length === 0) {
    throw new ArticleImportError("El enlace no devolvió texto legible.", "EMPTY");
  }

  return {
    title: payload.title,
    author: payload.author,
    language: payload.language || "es",
    sourceHost: payload.sourceHost || "",
    paragraphs: payload.paragraphs,
  };
}

export function estimateArticleReadingMinutes(paragraphs: string[]): number {
  const wordCount = paragraphs.reduce((acc, p) => {
    const trimmed = p.trim();
    if (!trimmed) return acc;
    return acc + trimmed.split(/\s+/).length;
  }, 0);
  return Math.max(1, Math.round(wordCount / 220));
}

/**
 * Empaqueta un artículo extraído en un EPUB 3 válido para lectura local en IndexedDB.
 */
export async function buildArticleEpubFile(article: ExtractedArticle): Promise<File> {
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  const title = escapeXml(article.title);
  const author = escapeXml(article.author || article.sourceHost || "Artículo web");
  const lang = escapeXml((article.language || "es").slice(0, 5));
  const id = `lecta-article-${articleSlug(article.title) || "doc"}`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(id)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2026-11-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
  <nav epub:type="toc">
    <h1>Índice</h1>
    <ol><li><a href="chapter1.xhtml">${title}</a></li></ol>
  </nav>
</body>
</html>`;

  const bodyParagraphs = article.paragraphs
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join("\n    ");
  const sourceNote = article.sourceHost
    ? `<p><em>Fuente: ${escapeXml(article.sourceHost)}</em></p>`
    : "";

  const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
  <h1>${title}</h1>
  ${sourceNote}
  ${bodyParagraphs}
</body>
</html>`;

  await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 });
  await writer.add("META-INF/container.xml", new TextReader(containerXml));
  await writer.add("OEBPS/content.opf", new TextReader(contentOpf));
  await writer.add("OEBPS/nav.xhtml", new TextReader(navXhtml));
  await writer.add("OEBPS/chapter1.xhtml", new TextReader(chapterXhtml));

  const blob = await writer.close();
  const filename = `${articleSlug(article.title) || "articulo"}.epub`;
  return new File([blob], filename, { type: "application/epub+zip" });
}
