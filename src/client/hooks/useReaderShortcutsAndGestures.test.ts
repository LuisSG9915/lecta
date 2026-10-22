// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReaderShortcutsAndGestures,
  type UseReaderShortcutsAndGesturesOptions,
} from "./useReaderShortcutsAndGestures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toggleFullscreenMock = vi.fn().mockResolvedValue(true);
vi.mock("../lib/fullscreen", () => ({
  isFullscreen: vi.fn(() => false),
  isFullscreenSupported: vi.fn(() => true),
  subscribeFullscreenChange: vi.fn(() => () => {}),
  toggleFullscreen: () => toggleFullscreenMock(),
}));

vi.mock("../lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

describe("useReaderShortcutsAndGestures", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderHook(overrides?: Partial<UseReaderShortcutsAndGesturesOptions>) {
    let hookResult!: ReturnType<typeof useReaderShortcutsAndGestures>;

    const defaultOptions: UseReaderShortcutsAndGesturesOptions = {
      viewportRef: { current: container },
      containerRef: { current: container },
      layout: "pages",
      page: 1,
      pageCount: 5,
      pageAdvancePx: 400,
      sectionIndex: 0,
      sectionTotal: 10,
      onTurnPage: vi.fn(),
      onCenterTap: vi.fn(),
      noteActivity: vi.fn(),
      onOpenSheet: vi.fn(),
      onFinishDeepReading: vi.fn(),
      ...overrides,
    };

    function TestComp() {
      hookResult = useReaderShortcutsAndGestures(defaultOptions);
      return null;
    }

    act(() => {
      root.render(h(TestComp));
    });

    return {
      get current() {
        return hookResult;
      },
      options: defaultOptions,
    };
  }

  it("avanza de página con ArrowRight y retrocede con ArrowLeft", () => {
    const onTurnPage = vi.fn();
    const noteActivity = vi.fn();
    renderHook({ onTurnPage, noteActivity });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(onTurnPage).toHaveBeenCalledWith(1);
    expect(noteActivity).toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(onTurnPage).toHaveBeenCalledWith(-1);
  });

  it("finaliza lectura profunda con Escape", () => {
    const onFinishDeepReading = vi.fn();
    renderHook({ deepReadingActive: true, onFinishDeepReading });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onFinishDeepReading).toHaveBeenCalledWith(false);
  });

  it("alterna pantalla completa con la tecla 'f'", async () => {
    const handle = renderHook();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    });

    expect(toggleFullscreenMock).toHaveBeenCalled();
    expect(handle.current.isFullscreenActive).toBe(true);
  });

  it("abre el índice con 't' y los marcadores con 'm'", () => {
    const onOpenSheet = vi.fn();
    renderHook({ onOpenSheet });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
    });
    expect(onOpenSheet).toHaveBeenCalledWith("toc");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
    });
    expect(onOpenSheet).toHaveBeenCalledWith("marks");
  });
});
