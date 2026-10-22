// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReaderPersistence,
  type UseReaderPersistenceOptions,
} from "./useReaderPersistence";
import type { SavedBookPosition, SavedInterval } from "../lib/idb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const savedPositions = new Map<string, SavedBookPosition>();
const savedIntervals: SavedInterval[] = [];

vi.mock("../lib/idb", () => ({
  loadBookPosition: vi.fn(async (hash: string) => savedPositions.get(hash) ?? null),
  saveBookPosition: vi.fn(async (pos: SavedBookPosition) => {
    savedPositions.set(pos.bookHash, pos);
  }),
  saveReadingInterval: vi.fn(async (interval: SavedInterval) => {
    savedIntervals.push(interval);
  }),
  listIntervals: vi.fn(async () => [...savedIntervals]),
  captureDbScope: vi.fn(() => ({})),
}));

vi.mock("../lib/reading-sync", () => ({
  pushActivityToServer: vi.fn(async () => {}),
}));

describe("useReaderPersistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    savedPositions.clear();
    savedIntervals.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const mockPosition: SavedBookPosition = {
    bookHash: "book-hash-123",
    sectionIndex: 3,
    scrollTop: 150,
    ratio: 0.45,
    progress: 0.3,
    updatedAt: 1000,
  };

  function renderHook(overrides?: Partial<UseReaderPersistenceOptions>) {
    let hookResult!: ReturnType<typeof useReaderPersistence>;

    const defaultOptions: UseReaderPersistenceOptions = {
      bookHash: "book-hash-123",
      isReady: true,
      capturePosition: vi.fn(() => mockPosition),
      signalCompanion: vi.fn(),
      presenceActivity: vi.fn(),
      presenceIdle: vi.fn(),
      setCatSleepy: vi.fn(),
      ...overrides,
    };

    function TestComp() {
      hookResult = useReaderPersistence(defaultOptions);
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

  it("carga la posición del libro desde IndexedDB", async () => {
    savedPositions.set("book-hash-123", mockPosition);
    const handle = renderHook();

    let loaded: SavedBookPosition | null = null;
    await act(async () => {
      loaded = await handle.current.loadSavedPosition();
    });

    expect(loaded).toEqual(mockPosition);
  });

  it("guarda inmediatamente la posición en IndexedDB al solicitar saveImmediate", async () => {
    const customPos: SavedBookPosition = {
      ...mockPosition,
      sectionIndex: 5,
      scrollTop: 300,
    };
    const capturePosition = vi.fn(() => customPos);
    const handle = renderHook({ capturePosition });

    await act(async () => {
      await handle.current.saveImmediate();
    });

    expect(savedPositions.get("book-hash-123")).toEqual(customPos);
  });

  it("registra actividad e intervalo de lectura al superar el mínimo de tiempo", async () => {
    const handle = renderHook();

    // Iniciar actividad
    const now = 10000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    act(() => {
      handle.current.noteActivity();
    });

    expect(handle.current.activityRef.current).not.toBeNull();
    expect(handle.current.activityRef.current?.startedAt).toBe(now);

    // Simular que pasaron 15 segundos (MIN_INTERVAL_MS es 10_000)
    vi.spyOn(Date, "now").mockReturnValue(now + 15_000);
    act(() => {
      handle.current.noteActivity();
      handle.current.closeActivity();
    });

    expect(savedIntervals.length).toBe(1);
    expect(savedIntervals[0].bookHash).toBe("book-hash-123");
    expect(savedIntervals[0].endedAt - savedIntervals[0].startedAt).toBeGreaterThanOrEqual(10_000);
  });

  it("guarda la posición al desmontar cuando el lector está listo", async () => {
    const capturePosition = vi.fn(() => mockPosition);
    renderHook({ capturePosition, isReady: true });

    act(() => {
      root.unmount();
    });

    expect(savedPositions.get("book-hash-123")).toBeDefined();
    expect(savedPositions.get("book-hash-123")?.sectionIndex).toBe(3);
  });
});
