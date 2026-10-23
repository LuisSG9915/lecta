// @vitest-environment jsdom
// Pruebas de la navegación del lector (extraída de Reader.tsx): coordinador de
// saltos, atajo intra-sección, identidad estable y paso de página con sus bordes.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReaderNavigation,
  useReaderPagination,
  type UseReaderNavigationOptions,
  type UseReaderPaginationOptions,
} from "./useReaderNavigation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  isTtsProgrammaticNav: vi.fn(() => false),
  pageForFragment: vi.fn(),
  scrollToFragment: vi.fn(),
  targetAt: vi.fn(() => ({ id: "t1" })),
  buildPostChapterConsolidationQueue: vi.fn<
    (candidates: unknown, prefs: unknown, isL2: boolean, options: unknown) => unknown[]
  >(() => []),
  isConsolidationActive: vi.fn(() => false),
  loadPostChapterConsolidationPrefs: vi.fn(() => ({})),
  isFeatureFlagEnabled: vi.fn<(flag: string) => boolean>(() => false),
  loadNativeLanguage: vi.fn(() => "es"),
  evaluateReadingFatigue: vi.fn(),
  loadFocusTelemetryProfile: vi.fn(() => ({})),
  saveFocusTelemetryProfile: vi.fn(),
  recordChapterCompleted: vi.fn(),
  getBookLanguage: vi.fn(() => "es"),
}));

vi.mock("../lib/ttsGuards", async (orig) => ({
  ...(await orig<typeof import("../lib/ttsGuards")>()),
  isTtsProgrammaticNav: mocks.isTtsProgrammaticNav,
}));
vi.mock("../lib/pagination", async (orig) => ({
  ...(await orig<typeof import("../lib/pagination")>()),
  pageForFragment: mocks.pageForFragment,
}));
vi.mock("../lib/reading-location", async (orig) => ({
  ...(await orig<typeof import("../lib/reading-location")>()),
  scrollToFragment: mocks.scrollToFragment,
}));
vi.mock("../lib/chapters", async (orig) => ({
  ...(await orig<typeof import("../lib/chapters")>()),
  targetAt: mocks.targetAt,
}));
vi.mock("../lib/practice", async (orig) => ({
  ...(await orig<typeof import("../lib/practice")>()),
  buildPostChapterConsolidationQueue: mocks.buildPostChapterConsolidationQueue,
  isConsolidationActive: mocks.isConsolidationActive,
  loadPostChapterConsolidationPrefs: mocks.loadPostChapterConsolidationPrefs,
}));
vi.mock("../lib/settings", async (orig) => ({
  ...(await orig<typeof import("../lib/settings")>()),
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
  loadNativeLanguage: mocks.loadNativeLanguage,
}));
vi.mock("../lib/focus-telemetry", async (orig) => ({
  ...(await orig<typeof import("../lib/focus-telemetry")>()),
  evaluateReadingFatigue: mocks.evaluateReadingFatigue,
  loadFocusTelemetryProfile: mocks.loadFocusTelemetryProfile,
  saveFocusTelemetryProfile: mocks.saveFocusTelemetryProfile,
}));
vi.mock("../lib/profile-models", async (orig) => ({
  ...(await orig<typeof import("../lib/profile-models")>()),
  recordChapterCompleted: mocks.recordChapterCompleted,
}));
vi.mock("../lib/epub", async (orig) => ({
  ...(await orig<typeof import("../lib/epub")>()),
  getBookLanguage: mocks.getBookLanguage,
}));

const navOptions = (
  over: Partial<UseReaderNavigationOptions> = {},
): UseReaderNavigationOptions => ({
  loadSection: vi.fn(async () => undefined),
  evaluatePreparation: vi.fn(async () => undefined),
  setPageIdx: vi.fn(),
  setActiveScrollFragment: vi.fn(),
  activeScrollFragRef: { current: null },
  catalogRef: { current: { ranges: [] } as never },
  containerRef: { current: document.createElement("div") },
  layoutRef: { current: "scroll" },
  metricsRef: { current: null },
  navIntentRef: { current: "initial" },
  sectionIndexRef: { current: 2 },
  stateRef: { current: "ready" },
  ttsStopOnNavRef: { current: null },
  ...over,
});

describe("useReaderNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api!: ReturnType<typeof useReaderNavigation>;

  function Probe({ options }: { options: UseReaderNavigationOptions }) {
    api = useReaderNavigation(options);
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    mocks.isTtsProgrammaticNav.mockReturnValue(false);
    mocks.targetAt.mockReturnValue({ id: "t1" });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (opts: UseReaderNavigationOptions) =>
    act(() => {
      root.render(h(Probe, { options: opts }));
    });

  it("mantiene la identidad de navigate entre renders", () => {
    render(navOptions());
    const first = api.navigate;
    render(navOptions());
    expect(api.navigate).toBe(first);
  });

  it("registra la intención y corta la voz salvo navegación programática", async () => {
    const stop = vi.fn();
    const opts = navOptions({ ttsStopOnNavRef: { current: stop } });
    render(opts);
    await act(async () => {
      await api.navigate("lookup", { index: 3 });
    });
    expect(opts.navIntentRef.current).toBe("lookup");
    expect(stop).toHaveBeenCalledTimes(1);

    mocks.isTtsProgrammaticNav.mockReturnValue(true);
    await act(async () => {
      await api.navigate("lookup", { index: 3 });
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("en la misma sección con fragmento no recarga: salta al fragmento", async () => {
    const opts = navOptions({ layoutRef: { current: "scroll" } });
    render(opts);
    await act(async () => {
      await api.navigate("chapter", { index: 2, fragment: "f1" });
    });
    expect(opts.loadSection).not.toHaveBeenCalled();
    expect(mocks.scrollToFragment).toHaveBeenCalledWith(opts.containerRef.current, "f1");
    expect(opts.activeScrollFragRef.current).toBe("f1");
    expect(opts.setActiveScrollFragment).toHaveBeenCalledWith("f1");
    expect(opts.evaluatePreparation).toHaveBeenCalledWith(2, "enter", "t1");
  });

  it("en modo páginas lleva la misma sección a la página del fragmento", async () => {
    mocks.pageForFragment.mockReturnValue(4);
    const opts = navOptions({ layoutRef: { current: "pages" }, metricsRef: { current: {} as never } });
    render(opts);
    await act(async () => {
      await api.navigate("initial", { index: 2, fragment: "f1" });
    });
    expect(opts.setPageIdx).toHaveBeenCalledWith(4, true);
    expect(mocks.scrollToFragment).not.toHaveBeenCalled();
  });

  it("carga la sección y evalúa la preparación al terminar", async () => {
    let resolveLoad: () => void = () => {};
    const loadSection = vi.fn(
      () => new Promise<void>((res) => { resolveLoad = () => res(); }),
    );
    const opts = navOptions({ loadSection });
    opts.sectionIndexRef = { current: 2 };
    render(opts);
    let pending!: Promise<unknown>;
    act(() => {
      pending = api.navigate("chapter", { index: 5, restore: { ratio: 0.3 } });
    });
    expect(loadSection).toHaveBeenCalledWith(5, { ratio: 0.3 });
    opts.sectionIndexRef.current = 5;
    await act(async () => {
      resolveLoad();
      await pending;
    });
    expect(opts.evaluatePreparation).toHaveBeenCalledWith(5, "enter", "t1");
  });
});

describe("useReaderPagination", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api!: ReturnType<typeof useReaderPagination>;

  function Probe({ options }: { options: UseReaderPaginationOptions }) {
    api = useReaderPagination(options);
    return null;
  }

  const pageOptions = (
    over: Partial<UseReaderPaginationOptions> = {},
  ): UseReaderPaginationOptions => ({
    navigate: vi.fn(async () => undefined),
    checkPassiveExposure: vi.fn(),
    noteActivity: vi.fn(),
    saveSoon: vi.fn(),
    trackMove: vi.fn(),
    showNotice: vi.fn(),
    signalCompanion: vi.fn(),
    setPageIdx: vi.fn(),
    setBarsVisible: vi.fn(),
    setDeepSummary: vi.fn(),
    setFatigueSuggestion: vi.fn(),
    setPostChapterQueue: vi.fn(),
    bookHash: "book-1",
    language: "es",
    sectionWords: 100,
    sectionTotal: 4,
    bookRef: { current: null },
    pageRef: { current: 1 },
    pageCountRef: { current: 5 },
    sectionIndexRef: { current: 1 },
    pageTurnTimeRef: { current: Date.now() },
    sessionStartRef: { current: Date.now() },
    chapterStartedAtRef: { current: Date.now() },
    pendingNextChapterRef: { current: null },
    currentChapterLookups: { current: [] },
    currentChapterPrimedWordsRef: { current: [] },
    focusTelemetryRef: { current: { recordPageTurn: () => false } },
    settingsRef: { current: null },
    ...over,
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    mocks.isFeatureFlagEnabled.mockReturnValue(false);
    mocks.buildPostChapterConsolidationQueue.mockReturnValue([]);
    mocks.isConsolidationActive.mockReturnValue(false);
    mocks.evaluateReadingFatigue.mockReturnValue({
      updatedProfile: {},
      isFatigued: false,
      reason: "none",
      recommendedAid: "focus-ruler",
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (opts: UseReaderPaginationOptions) =>
    act(() => {
      root.render(h(Probe, { options: opts }));
    });

  it("mantiene la identidad de goPage entre renders", () => {
    render(pageOptions());
    const first = api.goPage;
    render(pageOptions());
    expect(api.goPage).toBe(first);
  });

  it("avanza página dentro de la sección y oculta las barras", async () => {
    const opts = pageOptions();
    render(opts);
    await act(async () => {
      await api.goPage(1);
    });
    expect(opts.noteActivity).toHaveBeenCalled();
    expect(opts.trackMove).toHaveBeenCalledWith(false);
    expect(opts.checkPassiveExposure).toHaveBeenCalled();
    expect(opts.setBarsVisible).toHaveBeenCalledWith(false);
    expect(opts.setPageIdx).toHaveBeenCalledWith(2);
    expect(opts.saveSoon).toHaveBeenCalled();
    expect(opts.navigate).not.toHaveBeenCalled();
  });

  it("en el borde vuelve a la sección anterior por el final", async () => {
    const opts = pageOptions({ pageRef: { current: 0 } });
    render(opts);
    await act(async () => {
      await api.goPage(-1);
    });
    expect(opts.navigate).toHaveBeenCalledWith("chapter", {
      index: 0,
      restore: { at: "end" },
    });
    expect(opts.setPageIdx).not.toHaveBeenCalled();
  });

  it("en la primera página de la primera sección no navega", async () => {
    const opts = pageOptions({ pageRef: { current: 0 }, sectionIndexRef: { current: 0 } });
    render(opts);
    await act(async () => {
      await api.goPage(-1);
    });
    expect(opts.navigate).not.toHaveBeenCalled();
    expect(opts.trackMove).toHaveBeenCalledWith(true);
  });

  it("al terminar la sección cierra el capítulo y pasa a la siguiente", async () => {
    const opts = pageOptions({ pageRef: { current: 4 } });
    render(opts);
    await act(async () => {
      await api.goPage(1);
    });
    expect(mocks.recordChapterCompleted).toHaveBeenCalledWith("es");
    expect(opts.signalCompanion).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "goal_completed" }),
    );
    expect(opts.navigate).toHaveBeenCalledWith("chapter", { index: 2 });
  });

  it("si hay cola de consolidación, la abre en vez de navegar", async () => {
    mocks.isFeatureFlagEnabled.mockImplementation((flag: string) => flag === "vocabGames");
    mocks.buildPostChapterConsolidationQueue.mockReturnValue([
      { item: { lemma: "casa" }, modality: "recognition" },
    ]);
    mocks.isConsolidationActive.mockReturnValue(true);
    const opts = pageOptions({ pageRef: { current: 4 } });
    render(opts);
    await act(async () => {
      await api.goPage(1);
    });
    expect(opts.setPostChapterQueue).toHaveBeenCalled();
    expect(opts.pendingNextChapterRef.current).toBe(2);
    expect(opts.setDeepSummary).toHaveBeenCalledWith(
      expect.objectContaining({ completedNaturally: true, sectionsRead: 1 }),
    );
    expect(opts.navigate).not.toHaveBeenCalled();
  });

  it("avisa de la guía visual cuando la telemetría lo pide", async () => {
    mocks.isFeatureFlagEnabled.mockImplementation((flag: string) => flag === "focusTelemetry");
    mocks.evaluateReadingFatigue.mockReturnValue({
      updatedProfile: {},
      isFatigued: false,
      reason: "none",
      recommendedAid: "focus-ruler",
    });
    const opts = pageOptions({
      focusTelemetryRef: { current: { recordPageTurn: () => true } },
      settingsRef: { current: { bionicAnchors: false } as never },
    });
    render(opts);
    await act(async () => {
      await api.goPage(1);
    });
    expect(mocks.saveFocusTelemetryProfile).toHaveBeenCalled();
    expect(opts.showNotice).toHaveBeenCalledWith(
      "¿Pasaje denso? Puedes activar la «Guía visual de sílabas» en el menú Aa.",
    );
  });
});
