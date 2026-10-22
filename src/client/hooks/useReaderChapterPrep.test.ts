// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldAutoShowPreview,
  markSectionPreviewed,
  useReaderChapterPrep,
  type UseReaderChapterPrepOptions,
} from "./useReaderChapterPrep";
import { DEFAULT_SETTINGS, type ReaderSettings } from "../lib/settings";
import type { ChapterCatalog } from "../lib/chapters";
import type { ChapterAnalyzer } from "../lib/chapter-analysis";
import type { DbScope } from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prefetchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/offline-dictionary", () => ({
  planPredictiveChapterPrecache: vi.fn(() => [1, 2, 3]),
  prefetchUpcomingChaptersLexicon: (...args: unknown[]) => prefetchMock(...args),
}));

const isFeatureFlagEnabledMock = vi.fn((..._args: unknown[]) => true);
const isPrimingMutedMock = vi.fn((..._args: unknown[]) => false);

vi.mock("../lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/settings")>();
  return {
    ...actual,
    loadNativeLanguage: vi.fn(() => "es"),
    isFeatureFlagEnabled: (flag: string) => isFeatureFlagEnabledMock(flag),
    isPrimingMutedForBook: (id: string) => isPrimingMutedMock(id),
  };
});

describe("useReaderChapterPrep", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  describe("shouldAutoShowPreview & markSectionPreviewed", () => {
    it("devuelve false si chapterPreviewMode es 'off'", () => {
      expect(shouldAutoShowPreview("off", "book1", 0, 80, 5)).toBe(false);
    });

    it("devuelve false si unknownKeyWordsCount es 0 o negativo", () => {
      expect(shouldAutoShowPreview("on", "book1", 0, 80, 0)).toBe(false);
      expect(shouldAutoShowPreview("on", "book1", 0, 80, -1)).toBe(false);
    });

    it("devuelve true si hay palabras desconocidas y no se ha marcado como visto", () => {
      expect(shouldAutoShowPreview("on", "book1", 0, 80, 4)).toBe(true);
    });

    it("devuelve false si la sección ya fue marcada como vista", () => {
      markSectionPreviewed("book1", 2);
      expect(shouldAutoShowPreview("on", "book1", 2, 80, 4)).toBe(false);
    });
  });

  describe("hook useReaderChapterPrep", () => {
    const baseSettings: ReaderSettings = { ...DEFAULT_SETTINGS };

    function renderPrep(overrides?: Partial<UseReaderChapterPrepOptions>) {
      let hookResult!: ReturnType<typeof useReaderChapterPrep>;

      const defaultOptions: UseReaderChapterPrepOptions = {
        bookHash: "book-test-hash",
        bookRef: { current: null },
        catalogRef: { current: { ranges: [], targets: [] } as unknown as ChapterCatalog },
        analyzerRef: { current: null },
        language: "en",
        sectionIndexRef: { current: 0 },
        settingsRef: { current: baseSettings },
        tocRowsRef: { current: [] },
        bookStartRef: { current: null },
        currentChapterPrimedWordsRef: { current: [] },
        savedForms: { current: new Map() },
        knowledgeMapRef: { current: new Map() },
        evidenceRef: { current: new Map() },
        profileRef: { current: null },
        adjustRef: { current: 0 },
        baseThresholdRef: { current: 0 },
        overlayReleaseRef: { current: null },
        pushOverlay: vi.fn(),
        releaseOverlay: vi.fn(),
        captureDbScope: vi.fn(() => ({ userId: "u1", active: true } as unknown as DbScope)),
        rangeFor: vi.fn(() => null),
        setAnalyzingFor: vi.fn(),
        applyPrediction: vi.fn(),
        trackEvent: vi.fn(),
        ingestKnowledgeRow: vi.fn(),
        onStatus: vi.fn(),
        onError: vi.fn(),
        closeOtherOverlays: vi.fn(),
        ...overrides,
      };

      function TestComp() {
        hookResult = useReaderChapterPrep(defaultOptions);
        return null;
      }

      act(() => {
        root.render(h(TestComp));
      });

      return {
        get current() {
          return hookResult;
        },
      };
    }

    it("no ejecuta preparación si featureFlags.chapterPriming está desactivado", async () => {
      isFeatureFlagEnabledMock.mockReturnValue(false);
      const handle = renderPrep();

      await act(async () => {
        await handle.current.evaluatePreparation(0);
      });

      expect(handle.current.prep).toBeNull();
      expect(handle.current.prepNotice).toBeNull();
    });

    it("no ejecuta preparación si el libro está silenciado en mutedBookIds", async () => {
      isFeatureFlagEnabledMock.mockReturnValue(true);
      isPrimingMutedMock.mockReturnValue(true);

      const handle = renderPrep();

      await act(async () => {
        await handle.current.evaluatePreparation(0);
      });

      expect(handle.current.prep).toBeNull();
      expect(handle.current.prepNotice).toBeNull();
    });

    it("dispara pre-caché offline L2 en libros con idioma distinto al nativo", async () => {
      isFeatureFlagEnabledMock.mockReturnValue(true);
      isPrimingMutedMock.mockReturnValue(false);

      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue({ state: "ready", rows: [] }),
      } as unknown as ChapterAnalyzer;

      const handle = renderPrep({
        language: "en", // Nativo es "es", por tanto es L2
        analyzerRef: { current: mockAnalyzer },
      });

      await act(async () => {
        await handle.current.triggerL2Precache(0, 10, "en");
      });

      expect(prefetchMock).toHaveBeenCalled();
    });
  });
});
