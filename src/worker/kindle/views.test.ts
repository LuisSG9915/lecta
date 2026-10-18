import { describe, it, expect } from "vitest";
import {
  renderKindleChapterPrimingView,
  injectKindlePrimedAnchors,
  type KindleChapterPrimingViewProps,
} from "./views";
import type { KindlePrimingWord } from "./epub-reader";

describe("Kindle Views - Espacio de Pre-lectura Adaptativo (Fase 3)", () => {
  const sampleWords: KindlePrimingWord[] = [
    {
      lemma: "perenne",
      surfaceForm: "perenne",
      lang: "es",
      beta: 1.2,
      chapterFrequency: 2,
      shortGloss: "Que dura indefinidamente.",
      partOfSpeech: "adj.",
      contextSentence: "Luis leyó despacio una palabra difícil: perenne.",
      utilityScore: 0.85,
    },
    {
      lemma: "estrecho",
      surfaceForm: "estrecha",
      lang: "es",
      beta: 0.8,
      chapterFrequency: 3,
      shortGloss: "Que tiene poca anchura.",
      partOfSpeech: "adj.",
      contextSentence: "La casa antigua tenía una puerta estrecha.",
      utilityScore: 0.65,
    },
  ];

  describe("renderKindleChapterPrimingView", () => {
    it("genera HTML E-Ink de alto contraste sin animaciones y con botones táctiles accesibles", () => {
      const props: KindleChapterPrimingViewProps = {
        bookId: "book-123",
        bookTitle: "Cien años de soledad",
        chapterIndex: 0,
        chapterTitle: "Capítulo I",
        bookLang: "es",
        isForeignLang: false,
        words: sampleWords,
      };

      const html = renderKindleChapterPrimingView(props);

      // Verificación de estilos E-Ink estrictos (cero parpadeo, sin animaciones ni transiciones)
      expect(html).toContain("transition: none !important");
      expect(html).toContain("animation: none !important");
      expect(html).toContain("background: #ffffff");
      expect(html).toContain("color: #000000");

      // Objetivos táctiles mínimos para E-Readers (>= 44px)
      expect(html).toContain("min-height: 44px");

      // Título y contenido pedagógico
      expect(html).toContain("Capítulo I");
      expect(html).toContain("Cien años de soledad");
      expect(html).toContain("Comenzar a leer capítulo →");
      expect(html).toContain("Pre-lectura · 2 palabras");

      // Tarjetas de palabras con glosa y contexto
      expect(html).toContain("perenne");
      expect(html).toContain("estrecha");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("Que tiene poca anchura.");
      expect(html).toContain("«Luis leyó despacio una palabra difícil: perenne.»");

      // Formulario con botones de acción directa
      expect(html).toContain("✓ Ya la sé");
      expect(html).toContain("+ Repasar");
      expect(html).toContain('name="action" value="known"');
      expect(html).toContain('name="action" value="save"');

      // Acciones de desactivación en un toque
      expect(html).toContain("Ocultar en este libro");
      expect(html).toContain("Desactivar siempre");
      expect(html).toContain('value="mute_book"');
      expect(html).toContain('value="disable_all"');

      // Script de mejora progresiva sin parpadeo (Zero-Flash Progressive Enhancement)
      expect(html).toContain("window.lectaKindleAction");
      expect(html).toContain("fetch(formEl.action");
    });

    it("indica el idioma extranjero en el badge si isForeignLang es true", () => {
      const props: KindleChapterPrimingViewProps = {
        bookId: "book-en",
        bookTitle: "Moby Dick",
        chapterIndex: 1,
        chapterTitle: "Chapter 2: The Carpet-Bag",
        bookLang: "en",
        isForeignLang: true,
        words: [
          {
            lemma: "melancholy",
            surfaceForm: "melancholy",
            lang: "en",
            beta: 1.5,
            chapterFrequency: 1,
            shortGloss: "A deep, pensive sadness.",
            contextSentence: "A damp, drizzly November in my soul.",
            utilityScore: 0.9,
          },
        ],
      };

      const html = renderKindleChapterPrimingView(props);
      expect(html).toContain("Idioma: EN · 1 palabras");
      expect(html).toContain("melancholy");
      expect(html).toContain("A deep, pensive sadness.");
    });
  });

  describe("injectKindlePrimedAnchors", () => {
    it("devuelve el HTML original si la lista de palabras está vacía", () => {
      const html = "<p>Texto intacto.</p>";
      expect(injectKindlePrimedAnchors(html, [])).toBe(html);
    });

    it("subraya con línea punteada e inserta la micro-glosa en la primera aparición", () => {
      const chapterHtml =
        "<p>La casa antigua tenía una puerta estrecha. Era muy estrecha.</p>";
      const result = injectKindlePrimedAnchors(chapterHtml, [
        {
          lemma: "estrecho",
          surfaceForm: "estrecha",
          lang: "es",
          beta: 0.8,
          chapterFrequency: 2,
          shortGloss: "de poca anchura",
          contextSentence: "",
          utilityScore: 0.5,
        },
      ]);

      // Debe incluir la primera aparición con estilo punteado y glosa entre corchetes
      expect(result).toContain(
        '<span style="border-bottom: 1.5px dashed #000; font-weight: 500;">estrecha</span> <small style="font-family: sans-serif; font-size: 0.78em;">[de poca anchura]</small>',
      );

      // Solo la primera aparición debe tener la glosa
      const matches = result.match(/\[de poca anchura\]/g);
      expect(matches).toHaveLength(1);
    });

    it("no modifica palabras contenidas dentro de etiquetas o atributos HTML", () => {
      const chapterHtml =
        '<div class="estrecha"><img src="/img/estrecha.jpg" alt="estrecha" /><p>Una calle estrecha.</p></div>';
      const result = injectKindlePrimedAnchors(chapterHtml, [
        {
          lemma: "estrecho",
          surfaceForm: "estrecha",
          lang: "es",
          beta: 0.8,
          chapterFrequency: 1,
          shortGloss: "angosta",
          contextSentence: "",
          utilityScore: 0.5,
        },
      ]);

      // Los atributos no se tocan
      expect(result).toContain('class="estrecha"');
      expect(result).toContain('src="/img/estrecha.jpg"');
      expect(result).toContain('alt="estrecha"');

      // El texto dentro del párrafo sí recibe el anclaje
      expect(result).toContain(
        '<span style="border-bottom: 1.5px dashed #000; font-weight: 500;">estrecha</span> <small style="font-family: sans-serif; font-size: 0.78em;">[angosta]</small>',
      );
    });
  });
});
