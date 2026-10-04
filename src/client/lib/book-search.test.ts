// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { foldWithMap, searchBookSections } from "./book-search";

const section = (html: string) => ({
  createDocument: async () =>
    new DOMParser().parseFromString(`<body>${html}</body>`, "text/html"),
});

const collect = async (
  sections: ReturnType<typeof section>[],
  query: string,
  options: Parameters<typeof searchBookSections>[3] = {},
) => {
  const hits = [];
  for await (const hit of searchBookSections(sections, [], query, options))
    hits.push(hit);
  return hits;
};

describe("foldWithMap", () => {
  it("pliega acentos y mayúsculas conservando el mapa", () => {
    const { folded, map } = foldWithMap("Éra úna");
    expect(folded).toBe("era una");
    expect(map[0]).toBe(0);
    expect(map[4]).toBe(4);
  });

  it("mapea cada carácter plegado al índice original", () => {
    const text = "Corazón";
    const { folded, map } = foldWithMap(text);
    expect(folded).toBe("corazon");
    // folded[5] ('o' sin tilde) apunta a la 'ó' original.
    expect(text[map[5]]).toBe("ó");
  });
});

describe("searchBookSections", () => {
  it("encuentra sin importar acentos ni mayúsculas", async () => {
    const hits = await collect(
      [section("<p>El Corazón delator latía.</p>")],
      "corazon",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("Corazón");
    expect(hits[0].before).toBe("El ");
    expect(hits[0].anchor.startsWith("Corazón delator")).toBe(true);
  });

  it("encuentra dentro de elementos en línea (em/strong)", async () => {
    const hits = await collect(
      [section("<p>Will <em>divisó un</em> movimiento.</p>")],
      "divisó un mov",
    );
    expect(hits).toHaveLength(1);
  });

  it("da contexto con elipsis cuando el hallazgo está a mitad de bloque", async () => {
    const long = "palabra ".repeat(30) + "objetivo único" + " más ".repeat(30);
    const hits = await collect([section(`<p>${long}</p>`)], "objetivo");
    expect(hits[0].before.startsWith("…")).toBe(true);
    expect(hits[0].after.endsWith("…")).toBe(true);
  });

  it("recorre varias secciones y etiqueta sin índice", async () => {
    const hits = await collect(
      [
        section("<p>nada aquí</p>"),
        section("<p>otra puerta</p><p>puerta trasera</p>"),
      ],
      "puerta",
    );
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.sectionIndex === 1)).toBe(true);
    expect(hits[0].label).toBe("Sección 2");
  });

  it("respeta el límite de resultados", async () => {
    const hits = await collect(
      [section(`<p>${"eco ".repeat(50)}</p>`)],
      "eco",
      { limit: 5 },
    );
    expect(hits).toHaveLength(5);
  });

  it("se cancela con la señal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const hits = await collect(
      [section("<p>eco eco eco</p>")],
      "eco",
      { signal: ctrl.signal },
    );
    expect(hits).toHaveLength(0);
  });

  it("usa la etiqueta del índice cuando existe", async () => {
    const hits = [];
    for await (const hit of searchBookSections(
      [section("<p>hallazgo</p>")],
      [{ index: 0, label: "Capítulo uno" }],
      "hallazgo",
    ))
      hits.push(hit);
    expect(hits[0].label).toBe("Capítulo uno");
  });
});
