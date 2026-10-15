// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { foldWithMap, searchBookSections, searchBookSpoilerFree } from "./book-search";

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

describe("searchBookSpoilerFree", () => {
  it("encuentra menciones previas sin acceder a capítulos posteriores", async () => {
    let futureAccessed = false;
    const sections = [
      section("<p>Apareció Aureliano Buendía por primera vez en Macondo.</p>"),
      section("<p>Aureliano organizó el taller de orfebrería.</p>"),
      {
        createDocument: async () => {
          futureAccessed = true;
          return new DOMParser().parseFromString(
            "<body><p>SPOILER: Aureliano morirá mucho después frente al pelotón.</p></body>",
            "text/html",
          );
        },
      },
    ];

    const toc = [
      { index: 0, label: "Capítulo 1" },
      { index: 1, label: "Capítulo 2" },
      { index: 2, label: "Capítulo 3" },
    ];

    // El lector está en el capítulo 2 (índice 1):
    const summary = await searchBookSpoilerFree(sections, toc, "Aureliano", 1);

    expect(summary.totalMentionsSoFar).toBe(2);
    expect(summary.firstMention?.chapterLabel).toBe("Capítulo 1");
    expect(summary.firstMention?.sentence).toContain("Apareció Aureliano Buendía");
    expect(summary.recentMentions).toHaveLength(2);
    expect(summary.recentMentions[1].chapterLabel).toBe("Capítulo 2");
    expect(summary.excerptsSoFar.length).toBeGreaterThan(0);

    // Verificación estricta: el capítulo 3 NUNCA fue llamado ni abierto
    expect(futureAccessed).toBe(false);
  });

  it("respeta el límite de párrafos/bloques dentro de la sección actual", async () => {
    const sections = [
      section(
        "<p>Párrafo 0: Úrsula cocinaba animalitos de caramelo.</p>" +
        "<p>Párrafo 1: Úrsula miraba por la ventana.</p>" +
        "<p>Párrafo 2: Úrsula descubre un secreto.</p>",
      ),
    ];

    // Lector en el párrafo 1: el párrafo 2 no debe incluirse
    const summary = await searchBookSpoilerFree(sections, [], "Úrsula", 0, 1);
    expect(summary.totalMentionsSoFar).toBe(2);
    expect(summary.recentMentions[summary.recentMentions.length - 1].sentence).toContain(
      "miraba por la ventana",
    );
    expect(
      summary.recentMentions.some((m) => m.sentence.includes("descubre un secreto")),
    ).toBe(false);
  });
});

