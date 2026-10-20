// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KittenTtsEngine,
  WORKER_INFERENCE_TIMEOUT_MS,
  kittenTtsEngine,
  sanitizeAudioSamples,
  unlockAudioContext,
} from "./kittenTtsEngine";
import { trimLeadingAndTrailingSilence } from "../workers/kitten-tts.worker";

describe("KittenTTS Web Audio & Memory Lifecycle (Fase 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    kittenTtsEngine.resetAudioContextForTesting();
  });

  afterEach(() => {
    kittenTtsEngine.releaseWorkerMemory();
    kittenTtsEngine.resetAudioContextForTesting();
  });

  describe("unlockAudioContext", () => {
    it("desbloquea e inicializa de forma síncrona el AudioContext", () => {
      let resumed = false;
      const fakeCtx = {
        state: "suspended",
        resume: vi.fn().mockImplementation(() => {
          resumed = true;
          return Promise.resolve();
        }),
        createBuffer: vi.fn(),
      } as unknown as AudioContext;

      vi.stubGlobal("AudioContext", class {
        constructor() {
          return fakeCtx;
        }
      });

      const ctx = unlockAudioContext();
      expect(ctx).toBe(fakeCtx);
      expect(fakeCtx.resume).toHaveBeenCalled();
      expect(resumed).toBe(true);

      vi.unstubAllGlobals();
    });

    it("es seguro e idempotente si AudioContext no está disponible", () => {
      const origAudioContext = window.AudioContext;
      // @ts-expect-error test override
      delete window.AudioContext;
      // @ts-expect-error test override
      delete window.webkitAudioContext;

      expect(() => unlockAudioContext()).not.toThrow();
      expect(unlockAudioContext()).toBeNull();

      window.AudioContext = origAudioContext;
    });
  });

  describe("sanitizeAudioSamples", () => {
    it("aplica normalización proporcional si hay picos > 0.95 y reemplaza NaN e Infinity por 0", () => {
      const dirty = new Float32Array([1.5, -2.0, NaN, Infinity, -Infinity, 0.5, -0.5]);
      const clean = sanitizeAudioSamples(dirty);

      expect(clean.length).toBeGreaterThanOrEqual(240); // Mínimo para createBuffer
      // maxPeak = 2.0 > 0.95 -> normalización de pico escalando por (0.95 / maxPeak)
      expect(clean[0]).toBeCloseTo(0.7125, 4);
      expect(clean[1]).toBeCloseTo(-0.95, 4);
      expect(clean[2]).toBe(0);
      expect(clean[3]).toBe(0);
      expect(clean[4]).toBe(0);
      expect(clean[5]).toBeCloseTo(0.2375, 4);
      expect(clean[6]).toBeCloseTo(-0.2375, 4);
    });

    it("no altera las muestras si maxPeak <= 0.95", () => {
      const normal = new Float32Array([0.1, -0.4, 0.95, -0.8]);
      const clean = sanitizeAudioSamples(normal);

      expect(clean[0]).toBeCloseTo(0.1, 5);
      expect(clean[1]).toBeCloseTo(-0.4, 5);
      expect(clean[2]).toBeCloseTo(0.95, 5);
      expect(clean[3]).toBeCloseTo(-0.8, 5);
    });

    it("normaliza picos mayores a 1.0 proporcionalmente sin hacer hard-clipping", () => {
      // Onda con forma progresiva con picos superiores a 1.0 (máx 2.5)
      const samples = new Float32Array([0.5, 1.25, 2.0, 2.5, 1.5, -0.5, -1.5, -2.5, -1.0]);
      const clean = sanitizeAudioSamples(samples);

      // maxPeak = 2.5 > 0.95 -> scale = 0.95 / 2.5 = 0.38
      // Verificar que ningún pico supera 0.95 (sin saturación ni recorte a ±1.0)
      for (let i = 0; i < samples.length; i++) {
        expect(Math.abs(clean[i])).toBeLessThanOrEqual(0.95 + 1e-6);
      }

      // El pico máximo queda exactamente en 0.95
      expect(clean[3]).toBeCloseTo(0.95, 5); // 2.5 * (0.95 / 2.5)
      expect(clean[7]).toBeCloseTo(-0.95, 5); // -2.5 * (0.95 / 2.5)

      // Verificar que NO hay hard-clipping: la relación proporcional entre muestras se conserva
      // En hard-clipping, tanto 2.0 como 2.5 se truncarían a 1.0 (ratio 1.0).
      // Con normalización proporcional: clean[3] / clean[2] === 2.5 / 2.0 === 1.25
      const ratio = clean[3] / clean[2];
      expect(ratio).toBeCloseTo(2.5 / 2.0, 5);
      expect(clean[1] / clean[0]).toBeCloseTo(1.25 / 0.5, 5);
    });

    it("previene errores de createBuffer con Float32Array vacío o buffer detached", () => {
      const empty = new Float32Array(0);
      const clean = sanitizeAudioSamples(empty);

      expect(clean.length).toBe(240);
      expect(clean.every((v) => v === 0)).toBe(true);
    });

    it("devuelve buffer de silencio mínimo si se le pasa null o undefined", () => {
      const cleanNull = sanitizeAudioSamples(null);
      const cleanUndef = sanitizeAudioSamples(undefined);

      expect(cleanNull.length).toBe(240);
      expect(cleanUndef.length).toBe(240);
    });
  });

  describe("trimLeadingAndTrailingSilence", () => {
    it("nunca devuelve Float32Array(0) vacío ante silencio total o umbral bajo", () => {
      const silent = new Float32Array(1000); // 1000 ceros
      const trimmed = trimLeadingAndTrailingSilence(silent, 0.003);

      expect(trimmed.length).toBeGreaterThanOrEqual(240);
      expect(trimmed.every((v) => v === 0)).toBe(true);
    });

    it("no falla si se le pasa un buffer de longitud 0", () => {
      const empty = new Float32Array(0);
      const trimmed = trimLeadingAndTrailingSilence(empty);

      expect(trimmed.length).toBe(240);
    });
  });

  describe("Inference timeout & queue lifecycle", () => {
    it("WORKER_INFERENCE_TIMEOUT_MS está configurado a 12000 ms", () => {
      expect(WORKER_INFERENCE_TIMEOUT_MS).toBe(12000);
    });

    it("play() dispara el callback onEnded incluso con AudioBuffer silencioso o corto", async () => {
      const fakeCtx = {
        state: "running",
        resume: vi.fn().mockResolvedValue(undefined),
        createBufferSource: () => ({
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        }),
      } as unknown as AudioContext;

      vi.stubGlobal("AudioContext", class {
        constructor() {
          return fakeCtx;
        }
      });

      const fakeBuffer = {
        sampleRate: 24000,
        length: 240,
        duration: 0.01,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(240),
        copyFromChannel: () => {},
        copyToChannel: () => {},
      } as unknown as AudioBuffer;

      let ended = false;
      kittenTtsEngine.play(fakeBuffer, 1, () => {
        ended = true;
      });

      // El watchdog de seguridad debe garantizar que se invoque onEnded
      await new Promise((r) => setTimeout(r, 900));
      expect(ended).toBe(true);

      vi.unstubAllGlobals();
    });

    it("source.playbackRate.value permanece en 1.0 incluso cuando speed es 0.8 o 1.25", () => {
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

      // 1. Probar velocidad lenta (0.8)
      kittenTtsEngine.play(fakeBuffer, 0.8);
      expect(fakeSource.playbackRate.value).toBe(1.0);

      // 2. Probar velocidad rápida (1.25)
      kittenTtsEngine.play(fakeBuffer, 1.25);
      expect(fakeSource.playbackRate.value).toBe(1.0);

      vi.unstubAllGlobals();
    });

    it("init() devuelve false y deja isReady() === false cuando el Worker emite INIT_ERROR", async () => {
      const engine = new KittenTtsEngine();
      type Listener = (e: { data?: unknown; message?: string }) => void;
      const listeners: Record<string, Listener> = {};

      const fakeWorker = {
        postMessage: vi.fn((msg: { type: string }) => {
          if (msg.type === "INIT") {
            setTimeout(() => {
              listeners.message?.({
                data: { type: "INIT_ERROR", error: "Failed to compile ONNX WebAssembly module" },
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
      expect(engine.getModelProgress().status).toBe("error");
      expect(engine.getModelProgress().errorMessage).toContain("Failed to compile ONNX WebAssembly module");
    });
  });
});
