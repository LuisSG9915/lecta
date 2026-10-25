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

  it("conserva enlaces internos y notas al pie con data-epub-link='internal' y desactiva esquemas peligrosos o externos", () => {
    const cleanInternal1 = sanitize('<a href="#fn1">1</a>');
    const a1 = cleanInternal1.querySelector("a");
    expect(a1).not.toBeNull();
    expect(a1?.getAttribute("href")).toBe("#fn1");
    expect(a1?.getAttribute("data-epub-link")).toBe("internal");

    const cleanInternal2 = sanitize('<a href="chapter2.xhtml#note-4">ver nota</a>');
    const a2 = cleanInternal2.querySelector("a");
    expect(a2).not.toBeNull();
    expect(a2?.getAttribute("href")).toBe("chapter2.xhtml#note-4");
    expect(a2?.getAttribute("data-epub-link")).toBe("internal");

    const cleanJs = sanitize('<a href="javascript:alert(1)">x</a>');
    const aJs = cleanJs.querySelector("a");
    expect(aJs).not.toBeNull();
    expect(aJs?.hasAttribute("href")).toBe(false);
    expect(aJs?.textContent).toBe("x");

    const cleanEvil = sanitize('<a href="https://evil.com">y</a>');
    const aEvil = cleanEvil.querySelector("a");
    expect(aEvil).not.toBeNull();
    expect(aEvil?.hasAttribute("href")).toBe(false);
    expect(aEvil?.textContent).toBe("y");
  });

  it("conserva imágenes pero elimina sus handlers, e iframes", () => {
    const clean = sanitize('<img src="x" onerror="window.__xss=1"/><iframe src="https://evil.example"></iframe>');
    const img = clean.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.hasAttribute("onerror")).toBe(false);
    expect(clean.querySelector("iframe")).toBeNull();
  });

  it("conserva SVG pero elimina el contenido activo", () => {
    const clean = sanitize('<svg><script>window.__xss=1</script><image href="cover.png"/></svg>');
    expect(clean.querySelector("svg")).not.toBeNull();
    expect(clean.querySelector("script")).toBeNull();
  });

  it("elimina encabezados vacíos (metadato sin contenido)", () => {
    const clean = sanitize('<h1 title="Portada"></h1><p>Texto</p><h2>Real</h2>');
    expect(clean.querySelector("h1")).toBeNull();
    expect(clean.querySelector("h2")?.textContent).toBe("Real");
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

  it("preserva anclas <a id> y <a name> estilo Calibre convirtiéndolas en span con data-frag-id sin dejar <a>", () => {
    const clean = sanitize(
      '<p class="calibre1"><a id="p7"></a><img src="index-7_1.jpg" alt="Image 4"/></p><p><a id="p17"></a></p><p>Chapter Two</p>',
    );
    expect(clean.querySelector("a")).toBeNull();
    expect(clean.querySelector('[data-frag-id="p7"]')).not.toBeNull();
    expect(clean.querySelector('[data-frag-id="p17"]')).not.toBeNull();
    // p17 se rescató y se movió al inicio del bloque con contenido 'Chapter Two'
    const chapterTwoBlock = clean.querySelector("p:last-child");
    expect(chapterTwoBlock?.textContent).toContain("Chapter Two");
    expect(chapterTwoBlock?.querySelector('[data-frag-id="p17"]')).not.toBeNull();
  });

  it("preserva anclas <a name> con texto interno descartando href pero manteniendo data-frag-id", () => {
    const clean = sanitize('<a name="sec1" href="https://externo.com">Título de Sección</a>');
    const el = clean.querySelector('[data-frag-id="sec1"]');
    expect(el).not.toBeNull();
    expect(el?.hasAttribute("href")).toBe(false);
    expect(el?.textContent).toBe("Título de Sección");
  });
});

