// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TtsNowPlaying from "./TtsNowPlaying";
import type { TtsSnapshot } from "../lib/ttsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("TtsNowPlaying", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = (props: Parameters<typeof TtsNowPlaying>[0]) => {
    act(() => {
      root.render(h(TtsNowPlaying, props));
    });
  };

  it("no se muestra si el estado es idle o stopping", () => {
    const idleSnap: TtsSnapshot = {
      status: "idle",
      sessionId: null,
      rate: 1,
      highlight: "sentence",
      pauseReason: null,
    };
    render({
      snap: idleSnap,
      onPauseResume: vi.fn(),
      onCycleRate: vi.fn(),
      onStop: vi.fn(),
    });
    expect(container.querySelector(".tts-chip")).toBeNull();

    const stoppingSnap: TtsSnapshot = {
      status: "stopping",
      sessionId: "s-1",
      rate: 1,
      highlight: "sentence",
      pauseReason: null,
    };
    render({
      snap: stoppingSnap,
      onPauseResume: vi.fn(),
      onCycleRate: vi.fn(),
      onStop: vi.fn(),
    });
    expect(container.querySelector(".tts-chip")).toBeNull();
  });

  it("muestra controles y dispara acciones de salto, pausa, velocidad y captura", () => {
    const onPauseResume = vi.fn();
    const onPrevSentence = vi.fn();
    const onNextSentence = vi.fn();
    const onCycleRate = vi.fn();
    const onCaptureWord = vi.fn();
    const onStop = vi.fn();

    const snap: TtsSnapshot = {
      status: "speaking",
      sessionId: "session-1",
      rate: 1,
      highlight: "sentence",
      pauseReason: null,
    };

    render({
      snap,
      onPauseResume,
      onPrevSentence,
      onNextSentence,
      onCycleRate,
      onCaptureWord,
      onStop,
    });

    const chip = container.querySelector(".tts-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("En voz alta");

    // Frase anterior
    const prevBtn = container.querySelector('button[aria-label="Frase anterior"]') as HTMLButtonElement;
    expect(prevBtn).not.toBeNull();
    act(() => prevBtn.click());
    expect(onPrevSentence).toHaveBeenCalledTimes(1);

    // Frase siguiente
    const nextBtn = container.querySelector('button[aria-label="Frase siguiente"]') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    act(() => nextBtn.click());
    expect(onNextSentence).toHaveBeenCalledTimes(1);

    // Pausar
    const playPauseBtn = container.querySelector(".tts-btn-playpause") as HTMLButtonElement;
    expect(playPauseBtn.textContent).toBe("Pausar");
    act(() => playPauseBtn.click());
    expect(onPauseResume).toHaveBeenCalledTimes(1);

    // Velocidad
    const rateBtn = container.querySelector(".tts-chip-rate") as HTMLButtonElement;
    expect(rateBtn.textContent).toBe("1.0×");
    act(() => rateBtn.click());
    expect(onCycleRate).toHaveBeenCalledTimes(1);

    // Capturar palabra
    const captureBtn = container.querySelector(".tts-chip-capture") as HTMLButtonElement;
    expect(captureBtn.textContent).toContain("★ Capturar palabra");
    act(() => captureBtn.click());
    expect(onCaptureWord).toHaveBeenCalledTimes(1);
    expect(captureBtn.textContent).toContain("✓ Guardada");

    // Detener
    const stopBtn = container.querySelector(".tts-chip-stop") as HTMLButtonElement;
    act(() => stopBtn.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("en modo minimal sólo muestra la etiqueta de estado", () => {
    const snap: TtsSnapshot = {
      status: "paused",
      sessionId: "session-2",
      rate: 1.15,
      highlight: "sentence",
      pauseReason: "user",
    };

    render({
      snap,
      minimal: true,
      onPauseResume: vi.fn(),
      onCycleRate: vi.fn(),
      onStop: vi.fn(),
    });

    const chip = container.querySelector(".tts-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("En pausa");
    expect(container.querySelector(".tts-chip-actions")).toBeNull();
  });

  it("muestra el selector de voz con las 8 voces de KittenTTS y emite onSelectKittenVoice", () => {
    const onSelectKittenVoice = vi.fn();
    const snap: TtsSnapshot = {
      status: "speaking",
      sessionId: "session-3",
      rate: 1,
      highlight: "sentence",
      pauseReason: null,
      kittenVoice: "expr-voice-2-f",
      activeEngine: "kitten-neural",
    };

    render({
      snap,
      onPauseResume: vi.fn(),
      onCycleRate: vi.fn(),
      onStop: vi.fn(),
      onSelectKittenVoice,
    });

    // Badge del motor neural
    const badge = container.querySelector(".tts-engine-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Neural 24kHz");

    // Selector de voz
    const select = container.querySelector(".tts-voice-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(8);
    expect(select.value).toBe("expr-voice-2-f");

    // Cambiar de voz a Leo
    act(() => {
      select.value = "expr-voice-2-m";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSelectKittenVoice).toHaveBeenCalledWith("expr-voice-2-m");
  });

  it("muestra badge 'Sistema' cuando el motor activo es browser", () => {
    const snap: TtsSnapshot = {
      status: "speaking",
      sessionId: "session-4",
      rate: 1,
      highlight: "sentence",
      pauseReason: null,
      activeEngine: "browser",
    };

    render({
      snap,
      onPauseResume: vi.fn(),
      onCycleRate: vi.fn(),
      onStop: vi.fn(),
    });

    const badge = container.querySelector(".tts-engine-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Sistema");
  });
});

