// @vitest-environment jsdom
// Pruebas del cargador de sección (extraído de Reader.tsx): pintado, estado de
// paginación, restauración de posición, dwell y camino de error.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReaderSectionLoader,
  type UseReaderSectionLoaderOptions,
} from "./useReaderSectionLoader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getBookLanguage: vi.fn(() => "es"),
  hydrateSectionImages: vi.fn(),
  stripSoftHyphens: vi.fn(),
  sanitizeSectionDocument: vi.fn(),
  markWords: vi.fn(),
  applySyntacticLines: vi.fn(),
  countWords: vi.fn(() => 42),
  scrollToAnchor: vi.fn(() => false),
  scrollToFragment: vi.fn(() => false),
  scrollToSnippet: vi.fn(() => false),
  saveBookPosition: vi.fn(async () => {}),
  captureDbScope: vi.fn(() => ({})),
  targetAt: vi.fn(() => null),
}));

vi.mock("../lib/epub", async (orig) => ({
  ...(await orig<typeof import("../lib/epub")>()),
  getBookLanguage: mocks.getBookLanguage,
  hydrateSectionImages: mocks.hydrateSectionImages,
  stripSoftHyphens: mocks.stripSoftHyphens,
}));
vi.mock("../lib/sanitize", async (orig) => ({
  ...(await orig<typeof import("../lib/sanitize")>()),
  sanitizeSectionDocument: mocks.sanitizeSectionDocument,
}));
vi.mock("../lib/marks", async (orig) => ({
  ...(await orig<typeof import("../lib/marks")>()),
  markWords: mocks.markWords,
}));
vi.mock("../lib/syntactic-lines", async (orig) => ({
  ...(await orig<typeof import("../lib/syntactic-lines")>()),
  applySyntacticLines: mocks.applySyntacticLines,
}));
vi.mock("../lib/progress", async (orig) => ({
  ...(await orig<typeof import("../lib/progress")>()),
  countWords: mocks.countWords,
}));
vi.mock("../lib/reading-location", async (orig) => ({
  ...(await orig<typeof import("../lib/reading-location")>()),
  scrollToAnchor: mocks.scrollToAnchor,
  scrollToFragment: mocks.scrollToFragment,
  scrollToSnippet: mocks.scrollToSnippet,
}));
vi.mock("../lib/idb", async (orig) => ({
  ...(await orig<typeof import("../lib/idb")>()),
  saveBookPosition: mocks.saveBookPosition,
  captureDbScope: mocks.captureDbScope,
}));
vi.mock("../lib/chapters", async (orig) => ({
  ...(await orig<typeof import("../lib/chapters")>()),
  targetAt: mocks.targetAt,
}));

describe("useReaderSectionLoader", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api!: ReturnType<typeof useReaderSectionLoader>;
  let scrollTo: ReturnType<typeof vi.fn>;

  function Probe({ options }: { options: UseReaderSectionLoaderOptions }) {
    api = useReaderSectionLoader(options);
    return null;
  }

  const loaderOptions = (
    over: Partial<UseReaderSectionLoaderOptions> = {},
  ): UseReaderSectionLoaderOptions => ({
    onError: vi.fn(),
    language: "es",
    setState: vi.fn(),
    setSelection: vi.fn(),
    setActiveScrollFragment: vi.fn(),
    setPage: vi.fn(),
    setPageCount: vi.fn(),
    setPrediction: vi.fn(),
    setScrollRatio: vi.fn(),
    setSectionHasImages: vi.fn(),
    setSectionIndex: vi.fn(),
    setSectionTitle: vi.fn(),
    setSectionWords: vi.fn(),
    setShowChapterTitle: vi.fn(),
    setAnalyzing: vi.fn(),
    activeScrollFragRef: { current: null },
    analyzingTargets: { current: new Set<string>() },
    bookRef: { current: null },
    catalogRef: { current: null },
    chapterStartedAtRef: { current: 0 },
    containerRef: { current: null },
    currentChapterLookups: { current: [] },
    imgUrlsRef: { current: [] },
    layoutRef: { current: "scroll" },
    loadBlobRef: { current: null },
    pageAnchorRef: { current: null },
    pageCountRef: { current: 1 },
    pageRef: { current: 0 },
    pendingPageRef: { current: null },
    savedForms: { current: new Map() },
    sectionIndexRef: { current: 0 },
    sectionTextRef: { current: "" },
    sectionTiming: { current: null },
    settingsRef: { current: null },
    tocRowsRef: { current: [] },
    capturePosition: vi.fn(() => null),
    classifyCached: vi.fn(() => null),
    computeMetrics: vi.fn(() => null),
    currentRatioNow: vi.fn(() => 0),
    finalizeTiming: vi.fn(() => null),
    trackEvent: vi.fn(),
    analyzeSection: vi.fn(async () => {}),
    triggerL2Precache: vi.fn(),
    ...over,
  });

  const section = (options: { fail?: boolean } = {}) => ({
    createDocument: async () => {
      if (options.fail) throw new Error("boom");
      return document.implementation.createHTMLDocument("sec");
    },
  });

  const book = (options: { fail?: boolean; sections?: number } = {}) =>
    ({
      language: "es",
      sections: Array.from({ length: options.sections ?? 1 }, () => section(options)),
    }) as never;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    mocks.sanitizeSectionDocument.mockImplementation(() => {
      const el = document.createElement("div");
      el.innerHTML = "<p>hola mundo</p>";
      return el;
    });
    mocks.countWords.mockReturnValue(42);
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as never;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as never;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (opts: UseReaderSectionLoaderOptions) =>
    act(() => {
      root.render(h(Probe, { options: opts }));
    });

  it("no toca nada sin libro, sección o contenedor", async () => {
    const opts = loaderOptions();
    render(opts);
    await act(async () => {
      await api.loadSection(0);
    });
    expect(opts.setState).not.toHaveBeenCalled();
    expect(opts.setSectionIndex).not.toHaveBeenCalled();
  });

  it("pinta la sección y deja el lector listo", async () => {
    const opts = loaderOptions({
      bookRef: { current: book() },
      containerRef: { current: document.createElement("div") },
      tocRowsRef: { current: [{ label: "Cap. 2", index: 0, depth: 0, target: {} as never }] },
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0);
    });
    expect(opts.setState).toHaveBeenNthCalledWith(1, "opening");
    expect(opts.setState).toHaveBeenLastCalledWith("ready");
    expect(opts.containerRef.current?.innerHTML).toContain("hola mundo");
    expect(opts.setSectionIndex).toHaveBeenCalledWith(0);
    expect(opts.sectionIndexRef.current).toBe(0);
    expect(opts.setSectionWords).toHaveBeenCalledWith(42);
    expect(opts.sectionTextRef.current).toContain("hola mundo");
    expect(opts.setSectionTitle).toHaveBeenCalledWith("Cap. 2");
    expect(opts.setShowChapterTitle).toHaveBeenCalledWith(true);
    expect(opts.setPrediction).toHaveBeenCalledWith(null);
    expect(opts.pageRef.current).toBe(0);
    expect(opts.pageCountRef.current).toBe(1);
    expect(opts.analyzeSection).toHaveBeenCalledWith(0, expect.stringContaining("hola mundo"));
    expect(opts.triggerL2Precache).toHaveBeenCalledWith(0, 1, "es");
  });

  it("restaura la fracción guardada al pintar en scroll", async () => {
    const opts = loaderOptions({
      bookRef: { current: book() },
      containerRef: { current: document.createElement("div") },
      capturePosition: vi.fn(() => ({
        bookHash: "b",
        sectionIndex: 0,
        scrollTop: 10,
        ratio: 0.5,
        progress: 0.1,
        updatedAt: 1,
      })),
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0, { ratio: 0.5 });
    });
    expect(scrollTo).toHaveBeenCalled();
    expect(opts.sectionTiming.current).not.toBeNull();
    expect(mocks.saveBookPosition).toHaveBeenCalled();
  });

  it("en modo páginas deja la restauración pendiente del recuento", async () => {
    const restore = { ratio: 0.4 };
    const opts = loaderOptions({
      bookRef: { current: book() },
      containerRef: { current: document.createElement("div") },
      layoutRef: { current: "pages" },
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0, restore);
    });
    expect(opts.pendingPageRef.current).toEqual(restore);
    expect(opts.computeMetrics).toHaveBeenCalled();
    expect(mocks.saveBookPosition).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("registra el dwell de la sección que se deja", async () => {
    const opts = loaderOptions({
      bookRef: { current: book() },
      containerRef: { current: document.createElement("div") },
      finalizeTiming: vi.fn(() => ({ ms: 20_000, words: 120 })),
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0);
    });
    expect(opts.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "section_dwell", ms: 20_000, words: 120 }),
    );
  });

  it("no registra dwells fuera de la barra de credibilidad", async () => {
    const opts = loaderOptions({
      bookRef: { current: book() },
      containerRef: { current: document.createElement("div") },
      finalizeTiming: vi.fn(() => ({ ms: 10, words: 2 })),
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0);
    });
    expect(opts.trackEvent).not.toHaveBeenCalled();
  });

  it("cambia de capítulo y reinicia los lookups", async () => {
    const opts = loaderOptions({
      bookRef: { current: book({ sections: 2 }) },
      containerRef: { current: document.createElement("div") },
      sectionIndexRef: { current: 0 },
      currentChapterLookups: { current: [{ lemma: "casa" } as never] },
    });
    render(opts);
    await act(async () => {
      await api.loadSection(1);
    });
    expect(opts.currentChapterLookups.current).toEqual([]);
    expect(opts.chapterStartedAtRef.current).toBeGreaterThan(0);
  });

  it("marca error y avisa cuando la sección no se puede abrir", async () => {
    const opts = loaderOptions({
      bookRef: { current: book({ fail: true }) },
      containerRef: { current: document.createElement("div") },
    });
    render(opts);
    await act(async () => {
      await api.loadSection(0);
    });
    expect(opts.setState).toHaveBeenLastCalledWith("error");
    expect(opts.onError).toHaveBeenCalledWith("No pudimos abrir esta sección del libro.");
  });
});
