// Quita la marca Project Gutenberg de un EPUB de dominio público.
//
// La licencia de PG permite redistribuir sus libros gratis con la marca,
// pero cobrar por copias o por acceso a una obra con la marca exige
// regalías (§1.E.8). Si se quita toda referencia a Project Gutenberg,
// queda texto de dominio público sin condiciones de marca (§1.C). Lecta
// sirve los libros dentro de un producto de pago, así que publica el
// catálogo limpio. Ver docs/designs/2026-11-15-explora-derechos.md (R4,
// M4c).
//
// Lo que quita (formato Ebookmaker de PG):
// - XHTML: <header id="pg-header"> (cabecera con la licencia corta y el
//   «*** START OF THE PROJECT GUTENBERG EBOOK»), <footer id="pg-footer">
//   (licencia completa) y <meta name="generator" …Project Gutenberg>.
//   Un documento que queda sin texto sale del manifiesto y del spine.
// - OPF: dc:identifier de gutenberg.org (pasa a urn:lecta:catalog:<id>),
//   dc:source y dc:publisher que nombran a PG, comentarios con la marca.
// - NCX / nav: dtb:uid, generator y las entradas del índice que apuntan
//   a la cabecera o al pie de PG o los nombran.
// - CSS: reglas cuyo selector nombra a Gutenberg.
// Lo que no toca: el texto de la obra, las imágenes y dc:rights
// («Public domain in the USA.» no es la marca).

import {
  BlobWriter,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  TextReader,
} from "@zip.js/zip.js";

/**
 * La marca: «Project Gutenberg», «Gutenberg-tm», «PG-tm» o el dominio.
 * «Gutenberg» a secas no: el texto de una obra puede nombrar al inventor
 * de la imprenta («la biblia de Gutenberg»). Esas menciones sueltas se
 * reportan aparte (`mentions`) para revisarlas a mano.
 */
export const GUTENBERG_MARK = /project\s*gutenberg|gutenberg\.org|gutenberg\s*[-‑]?\s*tm|\bpg-?tm\b/i;
const GUTENBERG_WORD = /gutenberg/i;

const TEXT_FILE = /\.(x?html?|opf|ncx|css|xml)$/i;
const DOC_FILE = /\.x?html?$/i;

// Quita elementos cuyo id es exactamente pg-header / pg-footer. Busca la
// etiqueta de cierre equilibrando las del mismo nombre, por si dentro hay
// otro <header>/<section> anidado.
function removeElementById(html: string, id: string): string {
  const open = new RegExp(`<(header|footer|section|div)\\b[^>]*\\bid="${id}"[^>]*>`, "i");
  const match = open.exec(html);
  if (!match) return html;
  const tag = match[1].toLowerCase();
  const start = match.index;
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  scan.lastIndex = start + match[0].length;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html))) {
    if (m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + html.slice(scan.lastIndex);
  }
  return html;
}

const textOf = (html: string) =>
  (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, "");

// Bloques hoja (sin el mismo bloque anidado) que nombran la marca: notas
// del transcriptor o del editor de PG dentro del cuerpo del libro.
const LEAF_BLOCK = /<(p|h[1-6]|li|pre|blockquote|tr)\b[^>]*>(?:(?!<\1\b)[^])*?<\/\1>/gi;

export function debrandXhtml(html: string, bookTitle = ""): string {
  let out = html;
  for (const id of ["pg-header", "pg-footer"]) {
    // Puede haber más de uno en ediciones viejas.
    for (let i = 0; i < 4; i++) {
      const next = removeElementById(out, id);
      if (next === out) break;
      out = next;
    }
  }
  out = out
    .replace(/<meta\b[^>]*gutenberg[^>]*\/?>\s*/gi, "")
    .replace(/<title>([^<]*)<\/title>/i, (tag, text: string) => {
      if (!GUTENBERG_MARK.test(text)) return tag;
      const rest = text.replace(/^\s*the\s+project\s+gutenberg\s+e-?book\s+of\s+/i, "");
      return `<title>${GUTENBERG_MARK.test(rest) ? bookTitle : rest}</title>`;
    })
    // Enlaces a gutenberg.org: queda el texto, sale el enlace.
    .replace(/<a\b[^>]*href="[^"]*gutenberg\.org[^"]*"[^>]*>([^]*?)<\/a>/gi, "$1");
  const body = /(<body\b[^>]*>)([^]*)(<\/body>)/i.exec(out);
  if (body) {
    const cleaned = body[2].replace(LEAF_BLOCK, (block) =>
      GUTENBERG_MARK.test(block.replace(/<[^>]+>/g, " ")) ? "" : block,
    );
    out = out.slice(0, body.index) + body[1] + cleaned + body[3] + out.slice(body.index + body[0].length);
  }
  return out;
}

/** ¿El documento quedó sin texto de la obra? (p. ej. el que solo llevaba la licencia) */
export function isEmptyDocument(html: string): boolean {
  return textOf(html) === "" && !/<(img|svg|image)\b/i.test(html);
}

export function debrandOpf(opf: string, id: string, dropHrefs: Set<string>): string {
  let out = opf
    .replace(
      /(<dc:identifier\b[^>]*>)[^<]*gutenberg[^<]*(<\/dc:identifier>)/gi,
      `$1urn:lecta:catalog:${id}$2`,
    )
    .replace(/\s*<dc:(source|publisher)\b[^>]*>[^<]*gutenberg[^<]*<\/dc:\1>/gi, "")
    .replace(/\s*<meta\b[^>]*gutenberg[^>]*\/?>/gi, "")
    .replace(/\s*<!--[^]*?-->/g, (c) => (GUTENBERG_MARK.test(c) ? "" : c));
  for (const href of dropHrefs) {
    const esc = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const item = new RegExp(`\\s*<item\\b[^>]*href="${esc}"[^>]*/>`, "i");
    const idMatch = new RegExp(`<item\\b[^>]*href="${esc}"[^>]*\\bid="([^"]+)"`, "i").exec(out) ??
      new RegExp(`<item\\b[^>]*\\bid="([^"]+)"[^>]*href="${esc}"`, "i").exec(out);
    out = out.replace(item, "");
    if (idMatch) {
      const ref = idMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\s*<itemref\\b[^>]*idref="${ref}"[^>]*/>`, "i"), "");
    }
  }
  return out;
}

export function debrandNcx(ncx: string, id: string): string {
  let out = ncx
    .replace(/(<meta\b[^>]*name="dtb:uid"[^>]*content=")[^"]*gutenberg[^"]*(")/gi, `$1urn:lecta:catalog:${id}$2`)
    .replace(/\s*<meta\b[^>]*gutenberg[^>]*\/?>/gi, "");
  // navPoint sin hijos navPoint que apunte a la cabecera/pie o nombre a PG.
  out = out.replace(/\s*<navPoint\b(?:(?!<navPoint\b)[^])*?<\/navPoint>/gi, (block) =>
    /pg-(header|footer)/i.test(block) || GUTENBERG_MARK.test(block) ? "" : block,
  );
  return out;
}

export function debrandNav(nav: string, id: string): string {
  let out = debrandNcx(nav, id);
  // <li> hoja (sin <li> anidado) con enlace a la cabecera/pie o con la marca.
  out = out.replace(/\s*<li\b(?:(?!<li\b)[^])*?<\/li>/gi, (block) =>
    /pg-(header|footer)/i.test(block) || GUTENBERG_MARK.test(block) ? "" : block,
  );
  return out.replace(/<meta\b[^>]*gutenberg[^>]*\/?>\s*/gi, "");
}

export function debrandCss(css: string): string {
  return css.replace(/[^{}]*\{[^{}]*\}/g, (rule) => {
    const selector = rule.slice(0, rule.indexOf("{"));
    return GUTENBERG_WORD.test(selector) ? "" : rule;
  });
}

/** Una entrada del zip para el informe: dónde quedó la marca después de limpiar. */
export type BrandHit = { file: string; where: "name" | "content" | "mention" };

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Limpia un EPUB entero y devuelve los bytes nuevos más las menciones que
 * quedaron (nombres de archivo o contenido de texto). Una lista vacía es
 * la condición para publicar.
 */
export async function debrandGutenbergEpub(
  epub: Uint8Array,
  id: string,
): Promise<{ bytes: Uint8Array; residual: BrandHit[] }> {
  const reader = new ZipReader(new Uint8ArrayReader(epub));
  const entries = (await reader.getEntries()).filter((e) => !e.directory);
  const texts = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.directory) continue;
    if (TEXT_FILE.test(entry.filename)) {
      texts.set(entry.filename, await entry.getData(new TextWriter()));
    } else {
      binaries.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
  }
  await reader.close();

  const opfText = [...texts.entries()].find(([name]) => /\.opf$/i.test(name))?.[1] ?? "";
  const bookTitle = /<dc:title\b[^>]*>([^<]*)<\/dc:title>/i.exec(opfText)?.[1].trim() ?? "";

  // Documentos XHTML primero: los que quedan vacíos salen del paquete.
  const dropped = new Set<string>();
  for (const [name, text] of texts) {
    if (!DOC_FILE.test(name)) continue;
    const clean = debrandXhtml(text, bookTitle);
    // Solo sale un documento que llevaba la cabecera o el pie de PG y
    // quedó vacío; uno que ya venía vacío (anclas de página) se queda.
    if (/\bid="pg-(header|footer)"/i.test(text) && isEmptyDocument(clean)) {
      dropped.add(name);
      texts.delete(name);
    } else {
      texts.set(name, clean);
    }
  }
  for (const [name, text] of texts) {
    if (/\.opf$/i.test(name)) {
      const dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
      const rel = new Set(
        [...dropped].map((d) => (d.startsWith(dir) ? d.slice(dir.length) : d)),
      );
      texts.set(name, debrandOpf(text, id, rel));
    } else if (/\.ncx$/i.test(name)) {
      texts.set(name, debrandNcx(text, id));
    } else if (/\.css$/i.test(name)) {
      texts.set(name, debrandCss(text));
    } else if (DOC_FILE.test(name) && /<nav\b/i.test(text)) {
      texts.set(name, debrandNav(text, id));
    }
  }
  // Enlaces a los documentos que salieron: se quitan los <a> que apuntan
  // a ellos (dejando su texto) para no dejar enlaces rotos.
  if (dropped.size) {
    const names = [...dropped].map(basename);
    for (const [name, text] of texts) {
      if (!DOC_FILE.test(name)) continue;
      texts.set(
        name,
        text.replace(/<a\b[^>]*href="([^"#]*)[^"]*"[^>]*>([^]*?)<\/a>/gi, (a, href, inner) =>
          names.includes(basename(href)) ? inner : a,
        ),
      );
    }
  }

  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  const mimetype = texts.get("mimetype") ?? "application/epub+zip";
  await writer.add("mimetype", new TextReader(mimetype), { level: 0, extendedTimestamp: false });
  const residual: BrandHit[] = [];
  for (const entry of entries) {
    const name = entry.filename;
    if (name === "mimetype" || dropped.has(name)) continue;
    if (GUTENBERG_MARK.test(name)) residual.push({ file: name, where: "name" });
    const text = texts.get(name);
    if (text !== undefined) {
      if (GUTENBERG_MARK.test(text)) residual.push({ file: name, where: "content" });
      else if (GUTENBERG_WORD.test(text)) residual.push({ file: name, where: "mention" });
      await writer.add(name, new TextReader(text));
    } else {
      const bin = binaries.get(name);
      if (bin) await writer.add(name, new Uint8ArrayReader(bin));
    }
  }
  const blob = await writer.close();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), residual };
}
