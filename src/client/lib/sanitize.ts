import DOMPurify from "dompurify";

export function isSafeInternalEpubHref(rawHref: string): boolean {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;
  // Bloquear cualquier esquema con ':' (javascript:, data:, http:, https:, vbscript:, mailto:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) return false;
  return true;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName && node.tagName.toLowerCase() === "a") {
    const href = node.getAttribute("href");
    if (href && isSafeInternalEpubHref(href)) {
      node.setAttribute("data-epub-link", "internal");
    } else {
      node.removeAttribute("href");
      node.removeAttribute("target");
    }
  }
});

const READER_TAGS = [
  "a",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "image",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "var",
];

// El `id` sobrevive el filtro solo para ser renombrado a `data-frag-id`
// tras la sanitización: los destinos de fragmento del índice los
// necesitan, y dejarlos como `id` permitiría que un EPUB choque con
// los identificadores de la interfaz (contenido no confiable).
// `src`, `href` y `xlink:href` sobreviven para las imágenes: el lector
// los vacía y los rellena con blob: del propio EPUB (las rutas del zip
// no resuelven contra el origen de la app). `<a>` sigue vetado, así
// que `href` no puede convertirse en enlace.
const READER_ATTRS = [
  "dir",
  "lang",
  "rowspan",
  "colspan",
  "scope",
  "headers",
  "epub:type",
  "role",
  "id",
  "name",
  "data-frag-id",
  "data-epub-link",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "href",
  "xlink:href",
  "viewBox",
  "x",
  "y",
  "preserveAspectRatio",
];

export function sanitizeSectionDocument(source: Document) {
  const body = source.body ?? source.getElementsByTagName("body")[0] ?? source.documentElement;
  // Pre-procesamiento seguro sobre clon para no mutar el documento fuente:
  // En EPUBs de Calibre y EPUB 2 las anclas vacías son <a id="p7"></a> o <a name="ch1">.
  // Las transformamos en <span> solo si carecen de href.
  const root = (body.cloneNode(true) as HTMLElement);
  for (const a of root.querySelectorAll("a")) {
    const fragId = a.getAttribute("id") || a.getAttribute("name");
    if (fragId && !a.hasAttribute("href")) {
      const doc = root.ownerDocument || document;
      const span = doc.createElement("span");
      span.setAttribute("id", fragId);
      span.setAttribute("data-frag-id", fragId);
      while (a.firstChild) {
        span.appendChild(a.firstChild);
      }
      a.replaceWith(span);
    }
  }

  const serializer = new XMLSerializer();
  const dirty = [...root.childNodes]
    .map((node) => serializer.serializeToString(node))
    .join("");
  const fragment = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: READER_TAGS,
    ALLOWED_ATTR: READER_ATTRS,
    ADD_ATTR: ["data-frag-id", "data-epub-link", "id", "name"],
    FORBID_TAGS: [],
    FORBID_ATTR: ["class", "style"],
    ALLOW_DATA_ATTR: true,
    RETURN_DOM_FRAGMENT: true,
  });
  const result = document.createElement("div");
  result.append(fragment);

  for (const el of result.querySelectorAll("[id], [name]")) {
    const fragId = el.getAttribute("id") || el.getAttribute("name");
    if (fragId && !el.getAttribute("data-frag-id")) {
      el.setAttribute("data-frag-id", fragId);
    }
    el.removeAttribute("id");
    el.removeAttribute("name");
  }

  // Regla anti-colapso para Calibre:
  // Bloques vacíos (sin texto ni imagen) que contienen [data-frag-id] no se pierden;
  // se trasladan sus anclas al inicio del siguiente elemento hermano con contenido.
  const blockCandidates = result.querySelectorAll("p, div, li, blockquote");
  for (const el of blockCandidates) {
    const hasText = Boolean(el.textContent?.trim());
    const hasMedia = Boolean(el.querySelector("img, svg, image"));
    const fragSpans = [...el.querySelectorAll<HTMLElement>("[data-frag-id]")];
    if (el.hasAttribute("data-frag-id")) {
      fragSpans.push(el as HTMLElement);
    }
    if (!hasText && !hasMedia && fragSpans.length > 0) {
      let next = el.nextElementSibling;
      while (next && !next.textContent?.trim() && !next.querySelector("img, svg, image")) {
        next = next.nextElementSibling;
      }
      if (next) {
        for (const fn of fragSpans) {
          if (fn === el) {
            const span = document.createElement("span");
            span.setAttribute("data-frag-id", fn.getAttribute("data-frag-id")!);
            next.prepend(span);
          } else {
            next.prepend(fn);
          }
        }
        el.remove();
      }
    }
  }

  // Encabezados vacíos (típicos de portadas/mapas: solo llevan `title`
  // como metadato) ocupan márgenes sin renderizar nada; en modo
  // páginas hasta pueden expulsar una imagen de su columna.
  for (const el of result.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    if (!el.textContent?.trim() && !el.firstElementChild) el.remove();

  // Accesibilidad: imágenes de EPUB sin atributo alt reciben alt=""
  // para considerarse decorativas según WCAG 2.1 (evita fallos de lectura asistida).
  for (const img of result.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) {
      img.setAttribute("alt", "");
    }
  }

  return result;
}

