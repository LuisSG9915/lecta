// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpeaker,
  defaultSpanishLangTag,
  ensureVoices,
  speakWithSystemVoice,
  stopSystemVoice,
} from "./ttsSpeech";

type FakeUtterance = {
  text: string;
  lang: string;
  voice?: SpeechSynthesisVoice;
  rate: number;
  pitch: number;
  volume: number;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (event: { error: string }) => void;
};

class MockUtterance implements FakeUtterance {
  text: string;
  lang = "";
  voice?: SpeechSynthesisVoice;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (event: { error: string }) => void;

  constructor(text: string) {
    this.text = text;
  }
}

const esMX = { lang: "es-MX", voiceURI: "es-mx", name: "Voz ES" } as SpeechSynthesisVoice;
const enUS = { lang: "en-US", voiceURI: "en-us", name: "Voice EN" } as SpeechSynthesisVoice;

let spoken: FakeUtterance[] = [];

type SynthStub = {
  speaking: boolean;
  pending: boolean;
  paused: boolean;
  getVoices: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function installSynth(overrides: Partial<SynthStub> = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const synth: SynthStub = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: vi.fn(() => [esMX, enUS]),
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn((event: string, callback: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(callback);
      listeners.set(event, set);
    }),
    removeEventListener: vi.fn((event: string, callback: () => void) => {
      listeners.get(event)?.delete(callback);
    }),
    ...overrides,
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
  });
  return { synth, listeners };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  spoken = [];
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error limpieza del stub de jsdom
  delete window.speechSynthesis;
  vi.restoreAllMocks();
});

describe("ensureVoices", () => {
  it("resuelve de inmediato si getVoices ya trae voces", async () => {
    const { synth } = installSynth();
    await expect(ensureVoices()).resolves.toEqual([esMX, enUS]);
    expect(synth.addEventListener).not.toHaveBeenCalled();
  });

  it("espera voiceschanged cuando la primera lectura viene vacía", async () => {
    const getVoices = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValue([esMX]);
    const { synth, listeners } = installSynth({ getVoices });

    const promise = ensureVoices(5_000);
    const listener = [...(listeners.get("voiceschanged") ?? [])][0];
    expect(listener).toBeTypeOf("function");
    listener();

    await expect(promise).resolves.toEqual([esMX]);
    expect(synth.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      listener,
    );
  });

  it("cae al timeout y devuelve las voces disponibles", async () => {
    vi.useFakeTimers();
    const getVoices = vi.fn(() => []);
    const { synth } = installSynth({ getVoices });

    const promise = ensureVoices(100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toEqual([]);
    expect(synth.removeEventListener).toHaveBeenCalled();
  });

  it("devuelve vacío si el entorno no tiene speechSynthesis", async () => {
    await expect(ensureVoices()).resolves.toEqual([]);
  });
});

describe("speakWithSystemVoice", () => {
  it("elige voz por idioma, ajusta rate y resuelve con onend", async () => {
    const { synth } = installSynth();
    const promise = speakWithSystemVoice("Hola.", {
      language: "es",
      rate: 1.25,
    });
    await flush();

    const utterance = spoken[0];
    expect(utterance.text).toBe("Hola.");
    expect(utterance.lang).toBe("es-MX");
    expect(utterance.voice).toBe(esMX);
    expect(utterance.rate).toBe(1.25);
    expect(synth.cancel).toHaveBeenCalled();

    utterance.onend?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it("usa la voz inglesa cuando el idioma es inglés", async () => {
    installSynth();
    const promise = speakWithSystemVoice("Hello.", { language: "en" });
    await flush();

    expect(spoken[0].lang).toBe("en-US");
    expect(spoken[0].voice).toBe(enUS);
    spoken[0].onerror?.({ error: "network" });
    await expect(promise).resolves.toBeUndefined();
  });

  it("resuelve si speak() lanza al instante", async () => {
    installSynth({
      speak: vi.fn(() => {
        throw new Error("motor sin voz");
      }),
    });
    await expect(speakWithSystemVoice("Hola.")).resolves.toBeUndefined();
  });

  it("resuelve por timeout si el motor nunca emite eventos", async () => {
    vi.useFakeTimers();
    installSynth();
    const promise = speakWithSystemVoice("Hola.");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("stopSystemVoice", () => {
  it("cancela la síntesis y tolera un motor que falla", () => {
    const { synth } = installSynth();
    stopSystemVoice();
    expect(synth.cancel).toHaveBeenCalled();

    installSynth({
      cancel: vi.fn(() => {
        throw new Error("sin motor");
      }),
    });
    expect(() => stopSystemVoice()).not.toThrow();
  });
});

describe("createSpeaker", () => {
  it("habla con voz, rate, pitch y volumen; onend cierra la oración", async () => {
    installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events, { language: "es" });
    await flush();

    speaker.speak("Hola mundo.", 1.2);

    const utterance = spoken[0];
    expect(utterance.text).toBe("Hola mundo.");
    expect(utterance.lang).toBe("es-MX");
    expect(utterance.voice).toBe(esMX);
    expect(utterance.rate).toBe(1.2);
    expect(utterance.pitch).toBe(1);
    expect(utterance.volume).toBe(1);
    expect(speaker.speakingNow()).toBe(false);

    utterance.onstart?.();
    utterance.onend?.();
    expect(events.onEnded).toHaveBeenCalledTimes(1);
  });

  it("parte oraciones largas y encadena los trozos", async () => {
    installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();

    speaker.speak("palabra, ".repeat(40), 1);
    expect(spoken.length).toBe(1);
    spoken[0].onend?.();
    expect(spoken.length).toBe(2);
    spoken[1].onend?.();
    expect(events.onEnded).toHaveBeenCalledTimes(1);
  });

  it("ignora canceled/interrupted y reporta otros errores", async () => {
    installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();
    speaker.speak("Frase.", 1);
    const utterance = spoken[0];

    utterance.onerror?.({ error: "canceled" });
    utterance.onerror?.({ error: "interrupted" });
    expect(events.onStalled).not.toHaveBeenCalled();

    utterance.onerror?.({ error: "network" });
    expect(events.onStalled).toHaveBeenCalledWith("mid");
  });

  it("reporta arranque mudo tras el watchdog", async () => {
    vi.useFakeTimers();
    installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();
    speaker.speak("Frase.", 1);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.onStalled).toHaveBeenCalledWith("start");
  });

  it("reporta media utterance zombie tras dos ventanas", async () => {
    vi.useFakeTimers();
    const { synth } = installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();
    speaker.speak("Frase.", 1);
    spoken[0].onstart?.();
    synth.speaking = true;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.onStalled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.onStalled).toHaveBeenCalledWith("mid");
  });

  it("pausa, reanuda, ajusta rate y cancela sin dejar timers vivos", async () => {
    const { synth } = installSynth();
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();
    speaker.speak("Frase.", 1);

    speaker.pause();
    expect(synth.pause).toHaveBeenCalled();
    speaker.resume();
    expect(synth.resume).toHaveBeenCalled();
    speaker.setRate(1.2);

    speaker.cancel();
    expect(synth.cancel).toHaveBeenCalled();
    expect(speaker.speakingNow()).toBe(false);
    expect(events.onEnded).not.toHaveBeenCalled();
  });

  it("si la cola no está idle, cancela y espera el asentamiento", async () => {
    vi.useFakeTimers();
    const { synth } = installSynth({ speaking: true });
    const speaker = createSpeaker({ onEnded: vi.fn(), onStalled: vi.fn() });
    await flush();

    speaker.speak("Nueva.", 1);
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(120);
    expect(spoken[0]?.text).toBe("Nueva.");
  });

  it("si speak() lanza, reporta arranque mudo", async () => {
    installSynth({
      speak: vi.fn(() => {
        throw new Error("sin audio");
      }),
    });
    const events = { onEnded: vi.fn(), onStalled: vi.fn() };
    const speaker = createSpeaker(events);
    await flush();
    speaker.speak("Frase.", 1);
    expect(events.onStalled).toHaveBeenCalledWith("start");
  });

  it("usa en-US y la voz inglesa cuando el idioma es inglés", async () => {
    installSynth();
    const speaker = createSpeaker(
      { onEnded: vi.fn(), onStalled: vi.fn() },
      { language: "en" },
    );
    await flush();
    speaker.speak("Hello.", 1);
    expect(spoken[0].lang).toBe("en-US");
    expect(spoken[0].voice).toBe(enUS);
  });

  it("cae al tag por defecto si no hay voces", async () => {
    installSynth({ getVoices: vi.fn(() => []) });
    const speaker = createSpeaker({ onEnded: vi.fn(), onStalled: vi.fn() });
    await flush();
    speaker.speak("Hola.", 1);
    expect(spoken[0].voice).toBeUndefined();
    expect(spoken[0].lang).toBe(defaultSpanishLangTag());
  });
});
