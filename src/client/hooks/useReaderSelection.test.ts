// @vitest-environment jsdom
// Pruebas de la selección del lector (extraída de Reader.tsx): contrato de
// apertura/cierre, capa de historial, locución y estabilidad de identidad.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderSelection, type UseReaderSelectionOptions } from "./useReaderSelection";
import type { WordHit } from "../lib/words";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pushOverlay: vi.fn(),
  matchPhrase: vi.fn(),
  lemmaOfFromEntries: vi.fn(),
  targetAt: vi.fn(),
  charOffsetAtViewTop: vi.fn(),
  award: vi.fn(),
  localDayKey: vi.fn(() => "2026-10-22"),
  captureDbScope: vi.fn(() => ({})),
  getBookLanguage: vi.fn(() => "es"),
  betaFromZipf: vi.fn(() => 3.5),
  updateLanguageTheta: vi.fn(),
}));

vi.mock("../lib/history", async (orig) => ({
  ...(await orig<typeof import("../lib/history")>()),
  pushOverlay: mocks.pushOverlay,
}));
vi.mock("../lib/phrases", async (orig) => ({
  ...(await orig<typeof import("../lib/phrases")>()),
  matchPhrase: mocks.matchPhrase,
  lemmaOfFromEntries: mocks.lemmaOfFromEntries,
}));
vi.mock("../lib/chapters", async (orig) => ({
  ...(await orig<typeof import("../lib/chapters")>()),
  targetAt: mocks.targetAt,
}));
vi.mock("../lib/reading-location", async (orig) => ({
  ...(await orig<typeof import("../lib/reading-location")>()),
  charOffsetAtViewTop: mocks.charOffsetAtViewTop,
}));
vi.mock("../lib/game", async (orig) => ({
  ...(await orig<typeof import("../lib/game")>()),
  award: mocks.award,
  localDayKey: mocks.localDayKey,
}));
vi.mock("../lib/idb", async (orig) => ({
  ...(await orig<typeof import("../lib/idb")>()),
  captureDbScope: mocks.captureDbScope,
}));
vi.mock("../lib/epub", async (orig) => ({
  ...(await orig<typeof import("../lib/epub")>()),
  getBookLanguage: mocks.getBookLanguage,
}));
vi.mock("../lib/profile-models", async (orig) => ({
  ...(await orig<typeof import("../lib/profile-models")>()),
  betaFromZipf: mocks.betaFromZipf,
  updateLanguageTheta: mocks.updateLanguageTheta,
}));

type Api = ReturnType<typeof useReaderSelection>;

const overlayHandle = () => ({ swap: vi.fn(), release: vi.fn() });

const options = (over: Partial<UseReaderSelectionOptions> = {}): UseReaderSelectionOptions => ({
  language: "es",
  setSelection: vi.fn(),
  setSheet: vi.fn(),
  setCharOffsetInChapter: vi.fn(),
  analyzerRef: { current: null },
  bookRef: { current: null },
  catalogRef: { current: null },
  consultedInPageRef: { current: new Set<string>() },
  containerRef: { current: null },
  currentChapterLookups: { current: [] },
  overlayReleaseRef: { current: null },
  phrasesRef: { current: null },
  sectionIndexRef: { current: 3 },
  sectionTextRef: { current: "texto de la sección" },
  tocRowsRef: { current: [{ label: "Cap. 4", index: 3, depth: 0, target: {} as never }] },
  analysisFor: vi.fn(() => undefined),
  recordConsult: vi.fn(),
  signalCompanion: vi.fn(),
  trackEvent: vi.fn(),
  releaseOverlay: vi.fn(),
  noteActivity: vi.fn(),
  ...over,
});

describe("useReaderSelection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Api;

  function Probe({ options }: { options: UseReaderSelectionOptions }) {
    api = useReaderSelection(options);
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    mocks.charOffsetAtViewTop.mockReturnValue(42);
    mocks.pushOverlay.mockReturnValue(overlayHandle());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (opts: UseReaderSelectionOptions) =>
    act(() => {
      root.render(h(Probe, { options: opts }));
    });

  it("devuelve acciones con identidad estable entre renders", () => {
    render(options());
    const first = api.openSelection;
    const firstClose = api.closeSelection;
    render(options());
    expect(api.openSelection).toBe(first);
    expect(api.closeSelection).toBe(firstClose);
  });

  it("lee la versión vigente de las opciones y no una capturada", () => {
    render(options({ language: "es" }));
    render(options({ language: "fr" }));
    act(() => api.openSelection({ word: "Casa", context: "" }));
    expect(mocks.updateLanguageTheta).toHaveBeenCalledWith("fr", 3.5, 0, 0.8);
  });

  it("abre la ficha: capa de historial, selección, hoja, evidencia y journal", () => {
    const opts = options({ containerRef: { current: document.createElement("div") } });
    render(opts);
    act(() => api.openSelection({ word: "Casa", context: "" }));

    expect(opts.noteActivity).toHaveBeenCalled();
    expect(mocks.pushOverlay).toHaveBeenCalledTimes(1);
    expect(opts.setSheet).toHaveBeenCalledWith(null);
    expect(opts.setSelection).toHaveBeenCalledWith({ word: "Casa", context: "" });
    expect(opts.setCharOffsetInChapter).toHaveBeenCalledWith(42);
    expect(opts.consultedInPageRef.current.has("casa")).toBe(true);
    expect(opts.trackEvent).toHaveBeenCalledWith({
      kind: "word_consulted",
      sectionIndex: 3,
      form: "Casa",
      origin: "text",
    });
    expect(mocks.award).toHaveBeenCalledWith(
      { kind: "consulted" },
      {},
      expect.objectContaining({ dayKey: "2026-10-22" }),
    );
    expect(opts.signalCompanion).toHaveBeenCalledWith({ kind: "word_consulted" });
    expect(opts.recordConsult).toHaveBeenCalledWith("Casa");
    expect(opts.currentChapterLookups.current).toHaveLength(1);
  });

  it("reutiliza la capa de historial cuando ya hay una abierta", () => {
    const handle = overlayHandle();
    const opts = options({ overlayReleaseRef: { current: handle as never } });
    render(opts);
    act(() => api.openSelection({ word: "Casa", context: "" }));
    expect(mocks.pushOverlay).not.toHaveBeenCalled();
    expect(handle.swap).toHaveBeenCalledTimes(1);
  });

  it("no duplica la consulta en el registro del capítulo", () => {
    const opts = options();
    render(opts);
    act(() => api.openSelection({ word: "Casa", context: "" }));
    act(() => api.openSelection({ word: "Casa", context: "" }));
    expect(opts.currentChapterLookups.current).toHaveLength(1);
  });

  it("adjunta la locución cuando la frase se puede emparejar", () => {
    mocks.matchPhrase.mockReturnValue("de la casa");
    const opts = options({ phrasesRef: { current: {} as never } });
    render(opts);
    const hit: WordHit = { word: "casa", context: "vuelve a casa" };
    act(() => api.openSelection(hit));
    expect(mocks.matchPhrase).toHaveBeenCalled();
    expect(hit.phrase).toBe("de la casa");
  });

  it("cierra la ficha con la misma capa", () => {
    const opts = options();
    render(opts);
    act(() => api.closeSelection());
    expect(opts.releaseOverlay).toHaveBeenCalledTimes(1);
    expect(opts.setSelection).toHaveBeenCalledWith(null);
  });
});
