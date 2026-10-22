// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSentenceMap, sentenceFingerprint } from "./ttsSentences";
import { clearTtsMarks, markSentence, ttsMarkElement } from "./ttsMarks";
import {
  pickEnglishVoice,
  pickSpanishVoice,
  pickVoiceForLanguage,
  splitForSpeech,
} from "./ttsSpeech";
import {
  consentTts,
  isTtsSupported,
  loadTtsSettings,
  saveTtsSettings,
  TTS_SETTINGS_DEFAULTS,
} from "./ttsSettings";
import {
  isTtsProgrammaticNav,
  isTtsProgrammaticScroll,
  noteTtsProgrammaticScroll,
  withTtsProgrammaticNav,
} from "./ttsGuards";
import {
  createTtsController,
  playSentencesLoop,
  sentenceStillValid,
  stopAllTtsPlayback,
  TtsAudioController,
  type TtsControllerDeps,
} from "./ttsController";
import {
  KITTEN_VOICES,
  type TtsSnapshot,
  type TtsTargetContext,
} from "./ttsTypes";
import {
  normalizeEnglishText,
  kittenTtsEngine,
  KittenTtsEngine,
  KITTEN_IDLE_TIMEOUT_MS,
  sanitizeAudioSamples,
} from "./kittenTtsEngine";
import { prepareKittenInputIds } from "./kittenPhonemizer";
import { trimLeadingAndTrailingSilence } from "../workers/kitten-tts.worker";

const section = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("ttsSentences", () => {
  it("segmenta oraciones con offsets absolutos sobre el texto concatenado", () => {
    const root = section("<p>Hola mundo. Adiós mundo.</p><p>Segunda línea.</p>");
    const { items, text } = buildSentenceMap(root, 3, "es");
    // Los bloques llevan un separador en el flujo: sin él,
    // «mundo.Segunda» quedaría pegada y el segmentador no cortaría.
    expect(text).toBe("Hola mundo. Adiós mundo.\nSegunda línea.");
    expect(items.map((i) => i.text)).toEqual([
      "Hola mundo.",
      "Adiós mundo.",
      "Segunda línea.",
    ]);
    expect(items[0].start).toBe(0);
    expect(items[0].sectionIndex).toBe(3);
    expect(items.map((i) => i.sentenceIndex)).toEqual([0, 1, 2]);
    for (const item of items)
      expect(item.fingerprint).toBe(sentenceFingerprint(item.text));
  });

  it("omite script, oculto y la tarjeta «Antes de leer»", () => {
    const root = section(
      "<p>Texto real.</p><script>var x = 1;</script>" +
        "<div hidden>Oculto.</div>" +
        '<div class="section-preview-slot"><p>Fila de tarjeta.</p></div>',
    );
    const { items, text } = buildSentenceMap(root, 0);
    expect(text).not.toContain("Fila de tarjeta");
    expect(text).not.toContain("var x");
    expect(items).toHaveLength(1);
  });

  it("descarta separadores sin letras («—», «…»)", () => {
    const root = section("<p>…</p><p>—</p><p>Texto hablable.</p>");
    const { items } = buildSentenceMap(root, 0);
    // Solo «Texto hablable.» cuenta: un segmento de pura puntuación
    // produciría una utterance vacía que avanzaría el puntero muda.
    expect(items.map((i) => i.text)).toEqual(["Texto hablable."]);
  });
});

describe("ttsMarks", () => {
  it("envuelve la oración activa aunque cruce nodos y la limpia después", () => {
    const root = section("<p>Dijo <i>ella</i> bajito. Otra frase.</p>");
    const { items } = buildSentenceMap(root, 0);
    const across = items.find((i) => i.text === "Dijo ella bajito.") ?? items[0];
    expect(markSentence(root, across)).toBe(true);
    const marks = root.querySelectorAll("[data-tts-sentence]");
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(
      [...marks].map((m) => m.textContent).join(""),
    ).toContain("ella");
    // Una marca por oración activa: la segunda no queda marcada.
    for (const mark of marks)
      expect(mark.getAttribute("data-tts-sentence")).toBe(
        String(across.sentenceIndex),
      );
    clearTtsMarks(root);
    expect(root.querySelectorAll("[data-tts-sentence]")).toHaveLength(0);
    // Y el mapa se puede reconstruir idéntico tras limpiar.
    const rebuilt = buildSentenceMap(root, 0);
    expect(rebuilt.items.map((i) => i.fingerprint)).toEqual(
      items.map((i) => i.fingerprint),
    );
  });

  it("marca y limpia sin romper las oraciones siguientes", () => {
    const root = section("<p>Una frase larga de verdad. Otra más.</p>");
    const { items } = buildSentenceMap(root, 0);
    expect(markSentence(root, items[0])).toBe(true);
    // Marcar la segunda con la primera puesta: el resolve por offsets
    // debe seguir encontrando su tramo aunque el nodo ya esté partido.
    clearTtsMarks(root);
    expect(markSentence(root, items[1])).toBe(true);
    expect(ttsMarkElement(root)?.textContent).toContain("Otra más");
  });

  it("no marca si la huella ya no coincide (mapa obsoleto)", () => {
    const root = section("<p>Texto original.</p>");
    const { items } = buildSentenceMap(root, 0);
    // Simula un re-render: el contenedor tiene otro contenido.
    const other = section("<p>Contenido distinto del todo.</p>");
    expect(markSentence(other, items[0])).toBe(false);
    expect(other.querySelectorAll("[data-tts-sentence]")).toHaveLength(0);
  });
});

describe("ttsSpeech", () => {
  it("no parte oraciones cortas", () => {
    expect(splitForSpeech("Hola mundo.")).toEqual(["Hola mundo."]);
  });

  it("parte en puntuación interna sin exceder el tope", () => {
    const body = "palabra, ".repeat(40).trim();
    const chunks = splitForSpeech(body, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("palabra");
  });

  it("sin puntuación útil corta en el último espacio", () => {
    const body = Array.from({ length: 30 }, () => "palabras").join(" ");
    const chunks = splitForSpeech(body, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
  });

  it("prefiere es-MX, luego es-US, luego cualquier es-*", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    expect(pickSpanishVoice([voice("en-US"), voice("es-MX")])?.lang).toBe(
      "es-MX",
    );
    expect(pickSpanishVoice([voice("es-US"), voice("es-ES")])?.lang).toBe(
      "es-US",
    );
    expect(pickSpanishVoice([voice("en-US"), voice("es-AR")])?.lang).toBe(
      "es-AR",
    );
    expect(pickSpanishVoice([voice("en-US")])).toBeNull();
  });

  it("prefiere en-US, luego en-GB, luego cualquier en-*", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    expect(pickEnglishVoice([voice("es-MX"), voice("en-US")])?.lang).toBe(
      "en-US",
    );
    expect(pickEnglishVoice([voice("en-GB"), voice("en-AU")])?.lang).toBe(
      "en-GB",
    );
    expect(pickEnglishVoice([voice("es-ES"), voice("en-CA")])?.lang).toBe(
      "en-CA",
    );
    expect(pickEnglishVoice([voice("es-ES")])).toBeNull();
  });

  it("selecciona la voz y tag de fallback según el idioma", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    const voices = [voice("es-MX"), voice("en-US")];
    const enResult = pickVoiceForLanguage(voices, "en");
    expect(enResult.voice?.lang).toBe("en-US");
    expect(enResult.defaultLangTag).toBe("en-US");

    const esResult = pickVoiceForLanguage(voices, "es");
    expect(esResult.voice?.lang).toBe("es-MX");
    expect(esResult.defaultLangTag).toBe("es-MX");
  });
});

describe("ttsSettings", () => {
  beforeEach(() => localStorage.clear());

  it("por defecto apagado y sin consentimiento", () => {
    expect(loadTtsSettings()).toEqual(TTS_SETTINGS_DEFAULTS);
  });

  it("el consentimiento guarda epoch ms y enciende", () => {
    const next = consentTts(1_700_000_000_000);
    expect(next.enabled).toBe(true);
    expect(next.consentedAt).toBe(1_700_000_000_000);
    expect(loadTtsSettings().enabled).toBe(true);
  });

  it("JSON roto cae a defaults y rate inválido a 1", () => {
    localStorage.setItem("lecta:tts", "{no json");
    expect(loadTtsSettings()).toEqual(TTS_SETTINGS_DEFAULTS);
    localStorage.setItem(
      "lecta:tts",
      JSON.stringify({ enabled: true, consentedAt: 5, rate: 3.4 }),
    );
    expect(loadTtsSettings().rate).toBe(1);
  });

  it("persiste configuraciones multi-motor y voz de KittenTTS", () => {
    saveTtsSettings({
      ...TTS_SETTINGS_DEFAULTS,
      enabled: true,
      consentedAt: 12345,
      engine: "kitten-neural",
      kittenVoice: "expr-voice-3-m",
    });
    const loaded = loadTtsSettings();
    expect(loaded.engine).toBe("kitten-neural");
    expect(loaded.kittenVoice).toBe("expr-voice-3-m");
  });

  it("recupera defaults ante engine o voz inválidos", () => {
    localStorage.setItem(
      "lecta:tts",
      JSON.stringify({ enabled: true, consentedAt: 10, engine: "invalido", kittenVoice: "fake-voice" }),
    );
    const loaded = loadTtsSettings();
    expect(loaded.engine).toBe("auto");
    expect(loaded.kittenVoice).toBe("expr-voice-2-f");
  });

  it("isTtsSupported exige speechSynthesis", () => {
    // jsdom no trae speechSynthesis → no soportado aquí.
    expect(isTtsSupported()).toBe(false);
  });
});

describe("kittenTtsEngine", () => {
  it("expone el catálogo completo de 8 voces KittenTTS con metadatos", () => {
    expect(KITTEN_VOICES).toHaveLength(8);
    const ids = KITTEN_VOICES.map((v) => v.id);
    expect(ids).toContain("expr-voice-2-m");
    expect(ids).toContain("expr-voice-2-f");
    expect(ids).toContain("expr-voice-3-m");
    expect(ids).toContain("expr-voice-3-f");
    expect(ids).toContain("expr-voice-4-m");
    expect(ids).toContain("expr-voice-4-f");
    expect(ids).toContain("expr-voice-5-m");
    expect(ids).toContain("expr-voice-5-f");

    for (const voice of KITTEN_VOICES) {
      expect(voice.lang).toBe("en");
      expect(["m", "f"]).toContain(voice.gender);
      expect(voice.name.length).toBeGreaterThan(0);
    }
  });

  it("normaliza abreviaturas literarias, números romanos y diálogo en inglés", () => {
    const input = '—"Mr. Darcy and Mrs. Bennet met Dr. Watson at St. Paul Church, Chapter IV: 42 steps."';
    const normalized = normalizeEnglishText(input);

    expect(normalized).toContain("Mister Darcy");
    expect(normalized).toContain("Missus Bennet");
    expect(normalized).toContain("Doctor Watson");
    expect(normalized).toContain("Saint Paul Church");
    expect(normalized).toContain("Chapter four");
    expect(normalized).toContain("forty-two steps");
    expect(normalized).not.toContain("—");
    expect(normalized).not.toContain('"');
  });

  it("recorta silencios muertos al inicio y final manteniendo un colchón de seguridad", () => {
    const sampleRate = 24000;
    const total = sampleRate; // 1 segundo
    const samples = new Float32Array(total);
    for (let i = 5000; i < 15000; i++) {
      samples[i] = 0.5;
    }
    const trimmed = trimLeadingAndTrailingSilence(samples, 0.003);
    expect(trimmed.length).toBeLessThan(total);
    expect(trimmed.length).toBeCloseTo(15000 - 5000 + 960 * 2, -2);
    expect(trimmed.some((v) => v > 0.4)).toBe(true);
  });

  it("descarga el modelo con ReadableStream reportando progreso y guardándolo en CacheStorage", async () => {
    const mockCache = {
      match: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const mockCaches = {
      open: vi.fn().mockResolvedValue(mockCache),
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal("caches", mockCaches);

    const chunk1 = new Uint8Array(100);
    const chunk2 = new Uint8Array(100);
    let readCount = 0;
    const mockStream = {
      getReader: () => ({
        read: async () => {
          readCount++;
          if (readCount === 1) return { done: false, value: chunk1 };
          if (readCount === 2) return { done: false, value: chunk2 };
          return { done: true, value: undefined };
        },
      }),
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: mockStream,
      headers: new Headers({ "content-length": "200" }),
    } as unknown as Response);

    const progressReports: number[] = [];
    const engine = new KittenTtsEngine();
    // Sin hash esperado: este caso prueba el flujo de descarga y caché; la
    // verificación de integridad la cubre kittenNetworkStorage.test.ts.
    await engine.downloadModelWithProgress((p) => {
      progressReports.push(p.percent);
    }, "/mock-model.onnx", "");

    expect(progressReports).toContain(50);
    expect(progressReports).toContain(100);
    expect(mockCache.put).toHaveBeenCalledWith(
      "/mock-model.onnx",
      expect.any(Response),
    );

    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("la tokenización añade el padding 0 inicial y final y genera un BigInt64Array válido", () => {
    const text = "Lecta Zero-Friction TTS";
    const tokenIds = prepareKittenInputIds(text);

    // Padding 0 obligatorio al inicio y final según StyleTTS2 ONNX
    expect(tokenIds.length).toBeGreaterThanOrEqual(3);
    expect(tokenIds[0]).toBe(0);
    expect(tokenIds[tokenIds.length - 1]).toBe(0);

    // Conversión a BigInt64Array requerida para el tensor ONNX int64 [1, N]
    const tensorData = BigInt64Array.from(tokenIds.map(BigInt));
    expect(tensorData).toBeInstanceOf(BigInt64Array);
    expect(tensorData.length).toBe(tokenIds.length);
    expect(tensorData[0]).toBe(0n);
    expect(tensorData[tensorData.length - 1]).toBe(0n);
  });

  it("kittenTtsEngine maneja muestras con NaN o silencios sin lanzar excepción en createBuffer", () => {
    // Buffer contaminado con NaN, Infinity y valores fuera de [-1, 1]
    const dirtySamples = new Float32Array([NaN, 2.5, -3.0, Infinity, -Infinity, 0.25]);
    const cleanSamples = sanitizeAudioSamples(dirtySamples);

    expect(cleanSamples.length).toBeGreaterThanOrEqual(240);
    expect(cleanSamples[0]).toBe(0); // NaN reemplazado
    // Normalización de pico proporcional (maxAbs = 3.0 > 0.98, divisor = 3.0 / 0.95)
    expect(cleanSamples[1]).toBeCloseTo((2.5 * 0.95) / 3.0, 5);
    expect(cleanSamples[2]).toBeCloseTo(-0.95, 5);
    expect(cleanSamples[3]).toBe(0); // Infinity reemplazado
    expect(cleanSamples[4]).toBe(0); // -Infinity reemplazado
    expect(cleanSamples[5]).toBeCloseTo((0.25 * 0.95) / 3.0, 5);

    // Caso de silencio absoluto / buffer vacío: debe tener al menos 240 muestras para createBuffer
    const emptySamples = new Float32Array(0);
    const sanitizedEmpty = sanitizeAudioSamples(emptySamples);
    expect(sanitizedEmpty.length).toBe(240);

    // Verificar que createBuffer jamás falle por frame count 0
    const fakeCtx = {
      createBuffer: vi.fn((_channels: number, length: number, rate: number) => {
        if (length === 0) throw new Error("The number of frames is 0");
        return { length, sampleRate: rate };
      }),
    };
    expect(() => fakeCtx.createBuffer(1, sanitizedEmpty.length, 24000)).not.toThrow();
  });

  it("la pre-síntesis (Lookahead Buffer N+1) no reutiliza un ArrayBuffer detached", async () => {
    const engine = new KittenTtsEngine();

    // Simular un buffer detached o con longitud cero
    const rawBuffer = new ArrayBuffer(2400);
    const detachedSamples = new Float32Array(rawBuffer, 0, 0);
    const safeOutput = sanitizeAudioSamples(detachedSamples);
    expect(safeOutput.length).toBeGreaterThanOrEqual(240);
    expect(safeOutput.byteLength).toBeGreaterThan(0);

    // Verificar que requestAudioBuffer devuelve una promesa segura y reutilizable
    const p1 = (engine as unknown as {
      requestAudioBuffer: (t: string, v: string, s: number, p: string) => Promise<AudioBuffer>;
    }).requestAudioBuffer("Lookahead text", "expr-voice-2-f", 1, "low");
    const p2 = (engine as unknown as {
      requestAudioBuffer: (t: string, v: string, s: number, p: string) => Promise<AudioBuffer>;
    }).requestAudioBuffer("Lookahead text", "expr-voice-2-f", 1, "high");

    expect(p1).toBe(p2);
    const buf = await p1;
    expect(buf.length).toBeGreaterThan(0);
  });

  it("speakSentenceWithLookahead pre-sintetiza N+1 y N+2 automáticamente", async () => {
    const engine = new KittenTtsEngine();
    vi.spyOn(engine, "isModelDownloaded").mockResolvedValue(true);
    const prefetchSpy = vi.spyOn(engine, "prefetchUpcoming");
    const sentences = [
      "Sentence zero.",
      "Sentence one.",
      "Sentence two.",
      "Sentence three.",
    ];

    await engine.speakSentenceWithLookahead({
      sentences,
      currentIndex: 0,
      voiceId: "expr-voice-2-f",
      speed: 1,
    });

    expect(prefetchSpy).toHaveBeenCalledWith(sentences, 1, "expr-voice-2-f", 1, 2);
  });

  it("init() devuelve false y mantiene ready = false ante INIT_ERROR del Worker", async () => {
    const engine = new KittenTtsEngine();
    type Listener = (e: { data?: unknown }) => void;
    const listeners: Record<string, Listener> = {};

    const fakeWorker = {
      postMessage: vi.fn((msg: { type: string }) => {
        if (msg.type === "INIT") {
          setTimeout(() => {
            listeners.message?.({
              data: { type: "INIT_ERROR", error: "Session creation failed in Worker" },
            });
          }, 0);
        }
      }),
      addEventListener: vi.fn((type: string, fn: Listener) => {
        listeners[type] = fn;
      }),
      removeEventListener: vi.fn((type: string) => {
        delete listeners[type];
      }),
      terminate: vi.fn(),
    };

    vi.spyOn(engine as unknown as { getWorker: () => unknown }, "getWorker").mockReturnValue(fakeWorker);
    vi.spyOn(engine, "isModelDownloaded").mockResolvedValue(true);
    vi.spyOn(engine, "isSupported").mockReturnValue(true);

    const ok = await engine.init();
    expect(ok).toBe(false);
    expect(engine.isReady()).toBe(false);
  });

  it("source.playbackRate.value se fija estrictamente en 1.0 para preservar el tono natural", () => {
    const fakeSource = {
      buffer: null,
      playbackRate: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };

    const fakeCtx = {
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      createBufferSource: () => {
        fakeSource.playbackRate.value = 0;
        return fakeSource;
      },
    } as unknown as AudioContext;

    vi.stubGlobal("AudioContext", class {
      constructor() {
        return fakeCtx;
      }
    });

    const fakeBuffer = {
      sampleRate: 24000,
      length: 240,
      duration: 0.05,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(240),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;

    kittenTtsEngine.play(fakeBuffer, 0.8);
    expect(fakeSource.playbackRate.value).toBe(1.0);

    kittenTtsEngine.play(fakeBuffer, 1.25);
    expect(fakeSource.playbackRate.value).toBe(1.0);

    vi.unstubAllGlobals();
  });

  it("playSentencesLoop reproduce con Kitten TTS si el modelo está descargado", async () => {
    const isDownloadedSpy = vi.spyOn(kittenTtsEngine, "isModelDownloaded").mockResolvedValue(true);
    const speakSpy = vi.spyOn(kittenTtsEngine, "speakSentenceWithLookahead").mockResolvedValue();

    const highlights: number[] = [];
    const onFinish = vi.fn();
    const sentences = ["One.", "Two."];

    await playSentencesLoop({
      sentences,
      startIndex: 0,
      engineMode: "kitten-hd",
      voiceId: "expr-voice-2-f",
      speed: 1,
      onHighlightSentence: (i) => highlights.push(i),
      onFinishPage: onFinish,
      isCancelled: () => false,
    });

    expect(speakSpy).toHaveBeenCalledTimes(2);
    expect(onFinish).toHaveBeenCalledTimes(1);

    expect(() => stopAllTtsPlayback()).not.toThrow();

    isDownloadedSpy.mockRestore();
    speakSpy.mockRestore();
  });
});

describe("ttsGuards", () => {
  it("los envoltorios marcan solo durante la llamada", () => {
    expect(isTtsProgrammaticNav()).toBe(false);
    let inside = false;
    withTtsProgrammaticNav(() => {
      inside = isTtsProgrammaticNav();
    });
    expect(inside).toBe(true);
    expect(isTtsProgrammaticNav()).toBe(false);

    // El guard de scroll es una ventana de tiempo (el evento llega
    // asíncrono tras scrollIntoView): dentro vigente, fuera no.
    vi.useFakeTimers();
    try {
      noteTtsProgrammaticScroll();
      expect(isTtsProgrammaticScroll()).toBe(true);
      vi.advanceTimersByTime(700);
      expect(isTtsProgrammaticScroll()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- Controlador: máquina de estados con speaker falso ----------

type FakeSpeaker = {
  spoken: string[];
  ended(): void;
  stalled(kind: "start" | "mid" | "resume"): void;
  pauseCount: number;
  resumeCount: number;
  cancelCount: number;
  // false simula un motor que soltó la cola al pausar (sin pause
  // real): resume() entonces debe re-speak la oración activa.
  alive?: boolean;
};

const makeDeps = (roots: HTMLElement[]) => {
  const events: Record<string, unknown>[] = [];
  const snaps: TtsSnapshot[] = [];
  const speakers: FakeSpeaker[] = [];
  let current = 0;
  let activities = 0;
  const deps: TtsControllerDeps = {
    language: () => "es",
    root: () => roots[current] ?? null,
    sectionIndex: () => current,
    sectionReady: () => true,
    navigateSection: (i) => {
      current = i;
    },
    reveal: () => undefined,
    emit: (d) => events.push(d),
    noteActivity: () => {
      activities += 1;
    },
    onSnapshot: (s) => snaps.push(s),
    supported: () => true,
    makeSpeaker: (ev) => {
      const fake: FakeSpeaker = {
        spoken: [],
        pauseCount: 0,
        resumeCount: 0,
        cancelCount: 0,
        ended: () => ev.onEnded(),
        stalled: (k) => ev.onStalled(k),
      };
      const speaker = {
        speak: (t: string) => void fake.spoken.push(t),
        pause: () => void fake.pauseCount++,
        resume: () => void fake.resumeCount++,
        cancel: () => void fake.cancelCount++,
        speakingNow: () => fake.alive !== false,
        setRate: () => undefined,
      };
      speakers.push(fake);
      return speaker;
    },
  };
  return {
    deps,
    events,
    snaps,
    speakers,
    activities: () => activities,
  };
};

const CTX: TtsTargetContext = {
  bookHash: "h",
  targetId: "t1",
  startSection: 0,
  endSection: 3,
  sectionIndex: 0,
};

// Los ajustes se leen del localStorage: el consentimiento es puerta.
const consent = () => consentTts(1_000);

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ttsController", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("no arranca sin consentimiento guardado", async () => {
    const { deps, events, snaps } = makeDeps([section("<p>Una. Otra.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    // La puerta corta antes de publicar: no hay evento ni cambio.
    expect(ctl.snapshot().status).toBe("idle");
    expect(events).toHaveLength(0);
    void snaps;
  });

  it("habla las oraciones en orden y emite inicio", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([
      section("<p>Una frase. Otra frase.</p>"),
    ]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.snapshot().status).toBe("speaking");
    expect(speakers[0].spoken).toEqual(["Una frase."]);
    expect(events[0].kind).toBe("tts_session_start");
    speakers[0].ended();
    expect(speakers[0].spoken).toEqual(["Una frase.", "Otra frase."]);
  });

  it("al terminar la sección avanza dentro del target y termina en chapter_end", async () => {
    consent();
    const roots = [
      section("<p>Solo una.</p>"),
      section("<p>Siguiente sección.</p>"),
      section(""),
    ];
    const navigated: number[] = [];
    const { deps, events, speakers } = makeDeps(roots);
    const nav = deps.navigateSection;
    deps.navigateSection = (i) => {
      navigated.push(i);
      nav(i);
    };
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].ended(); // fin sección 0 → navega a 1
    expect(navigated).toEqual([1]);
    ctl.onSectionRendered();
    expect(speakers[0].spoken.at(-1)).toBe("Siguiente sección.");
    speakers[0].ended(); // fin sección 1 → navega a 2 (vacía)
    ctl.onSectionRendered();
    // Sección 2 sin texto → sigue avanzando; 3 = endSection → chapter_end
    expect(navigated).toEqual([1, 2]);
    speakers[0].ended();
    ctl.onSectionRendered();
    const end = events.find((e) => e.kind === "tts_session_end");
    expect(end?.endReason).toBe("chapter_end");
    expect(end?.sectionAdvances).toBe(2);
    expect(ctl.snapshot().status).toBe("idle");
  });

  it("pausa y reanuda emitiendo eventos; el heartbeat alimenta actividad", async () => {
    consent();
    const { deps, events, speakers, activities } = makeDeps([
      section("<p>Larga una. Larga dos. Larga tres.</p>"),
    ]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    vi.advanceTimersByTime(30_000);
    expect(activities()).toBeGreaterThanOrEqual(1);
    ctl.pause("word_lookup");
    expect(ctl.snapshot().status).toBe("paused");
    expect(speakers[0].pauseCount).toBe(1);
    expect(
      events.some((e) => e.kind === "tts_paused" && e.reason === "word_lookup"),
    ).toBe(true);
    ctl.resume();
    expect(speakers[0].resumeCount).toBe(1);
    expect(events.some((e) => e.kind === "tts_resumed")).toBe(true);
    ctl.stop("user");
    const end = events.find((e) => e.kind === "tts_session_end");
    expect(end?.endReason).toBe("user");
    expect(end?.lookupCount).toBe(1);
    expect(end?.resumedCount).toBe(1);
  });

  it("un stall reintenta una vez; el segundo cierra con error", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].stalled("start");
    // Reintento: cancela y re-speak — un speaker nuevo.
    expect(speakers.length).toBe(2);
    speakers[1].stalled("start");
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("error");
  });

  it("cicla velocidades 1→1.2→0.8→1 y re-speak la oración", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Frase única.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.cycleRate()).toBe(1.2);
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Frase única.");
    expect(ctl.cycleRate()).toBe(0.8);
    expect(ctl.cycleRate()).toBe(1);
    expect(loadTtsSettings().rate).toBe(1);
  });

  it("visibilidad prolongada termina la sesión por su cuenta", async () => {
    consent();
    const { deps, events } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    const realHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    ctl.pause("visibility");
    vi.advanceTimersByTime(91_000);
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("visibility");
    if (realHidden) Object.defineProperty(document, "hidden", realHidden);
  });

  it("pausar en «preparing» no cuaja: al pintar la voz arranca igual", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    // La pausa llega antes de ensureVoices: no hay speaker ni mapa —
    // no debe dejar una sesión zombie sin nada que reanudar.
    ctl.pause("panel_opened");
    await flush();
    expect(ctl.snapshot().status).toBe("speaking");
    expect(speakers[0].spoken).toEqual(["Frase."]);
  });

  it("un salto de sección que nunca pinta termina la sesión con error", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([section("<p>Única.</p>")]);
    // La navegación acepta pero jamás llega el render (carga fallida).
    deps.navigateSection = () => undefined;
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].ended(); // fin de sección → pide avanzar a 1
    vi.advanceTimersByTime(9_000);
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("error");
    expect(ctl.snapshot().status).toBe("idle");
  });

  it("reanudar con la cola soltada re-speak la oración activa", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Una. Dos.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    ctl.pause("user");
    speakers[0].alive = false; // el motor vació la cola al pausar
    ctl.resume();
    // No se resume nada: se re-speak desde la oración en curso.
    expect(speakers[0].resumeCount).toBe(0);
    expect(speakers[0].spoken.at(-1)).toBe("Una.");
  });

  it("avanza y retrocede de frase con nextSentence y prevSentence", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Primera. Segunda. Tercera.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    expect(ctl.getCurrentSentence()).toBe("Primera.");
    ctl.nextSentence();
    expect(ctl.getCurrentSentence()).toBe("Segunda.");
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Segunda.");

    ctl.nextSentence();
    expect(ctl.getCurrentSentence()).toBe("Tercera.");

    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Segunda.");
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Segunda.");

    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Primera.");

    // prevSentence en el inicio no se desborda
    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Primera.");
  });

  it("permite ciclar velocidades personalizadas con cycleRate(customRates)", async () => {
    consent();
    const { deps } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    const customRates: [0.9, 1, 1.15, 1.3] = [0.9, 1, 1.15, 1.3];
    expect(ctl.cycleRate(customRates)).toBe(1.15);
    expect(ctl.cycleRate(customRates)).toBe(1.3);
    expect(ctl.cycleRate(customRates)).toBe(0.9);
    expect(ctl.cycleRate(customRates)).toBe(1);
  });

  it("pre-sintetiza oraciones anticipadas en Lookahead Buffer (lookahead = 2) y reproduce sin pausas", async () => {
    consent();
    saveTtsSettings({
      ...loadTtsSettings(),
      engine: "kitten-neural",
      kittenVoice: "expr-voice-2-f",
    });

    const fakeKitten = {
      isSupported: () => true,
      isReady: () => true,
      synthesized: [] as string[],
      played: [] as AudioBuffer[],
      synthesize: vi.fn(async (text: string) => {
        fakeKitten.synthesized.push(text);
        return {
          sampleRate: 24000,
          length: text.length * 100,
          duration: 0.2,
        } as AudioBuffer;
      }),
      play: vi.fn((buf: AudioBuffer) => {
        fakeKitten.played.push(buf);
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      isPlaying: () => true,
      getModelProgress: () => ({ status: "ready" as const, percent: 100 }),
    };

    const { deps } = makeDeps([
      section("<p>Sentence zero. Sentence one. Sentence two. Sentence three.</p>"),
    ]);
    deps.language = () => "en";
    deps.kittenEngine = fakeKitten as unknown as KittenTtsEngine;

    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    // Oración 0 se reproduce de inmediato
    expect(fakeKitten.played).toHaveLength(1);
    // Lookahead solicita Sentence one y Sentence two
    expect(ctl.getLookaheadBuffers?.().has(1)).toBe(true);
    expect(ctl.getLookaheadBuffers?.().has(2)).toBe(true);
    expect(fakeKitten.synthesized).toContain("Sentence one.");
    expect(fakeKitten.synthesized).toContain("Sentence two.");

    // Al avanzar a Sentence one
    ctl.nextSentence();
    await flush();

    // Se reproduce directamente desde el buffer pre-sintetizado
    expect(fakeKitten.played).toHaveLength(2);
    // Y solicita Sentence three
    expect(ctl.getLookaheadBuffers?.().has(3)).toBe(true);

    // Al avanzar a Sentence two
    ctl.nextSentence();
    await flush();

    // Se libera el buffer de Sentence zero (< cursor - 1)
    expect(ctl.getLookaheadBuffers?.().has(0)).toBe(false);
  });

  it("auto-avanza de página en modo paginado al avanzar de oración", async () => {
    consent();
    const s1 = section("<p id='sent-1'>Página 1.</p><p id='sent-2'>Página 2.</p>");
    let currentPage = 0;
    const { deps } = makeDeps([s1]);

    // En modo paginado, reveal calcula la página del elemento
    deps.reveal = (el: HTMLElement) => {
      if (el.textContent?.includes("Página 2")) {
        currentPage = 1;
      } else {
        currentPage = 0;
      }
    };

    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    expect(currentPage).toBe(0);

    ctl.nextSentence();
    await flush();

    expect(currentPage).toBe(1);
  });

  it("libera la memoria del worker de KittenTTS cuando la pestaña pasa a hidden estando inactivo", () => {
    vi.useFakeTimers();
    const engine = new KittenTtsEngine();
    const releaseSpy = vi.spyOn(engine, "releaseWorkerMemory");

    // Simular ciclo de inactividad
    (engine as unknown as { scheduleIdleRelease: () => void }).scheduleIdleRelease();
    vi.advanceTimersByTime(KITTEN_IDLE_TIMEOUT_MS + 100);

    expect(releaseSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("libera la memoria del worker de KittenTTS en evento visibilitychange a hidden", () => {
    const engine = new KittenTtsEngine();
    const releaseSpy = vi.spyOn(engine, "releaseWorkerMemory");

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(releaseSpy).toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    engine.dispose();
  });

  it("degrada suavemente a voz nativa si KittenTTS falla durante playSentencesLoop", async () => {
    const speakSpy = vi.spyOn(kittenTtsEngine, "speakSentenceWithLookahead").mockRejectedValueOnce(
      new Error("WASM Out of Memory"),
    );
    const releaseSpy = vi.spyOn(kittenTtsEngine, "releaseWorkerMemory");

    // Simular que el modelo está descargado para activar la rama Kitten
    vi.spyOn(kittenTtsEngine, "isModelDownloaded").mockResolvedValueOnce(true);

    const highlighted: number[] = [];
    let finished = false;

    await playSentencesLoop({
      sentences: ["Frase de prueba con fallback."],
      startIndex: 0,
      engineMode: "kitten-hd",
      voiceId: "expr-voice-2-f",
      speed: 1,
      onHighlightSentence: (idx) => highlighted.push(idx),
      onFinishPage: () => {
        finished = true;
      },
      isCancelled: () => false,
    });

    expect(speakSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(highlighted).toContain(0);
    expect(finished).toBe(true);

    speakSpy.mockRestore();
    releaseSpy.mockRestore();
  });

  it("ante un error o timeout del Worker en KittenTTS, el controlador conmuta a síntesis nativa sin bloquear la sesión", async () => {
    // Simular error de inferencia del Worker (como SYNTHESIS_ERROR o timeout de 12s)
    const workerError = new Error("KittenTTS Worker Inference Timeout");
    const speakSpy = vi.spyOn(kittenTtsEngine, "speakSentenceWithLookahead").mockRejectedValueOnce(workerError);
    const releaseSpy = vi.spyOn(kittenTtsEngine, "releaseWorkerMemory");
    vi.spyOn(kittenTtsEngine, "isModelDownloaded").mockResolvedValue(true);

    const spokenSentences: number[] = [];
    let pageEnded = false;

    await playSentencesLoop({
      sentences: ["Primera oración con fallo de worker.", "Segunda oración tras fallback nativo."],
      startIndex: 0,
      engineMode: "kitten-hd",
      voiceId: "expr-voice-2-f",
      speed: 1,
      onHighlightSentence: (idx) => spokenSentences.push(idx),
      onFinishPage: () => {
        pageEnded = true;
      },
      isCancelled: () => false,
    });

    expect(speakSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    // Debe haber avanzado y completado ambas oraciones sin bloquearse
    expect(spokenSentences).toContain(0);
    expect(spokenSentences).toContain(1);
    expect(pageEnded).toBe(true);

    speakSpy.mockRestore();
    releaseSpy.mockRestore();
  });

  it("cuando se cancela una síntesis con engine.stop() (ej: nextSentence), el .catch() no mata al Worker ni habla en voz nativa", async () => {
    consent();
    saveTtsSettings({
      ...loadTtsSettings(),
      engine: "kitten-neural",
      kittenVoice: "expr-voice-2-f",
    });

    const releaseSpy = vi.fn();
    let rejectPrevious: ((err: Error) => void) | null = null;

    const fakeKitten = {
      isSupported: () => true,
      isReady: () => true,
      synthesize: vi.fn((text: string) => {
        if (text.includes("Primera")) {
          return new Promise<AudioBuffer>((_resolve, reject) => {
            rejectPrevious = reject;
          });
        }
        return Promise.resolve({
          sampleRate: 24000,
          length: 2400,
          duration: 0.1,
        } as AudioBuffer);
      }),
      synthesizeLookahead: vi.fn().mockResolvedValue({
        sampleRate: 24000,
        length: 2400,
        duration: 0.1,
      } as AudioBuffer),
      play: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(() => {
        if (rejectPrevious) {
          rejectPrevious(new Error("Stopped"));
          rejectPrevious = null;
        }
      }),
      releaseWorkerMemory: releaseSpy,
      isPlaying: () => true,
      getModelProgress: () => ({ status: "ready" as const, percent: 100 }),
    };

    const nativeSpeaker = {
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      speakingNow: () => false,
      setRate: vi.fn(),
    };

    const { deps } = makeDeps([
      section("<p>Primera oración lenta. Segunda oración rápida.</p>"),
    ]);
    deps.language = () => "en";
    deps.kittenEngine = fakeKitten as unknown as KittenTtsEngine;
    deps.makeSpeaker = () => nativeSpeaker;

    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    // El usuario avanza rápidamente a la siguiente oración mientras la primera estaba en vuelo
    ctl.nextSentence();
    await flush();

    // El rechazo "Stopped" de la primera oración NO debe matar al Worker ni usar speaker nativo
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(nativeSpeaker.speak).not.toHaveBeenCalled();
  });

  it("shouldUseKitten no activa KittenTTS en libros en español cuando corre sin mock de pruebas", async () => {
    consent();
    saveTtsSettings({
      ...loadTtsSettings(),
      engine: "kitten-neural",
      kittenVoice: "expr-voice-2-f",
    });

    const nativeSpeaker = {
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      speakingNow: () => false,
      setRate: vi.fn(),
    };

    const { deps } = makeDeps([
      section("<p>Este es un texto en idioma español.</p>"),
    ]);
    deps.language = () => "es";
    // Sin kittenEngine inyectado (comportamiento real en producción)
    deps.kittenEngine = undefined;
    deps.makeSpeaker = () => nativeSpeaker;

    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    // Para libros en español, debe usar el speaker nativo y no KittenTTS
    expect(nativeSpeaker.speak).toHaveBeenCalledWith("Este es un texto en idioma español.", 1);
    expect(ctl.snapshot().activeEngine).toBe("browser");
  });

  it("playSentencesLoop pasa language a speakWithSystemVoice para evitar voz en español al leer inglés", async () => {
    vi.spyOn(kittenTtsEngine, "isModelDownloaded").mockResolvedValue(false);
    const speech = await import("./ttsSpeech");
    const speakSpy = vi.spyOn(speech, "speakWithSystemVoice").mockResolvedValue();

    await playSentencesLoop({
      sentences: ["Hello, world!"],
      startIndex: 0,
      engineMode: "browser",
      voiceId: "",
      speed: 1,
      language: "en",
      onHighlightSentence: () => {},
      onFinishPage: () => {},
      isCancelled: () => false,
    });

    expect(speakSpy).toHaveBeenCalledWith("Hello, world!", expect.objectContaining({ language: "en" }));
    speakSpy.mockRestore();
  });

  it("TtsAudioController reinicia la frase actual en caliente si se cambia la velocidad o la voz estando en reproducción", () => {
    const onStateChange = vi.fn();
    const ctrl = new TtsAudioController({ onStateChange });
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = "<p>Sentence one. Sentence two.</p>";
    ctrl.attachDocument(doc);

    // Mock play
    const playSpy = vi.spyOn(ctrl, "play").mockImplementation(() => {});

    // Poner estado en playing simulado
    // @ts-expect-error test private access
    ctrl.status = "playing";

    ctrl.setRate(1.2);
    expect(playSpy).toHaveBeenCalledTimes(1);

    ctrl.setVoice("kitten:expr-voice-3-m");
    expect(playSpy).toHaveBeenCalledTimes(2);

    playSpy.mockRestore();
  });

  it("playSentencesLoop llama a kittenTtsEngine.init si el modelo no está descargado previamente", async () => {
    vi.spyOn(kittenTtsEngine, "isModelDownloaded").mockResolvedValue(false);
    const initSpy = vi.spyOn(kittenTtsEngine, "init").mockResolvedValue(true);
    const speakSpy = vi.spyOn(kittenTtsEngine, "speakSentenceWithLookahead").mockResolvedValue();
    vi.spyOn(kittenTtsEngine, "isReady").mockReturnValue(true);

    const progressReports: number[] = [];

    await playSentencesLoop({
      sentences: ["Hello from KittenTTS!"],
      startIndex: 0,
      engineMode: "kitten-neural",
      voiceId: "expr-voice-2-f",
      speed: 1,
      language: "en",
      onDownloadProgress: (pct) => progressReports.push(pct),
      onHighlightSentence: () => {},
      onFinishPage: () => {},
      isCancelled: () => false,
    });

    expect(initSpy).toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalled();

    initSpy.mockRestore();
    speakSpy.mockRestore();
  });

  it("no arranca si el dispositivo no soporta TTS", async () => {
    consent();
    const { deps } = makeDeps([section("<p>Frase.</p>")]);
    deps.supported = () => false;
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.snapshot().status).toBe("idle");
  });

  it("un stall en pausa re-speak la oración y vuelve a pausar", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Una. Dos.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    ctl.pause("user");

    expect(speakers).toHaveLength(1);
    speakers[0].stalled("resume");

    expect(speakers).toHaveLength(2);
    expect(speakers[1].spoken.at(-1)).toBe("Una.");
    expect(speakers[1].pauseCount).toBe(1);
  });

  it("navega oraciones en pausa sin reanudar la voz", async () => {
    consent();
    const { deps, speakers } = makeDeps([
      section("<p>Primera. Segunda. Tercera.</p>"),
    ]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    ctl.pause("user");
    const spokenBefore = speakers[0].spoken.length;

    ctl.nextSentence();
    expect(ctl.getCurrentSentence()).toBe("Segunda.");
    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Primera.");
    expect(speakers[0].spoken).toHaveLength(spokenBefore);
  });

  it("cambia motor y voz en caliente sin cerrar la sesión", async () => {
    consent();
    const { deps } = makeDeps([section("<p>Frase única.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    ctl.setKittenVoice?.("expr-voice-2-f");
    expect(ctl.snapshot().kittenVoice).toBe("expr-voice-2-f");
    ctl.setEngine?.("auto");
    expect(ctl.snapshot().engine).toBe("auto");
    expect(ctl.snapshot().status).toBe("speaking");
  });

  it("reancla tras una mutación estructural y sigue hablando", async () => {
    consent();
    const root = section("<p>Una frase. Otra frase.</p>");
    const { deps } = makeDeps([root]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.getCurrentSentence()).toBe("Una frase.");

    root.innerHTML = "<p><em>Una frase.</em> Otra frase.</p>";
    ctl.onDomMutated();

    expect(ctl.snapshot().status).toBe("speaking");
    expect(ctl.getCurrentSentence()).toBe("Una frase.");
  });

  it("una mutación estando en pausa re-ancla sin reanudar", async () => {
    consent();
    const root = section("<p>Una frase. Otra frase.</p>");
    const { deps } = makeDeps([root]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    ctl.pause("user");

    root.innerHTML = "<p><em>Una frase.</em> Otra frase.</p>";
    ctl.onDomMutated();

    expect(ctl.snapshot().status).toBe("paused");
    expect(ctl.getCurrentSentence()).toBe("Una frase.");
  });

  it("destroy cierra por navegación y dispose libera el worker", async () => {
    consent();
    const { deps, events } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    const releaseSpy = vi.spyOn(kittenTtsEngine, "releaseWorkerMemory");
    ctl.destroy();
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("navigation");
    expect(ctl.snapshot().status).toBe("idle");

    ctl.dispose?.();
    expect(releaseSpy).toHaveBeenCalled();
    releaseSpy.mockRestore();
  });

  it("adquiere y libera el wake lock al hablar y pausar", async () => {
    consent();
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    Object.defineProperty(navigator, "wakeLock", {
      value: { request },
      configurable: true,
    });

    try {
      const { deps } = makeDeps([section("<p>Frase.</p>")]);
      const ctl = createTtsController(deps);
      ctl.start(CTX, 0);
      await flush();
      expect(request).toHaveBeenCalledWith("screen");

      ctl.pause("user");
      await flush();
      expect(release).toHaveBeenCalled();
    } finally {
      // @ts-expect-error limpieza del stub
      delete navigator.wakeLock;
    }
  });

  it("getCurrentSentence es null fuera de una sesión activa", () => {
    const { deps } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    expect(ctl.getCurrentSentence()).toBeNull();
  });

  it("sentenceStillValid exige un nodo de texto vivo", () => {
    const root = section("<p>Texto.</p>");
    const { items } = buildSentenceMap(root, 0);
    expect(sentenceStillValid(root, items[0])).toBe(true);

    const other = document.createElement("div");
    expect(sentenceStillValid(other, items[0])).toBe(false);
  });
});

describe("TtsAudioController (motor del sistema)", () => {
  afterEach(() => {
    // @ts-expect-error limpieza del stub
    delete window.speechSynthesis;
    vi.restoreAllMocks();
  });

  it("enumera voces del sistema y reemite estado al adjuntar documento", () => {
    const voice = {
      voiceURI: "v1",
      name: "Voz ES",
      lang: "es-MX",
      default: true,
    } as SpeechSynthesisVoice;
    Object.defineProperty(window, "speechSynthesis", {
      value: { getVoices: () => [voice] },
      configurable: true,
    });

    const onVoicesChange = vi.fn();
    const onStateChange = vi.fn();
    const ctrl = new TtsAudioController({ onVoicesChange, onStateChange });
    expect(onVoicesChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        { id: "v1", name: "Voz ES", lang: "es-MX", isDefault: true },
      ]),
    );

    const doc = document.implementation.createHTMLDocument();
    doc.documentElement.lang = "es";
    doc.body.innerHTML = "<p>Una. Dos.</p>";
    ctrl.attachDocument(doc);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalSentences: 2, currentIndex: 0 }),
    );

    ctrl.attachDocument(null);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalSentences: 0, currentIndex: 0 }),
    );
  });

  it("no reproduce sin oraciones y completa la sección con la voz del sistema", async () => {
    const speech = await import("./ttsSpeech");
    const speakSpy = vi
      .spyOn(speech, "speakWithSystemVoice")
      .mockResolvedValue();
    const onSectionEnd = vi.fn();
    const ctrl = new TtsAudioController({ onSectionEnd });

    ctrl.attachDocument(null);
    ctrl.play();
    expect(speakSpy).not.toHaveBeenCalled();

    const doc = document.implementation.createHTMLDocument();
    doc.documentElement.lang = "es";
    doc.body.innerHTML = "<p>Una. Dos.</p>";
    ctrl.attachDocument(doc);
    ctrl.play();
    await flush();

    expect(speakSpy).toHaveBeenCalledTimes(2);
    expect(onSectionEnd).toHaveBeenCalledTimes(1);
    speakSpy.mockRestore();
  });

  it("pausa, reanuda, navega, ajusta velocidad/voz y se destruye", () => {
    const onStateChange = vi.fn();
    const ctrl = new TtsAudioController({ onStateChange });
    const doc = document.implementation.createHTMLDocument();
    doc.documentElement.lang = "es";
    doc.body.innerHTML = "<p>Una. Dos. Tres.</p>";
    ctrl.attachDocument(doc);

    ctrl.pause();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "paused" }),
    );
    ctrl.next();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentIndex: 1 }),
    );
    ctrl.prev();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentIndex: 0 }),
    );
    ctrl.setRate(1.2);
    ctrl.setVoice("v1");
    ctrl.stop();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "idle", currentIndex: 0 }),
    );
    ctrl.destroy();
    ctrl.dispose();
  });
});
