// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSpeechAvailable, speakWord } from "./speech";

describe("speech", () => {
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speakMock = vi.fn((utterance: SpeechSynthesisUtterance) => {
      // Simular onend síncrono o inmediato
      setTimeout(() => {
        utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
      }, 10);
    });
    cancelMock = vi.fn();

    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      rate = 1;
      volume = 1;
      onend: ((e: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((e: SpeechSynthesisEvent) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    });

    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [
        { lang: "es-MX", name: "Mexican Spanish" } as SpeechSynthesisVoice,
        { lang: "en-US", name: "US English" } as SpeechSynthesisVoice,
      ],
      speak: speakMock,
      cancel: cancelMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detecta disponibilidad de síntesis de voz", () => {
    expect(isSpeechAvailable()).toBe(true);
  });

  it("cancela habla previa y pronuncia la palabra con la voz de su idioma", async () => {
    await speakWord("apple", "en");

    expect(cancelMock).toHaveBeenCalled();
    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("apple");
    expect(utterance.lang).toBe("en-US");
    expect(utterance.rate).toBe(0.9);
  });

  it("pronuncia palabra en español por defecto", async () => {
    await speakWord("manzana", "es");

    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("manzana");
    expect(utterance.lang).toBe("es-MX");
  });

  it("no hace nada si la palabra está vacía", async () => {
    await speakWord("   ", "es");
    expect(speakMock).not.toHaveBeenCalled();
  });

  it("selecciona voz en-GB si no hay en-US", async () => {
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [
        { lang: "en-GB", name: "British English" } as SpeechSynthesisVoice,
      ],
      speak: speakMock,
      cancel: cancelMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    await speakWord("water", "en");
    expect(speakMock).toHaveBeenCalled();
    const utterance = speakMock.mock.calls[speakMock.mock.calls.length - 1][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("water");
    expect(utterance.lang).toBe("en-GB");
  });

  it("utiliza KittenTTS neural cuando el motor está listo para palabras en inglés", async () => {
    const { kittenTtsEngine } = await import("./kittenTtsEngine");
    kittenTtsEngine.setReadyForTesting(true);

    const synthesizeSpy = vi.spyOn(kittenTtsEngine, "synthesize").mockResolvedValue({
      sampleRate: 24000,
      length: 2400,
      duration: 0.1,
    } as AudioBuffer);
    const playSpy = vi.spyOn(kittenTtsEngine, "play").mockImplementation((_, __, onEnded) => {
      onEnded?.();
    });

    await speakWord("serendipity", "en");

    expect(synthesizeSpy).toHaveBeenCalledWith("serendipity", expect.any(String), 0.9);
    expect(playSpy).toHaveBeenCalled();
    // No debe usar speechSynthesis si KittenTTS neural está listo
    expect(speakMock).not.toHaveBeenCalled();

    kittenTtsEngine.setReadyForTesting(false);
    synthesizeSpy.mockRestore();
    playSpy.mockRestore();
  });

  it("palabras en español usan speechSynthesis con voz en español aun con KittenTTS listo", async () => {
    const { kittenTtsEngine } = await import("./kittenTtsEngine");
    kittenTtsEngine.setReadyForTesting(true);

    await speakWord("biblioteca", "es");

    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("biblioteca");
    expect(utterance.lang).toBe("es-MX");

    kittenTtsEngine.setReadyForTesting(false);
  });
});
