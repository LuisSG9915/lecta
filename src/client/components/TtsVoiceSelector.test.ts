// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TtsVoiceSelector from "./TtsVoiceSelector";
import * as kittenEngine from "../lib/kittenTtsEngine";
import * as speech from "../lib/ttsSpeech";
import * as settings from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const voice = (voiceURI: string, lang: string) =>
  ({ voiceURI, name: `Voz ${voiceURI}`, lang, default: false }) as SpeechSynthesisVoice;

describe("TtsVoiceSelector", () => {
  let container: HTMLDivElement;
  let root: Root;
  const snap = { engine: "auto" as const, activeEngine: "browser" as const, kittenVoice: "expr-voice-2-f" as const, voiceURI: null };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(speech, "ensureVoices").mockResolvedValue([
      voice("es-a", "es-MX"),
      voice("en-a", "en-US"),
    ]);
    vi.spyOn(settings, "isFeatureFlagEnabled").mockReturnValue(true);
    vi.spyOn(kittenEngine.kittenTtsEngine, "isEngineModelDownloaded").mockResolvedValue(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (props: Partial<Parameters<typeof TtsVoiceSelector>[0]> = {}) => {
    const full = {
      bookLanguage: "es",
      snap,
      onSelectSystem: vi.fn(),
      onSelectNeural: vi.fn(),
      onDismiss: vi.fn(),
      ...props,
    };
    await act(async () => {
      root.render(h(TtsVoiceSelector, full));
    });
    return full;
  };

  it("lista solo voces del idioma del libro", async () => {
    await render();
    expect(container.textContent).toContain("Voz es-a");
    expect(container.textContent).not.toContain("Voz en-a");
  });

  it("elegir una voz del sistema la reporta y cierra", async () => {
    const p = await render();
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Voz es-a")!;
    act(() => btn.click());
    expect(p.onSelectSystem).toHaveBeenCalledWith("es-a");
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it("en inglés ofrece las ocho voces Kitten", async () => {
    await render({ bookLanguage: "en" });
    expect(container.querySelectorAll('[aria-label="Voces naturales"] button')).toHaveLength(8);
  });

  it("sin la bandera neural oculta las voces naturales", async () => {
    vi.spyOn(settings, "isFeatureFlagEnabled").mockReturnValue(false);
    await render();
    expect(container.querySelector('[aria-label="Voces naturales"]')).toBeNull();
  });

  it("una neural sin descargar descarga antes de elegirse", async () => {
    const order: string[] = [];
    vi.spyOn(kittenEngine.kittenTtsEngine, "downloadEngineModel").mockImplementation(async () => {
      order.push("download");
    });
    vi.spyOn(kittenEngine.kittenTtsEngine, "init").mockImplementation(async () => {
      order.push("init");
      return true;
    });
    const onSelectNeural = vi.fn(() => order.push("select"));
    await render({ onSelectNeural });
    const btn = container.querySelector<HTMLButtonElement>('[aria-label="Voces naturales"] button')!;
    await act(async () => btn.click());
    expect(order).toEqual(["download", "init", "select"]);
  });
});
