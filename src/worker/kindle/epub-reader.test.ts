import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeRaschMastery,
  estimateThetaFromD1Knowledge,
  extractChapterPrepCandidates,
  extractCompactContextSentence,
  extractPageWords,
  findSentenceWithWord,
  formatChapterHtmlForMode,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  resolveZipPath,
  sanitizeKindleHtml,
  selectKindleChapterPrimingWords,
  wrapWordsWithLinks,
  type KindleUserLexicalState,
} from "./epub-reader";

describe("epub-reader (Kindle E-ink)", () => {
  const minimalPath = resolve(__dirname, "../../../fixtures/minimal.epub");
  const minimalBytes = new Uint8Array(readFileSync(minimalPath));

  describe("resolveZipPath", () => {
    it("resuelve rutas relativas y normaliza puntos", () => {
      expect(resolveZipPath("OEBPS", "chapter1.xhtml")).toBe("OEBPS/chapter1.xhtml");
      expect(resolveZipPath("OEBPS", "./chapter1.xhtml")).toBe("OEBPS/chapter1.xhtml");
      expect(resolveZipPath("OEBPS/text", "../images/cover.jpg")).toBe("OEBPS/images/cover.jpg");
      expect(resolveZipPath("", "META-INF/container.xml")).toBe("META-INF/container.xml");
      expect(resolveZipPath("OEBPS", "/images/fig.png")).toBe("OEBPS/images/fig.png");
    });
  });

  describe("parseEpub", () => {
    it("extrae metadatos, spine y rutas completas de minimal.epub", async () => {
      const epub = await parseEpub(minimalBytes);
      expect(epub).not.toBeNull();
      expect(epub?.title).toBe("Libro de prueba");
      expect(epub?.author).toBe("Equipo Lecta");
      expect(epub?.language).toBe("es");
      expect(epub?.spine.length).toBe(2);
      expect(epub?.spine[0]?.fullPath).toBe("OEBPS/chapter1.xhtml");
      expect(epub?.spine[1]?.fullPath).toBe("OEBPS/chapter2.xhtml");
    });

    it("devuelve null si los bytes no son un zip válido", async () => {
      const invalid = new Uint8Array([0, 1, 2, 3]);
      expect(await parseEpub(invalid)).toBeNull();
    });
  });

  describe("sanitizeKindleHtml", () => {
    it("elimina scripts, eventos on* y neutraliza enlaces javascript", () => {
      const raw = `
        <head><title>Prueba</title><script>alert('xss')</script></head>
        <body>
          <h1>Título</h1>
          <p>Texto</p>
          <img src="foto.jpg" onerror="alert(1)" />
          <a href="javascript:alert(2)">Peligro</a>
        </body>
      `;
      const { title, contentHtml } = sanitizeKindleHtml(raw, "OEBPS", "hash123");
      expect(title).toBe("Prueba");
      expect(contentHtml).not.toContain("<script>");
      expect(contentHtml).not.toContain("alert");
      expect(contentHtml).not.toContain("onerror");
      expect(contentHtml).toContain('href="#"');
      expect(contentHtml).toContain('/k/read/hash123/resource?path=OEBPS%2Ffoto.jpg');
    });
  });

  describe("getEpubChapter", () => {
    it("extrae el primer capítulo sanitizado con conteo de secciones", async () => {
      const result = await getEpubChapter(minimalBytes, 0, "test-book");
      expect(result).not.toBeNull();
      expect(result?.bookTitle).toBe("Libro de prueba");
      expect(result?.chapterTitle).toBe("Capítulo uno");
      expect(result?.sectionIndex).toBe(0);
      expect(result?.totalSections).toBe(2);
      expect(result?.contentHtml).toContain("La casa antigua tenía una puerta estrecha.");
      expect(result?.contentHtml).toContain("Luis leyó despacio una palabra difícil: perenne.");
      // Comprobar sanitización en minimal.epub:
      expect(result?.contentHtml).not.toContain("window.__xss");
      expect(result?.contentHtml).toContain('/k/read/test-book/resource?path=OEBPS%2Fx');
    });

    it("extrae el segundo capítulo correctamente", async () => {
      const result = await getEpubChapter(minimalBytes, 1, "test-book");
      expect(result).not.toBeNull();
      expect(result?.chapterTitle).toBe("Capítulo dos");
      expect(result?.sectionIndex).toBe(1);
      expect(result?.contentHtml).toContain("Otra sección para comprobar navegación.");
    });

    it("ajusta los índices fuera de rango al límite más cercano", async () => {
      const result = await getEpubChapter(minimalBytes, 99, "test-book");
      expect(result?.sectionIndex).toBe(1);
    });
  });

  describe("getEpubResource", () => {
    it("extrae un recurso interno del EPUB con el tipo MIME adecuado", async () => {
      const res = await getEpubResource(minimalBytes, "OEBPS/nav.xhtml");
      expect(res).not.toBeNull();
      expect(res?.mimeType).toBe("application/xhtml+xml");
      expect(res?.data.length).toBeGreaterThan(0);
    });

    it("devuelve null para recursos inexistentes", async () => {
      const res = await getEpubResource(minimalBytes, "no-existe.png");
      expect(res).toBeNull();
    });
  });

  describe("paginateChapter", () => {
    it("divide un texto largo en páginas de longitud controlada", () => {
      const paragraphs = Array.from(
        { length: 10 },
        (_, i) => `<p>Este es el párrafo número ${i + 1} con suficiente texto para simular lectura en tinta electrónica.</p>`,
      ).join("\n");

      // Con límite bajo (~200 chars), se generan múltiples páginas
      const pages = paginateChapter(paragraphs, 250);
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) {
        expect(page).toContain("<p>");
        expect(page).toContain("</p>");
      }
    });

    it("mantiene un texto corto en una sola página", () => {
      const short = "<p>Una sola línea breve.</p>";
      const pages = paginateChapter(short, 1600);
      expect(pages.length).toBe(1);
      expect(pages[0]).toBe(short);
    });
  });

  describe("extractPageWords", () => {
    it("extrae palabras candidatas descartando stopwords y signos", () => {
      const html = "<p>La casa antigua tenía una puerta estrecha y perenne.</p>";
      const words = extractPageWords(html, "es");
      expect(words).toContain("antigua");
      expect(words).toContain("puerta");
      expect(words).toContain("estrecha");
      expect(words).toContain("perenne");
      // Stopwords excluidas
      expect(words).not.toContain("la");
      expect(words).not.toContain("una");
      expect(words).not.toContain("y");
    });
  });

  describe("wrapWordsWithLinks", () => {
    it("envuelve palabras en enlaces de consulta inline respetando tags HTML y puntuación", () => {
      const html = '<p class="lead">La casa antigua.</p>';
      const saved = new Set(["antigua"]);
      const wrapped = wrapWordsWithLinks(
        html,
        "book123",
        "/k/read/book123?section=0&page=0",
        saved,
      );

      // Los atributos de las etiquetas no se tocan
      expect(wrapped).toContain('<p class="lead">');
      expect(wrapped).toContain('</p>');
      // La puntuación queda fuera
      expect(wrapped).toContain('</a>.');
      // Enlace ordinario a lookup en la misma página
      expect(wrapped).toContain('/k/read/book123?section=0&amp;page=0&amp;lookup=casa');
      // Palabra guardada lleva clase saved
      expect(wrapped).toContain('class="w saved"');
      expect(wrapped).toContain('>antigua</a>');
    });

    it("no re-envuelve texto que ya está dentro de un enlace <a>", () => {
      const html = '<p><a href="#nota">Nota al pie</a> y texto normal.</p>';
      const wrapped = wrapWordsWithLinks(html, "b1", "/k", new Set());
      expect(wrapped).toContain('<a href="#nota">Nota al pie</a>');
      expect(wrapped).toContain('/k?lookup=texto');
    });
  });

  describe("extractChapterPrepCandidates", () => {
    it("extrae candidatos descartando stopwords y palabras que solo aparecen en mayúsculas", () => {
      const html = "<p>Pedro y María visitaron la casa antigua y la fortaleza perenne.</p>";
      const candidates = extractChapterPrepCandidates(html, "es");
      expect(candidates).toContain("casa");
      expect(candidates).toContain("antigua");
      expect(candidates).toContain("fortaleza");
      expect(candidates).toContain("perenne");
      // "Pedro" y "María" solo aparecen con mayúscula -> se descartan como nombres propios
      expect(candidates).not.toContain("pedro");
      expect(candidates).not.toContain("maría");
      // Stopwords descartadas
      expect(candidates).not.toContain("la");
      expect(candidates).not.toContain("y");
      expect(candidates).toContain("visitaron");
    });
  });

  describe("findSentenceWithWord", () => {
    it("encuentra la oración que contiene una palabra específica", () => {
      const text = "Esta es la primera frase breve. La casa antigua tenía una puerta secreta de roble. Esta es la tercera.";
      const sentence = findSentenceWithWord(text, "antigua");
      expect(sentence).toBe("La casa antigua tenía una puerta secreta de roble.");
    });

    it("devuelve null si la palabra no está presente", () => {
      const text = "Frase simple sin coincidencias.";
      expect(findSentenceWithWord(text, "inexistente")).toBeNull();
    });
  });

  describe("formatChapterHtmlForMode", () => {
    it("deja el html sin cambios en modo clean o lexicon", () => {
      const html = "<p>Primer párrafo.</p><p>Segundo párrafo.</p>";
      expect(formatChapterHtmlForMode(html, "clean")).toBe(html);
      expect(formatChapterHtmlForMode(html, "lexicon")).toBe(html);
    });

    it("numera los párrafos con §1, §2 en modo paragraphs", () => {
      const html = "<p>Primer párrafo.</p><p>Segundo párrafo.</p>";
      const formatted = formatChapterHtmlForMode(html, "paragraphs");
      expect(formatted).toContain('<span class="p-num">§1</span>Primer párrafo.');
      expect(formatted).toContain('<span class="p-num">§2</span>Segundo párrafo.');
    });

    it("agrega p-guided en párrafos largos de más de 300 caracteres", () => {
      const longText = "A".repeat(350);
      const html = `<p>${longText}</p>`;
      const formatted = formatChapterHtmlForMode(html, "paragraphs");
      expect(formatted).toContain('class="p-guided"');
    });
  });

  describe("wrapWordsWithLinks con notedWordsMap (Modo Léxico)", () => {
    it("añade la clase w-lexicon y superíndice a las palabras anotadas", () => {
      const html = "<p>Un silencio perenne inundó la estancia.</p>";
      const noted = new Map<string, number>([["perenne", 1]]);
      const wrapped = wrapWordsWithLinks(html, "book123", "/k/read/book123", new Set(), noted);
      expect(wrapped).toContain('class="w w-lexicon"');
      expect(wrapped).toContain("perenne<sup>1</sup>");
    });
  });

  describe("computeRaschMastery", () => {
    it("devuelve 0.5 cuando theta es igual a beta", () => {
      expect(computeRaschMastery(1.5, 1.5)).toBeCloseTo(0.5);
      expect(computeRaschMastery(0.0, 0.0)).toBeCloseTo(0.5);
    });

    it("devuelve mayor a 0.5 cuando theta supera a beta", () => {
      expect(computeRaschMastery(2.0, 0.5)).toBeGreaterThan(0.5);
    });

    it("devuelve menor a 0.5 cuando theta es inferior a beta", () => {
      expect(computeRaschMastery(-1.0, 0.5)).toBeLessThan(0.5);
    });
  });

  describe("estimateThetaFromD1Knowledge", () => {
    it("devuelve 0.0 con registros vacíos", () => {
      expect(estimateThetaFromD1Knowledge([])).toBe(0.0);
    });

    it("incrementa theta cuando el usuario domina palabras difíciles", () => {
      const records = [
        { word: "efímero", status: "known", difficultyBeta: 1.2 },
        { word: "ubícuo", status: "known", difficultyBeta: 1.8 },
        { word: "perenne", status: "known", difficultyBeta: 1.5 },
      ];
      const theta = estimateThetaFromD1Knowledge(records);
      expect(theta).toBeGreaterThan(0.0);
    });

    it("disminuye theta si las palabras están en estado learning", () => {
      const records = [
        { word: "casa", status: "learning", difficultyBeta: 0.1 },
        { word: "libro", status: "learning", difficultyBeta: 0.2 },
        { word: "tiempo", status: "learning", difficultyBeta: 0.3 },
      ];
      const theta = estimateThetaFromD1Knowledge(records);
      expect(theta).toBeLessThan(0.0);
    });
  });

  describe("extractCompactContextSentence", () => {
    it("extrae la oración exacta cuando mide menos de 140 caracteres", () => {
      const text = "El gato dormía en el tejado. Una brisa fresca soplaba del norte.";
      const sentence = extractCompactContextSentence(text, "brisa");
      expect(sentence).toBe("Una brisa fresca soplaba del norte.");
    });

    it("trunca oraciones muy largas a un máximo centrado con elipsis", () => {
      const longSentence = "En un remoto confín del universo donde la oscuridad lo cubría todo y las estrellas parecían temblar ante el silencio absoluto, un viajero solitario contemplaba el horizonte infinito con melancólica serenidad.";
      const result = extractCompactContextSentence(longSentence, "viajero");
      expect(result.length).toBeLessThanOrEqual(140);
      expect(result).toContain("viajero");
      expect(result.startsWith("…") || result.endsWith("…")).toBe(true);
    });

    it("funciona con palabras que contienen tildes o caracteres especiales", () => {
      const text = "A la sombra de un frondoso árbol perenne descansaban los caminantes.";
      const sentence = extractCompactContextSentence(text, "árbol");
      expect(sentence).toContain("árbol");
    });

    it("devuelve cadena vacía si la palabra no se encuentra", () => {
      const text = "Texto sin la palabra clave.";
      expect(extractCompactContextSentence(text, "inexistente")).toBe("");
    });
  });

  describe("selectKindleChapterPrimingWords", () => {
    const sampleText = `
      El viejo marinero contemplaba la soledad del océano.
      La soledad era inmensa y un silencio perenne envolvía la embarcación.
      Sintió una honda afrenta al recordar las palabras del capitán.
      Aquella afrenta le quitaba el sueño. La soledad no le asustaba,
      pero el desamparo era difícil de sobrellevar.
    `;

    const userState: KindleUserLexicalState = {
      theta: 0.0,
      knownLemmas: new Set(["viejo", "mar"]),
      learningRetrievability: new Map([["palabra", 0.9]]),
    };

    const catalog = new Map([
      ["soledad", { beta: 0.6, gloss: "Carencia voluntaria o involuntaria de compañía.", pos: "sustantivo" }],
      ["perenne", { beta: 0.8, gloss: "Continuo, incesante, que no prescribe.", pos: "adjetivo" }],
      ["afrenta", { beta: 0.7, gloss: "Vergüenza y deshonor que resulta de algún dicho o hecho.", pos: "sustantivo" }],
      ["desamparo", { beta: 1.1, gloss: "Falta de amparo o protección.", pos: "sustantivo" }],
    ]);

    it("selecciona palabras óptimas ordenadas por utilidad según modelo Rasch y ZPD", () => {
      const selected = selectKindleChapterPrimingWords(sampleText, "es", userState, catalog, {
        maxWords: 4,
      });

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.length).toBeLessThanOrEqual(4);
      // Las palabras seleccionadas deben estar presentes en el catálogo y tener su contexto
      for (const w of selected) {
        expect(w.shortGloss.length).toBeGreaterThan(0);
        expect(w.contextSentence.length).toBeGreaterThan(0);
        expect(w.utilityScore).toBeGreaterThanOrEqual(0.2);
      }
      // Ordenadas de mayor a menor puntuación
      for (let i = 1; i < selected.length; i++) {
        expect(selected[i - 1].utilityScore).toBeGreaterThanOrEqual(selected[i].utilityScore);
      }
    });

    it("no incluye palabras marcadas en knownLemmas", () => {
      const stateWithKnown: KindleUserLexicalState = {
        theta: 0.0,
        knownLemmas: new Set(["soledad", "afrenta"]),
        learningRetrievability: new Map(),
      };
      const selected = selectKindleChapterPrimingWords(sampleText, "es", stateWithKnown, catalog);
      const lemmas = selected.map((s) => s.lemma);
      expect(lemmas).not.toContain("soledad");
      expect(lemmas).not.toContain("afrenta");
    });

    it("soporta selección en inglés (isForeignLang: true)", () => {
      const englishText = `
        She felt a lingering reluctance before entering the dark room.
        The lingering shadows made her hesitate.
        He whispered a quiet warning.
      `;
      const enCatalog = new Map([
        ["linger", { beta: 0.5, gloss: "To stay in a place longer than necessary.", pos: "verb" }],
        ["reluctance", { beta: 0.6, gloss: "Unwillingness or disinclination to do something.", pos: "noun" }],
        ["whisper", { beta: 0.3, gloss: "Speak very softly using one's breath without phonation.", pos: "verb" }],
      ]);
      const enUserState: KindleUserLexicalState = {
        theta: 0.2,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };

      const selected = selectKindleChapterPrimingWords(englishText, "en", enUserState, enCatalog, {
        maxWords: 3,
        isForeignLang: true,
      });

      expect(selected.length).toBeGreaterThan(0);
      expect(selected[0].lang).toBe("en");
    });

    it("descarta palabras cuya puntuación de utilidad sea menor a 0.20 o cuya probabilidad de desconocimiento sea baja", () => {
      const easyCatalog = new Map([
        ["soledad", { beta: -2.5, gloss: "Carencia de compañía.", pos: "sustantivo" }],
      ]);
      const highThetaState: KindleUserLexicalState = {
        theta: 2.0,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };
      const selected = selectKindleChapterPrimingWords(sampleText, "es", highThetaState, easyCatalog);
      // Para theta=2.0 y beta=-2.5, Rasch mastery es prácticamente 1.0 (unknownProb < 0.25), por lo que se descarta
      expect(selected).toHaveLength(0);
    });

    it("aplica lematización y extracción morfológica en inglés (-ing, -ed, -s)", () => {
      const text = "He was lingering in the shadows and whispered before knocking.";
      const enCatalog = new Map([
        ["linger", { beta: 0.6, gloss: "Stay longer than necessary", pos: "verb" }],
        ["whisper", { beta: 0.5, gloss: "Speak very softly without phonation", pos: "verb" }],
      ]);
      const userState: KindleUserLexicalState = {
        theta: 0.0,
        knownLemmas: new Set(),
        learningRetrievability: new Map(),
      };

      const selected = selectKindleChapterPrimingWords(text, "en", userState, enCatalog, {
        maxWords: 5,
        isForeignLang: true,
      });

      const lemmas = selected.map((s) => s.lemma);
      expect(lemmas).toContain("linger");
      expect(lemmas).toContain("whisper");
      // Formas superficiales reflejan el texto original
      const surfaces = selected.map((s) => s.surfaceForm);
      expect(surfaces).toContain("lingering");
      expect(surfaces).toContain("whispered");
    });
  });

  describe("computeRaschMastery y estimateThetaFromD1Knowledge (Robustez matemática)", () => {
    it("computeRaschMastery limita z entre -10 y 10 para evitar overflow o NaN", () => {
      expect(computeRaschMastery(100, 0)).toBeCloseTo(1.0, 4);
      expect(computeRaschMastery(-100, 0)).toBeCloseTo(0.0, 4);
      expect(computeRaschMastery(1.5, 1.5)).toBeCloseTo(0.5, 4);
    });

    it("estimateThetaFromD1Knowledge con registros vacíos devuelve 0.0", () => {
      expect(estimateThetaFromD1Knowledge([])).toBe(0.0);
    });

    it("estimateThetaFromD1Knowledge respeta los límites rígidos [-3.5, 4.0]", () => {
      const allKnown = Array.from({ length: 60 }, (_, i) => ({
        word: `word_${i}`,
        status: "known",
        difficultyBeta: 2.5,
      }));
      const highTheta = estimateThetaFromD1Knowledge(allKnown);
      expect(highTheta).toBeLessThanOrEqual(4.0);
      expect(highTheta).toBeGreaterThan(1.0);

      const allLearning = Array.from({ length: 60 }, (_, i) => ({
        word: `word_${i}`,
        status: "learning",
        difficultyBeta: -1.5,
      }));
      const lowTheta = estimateThetaFromD1Knowledge(allLearning);
      expect(lowTheta).toBeGreaterThanOrEqual(-3.5);
      expect(lowTheta).toBeLessThan(0.0);
    });
  });
});



