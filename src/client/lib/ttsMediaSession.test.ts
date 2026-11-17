import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTS_IDLE, type TtsSnapshot } from "./ttsTypes";
import { mediaSessionReset, syncMediaSession } from "./ttsMediaSession";

const META = { title: "Marianela", chapter: "Capítulo I", artwork: "/icons/icon-512.png" };
const snap = (status: TtsSnapshot["status"]): TtsSnapshot => ({ ...TTS_IDLE, status });

describe("ttsMediaSession", () => {
  const handlers: Record<string, (() => void) | null> = {};
  const fakeSession = {
    metadata: null as unknown,
    playbackState: "none",
    setActionHandler: vi.fn((a: string, fn: (() => void) | null) => {
      handlers[a] = fn;
    }),
  };

  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    fakeSession.metadata = null;
    fakeSession.playbackState = "none";
    fakeSession.setActionHandler.mockClear();
    Object.defineProperty(navigator, "mediaSession", { value: fakeSession, configurable: true });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: Record<string, unknown>) {}
      },
    );
  });
  afterEach(() => {
    mediaSessionReset();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaSession");
  });

  const fns = () => ({ play: vi.fn(), pause: vi.fn(), next: vi.fn(), prev: vi.fn(), stop: vi.fn() });

  it("publica metadata y estado, y los handlers llaman al controlador", () => {
    const h = fns();
    syncMediaSession(snap("speaking"), META, h);
    const md = fakeSession.metadata as { init: Record<string, unknown> };
    expect(md.init).toMatchObject({ title: "Capítulo I", album: "Marianela", artist: "Lecta" });
    expect(fakeSession.playbackState).toBe("playing");
    handlers.play?.();
    handlers.pause?.();
    handlers.nexttrack?.();
    handlers.previoustrack?.();
    handlers.seekforward?.();
    handlers.seekbackward?.();
    handlers.stop?.();
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.pause).toHaveBeenCalledTimes(1);
    expect(h.next).toHaveBeenCalledTimes(2);
    expect(h.prev).toHaveBeenCalledTimes(2);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it("pausado marca paused y no reasigna la metadata si no cambia", () => {
    syncMediaSession(snap("speaking"), META, fns());
    const first = fakeSession.metadata;
    syncMediaSession(snap("paused"), META, fns());
    expect(fakeSession.playbackState).toBe("paused");
    expect(fakeSession.metadata).toBe(first);
  });

  it("en idle limpia metadata y handlers", () => {
    syncMediaSession(snap("speaking"), META, fns());
    syncMediaSession(snap("idle"), META, fns());
    expect(fakeSession.metadata).toBeNull();
    expect(fakeSession.playbackState).toBe("none");
    expect(handlers.play).toBeNull();
  });

  it("sin navigator.mediaSession no lanza", () => {
    Reflect.deleteProperty(navigator, "mediaSession");
    expect(() => syncMediaSession(snap("speaking"), META, fns())).not.toThrow();
  });
});
