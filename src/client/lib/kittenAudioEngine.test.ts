// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
    it("aplica clamp a [-1.0, 1.0] y reemplaza NaN e Infinity por 0", () => {
      const dirty = new Float32Array([1.5, -2.0, NaN, Infinity, -Infinity, 0.5, -0.5]);
      const clean = sanitizeAudioSamples(dirty);

      expect(clean.length).toBeGreaterThanOrEqual(240); // Mínimo para createBuffer
      expect(clean[0]).toBe(1.0);
      expect(clean[1]).toBe(-1.0);
      expect(clean[2]).toBe(0);
      expect(clean[3]).toBe(0);
      expect(clean[4]).toBe(0);
      expect(clean[5]).toBe(0.5);
      expect(clean[6]).toBe(-0.5);
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
  });
});
