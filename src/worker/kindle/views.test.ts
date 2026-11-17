import { describe, it, expect } from "vitest";
import {
  renderKindleChapterPrimingView,
  renderHomeView,
  renderLookupView,
  renderKindleCatSvg,
  renderLoginView,
  renderKindleLinkView,
  renderPracticeView,
  renderReaderView,
  renderKindleSettingsView,
  renderKindleTocView,
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
      expect(html).toContain("Ya la sé");
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

    it("renderPracticeView renderiza la cita episódica original cuando está disponible", () => {
      const html = renderPracticeView({
        user: null,
        isFinished: false,
        question: {
          word: "perenne",
          lemma: "perenne",
          pos: "adj.",
          contextSentence: "El bosque mantenía un verde perenne en invierno.",
          options: [
            { key: "A", text: "Que dura siempre.", correct: true },
            { key: "B", text: "Que se marchita pronto.", correct: false },
            { key: "C", text: "Que es transparente.", correct: false },
          ],
          questionIndex: 0,
          totalQuestions: 1,
        },
      });
      expect(html).toContain('class="practice-episodic-quote"');
      expect(html).toContain("El bosque mantenía un verde perenne en invierno.");
    });

    it("K6: renderKindleTocView lista las secciones y marca la actual", () => {
      const html = renderKindleTocView({
        user: null,
        bookHash: "h1",
        bookTitle: "Azul",
        bookAuthor: "Rubén Darío",
        toc: [
          { title: "Preludio", sectionIndex: 0 },
          { title: "Sonata", sectionIndex: 2 },
        ],
        currentSection: 2,
        querySuffix: "&amp;mode=clean",
        backUrl: "/k/read/h1?section=2&page=0",
      });
      expect(html).toContain(">Índice</h1>");
      expect(html).toContain("Preludio");
      expect(html).toContain("Sonata");
      expect(html).toContain("is-current");
      expect(html).toContain("section=0&amp;page=0");
      expect(html).toContain("section=2&amp;page=0");
      expect(html).toContain("Volver al libro");
    });

    it("K6: renderKindleTocView sin nav/NCX muestra aviso amable", () => {
      const html = renderKindleTocView({
        user: null,
        bookHash: "h1",
        bookTitle: "Libro sin índice",
        bookAuthor: "Autor",
        toc: [],
        currentSection: 0,
        querySuffix: "",
        backUrl: "/k/read/h1?section=0&page=0",
      });
      expect(html).toContain("no trae índice navegable");
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

    it("las tarjetas dict-card van ocultas por defecto (display:none)", () => {
      const html = renderReaderView({
        ...baseProps,
        dictCardsHtml: '<div class="dict-card" id="dict-perenne">glosa</div>',
      });
      expect(html).toContain('class="dict-card"');
      expect(html).toContain(".dict-card {");
      expect(html).toContain("display: none;");
    });

    it("no inyecta bloques de vocabulario ni notas por página para asegurar 100% Zero-Scroll", () => {
      const html = renderReaderView(baseProps);
      expect(html).not.toContain("cat-notes-box");
      expect(html).not.toContain("Notas del Gato en esta página");
      expect(html).not.toContain("page-vocab-box");
      expect(html).not.toContain("quick-lookup-box");
    });

    it("aplica por defecto layout-paged y respeta layout-scroll cuando se solicita", () => {
      const htmlPaged = renderReaderView(baseProps);
      expect(htmlPaged).toContain('class="reader-body layout-paged"');

      const htmlScroll = renderReaderView({ ...baseProps, layout: "scroll" });
      expect(htmlScroll).toContain('class="reader-body layout-scroll"');
    });

    it("K6: muestra el enlace «Índice» solo cuando llega tocUrl", () => {
      const sinToc = renderReaderView(baseProps);
      expect(sinToc).not.toContain(">Índice</a>");

      const conToc = renderReaderView({
        ...baseProps,
        tocUrl: "/k/read/hash-kindle-1?section=0&toc=1",
      });
      expect(conToc).toContain(">Índice</a>");
      expect(conToc).toContain("section=0&amp;toc=1");
      // Acciones secundarias movidas dentro del menú, fuera de la barra
      expect(conToc).toContain("Aa · Menú");
      expect(conToc).toContain(">Antes de leer</a>");
      expect(conToc).toContain(">Práctica</a>");
    });

    it("incluye el interruptor [ Consultar ] y la barra inferior compacta turn-page-bar", () => {
      const html = renderReaderView(baseProps);
      expect(html).toContain('id="lookupToggle"');
      expect(html).toContain('aria-pressed="false">Consultar</button>');
      expect(html).not.toContain("🔍");
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

    it("aplica la clase margin al contenedor y renderiza el selector de márgenes en el menú Aa", () => {
      const htmlDefault = renderReaderView(baseProps);
      expect(htmlDefault).toContain('class="reader-container margin-md"');
      expect(htmlDefault).toContain("Margen:");
      expect(htmlDefault).toContain("margin-selector");
      expect(htmlDefault).toContain("margin=sm");
      expect(htmlDefault).toContain("margin=md");
      expect(htmlDefault).toContain("margin=lg");
      expect(htmlDefault).toContain("Estrecho");
      expect(htmlDefault).toContain("Normal");
      expect(htmlDefault).toContain("Amplio");

      const htmlSm = renderReaderView({ ...baseProps, margin: "sm" });
      expect(htmlSm).toContain('class="reader-container margin-sm"');
      expect(htmlSm).toMatch(/margin=sm[^>]*class="size-btn is-active"/);

      const htmlLg = renderReaderView({ ...baseProps, margin: "lg" });
      expect(htmlLg).toContain('class="reader-container margin-lg"');
      expect(htmlLg).toMatch(/margin=lg[^>]*class="size-btn is-active"/);
    });

    it("preserva el parámetro margin en cleanPageUrl, enlaces del menú y script de zonas táctiles", () => {
      const html = renderReaderView({ ...baseProps, margin: "lg" });
      expect(html).toContain("&amp;margin=lg");
      expect(html).toContain("margin=lg");
      expect(html).toContain('var lookupBase = "/k/read/hash-kindle-1?section=0&page=0&mode=clean&size=md&layout=paged&margin=lg');
    });

    it("renderiza inline-lookup-backdrop, card role=dialog y campo context en reader view", () => {
      const html = renderReaderView({
        ...baseProps,
        user: { id: "u1", email: "test@example.com", name: "Lector" },
        lookupResult: {
          word: "perenne",
          entries: [
            {
              entryId: "e1",
              lemma: "perenne",
              pos: "adj.",
              freqRank: null,
              zipf: 3.5,
              senses: [{ definition: "Que dura indefinidamente.", example: "Hojas perennes", senseOrder: 1 }],
            },
          ],
          contextSentence: "La casa antigua tenía un jardín perenne.",
        },
      });
      expect(html).toContain('class="inline-lookup-backdrop"');
      expect(html).toContain('class="inline-lookup-close"');
      expect(html).toContain('class="inline-lookup-card" role="dialog"');
      expect(html).toContain('<input type="hidden" name="context" value="La casa antigua tenía un jardín perenne."');
    });

    it("incluye einkRefreshOverlay, reseteo de forma de onda y gestos de swipe en reader view", () => {
      const html = renderReaderView(baseProps);
      expect(html).toContain('id="einkRefreshOverlay" class="eink-refresh-overlay"');
      expect(html).toContain("runEinkWaveformReset");
      expect(html).toContain("lecta_eink_turns");
      expect(html).toContain("changedTouches");
    });

    it("ancla la caja al alto visible real y evita recortar el último renglón", () => {
      const html = renderReaderView(baseProps);
      // El navegador del Kindle declara un viewport más alto que el área
      // que su barra inferior deja libre: la vista se ajusta a la medida
      // más conservadora y la página reduce su letra antes de recortar.
      expect(html).toContain("window.visualViewport");
      expect(html).toContain("visibleH");
      expect(html).toContain("container.style.height = visibleH + 'px'");
      expect(html).toContain("scrollHeight > content.clientHeight");
      expect(html).toContain("content.style.fontSize");
      // Reserva progresiva de viewport dinámico y tope de figuras.
      expect(html).toContain("height: 100dvh");
      expect(html).toContain("max-height: calc(100dvh - 82px)");
      expect(html).toContain(".epub-content img");
      expect(html).toContain("max-height: 100%");
    });
  });

  describe("K3 — Tipografía, interlineado, alineación y enfoques", () => {
    const k3Props = {
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

    it("declara @font-face autoalojados para las 4 tipografías en /fonts/", () => {
      const html = renderReaderView(k3Props);
      for (const f of [
        "/fonts/literata-latin-standard-normal.woff2",
        "/fonts/source-serif-4-latin-opsz-normal.woff2",
        "/fonts/atkinson-next-latin-400-normal.woff2",
        "/fonts/opendyslexic-latin-400-normal.woff2",
      ]) {
        expect(html).toContain(f);
      }
      expect(html).toContain("@font-face");
      expect(html).toContain("font-display: swap");
    });

    it("aplica las clases font-*, lh-* y align-* según las preferencias", () => {
      const html = renderReaderView({
        ...k3Props,
        fontFamily: "atkinson",
        lineHeight: "loose",
        align: "left",
        size: "xxl",
        mode: "anchors",
      });
      expect(html).toContain("font-atkinson");
      expect(html).toContain("lh-loose");
      expect(html).toContain("align-left");
      expect(html).toContain("size-xxl");
      expect(html).toContain("mode-anchors");
    });

    it("expone los tres enfoques con sus nombres de producto", () => {
      const html = renderReaderView(k3Props);
      expect(html).toContain("[ Limpio ]");
      expect(html).toContain("[ Párrafos aireados ]");
      expect(html).toContain("[ Anclas de lectura ]");
      expect(html).not.toContain("Modo Léxico");
    });

    it("enlaza al formulario completo de ajustes desde el menú del lector", () => {
      const html = renderReaderView(k3Props);
      expect(html).toContain("/k/ajustes?returnTo=");
      expect(html).toContain("Todos los ajustes (Aa)");
    });

    it("los tamaños llegan a xxl y el interlineado es configurable", () => {
      const html = renderReaderView(k3Props);
      expect(html).toContain(".epub-content.size-xxl");
      expect(html).toContain(".epub-content.lh-compact");
      expect(html).toContain(".epub-content.lh-normal");
      expect(html).toContain(".epub-content.lh-loose");
      expect(html).toContain(".epub-content.align-justify");
      expect(html).toContain(".epub-content.align-left");
    });

    it("el enfoque anchors no usa animaciones ni efectos de parpadeo", () => {
      const html = renderReaderView({ ...k3Props, mode: "anchors" });
      expect(html).toContain(".epub-content.mode-anchors .w .anc");
      expect(html).toContain("font-weight: bold");
      expect(html).not.toContain("mode-anchors .w .anc {\n    animation");
    });
  });

  describe("renderKindleSettingsView (K2)", () => {
    it("renderiza selects con los valores actuales marcados y escapea returnTo", () => {
      const html = renderKindleSettingsView({
        prefs: {
          fontFamily: "opendyslexic",
          fontSize: "xl",
          lineHeight: "compact",
          margin: "lg",
          align: "left",
          approach: "anchors",
          layout: "scroll",
        },
        returnTo: '/k/read/abc" onclick="evil()',
        saved: true,
      });
      expect(html).toContain('value="opendyslexic" selected');
      expect(html).toContain('value="xl" selected');
      expect(html).toContain('value="scroll" selected');
      expect(html).toContain("Ajustes guardados");
      // returnTo va escapado en el hidden input
      expect(html).not.toContain('returnTo" value="/k/read/abc" onclick');
      expect(html).toContain("abc&quot; onclick=&quot;evil()");
    });

    it("muestra el mensaje de error cuando el guardado falla", () => {
      const html = renderKindleSettingsView({
        prefs: undefined,
        error: "No pudimos guardar los ajustes ahora.",
      });
      expect(html).toContain("No pudimos guardar los ajustes ahora.");
      expect(html).toContain('value="literata" selected'); // defaults
    });
  });
});
