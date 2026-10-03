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

const READER_ATTRS = ["dir", "lang", "rowspan", "colspan", "scope", "headers", "epub:type"];

export function sanitizeSectionDocument(source: Document) {
  const body = source.body ?? source.getElementsByTagName("body")[0] ?? source.documentElement;
  const container = document.createElement("div");
  container.append(...body.childNodes);
  const fragment = DOMPurify.sanitize(container, {
    ALLOWED_TAGS: READER_TAGS,
    ALLOWED_ATTR: READER_ATTRS,
    FORBID_TAGS: ["a"],
    FORBID_ATTR: ["id", "class", "style"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const result = document.createElement("div");
  result.append(fragment);
  return result;
}
