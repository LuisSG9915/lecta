// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSectionDocument } from "./sanitize";

const parse = (html: string) =>
  new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body>${html}</body></html>`,
    "application/xhtml+xml",
  );

const sanitize = (html: string) => sanitizeSectionDocument(parse(html));

describe("sanitizeSectionDocument", () => {
  it("no mueve nodos vivos del documento fuente", () => {
    const source = parse('<p>Texto</p><img src="x" onerror="window.__xss=1"/>');
    sanitizeSectionDocument(source);
    expect(source.documentElement.textContent).toContain("Texto");
  });

  it("conserva texto y estructura básica", () => {
    const clean = sanitize("<h1>Título</h1><p>Un párrafo con <em>énfasis</em>.</p>");
    expect(clean.querySelector("h1")?.textContent).toBe("Título");
    expect(clean.querySelector("em")?.textContent).toBe("énfasis");
    expect(clean.textContent).toContain("Un párrafo");
  });

  it("elimina elementos script", () => {
    const clean = sanitize("<p>Texto</p><script>window.__xss=1</script>");
    expect(clean.querySelector("script")).toBeNull();
    expect(clean.textContent).toContain("Texto");
  });

  it("elimina handlers de eventos inline", () => {
    const clean = sanitize('<p onclick="window.__xss=1" onmouseover="window.__xss=2">Texto</p>');
    const p = clean.querySelector("p");
    expect(p?.hasAttribute("onclick")).toBe(false);
    expect(p?.hasAttribute("onmouseover")).toBe(false);
  });

  it("elimina enlaces y su href javascript:", () => {
    const clean = sanitize('<a href="javascript:window.__xss=1">enlace</a>');
    expect(clean.querySelector("a")).toBeNull();
    expect(clean.textContent).toBe("enlace");
  });

  it("elimina imágenes e iframes de la sección", () => {
    const clean = sanitize('<img src="x" onerror="window.__xss=1"/><iframe src="https://evil.example"></iframe>');
    expect(clean.querySelector("img")).toBeNull();
    expect(clean.querySelector("iframe")).toBeNull();
  });

  it("elimina SVG con contenido activo", () => {
    const clean = sanitize('<svg><script>window.__xss=1</script><circle r="4"/></svg>');
    expect(clean.querySelector("svg")).toBeNull();
    expect(clean.querySelector("script")).toBeNull();
  });

  it("elimina class y style del libro y renombra id a data-frag-id", () => {
    const clean = sanitize('<p id="x" class="y" style="color:red">Texto</p>');
    const p = clean.querySelector("p");
    expect(p?.hasAttribute("id")).toBe(false);
    expect(p?.getAttribute("data-frag-id")).toBe("x");
    expect(p?.hasAttribute("class")).toBe(false);
    expect(p?.hasAttribute("style")).toBe(false);
    expect(p?.textContent).toBe("Texto");
  });

  it("el id renombrado no colisiona con getElementById de la página", () => {
    const clean = sanitize('<p id="app">Texto</p>');
    document.body.append(clean);
    try {
      expect(document.getElementById("app")).not.toBe(clean.querySelector("p"));
    } finally {
      clean.remove();
    }
  });

  it("conserva atributos lingüísticos", () => {
    const clean = sanitize('<p lang="es" dir="ltr">Texto</p>');
    const p = clean.querySelector("p");
    expect(p?.getAttribute("lang")).toBe("es");
    expect(p?.getAttribute("dir")).toBe("ltr");
  });

  it("conserva tablas y citas", () => {
    const clean = sanitize(
      '<blockquote><p>Cita.</p></blockquote><table><tbody><tr><td>celda</td></tr></tbody></table>',
    );
    expect(clean.querySelector("blockquote p")?.textContent).toBe("Cita.");
    expect(clean.querySelector("td")?.textContent).toBe("celda");
  });
});
