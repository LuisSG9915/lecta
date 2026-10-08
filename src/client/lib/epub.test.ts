// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  detectBookLanguage,
  detectLanguageFromText,
  languageName,
  normalizeLanguage,
  stripSoftHyphens,
  type EpubBook,
} from "./epub";

const div = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("stripSoftHyphens", () => {
  it("quita los guiones blandos de los nodos de texto", () => {
    const root = div("<p>pa\u00ADla\u00ADbras</p><p>otro p\u00ADarrafo</p>");
    stripSoftHyphens(root);
    expect(root.textContent).toBe("palabrasotro parrafo");
  });

  it("cubre texto anidado en cualquier profundidad", () => {
    const root = div(
      '<p>ante<em>ri\u00ADor</em>mente <span><strong>des\u00ADecho</strong></span></p>',
    );
    stripSoftHyphens(root);
    expect(root.textContent).toBe("anteriormente desecho");
  });

  it("conserva guiones normales, espacios y entidades", () => {
    const root = div("<p>corre–ve–y–dile y boomerang</p>");
    stripSoftHyphens(root);
    expect(root.textContent).toBe("corre–ve–y–dile y boomerang");
  });

  it("no toca nada cuando no hay guiones blandos", () => {
    const root = div("<p>texto limpio</p>");
    const before = root.innerHTML;
    stripSoftHyphens(root);
    expect(root.innerHTML).toBe(before);
  });
});

describe("normalizeLanguage", () => {
  it("normaliza variantes de inglés a 'en'", () => {
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage("en-GB")).toBe("en");
    expect(normalizeLanguage("en_US")).toBe("en");
    expect(normalizeLanguage("eng")).toBe("en");
    expect(normalizeLanguage("EN")).toBe("en");
  });

  it("normaliza variantes de español a 'es'", () => {
    expect(normalizeLanguage("es-ES")).toBe("es");
    expect(normalizeLanguage("es-MX")).toBe("es");
    expect(normalizeLanguage("spa")).toBe("es");
    expect(normalizeLanguage("ES")).toBe("es");
  });

  it("normaliza códigos de 3 letras comunes", () => {
    expect(normalizeLanguage("fra")).toBe("fr");
    expect(normalizeLanguage("fre")).toBe("fr");
    expect(normalizeLanguage("deu")).toBe("de");
    expect(normalizeLanguage("ger")).toBe("de");
    expect(normalizeLanguage("ita")).toBe("it");
    expect(normalizeLanguage("por")).toBe("pt");
  });

  it("recae a 'es' ante entradas vacías o inválidas", () => {
    expect(normalizeLanguage("")).toBe("es");
    expect(normalizeLanguage(null)).toBe("es");
    expect(normalizeLanguage(undefined)).toBe("es");
    expect(normalizeLanguage("12345")).toBe("es");
  });
});

describe("languageName", () => {
  it("devuelve los nombres comunes en español", () => {
    expect(languageName("es")).toBe("Español");
    expect(languageName("en")).toBe("Inglés");
    expect(languageName("fr")).toBe("Francés");
    expect(languageName("de")).toBe("Alemán");
    expect(languageName("it")).toBe("Italiano");
    expect(languageName("pt")).toBe("Portugués");
  });

  it("muestra el código en mayúsculas si no está en la lista", () => {
    expect(languageName("nl")).toBe("NL");
  });
});

describe("detectLanguageFromText", () => {
  it("identifica texto en inglés mediante stopwords características", () => {
    const englishText =
      "It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith kept his chin into his breast.";
    expect(detectLanguageFromText(englishText)).toBe("en");
  });

  it("identifica texto en español mediante stopwords características", () => {
    const spanishText =
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero.";
    expect(detectLanguageFromText(spanishText)).toBe("es");
  });

  it("devuelve null ante texto muy corto o sin suficientes stopwords", () => {
    expect(detectLanguageFromText("Hello world")).toBeNull();
    expect(detectLanguageFromText("")).toBeNull();
  });
});

describe("detectBookLanguage", () => {
  it("prioriza metadatos válidos de idioma", async () => {
    const book = {
      metadata: { language: "en-US" },
      sections: [],
    } as unknown as EpubBook;
    expect(await detectBookLanguage(book)).toBe("en");
  });

  it("detecta a partir del texto cuando los metadatos declaran 'und' o faltan", async () => {
    const book = {
      metadata: { language: "und" },
      sections: [
        {
          createDocument: async () => ({
            body: {
              textContent:
                "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore.",
            },
          }),
        },
      ],
    } as unknown as EpubBook;
    expect(await detectBookLanguage(book)).toBe("en");
  });
});
