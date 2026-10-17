// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getCharactersOnPageWithoutSpoilers } from "./character-helper";

const section = (html: string) => ({
  createDocument: async () =>
    new DOMParser().parseFromString(`<body>${html}</body>`, "text/html"),
});

describe("character-helper", () => {
  it("encuentra menciones pasadas de personajes sin spoilers futuros", async () => {
    let futureAccessed = false;
    const sections = [
      section("<p>Aureliano Buendía fundó el taller de platería en Macondo.</p>"),
      section("<p>Melquíades trajo los galeones y los imanes.</p>"),
      section("<p>En esta página actual, Aureliano Buendía conversa con Melquíades.</p>"),
      {
        createDocument: async () => {
          futureAccessed = true;
          return new DOMParser().parseFromString(
            "<body><p>SPOILER: Muerte trágica de Aureliano Buendía.</p></body>",
            "text/html",
          );
        },
      },
    ];

    const toc = [
      { index: 0, label: "Capítulo 1" },
      { index: 1, label: "Capítulo 2" },
      { index: 2, label: "Capítulo 3" },
      { index: 3, label: "Capítulo 4 (Futuro)" },
    ];

    // Lector en capítulo 3 (index 2). Se escanea la página visible del capítulo 3:
    const pageText = "Aureliano Buendía miraba el hielo mientras Melquíades sonreía.";

    const characters = await getCharactersOnPageWithoutSpoilers({
      pageText,
      currentChapterIndex: 2,
      bookId: "cien-anos",
      sections,
      toc,
    });

    expect(characters.length).toBeGreaterThanOrEqual(1);
    const aureliano = characters.find((c) => c.name.includes("Aureliano"));
    expect(aureliano).toBeDefined();
    expect(aureliano?.oneLiner).toContain("fundó el taller");

    // Garantía matemática anti-spoilers: el capítulo futuro nunca fue evaluado
    expect(futureAccessed).toBe(false);
  });

  it("devuelve vacío si no hay menciones previas en capítulos anteriores", async () => {
    const sections = [
      section("<p>Capítulo 1: Paisajes desiertos y montañas.</p>"),
    ];

    const pageText = "Un extraño llamado Frodo Bolsón apareció de repente.";

    const characters = await getCharactersOnPageWithoutSpoilers({
      pageText,
      currentChapterIndex: 0, // Está en el primer capítulo: no hay anteriores
      bookId: "lotr",
      sections,
    });

    // En el capítulo 0 no hay capítulos previos (currentChapterIndex - 1 < 0)
    expect(characters).toEqual([]);
  });
});
