import DOMPurify from "dompurify";

const READER_TAGS = [
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
  "id",
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
  const serializer = new XMLSerializer();
  const dirty = [...body.childNodes]
    .map((node) => serializer.serializeToString(node))
    .join("");
  const fragment = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: READER_TAGS,
    ALLOWED_ATTR: READER_ATTRS,
    FORBID_TAGS: ["a"],
    FORBID_ATTR: ["class", "style"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const result = document.createElement("div");
  result.append(fragment);
  for (const el of result.querySelectorAll("[id]")) {
    el.setAttribute("data-frag-id", el.id);
    el.removeAttribute("id");
  }
  // Encabezados vacíos (típicos de portadas/mapas: solo llevan `title`
  // como metadato) ocupan márgenes sin renderizar nada; en modo
  // páginas hasta pueden expulsar una imagen de su columna.
  for (const el of result.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    if (!el.textContent?.trim() && !el.firstElementChild) el.remove();
  return result;
}
