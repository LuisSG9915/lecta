import { describe, it, expect } from "vitest";
import {
  renderKindleChapterPrimingView,
  injectKindlePrimedAnchors,
  renderHomeView,
  renderLookupView,
  renderKindleCatSvg,
  renderLoginView,
  renderKindleLinkView,
  renderPracticeView,
  renderReaderView,
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

      // Verificación de estructura semántica accesible
      expect(html).toContain("Cien años de soledad");
      expect(html).toContain("Capítulo I");
      expect(html).toContain("Pre-lectura · 2 palabras");
      expect(html).toContain("Comenzar a leer capítulo");

      // Verificación de tarjetas de vocabulario y botones de 1-toque
      expect(html).toContain("perenne");
      expect(html).toContain("estrecha");
      expect(html).toContain("Que dura indefinidamente.");
      expect(html).toContain("Luis leyó despacio una palabra difícil: perenne.");
      expect(html).toContain("✓ Ya la sé");
      expect(html).toContain("+ Repasar");

      // Verificación de opciones avanzadas (plegadas sin interrumpir)
      expect(html).toContain("Ocultar en este libro");
      expect(html).toContain("Desactivar siempre");
    });

    it("indica el idioma extranjero en el badge si isForeignLang es true", () => {
      const props: KindleChapterPrimingViewProps = {
        bookId: "book-en",
        bookTitle: "The Great Gatsby",
        chapterIndex: 0,
        chapterTitle: "Chapter 1",
        bookLang: "en",
        isForeignLang: true,
        words: [sampleWords[0]],
      };

      const html = renderKindleChapterPrimingView(props);
      expect(html).toContain("Idioma: EN · 1 palabras");
    });
  });

  describe("injectKindlePrimedAnchors", () => {
    it("devuelve el HTML original si la lista de palabras está vacía", () => {
      const rawHtml = "<p>Un texto sin cambios.</p>";
      const result = injectKindlePrimedAnchors(rawHtml, []);
      expect(result).toBe(rawHtml);
    });

    it("subraya con línea punteada e inserta la micro-glosa en la primera aparición", () => {
      const chapterHtml = `
        <div>
          <p>La casa tenía una entrada estrecha hacia el jardín.</p>
          <p>Era muy estrecha y oscura.</p>
        </div>
      `;

      const result = injectKindlePrimedAnchors(chapterHtml, [
        {
          lemma: "estrecho",
          surfaceForm: "estrecha",
          lang: "es",
          beta: 0.8,
          chapterFrequency: 2,
          shortGloss: "de poca anchura",
          contextSentence: "",
          utilityScore: 0.7,
        },
      ]);

      // Solo la primera aparición debe llevar el micro-anclaje
      expect(result).toContain(
        '<span style="border-bottom: 1.5px dashed #000; font-weight: 500;">estrecha</span> <small style="font-family: sans-serif; font-size: 0.78em;">[de poca anchura]</small>',
      );

      // La segunda aparición no debe duplicar la glosa
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

describe("Kindle Views - Seguridad y Escapado Anti-XSS", () => {
  it("escapa etiquetas HTML y scripts maliciosos en títulos y autores de libros", () => {
    const maliciousTitle = '<script>alert("XSS")</script>';
    const maliciousAuthor = '<img src=x onerror=alert(1)>';
    const html = renderHomeView({
      books: [
        {
          hash: "h1",
          title: maliciousTitle,
          author: maliciousAuthor,
          sections: 5,
        },
      ],
      user: { id: "u1", email: "attacker<script>@example.com" },
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("attacker<script>");
    expect(html).toContain("attacker&lt;script&gt;");
  });

  it("escapa entradas de búsqueda y notas de usuario en lookup", () => {
    const maliciousQuery = '"><b onmouseover="alert(1)">palabra</b>';
    const html = renderLookupView({
      query: maliciousQuery,
      entries: [],
      user: null,
    });

    expect(html).not.toContain('"><b onmouseover=');
    expect(html).toContain("&quot;&gt;&lt;b onmouseover=&quot;alert(1)&quot;&gt;palabra&lt;/b&gt;");
  });

  it("escapa títulos de capítulos y glosas en priming view", () => {
    const props: KindleChapterPrimingViewProps = {
      bookId: 'b1"><script>',
      bookTitle: 'Título <iframe src="evil.com">',
      chapterIndex: 0,
      chapterTitle: "Capítulo <svg onload=alert(1)>",
      bookLang: "es",
      isForeignLang: false,
      words: [
        {
          lemma: "lemma<script>",
          surfaceForm: "forma",
          lang: "es",
          beta: 1.0,
          chapterFrequency: 1,
          shortGloss: "Definición <script>alert(2)</script>",
          partOfSpeech: "sust.",
          contextSentence: "Oración de prueba <img src=x onerror=1>",
          utilityScore: 0.9,
        },
      ],
    };

    const html = renderKindleChapterPrimingView(props);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;iframe");
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  describe("Otras Vistas Kindle", () => {
    it("renderKindleCatSvg genera SVG para diferentes ánimos y objetos", () => {
      const svg = renderKindleCatSvg("happy", ["scarf"]);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
    });

    it("renderLoginView renderiza formulario de login con token CSRF", () => {
      const html = renderLoginView({ user: null, error: "Credenciales inválidas" });
      expect(html).toContain("Credenciales inválidas");
      expect(html).toContain("Iniciar sesión");
    });

    it("renderKindleLinkView muestra el código de vinculación y expiración", () => {
      const html = renderKindleLinkView({ code: "ABCD-1234" });
      expect(html).toContain("ABCD-1234");
      expect(html).toContain("Vincular Kindle");
    });

    it("renderPracticeView renderiza estado final y estado de sin palabras pendientes", () => {
      const finishedHtml = renderPracticeView({
        user: null,
        isFinished: true,
        correctCount: 3,
        totalQuestions: 3,
      });
      expect(finishedHtml).toContain("Completada");

      const emptyHtml = renderPracticeView({
        user: null,
        isFinished: false,
      });
      expect(emptyHtml).toContain("No hay palabras pendientes");
    });
  });

  describe("renderReaderView (Kindle Zero-Scroll & Ergonomía)", () => {
    const baseProps = {
      user: { id: "u1", email: "lector@kindle.test" },
      bookHash: "hash-kindle-1",
      bookTitle: "La Metamorfosis",
      bookAuthor: "Franz Kafka",
      chapterTitle: "Capítulo I",
      contentHtml: '<p><span class="w" data-w="gregor">Gregor</span> <span class="w" data-w="samsa">Samsa</span>.</p>',
      sectionIndex: 0,
      totalSections: 3,
      pageIndex: 0,
      totalPages: 5,
    };

    it("no inyecta el bloque de notas al pie cat-notes-box para asegurar 100% Zero-Scroll", () => {
      const html = renderReaderView({
        ...baseProps,
        gloss: false,
        catNotes: [
          {
            form: "perenne",
            lemma: "perenne",
            pos: "adj.",
            meaning: "Que dura indefinidamente.",
            noteIndex: 1,
            saved: false,
          },
        ],
      });
      expect(html).not.toContain("cat-notes-box");
      expect(html).not.toContain("Notas del Gato en esta página");
    });

    it("aplica por defecto layout-paged y respeta layout-scroll cuando se solicita", () => {
      const htmlPaged = renderReaderView(baseProps);
      expect(htmlPaged).toContain('class="reader-body layout-paged"');

      const htmlScroll = renderReaderView({ ...baseProps, layout: "scroll" });
      expect(htmlScroll).toContain('class="reader-body layout-scroll"');
    });

    it("incluye el interruptor [ 🔍 Consultar ] y la barra inferior compacta turn-page-bar", () => {
      const html = renderReaderView(baseProps);
      expect(html).toContain('id="lookupToggle"');
      expect(html).toContain("[ 🔍 Consultar ]");
      expect(html).toContain("turn-page-bar");
      expect(html).toContain("[ ← Ant. ]");
      expect(html).toContain("[ Sig. → ]");
    });

    it("inyecta el script ultraligero para long-press (450ms) y tap zones laterales", () => {
      const html = renderReaderView(baseProps);
      expect(html).toContain("<script>");
      expect(html).toContain("450");
      expect(html).toContain("lookup-active");
      expect(html).toContain("0.25");
      expect(html).toContain("window.getSelection");
    });
  });
});
