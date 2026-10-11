import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractChapterPrepCandidates,
  extractPageWords,
  findSentenceWithWord,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  resolveZipPath,
  sanitizeKindleHtml,
  wrapWordsWithLinks,
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
});


