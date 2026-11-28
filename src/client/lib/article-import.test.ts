import { describe, expect, it } from "vitest";
import { extractSharedArticleUrl } from "./share-target";
import { buildArticleEpubFile, estimateArticleReadingMinutes } from "./article-import";
import { checkEpubFile } from "./epub-intake";
import { extractEpubMeta } from "../../shared/epub-meta";

describe("share-target + article-import (E18)", () => {
  it("extractSharedArticleUrl extrae enlaces HTTPS desde ?url= o ?text= y descarta esquemas inseguros", () => {
    expect(extractSharedArticleUrl("https://ejemplo.com/ensayo?p=1", null)).toBe(
      "https://ejemplo.com/ensayo?p=1",
    );
    expect(
      extractSharedArticleUrl(null, "Mira este artículo: https://substack.com/p/lectura-lenta."),
    ).toBe("https://substack.com/p/lectura-lenta");
    expect(extractSharedArticleUrl("http://ejemplo.com/inseguro", null)).toBeNull();
    expect(extractSharedArticleUrl(null, "solo texto sin enlace")).toBeNull();
  });

  it("buildArticleEpubFile empaqueta un EPUB válido con metadatos escapados sin tocar servidor", async () => {
    const file = await buildArticleEpubFile({
      title: 'Lectura & Memoria <"Capítulo">',
      author: "Autor & Ensayista",
      language: "es",
      sourceHost: "ensayos.example.com",
      paragraphs: [
        "Primer párrafo limpio con signos < y >.",
        "Segundo párrafo del artículo importado localmente.",
      ],
    });

    expect(file.type).toBe("application/epub+zip");
    expect(file.name).toMatch(/\.epub$/);

    const check = await checkEpubFile(file);
    expect(check.ok).toBe(true);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await extractEpubMeta(bytes);
    expect(meta?.title).toBe('Lectura & Memoria <"Capítulo">');
    expect(meta?.author).toBe("Autor & Ensayista");
    expect(meta?.language).toBe("es");
    expect(meta?.sections).toBe(1);
  });

  it("estimateArticleReadingMinutes calcula minutos reales (mínimo 1)", () => {
    expect(estimateArticleReadingMinutes([])).toBe(1);
    expect(estimateArticleReadingMinutes(["Una frase corta."])).toBe(1);
    const fiveMin = Array.from({ length: 1100 }, () => "palabra").join(" ");
    expect(estimateArticleReadingMinutes([fiveMin])).toBe(5);
  });
});
