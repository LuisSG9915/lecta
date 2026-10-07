import { describe, expect, it } from "vitest";
import {
  parseRdf,
  rightsCheck,
  decodeEntities,
  xhtmlToText,
  tokenizeForms,
  buildVocabManifest,
  cliticBaseForms,
  menteBaseForms,
  formsWithBases,
  loadStopwords,
  buildResolvedManifest,
  validateCurationItem,
} from "./catalog-seed-lib.mjs";

const AGENT = (name, birth, death) => `
      <pgterms:agent rdf:about="2009/agents/1">
        <pgterms:name>${name}</pgterms:name>
        ${birth != null ? `<pgterms:birthdate>${birth}</pgterms:birthdate>` : ""}
        ${death != null ? `<pgterms:deathdate>${death}</pgterms:deathdate>` : ""}
      </pgterms:agent>`;

const RDF = ({ creators = [], trls = [], edts = [], lang = "es" } = {}) => `<?xml version="1.0"?>
<rdf:RDF xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:marcrel="http://id.loc.gov/vocabulary/relators/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <pgterms:ebook rdf:about="ebooks/2000">
    <dcterms:title>Don Quijote</dcterms:title>
    <dcterms:rights>Public domain in the USA.</dcterms:rights>
    <dcterms:language><rdf:Description><rdf:value>es</rdf:value>${lang !== "es" ? `<rdf:value>${lang}</rdf:value>` : ""}</rdf:Description></dcterms:language>
    <dcterms:issued>1999-11-01</dcterms:issued>
    <dcterms:subject><rdf:Description><rdf:value>Picaresque literature</rdf:value></rdf:Description></dcterms:subject>
    ${creators.map((a) => `<dcterms:creator>${a}</dcterms:creator>`).join("")}
    ${trls.map((a) => `<marcrel:trl>${a}</marcrel:trl>`).join("")}
    ${edts.map((a) => `<marcrel:edt>${a}</marcrel:edt>`).join("")}
  </pgterms:ebook>
</rdf:RDF>`;

describe("parseRdf", () => {
  it("extrae título, idioma, asuntos y colaboradores con fechas", () => {
    const meta = parseRdf(
      RDF({
        creators: [AGENT("Cervantes Saavedra, Miguel de", 1547, 1616)],
        trls: [AGENT("Pedraza y Páez, Pedro", 1877, null)],
        edts: [AGENT("Editor Viejo", 1800, 1870)],
      }),
    );
    expect(meta.title).toBe("Don Quijote");
    expect(meta.languages).toContain("es");
    expect(meta.subjects).toContain("Picaresque literature");
    expect(meta.issued).toBe("1999-11-01");
    expect(meta.contributors).toEqual([
      { name: "Cervantes Saavedra, Miguel de", role: "creator", birth: 1547, death: 1616 },
      { name: "Pedraza y Páez, Pedro", role: "trl", birth: 1877, death: null },
      { name: "Editor Viejo", role: "edt", birth: 1800, death: 1870 },
    ]);
  });

  it("tolera ebooks sin colaboradores", () => {
    const meta = parseRdf(RDF());
    expect(meta.contributors).toEqual([]);
    expect(meta.languages).toContain("es");
  });
});

describe("rightsCheck", () => {
  const dead = (name, death) => ({ name, role: "creator", birth: null, death });
  it("aprueba autor fallecido antes del corte", () => {
    const r = rightsCheck([dead("Cervantes", 1616)]);
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  it("bloquea autor fallecido después del corte", () => {
    const r = rightsCheck([dead("Lorca", 1936)]);
    expect(r.ok).toBe(false);
    expect(r.blocking[0].reason).toContain("1936");
  });

  it("bloquea traductor con muerte desconocida", () => {
    const r = rightsCheck([
      dead("Dostoyevsky", 1881),
      { name: "Pedraza", role: "trl", birth: 1877, death: null },
    ]);
    expect(r.ok).toBe(false);
    expect(r.blocking[0].name).toBe("Pedraza");
  });

  it("bloquea editor con muerte desconocida o reciente", () => {
    expect(
      rightsCheck([
        dead("Espronceda", 1842),
        { name: "Northup", role: "edt", birth: 1874, death: 1964 },
      ]).ok,
    ).toBe(false);
    expect(
      rightsCheck([
        dead("Espronceda", 1842),
        { name: "Northup", role: "edt", birth: 1874, death: null },
      ]).ok,
    ).toBe(false);
  });

  it("deja pasar anónimos y autores antiguos sin fecha de muerte", () => {
    expect(
      rightsCheck([{ name: "Anonymous", role: "creator", birth: null, death: null }]).ok,
    ).toBe(true);
    expect(
      rightsCheck([{ name: "Herodotus", role: "creator", birth: -480, death: null }]).ok,
    ).toBe(true);
    // El RDF a veces solo anota el siglo en el nombre («16th century»)
    expect(
      rightsCheck([
        { name: "Gómez de Tapia, Luis, 16th century", role: "trl", birth: null, death: null },
      ]).ok,
    ).toBe(true);
  });

  it("ilustrador reciente solo avisa, no bloquea", () => {
    const r = rightsCheck([
      dead("Autor", 1900),
      { name: "Ilustrador", role: "ill", birth: null, death: 1970 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.advisory).toHaveLength(1);
  });
});

describe("tokenizeForms", () => {
  it("solo letras del español, mínimo 3, en minúsculas", () => {
    const forms = tokenizeForms("La casa, el niño: 123 sí él a1b otoño ÜbÜ");
    expect(forms).toContain("casa");
    expect(forms).toContain("niño");
    expect(forms).toContain("otoño");
    expect(forms).toContain("übü");
    // quedan fuera: menores de 3 («la», «sí», «él»), dígitos, alfanuméricos
    expect(forms).not.toContain("la");
    expect(forms).not.toContain("123");
    expect(forms).not.toContain("a1b");
  });

  it("une palabras partidas por soft hyphen", () => {
    const forms = tokenizeForms("extraor­dinario simple");
    expect(forms).toContain("extraordinario");
    expect(forms).not.toContain("extraor");
  });
});

describe("xhtmlToText + decodeEntities", () => {
  it("decodifica entidades con nombre y numéricas", () => {
    expect(decodeEntities("acci&oacute;n &#241; &#xF1;")).toBe("acción ñ ñ");
    expect(decodeEntities("&amp; &quot;")).toBe('& "');
  });

  it("quita scripts, estilos y etiquetas", () => {
    const text = xhtmlToText(
      `<html><head><style>p{color:red}</style></head><body><script>var x=1;</script><p>La casa <b>roja</b>.</p><p>Otra&nbsp;línea.</p></body></html>`,
    );
    expect(text).not.toContain("var x");
    expect(text).not.toContain("color:red");
    const forms = tokenizeForms(text);
    expect(forms).toEqual(expect.arrayContaining(["casa", "roja", "línea"]));
  });
});

describe("buildVocabManifest", () => {
  it("cuenta palabras y deduplica formas ordenadas", () => {
    const m = buildVocabManifest("Casa casa perro. Casa; sol luna");
    expect(m.wordCount).toBe(6);
    expect(m.uniqueForms).toBe(4);
    expect(m.forms).toEqual([...m.forms].sort());
    expect(m.forms).toContain("casa");
  });
});

describe("cliticBaseForms / menteBaseForms", () => {
  it("quita enclíticos y normaliza la tilde desplazada", () => {
    expect(cliticBaseForms("tomándose")).toContain("tomando");
    expect(cliticBaseForms("abrirlo")).toEqual(["abrir"]);
    expect(cliticBaseForms("dígamelo")).toEqual(
      expect.arrayContaining(["digame", "diga"]),
    );
    expect(cliticBaseForms("casa")).toEqual([]);
  });

  it("saca la raíz adjetiva del adverbio en -mente", () => {
    expect(menteBaseForms("perfectamente")).toEqual(["perfecta", "perfecto"]);
    expect(menteBaseForms("simplemente")).toEqual(["simple"]);
    expect(menteBaseForms("mente")).toEqual([]);
    expect(menteBaseForms("casa")).toEqual([]);
  });

  it("formsWithBases incluye la forma y sus bases", () => {
    const all = formsWithBases(["tomándose", "lentamente"]);
    expect(all).toContain("tomándose");
    expect(all).toContain("tomando");
    expect(all).toContain("lenta");
    expect(all).toContain("lento");
  });
});

describe("loadStopwords", () => {
  it("extrae la lista del fuente .ts real", () => {
    const src =
      'const SPANISH_STOPWORDS = [\n  "el", "la",\n  // comentario\n  "de",\n' +
      `${'"x",'.repeat(120)}\n];\n`;
    const set = loadStopwords(src);
    expect(set.has("el")).toBe(true);
    expect(set.size).toBe(4); // «x» repetida cuenta una vez
  });

  it("rechaza una lista sospechosamente corta (parseo roto)", () => {
    expect(() => loadStopwords('const SPANISH_STOPWORDS = ["el"];')).toThrow();
  });
});

describe("buildResolvedManifest", () => {
  const entriesByForm = {
    casa: [{ entryId: "10", lemma: "casa", pos: "sustantivo", zipf: 5.1 }],
    roja: [
      { entryId: "11", lemma: "rojo", pos: "adjetivo", zipf: 4.2 },
      { entryId: "10", lemma: "casa", pos: "sustantivo", zipf: 5.1 }, // misma ficha, otra forma
    ],
    tomando: [{ entryId: "20", lemma: "tomar", pos: "verbo", zipf: 5.5 }],
  };

  it("arma byForm con índices deduplicados y respeta la base clítica", () => {
    const m = buildResolvedManifest("casa roja tomándose", entriesByForm, {
      stopwords: new Set(),
    });
    expect(m.entries).toHaveLength(3);
    expect(m.byForm.casa).toEqual([0]);
    // «roja» comparte la ficha de «casa» (mismo índice, no duplicada)
    expect(m.byForm.roja).toEqual([1, 0]);
    // «tomándose» sin ficha propia pero con base «tomando» → no es missing
    expect(m.byForm["tomándose"]).toBeUndefined();
    expect(m.byForm.tomando).toBeDefined();
    expect(m.missing).not.toContain("tomándose");
  });

  it("cuenta missing solo cuando ni forma ni base tienen ficha", () => {
    const m = buildResolvedManifest("casa perenne zzzzzz", entriesByForm, {
      stopwords: new Set(),
    });
    expect(m.missing).toEqual(["perenne", "zzzzzz"]);
  });

  it("excluye stopwords del análisis pero no del conteo total", () => {
    const m = buildResolvedManifest("esa casa solo siempre", entriesByForm, {
      stopwords: new Set(["esa", "solo", "siempre"]),
    });
    expect(m.uniqueForms).toBe(1); // solo «casa»
    expect(m.wordCount).toBe(4); // el texto íntegro sí cuenta
    expect(m.missing).toEqual([]);
  });
});

describe("validateCurationItem", () => {
  it("acepta una entrada bien formada", () => {
    expect(
      validateCurationItem({ id: "quijote", gutenbergId: 2000, title: "Don Quijote", author: "Cervantes" }),
    ).toEqual([]);
  });

  it("rechaza id con mayúsculas/espacios y campos vacíos", () => {
    const errs = validateCurationItem({ id: "Don Quijote", gutenbergId: 0, title: " ", author: "" });
    expect(errs).toHaveLength(4);
  });
});
