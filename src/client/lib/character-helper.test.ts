// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getCharactersOnPageWithoutSpoilers,
  isLikelyProperNoun,
  buildZeroSpoilerCharacterCard,
  type SpoilerBoundary,
} from "./character-helper";

const section = (html: string) => ({
  createDocument: async () =>
    new DOMParser().parseFromString(`<body>${html}</body>`, "text/html"),
});

describe("character-helper", () => {
  describe("getCharactersOnPageWithoutSpoilers (retrocompatibilidad)", () => {
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
      expect(futureAccessed).toBe(false);
    });

    it("devuelve vacío si no hay menciones previas en capítulos anteriores", async () => {
      const sections = [
        section("<p>Capítulo 1: Paisajes desiertos y montañas.</p>"),
      ];

      const pageText = "Un extraño llamado Frodo Bolsón apareció de repente.";

      const characters = await getCharactersOnPageWithoutSpoilers({
        pageText,
        currentChapterIndex: 0,
        bookId: "lotr",
        sections,
      });

      expect(characters).toEqual([]);
    });
  });

  describe("isLikelyProperNoun (detección multilingüe heurística)", () => {
    it("reconoce nombres propios en mitad de oración en español, francés e inglés", () => {
      expect(isLikelyProperNoun("Dantès", "Entonces Dantès miró a su alrededor.")).toBe(true);
      expect(isLikelyProperNoun("Marsella", "El buque navegó hasta Marsella ayer.")).toBe(true);
      expect(isLikelyProperNoun("Watson", "Then Watson stepped into the library.", "en")).toBe(true);
      expect(isLikelyProperNoun("Rocinante", "Y montó sobre Rocinante con brío.")).toBe(true);
    });

    it("reconoce títulos honoríficos al inicio de frase en varios idiomas", () => {
      expect(isLikelyProperNoun("Monsieur", "Monsieur Dantès llegó a Marsella.")).toBe(true);
      expect(isLikelyProperNoun("Madame", "Madame Bovary marchait dans le parc.", "fr")).toBe(true);
      expect(isLikelyProperNoun("Don", "Don Quijote salió por la puerta falsa.")).toBe(true);
      expect(isLikelyProperNoun("Doña", "Doña Bárbara no temía a nadie.")).toBe(true);
      expect(isLikelyProperNoun("Lady", "Lady Catherine received her guests.", "en")).toBe(true);
      expect(isLikelyProperNoun("Captain", "Captain Wentworth wrote a letter.", "en")).toBe(true);
      expect(isLikelyProperNoun("Herr", "Herr Müller wartete am Bahnhof.", "de")).toBe(true);
    });

    it("reconoce nombres compuestos al inicio de oración", () => {
      expect(isLikelyProperNoun("Edmond", "Edmond Dantès miró al mar tranquilamente.")).toBe(true);
      expect(isLikelyProperNoun("Aureliano", "Aureliano Buendía promovió treinta y dos levantamientos.")).toBe(true);
      expect(isLikelyProperNoun("Sherlock", "Sherlock Holmes listened carefully.", "en")).toBe(true);
    });

    it("rechaza stopwords al inicio de oración", () => {
      expect(isLikelyProperNoun("En", "En un lugar de la Mancha...")).toBe(false);
      expect(isLikelyProperNoun("Pero", "Pero nadie sabía la respuesta exacta.")).toBe(false);
      expect(isLikelyProperNoun("The", "The ship sailed across the ocean.", "en")).toBe(false);
      expect(isLikelyProperNoun("Cuando", "Cuando despertó, el dinosaurio todavía estaba allí.")).toBe(false);
    });

    it("rechaza palabras comunes en minúsculas, verbos al inicio o símbolos", () => {
      expect(isLikelyProperNoun("caminaba", "él caminaba por la colina.")).toBe(false);
      expect(isLikelyProperNoun("Caminaba", "Caminaba solo por el bosque antiguo.")).toBe(false);
      expect(isLikelyProperNoun("Running", "Running quietly through the garden.", "en")).toBe(false);
      expect(isLikelyProperNoun("A", "A house on the hill.", "en")).toBe(false);
      expect(isLikelyProperNoun("123", "123 páginas leídas.")).toBe(false);
    });
  });

  describe("buildZeroSpoilerCharacterCard (Garantía matemática Cero Spoilers)", () => {
    const chapters = [
      {
        index: 0,
        title: "Capítulo 1: La Llegada",
        plainText:
          "Edmond Dantès llegó al puerto de Marsella con Mercédès en el buque Faraón. Su padre los esperaba con impaciencia y amor.",
      },
      {
        index: 1,
        title: "Capítulo 2: La Traición",
        plainText:
          "Durante el banquete de bodas, Dantès fue detenido por los soldados del rey. Fernand y Danglars celebraban en silencio su ruina. Más tarde Villefort lo condenó al calabozo.",
      },
      {
        index: 2,
        title: "Capítulo 3: El Secreto (Futuro)",
        plainText:
          "SPOILER FATAL: Tras catorce años en el Castillo de If, Dantès escapa con la ayuda del abate Faria y encuentra el inmenso tesoro en Montecristo.",
      },
    ];

    it("bloquea estrictamente capítulos futuros y trunca el capítulo actual en charOffsetInChapter", () => {
      // El lector está en el Capítulo 2 (index 1), en el carácter 80 (justo tras el arresto)
      const boundary: SpoilerBoundary = {
        chapterIndex: 1,
        charOffsetInChapter: 80,
      };

      const card = buildZeroSpoilerCharacterCard("Dantès", chapters, boundary);

      expect(card.name).toBe("Dantès");
      expect(card.totalMentionsUpToCursor).toBe(2);

      // 1. Primera mención: Capítulo 1 (index 0)
      expect(card.firstMention).not.toBeNull();
      expect(card.firstMention?.chapterIndex).toBe(0);
      expect(card.firstMention?.chapterTitle).toContain("La Llegada");
      expect(card.firstMention?.sentence).toContain("Edmond Dantès llegó al puerto de Marsella");

      // 2. Última mención previa al cursor: Capítulo 2 (index 1) antes de offset 80
      expect(card.recentMention).not.toBeNull();
      expect(card.recentMention?.chapterIndex).toBe(1);
      expect(card.recentMention?.sentence).toContain("Dantès fue detenido");

      // 3. Garantía matemática anti-spoilers:
      // Jamás se menciona el Castillo de If, Faria o Montecristo del Capítulo 3
      expect(JSON.stringify(card)).not.toContain("Castillo de If");
      expect(JSON.stringify(card)).not.toContain("Faria");
      expect(JSON.stringify(card)).not.toContain("Montecristo");

      // Tampoco se lee el texto de Capítulo 2 posterior al offset 80 (Villefort)
      expect(JSON.stringify(card)).not.toContain("Villefort");

      // 4. Co-ocurrencias: Mercédès y Faraón (del capítulo 0)
      expect(card.coOccurringCharacters).toContain("Mercédès");
      expect(card.coOccurringCharacters).not.toContain("Villefort");
    });

    it("maneja personajes con solo 1 mención antes del cursor (recentMention es null)", () => {
      const boundary: SpoilerBoundary = {
        chapterIndex: 0,
        charOffsetInChapter: 120,
      };

      const card = buildZeroSpoilerCharacterCard("Mercédès", chapters, boundary);

      expect(card.totalMentionsUpToCursor).toBe(1);
      expect(card.firstMention).not.toBeNull();
      expect(card.firstMention?.sentence).toContain("Mercédès");
      // Al haber solo 1 mención, recentMention no duplica la primera
      expect(card.recentMention).toBeNull();
    });

    it("retorna ficha vacía para personajes no aparecidos aún", () => {
      const boundary: SpoilerBoundary = {
        chapterIndex: 0,
        charOffsetInChapter: 50,
      };

      const card = buildZeroSpoilerCharacterCard("Faria", chapters, boundary);

      expect(card.totalMentionsUpToCursor).toBe(0);
      expect(card.firstMention).toBeNull();
      expect(card.recentMention).toBeNull();
      expect(card.coOccurringCharacters).toEqual([]);
    });

    it("compacta oraciones largas a un máximo aproximado de 165 caracteres con elipsis", () => {
      const longChapters = [
        {
          index: 0,
          title: "Capítulo Único",
          plainText:
            "En un rincón apartado del inmenso palacio vivía el sabio Melquíades, observando las estrellas con instrumentos de alquimia traídos desde remotas tierras de Oriente durante muchísimos años sin descanso ni tregua alguna.",
        },
      ];

      const card = buildZeroSpoilerCharacterCard("Melquíades", longChapters, {
        chapterIndex: 0,
      });

      expect(card.firstMention?.sentence.length).toBeLessThanOrEqual(165);
      expect(card.firstMention?.sentence.endsWith("…")).toBe(true);
    });
  });

  describe("Verificación Estricta Cero Spoilers (Fase 4)", () => {
    it("garantiza matemáticamente que ninguna mención en capítulos posteriores al cursor es leída ni contabilizada", () => {
      let futureChapterAccessed = false;
      const trackedChapters = [
        {
          index: 0,
          title: "Capítulo 1",
          plainText: "El joven Edmond Dantès vivía humildemente en Marsella con su anciano padre.",
        },
        {
          index: 1,
          title: "Capítulo 2",
          plainText: "En la fiesta de compromiso, Edmond Dantès fue detenido por los guardias reales.",
        },
        {
          index: 2,
          title: "Capítulo 3 (Futuro)",
          get plainText() {
            futureChapterAccessed = true;
            return "SPOILER CRÍTICO: Edmond Dantès escapa del Castillo de If y busca venganza con el abate Faria.";
          },
        },
        {
          index: 3,
          title: "Capítulo 4 (Futuro Lejano)",
          get plainText() {
            futureChapterAccessed = true;
            return "SPOILER FATAL: Edmond Dantès destruye a Villefort y Danglars en París.";
          },
        },
      ];

      // Lector ubicado en el Capítulo 2 (index 1)
      const boundary: SpoilerBoundary = { chapterIndex: 1 };
      const card = buildZeroSpoilerCharacterCard("Dantès", trackedChapters, boundary);

      // Verificación 1: Los capítulos 3 y 4 jamás fueron accedidos ni evaluados
      expect(futureChapterAccessed).toBe(false);

      // Verificación 2: El conteo sólo incluye las 2 menciones de los capítulos 0 y 1
      expect(card.totalMentionsUpToCursor).toBe(2);

      // Verificación 3: El contenido no contiene spoilers ni personajes futuros
      const serialized = JSON.stringify(card);
      expect(serialized).not.toContain("Castillo de If");
      expect(serialized).not.toContain("Faria");
      expect(serialized).not.toContain("Villefort");
      expect(serialized).not.toContain("Danglars");
      expect(serialized).not.toContain("SPOILER");
    });

    it("garantiza que menciones en párrafos posteriores al charOffsetInChapter dentro del mismo capítulo jamás aparecen", () => {
      const chapterText =
        "Edmond Dantès conversaba alegremente con Mercédès en el jardín de la casa durante la tarde soleada.\n\n" +
        "SPOILER EN ESTE MISMO CAPÍTULO: En ese instante, Fernand sacó un puñal y traicionó a Edmond Dantès por la espalda trágicamente.";

      // El lector está en el carácter 95 (justo al final del primer párrafo)
      const boundary: SpoilerBoundary = {
        chapterIndex: 0,
        charOffsetInChapter: 95,
      };

      const card = buildZeroSpoilerCharacterCard(
        "Dantès",
        [{ index: 0, title: "Capítulo 1", plainText: chapterText }],
        boundary,
      );

      // Verificación: Solo existe la mención del primer párrafo
      expect(card.totalMentionsUpToCursor).toBe(1);
      expect(card.firstMention?.sentence).toContain("conversaba alegremente con Mercédès");
      expect(card.recentMention).toBeNull();

      // Ningún elemento del segundo párrafo (después de charOffsetInChapter) se filtra
      const serialized = JSON.stringify(card);
      expect(serialized).not.toContain("Fernand");
      expect(serialized).not.toContain("puñal");
      expect(serialized).not.toContain("traicionó");
      expect(serialized).not.toContain("SPOILER");
    });
  });
});
