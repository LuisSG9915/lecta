import { describe, expect, it } from "vitest";
import { indexRowFromRdf } from "./gutenberg-index.mjs";
import { parseRdf, searchTextOf } from "./catalog-seed-lib.mjs";

const AGENT = (name, birth, death) => `
      <pgterms:agent rdf:about="2009/agents/1">
        <pgterms:name>${name}</pgterms:name>
        ${birth != null ? `<pgterms:birthdate>${birth}</pgterms:birthdate>` : ""}
        ${death != null ? `<pgterms:deathdate>${death}</pgterms:deathdate>` : ""}
      </pgterms:agent>`;

// RDF con la forma real del volcado: tipo, descargas y formatos dentro
// de dcterms:hasFormat/pgterms:file (MIME en rdf:value de dcterms:format).
const RDF = ({
  creators = [],
  trls = [],
  edts = [],
  lang = "es",
  type = "Text",
  downloads = 1234,
  subjects = ["Novela"],
  epub = true,
  extraFormat = null,
} = {}) => `<?xml version="1.0"?>
<rdf:RDF xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:marcrel="http://id.loc.gov/vocabulary/relators/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <pgterms:ebook rdf:about="ebooks/2000">
    <dcterms:title>La prueba</dcterms:title>
    <dcterms:rights>Public domain in the USA.</dcterms:rights>
    <dcterms:language><rdf:Description><rdf:value>${lang}</rdf:value></rdf:Description></dcterms:language>
    <dcterms:type><rdf:Description><rdf:value>${type}</rdf:value></rdf:Description></dcterms:type>
    <dcterms:issued>1999-11-01</dcterms:issued>
    <pgterms:downloads>${downloads}</pgterms:downloads>
    ${subjects.map((s) => `<dcterms:subject><rdf:Description><rdf:value>${s}</rdf:value></rdf:Description></dcterms:subject>`).join("")}
    ${creators.map((a) => `<dcterms:creator>${a}</dcterms:creator>`).join("")}
    ${trls.map((a) => `<marcrel:trl>${a}</marcrel:trl>`).join("")}
    ${edts.map((a) => `<marcrel:edt>${a}</marcrel:edt>`).join("")}
    <dcterms:hasFormat>
      ${epub ? `<pgterms:file rdf:about="https://www.gutenberg.org/ebooks/2000.epub.images">
        <dcterms:format><rdf:Description><rdf:value>application/epub+zip</rdf:value></rdf:Description></dcterms:format>
      </pgterms:file>` : '<pgterms:file rdf:about="https://www.gutenberg.org/ebooks/2000.txt"><dcterms:format><rdf:Description><rdf:value>text/plain; charset=utf-8</rdf:value></rdf:Description></dcterms:format></pgterms:file>'}
      ${extraFormat ? `<pgterms:file rdf:about="https://www.gutenberg.org/ebooks/2000.extra"><dcterms:format><rdf:Description><rdf:value>${extraFormat}</rdf:value></rdf:Description></dcterms:format></pgterms:file>` : ""}
    </dcterms:hasFormat>
  </pgterms:ebook>
</rdf:RDF>`;

describe("parseRdf — campos nuevos del índice", () => {
  it("expone tipo, descargas y formatos MIME", () => {
    const meta = parseRdf(
      RDF({ epub: true, extraFormat: "text/html; charset=utf-8" }),
    );
    expect(meta.type).toBe("Text");
    expect(meta.downloads).toBe(1234);
    expect(meta.formats).toEqual([
      "application/epub+zip",
      "text/html",
    ]);
  });

  it("sin dcterms:type lee «Text» (regla de Gutendex) y sin descargas da 0", () => {
    const xml = RDF().replace(
      /<dcterms:type>[\s\S]*?<\/dcterms:type>/,
      "",
    ).replace(/<pgterms:downloads>\d+<\/pgterms:downloads>/, "");
    const meta = parseRdf(xml);
    expect(meta.type).toBe("Text");
    expect(meta.downloads).toBe(0);
  });
});

describe("searchTextOf", () => {
  it("minúsculas y sin acentos, título + autor", () => {
    expect(searchTextOf("Benito Pérez Galdós")).toBe("benito perez galdos");
    expect(searchTextOf("Fortunata y Jacinta", "Pérez Galdós")).toBe(
      "fortunata y jacinta perez galdos",
    );
  });
});

describe("indexRowFromRdf", () => {
  const base = {
    creators: [AGENT("Cervantes Saavedra, Miguel de", 1547, 1616)],
  };

  it("acepta un RDF válido y arma la fila del índice", () => {
    const r = indexRowFromRdf(2000, RDF(base), { deathYearMax: 1924 });
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({
      gutenberg_id: 2000,
      language: "es",
      title: "La prueba",
      author: "Cervantes Saavedra, Miguel de",
      downloads: 1234,
      issued: "1999-11-01",
    });
    expect(r.row.subjects).toEqual(["Novela"]);
    expect(r.row.search_text).toContain("la prueba");
    expect(r.row.search_text).toContain("cervantes");
  });

  it("toma el primer idioma es/en declarado en el RDF", () => {
    // languages llega como ["en", "es"]: la fila toma «en», la primera
    // que el índice soporta — no «es» por preferencia.
    const xml = RDF(base).replace(
      "<rdf:value>es</rdf:value>",
      "<rdf:value>en</rdf:value>",
    );
    const withBoth = xml.replace(
      "</dcterms:language>",
      `</dcterms:language><dcterms:language><rdf:Description><rdf:value>es</rdf:value></rdf:Description></dcterms:language>`,
    );
    const r = indexRowFromRdf(1, withBoth, { deathYearMax: 1924 });
    expect(r.ok).toBe(true);
    expect(r.row.language).toBe("en");
  });

  it("rechaza por derechos a un traductor vivo después de 1924", () => {
    const r = indexRowFromRdf(
      2000,
      RDF({
        ...base,
        trls: [AGENT("Traductor Vivo", 1950, 2010)],
      }),
      { deathYearMax: 1924 },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("derechos");
  });

  it("rechaza un libro en idioma no soportado", () => {
    const r = indexRowFromRdf(
      2000,
      RDF({ ...base, lang: "fr" }),
      { deathYearMax: 1924 },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("idioma no es/en");
  });

  it("rechaza tipo distinto de Text y ausencia de EPUB", () => {
    expect(
      indexRowFromRdf(1, RDF({ ...base, type: "Audio" }), {
        deathYearMax: 1924,
      }).reason,
    ).toBe("tipo Audio");
    expect(
      indexRowFromRdf(1, RDF({ ...base, epub: false }), {
        deathYearMax: 1924,
      }).reason,
    ).toBe("sin EPUB");
  });

  it("recorta asuntos a 8 y a 80 caracteres", () => {
    const subjects = Array.from({ length: 12 }, (_, i) => `Tema ${i} `.repeat(10));
    const r = indexRowFromRdf(
      1,
      RDF({ ...base, subjects }),
      { deathYearMax: 1924 },
    );
    expect(r.ok).toBe(true);
    expect(r.row.subjects).toHaveLength(8);
    for (const s of r.row.subjects) expect(s.length).toBeLessThanOrEqual(80);
  });
});
