import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectBookLanguage, extractEpubMeta } from "./epub-meta";

describe("extractEpubMeta", () => {
  it("extrae título, autor y secciones de fixtures/minimal.epub", async () => {
    const fixturePath = resolve(__dirname, "../../fixtures/minimal.epub");
    const data = new Uint8Array(readFileSync(fixturePath));
    const meta = await extractEpubMeta(data);
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe("Libro de prueba");
    expect(meta?.author).toBe("Equipo Lecta");
    expect(meta?.sections).toBe(2);
    expect(meta?.language).toBe("es");
  });

  it("devuelve null para bytes no válidos", async () => {
    const meta = await extractEpubMeta(new Uint8Array([1, 2, 3, 4]));
    expect(meta).toBeNull();
  });
});

describe("detectBookLanguage (shared)", () => {
  it("detecta idioma inglés desde XML OPF con dc:language", () => {
    const opf = `<package><metadata><dc:language>en-US</dc:language></metadata></package>`;
    expect(detectBookLanguage(opf)).toBe("en");
  });

  it("detecta idioma español desde XML OPF con dc:language", () => {
    const opf = `<package><metadata><dc:language>es-ES</dc:language></metadata></package>`;
    expect(detectBookLanguage(opf)).toBe("es");
  });

  it("resuelve código de idioma directo", () => {
    expect(detectBookLanguage("en")).toBe("en");
    expect(detectBookLanguage("eng")).toBe("en");
    expect(detectBookLanguage("es")).toBe("es");
    expect(detectBookLanguage("spa")).toBe("es");
  });

  it("usa muestra de texto cuando el OPF es ambiguo o falta", () => {
    const englishSample = "It was the best of times, it was the worst of times, it was the age of wisdom.";
    expect(detectBookLanguage(undefined, englishSample)).toBe("en");
    expect(detectBookLanguage("<dc:language>und</dc:language>", englishSample)).toBe("en");

    const spanishSample = "En un lugar de la Mancha de cuyo nombre no quiero acordarme vivía un hidalgo.";
    expect(detectBookLanguage(undefined, spanishSample)).toBe("es");
  });

  it("recae a 'es' ante entradas vacías", () => {
    expect(detectBookLanguage()).toBe("es");
    expect(detectBookLanguage("", "")).toBe("es");
  });
});
