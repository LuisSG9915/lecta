import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getEpubChapter,
  getEpubResource,
  parseEpub,
  resolveZipPath,
  sanitizeKindleHtml,
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
});
