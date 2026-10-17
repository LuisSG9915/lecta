// src/client/lib/kittenTtsEngine.ts
// Motor neural KittenTTS (<25MB, 24kHz) para Lecta.
// Soporta descarga opcional a CacheStorage ('lecta-kitten-tts-v1') con ReadableStream progress,
// Lookahead Buffer (N+1 y N+2) con cola LRU de 8 oraciones, y síntesis acelerada con Zero-Copy.

import type { KittenVoiceId, ModelDownloadProgress } from "./ttsTypes";
import type { WorkerRequest, WorkerResponse } from "../workers/kitten-tts.worker";

export const KITTEN_CACHE_NAME = "lecta-kitten-tts-v1";
export const KITTEN_MODEL_URL = "/models/kitten-tts-quantized.onnx";
const MAX_PREFETCH_CACHE_ITEMS = 8; // Máximo de oraciones pre-sintetizadas en RAM

export interface DownloadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

interface PendingJob {
  resolve: (buffer: AudioBuffer) => void;
  reject: (err: Error) => void;
  epoch: number;
}

// Conversión de números a palabras en inglés
const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

export function numberToEnglishWords(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return `minus ${numberToEnglishWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rem = n % 10;
    return `${TENS[Math.floor(n / 10)]}${rem ? `-${ONES[rem]}` : ""}`;
  }
  if (n < 1000) {
    const rem = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rem ? ` ${numberToEnglishWords(rem)}` : ""}`;
  }
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rem = n % 1000;
    return `${numberToEnglishWords(thousands)} thousand${rem ? ` ${numberToEnglishWords(rem)}` : ""}`;
  }
  return String(n);
}

const ROMAN_MAP: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
  XXI: 21, XXII: 22, XXIII: 23, XXIV: 24, XXV: 25, XXX: 30, XL: 40, L: 50,
};

function convertNumberOrRoman(val: string): string {
  const upper = val.toUpperCase();
  if (ROMAN_MAP[upper]) return numberToEnglishWords(ROMAN_MAP[upper]);
  const num = parseInt(val, 10);
  if (!isNaN(num)) return numberToEnglishWords(num);
  return val;
}

export function normalizeEnglishText(text: string): string {
  let t = text;
  // Diálogos: raya larga «—» y semirraya «–» a pausa breve
  t = t.replace(/[—–]/g, ", ");
  // Comillas tipográficas e inglesas
  t = t.replace(/[“”"']/g, "");
  t = t.replace(/[«»]/g, "");

  // Abreviaturas literarias
  t = t.replace(/\bMr\./g, "Mister");
  t = t.replace(/\bMr\b/g, "Mister");
  t = t.replace(/\bMrs\./g, "Missus");
  t = t.replace(/\bMrs\b/g, "Missus");
  t = t.replace(/\bMs\./g, "Miss");
  t = t.replace(/\bMs\b/g, "Miss");
  t = t.replace(/\bDr\./g, "Doctor");
  t = t.replace(/\bDr\b/g, "Doctor");
  t = t.replace(/\bSt\.\s/g, "Saint ");
  t = t.replace(/\bProf\./g, "Professor");
  t = t.replace(/\bCapt\./g, "Captain");
  t = t.replace(/\bGen\./g, "General");
  t = t.replace(/\bCol\./g, "Colonel");
  t = t.replace(/\bLt\./g, "Lieutenant");
  t = t.replace(/\bRev\./g, "Reverend");

  // Capítulos con números romanos o arábigos («Chapter IV» -> «Chapter four»)
  t = t.replace(/\bChapter\s+([0-9IVXLCDM]+)\b/gi, (_, val) => {
    return `Chapter ${convertNumberOrRoman(val)}`;
  });

  // Números a palabras
  t = t.replace(/\b\d+\b/g, (match) => {
    const num = parseInt(match, 10);
    return isNaN(num) ? match : numberToEnglishWords(num);
  });

  return t.replace(/\s+/g, " ").trim();
}

export class KittenTtsEngine {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private epoch = 1;
  private ready = false;
  private initPromise: Promise<boolean> | null = null;
  private progress: ModelDownloadProgress = { status: "idle", percent: 0 };

  // Trabajos esperando respuesta del Web Worker
  private pendingJobs = new Map<string, PendingJob>();

  // Lookahead Buffer: guarda promesas de AudioBuffer listas o en proceso (LRU de 8 oraciones)
  private lookaheadCache = new Map<string, Promise<AudioBuffer>>();

  constructor() {
    if (typeof caches !== "undefined") {
      void this.isModelDownloaded().then((cached) => {
        if (cached) {
          this.progress = { status: "ready", percent: 100 };
        }
      });
    }
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      (typeof AudioContext !== "undefined" ||
        typeof (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext !== "undefined")
    );
  }

  isReady(): boolean {
    return this.ready;
  }

  getModelProgress(): ModelDownloadProgress {
    return this.progress;
  }

  setReadyForTesting(ready: boolean): void {
    this.ready = ready;
    this.progress = ready
      ? { status: "ready", percent: 100 }
      : { status: "idle", percent: 0 };
  }

  /**
   * Verifica en 1ms si el usuario ya descargó el motor Kitten TTS previamente.
   */
  async isModelDownloaded(modelUrl = KITTEN_MODEL_URL): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    try {
      const cache = await caches.open(KITTEN_CACHE_NAME);
      const match = await cache.match(modelUrl);
      return Boolean(match);
    } catch {
      return false;
    }
  }

  /**
   * Descarga opcional del modelo ONNX (~24 MB) con barra de progreso real (0% a 100%).
   * Almacena en CacheStorage ('lecta-kitten-tts-v1') usando ReadableStream.
   */
  async downloadModelWithProgress(
    onProgress?: (p: DownloadProgress) => void,
    modelUrl = KITTEN_MODEL_URL,
  ): Promise<void> {
    if (await this.isModelDownloaded(modelUrl)) {
      this.progress = { status: "ready", percent: 100 };
      onProgress?.({ loadedBytes: 24_000_000, totalBytes: 24_000_000, percent: 100 });
      return;
    }

    this.progress = { status: "downloading", percent: 0 };
    const response = await fetch(modelUrl);
    if (!response.ok || !response.body) {
      this.progress = { status: "error", percent: 0, errorMessage: `HTTP ${response.status}` };
      throw new Error(`No se pudo descargar el motor de voz (${response.status})`);
    }

    const contentLength = Number(response.headers.get("content-length")) || 24_500_000;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loadedBytes += value.byteLength;
        const percent = Math.min(99, Math.round((loadedBytes / contentLength) * 100));
        this.progress = { status: "downloading", percent };
        onProgress?.({ loadedBytes, totalBytes: contentLength, percent });
      }
    }

    const blob = new Blob(chunks as unknown as BlobPart[], { type: "application/octet-stream" });
    if (typeof caches !== "undefined") {
      const cache = await caches.open(KITTEN_CACHE_NAME);
      await cache.put(
        modelUrl,
        new Response(blob, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(blob.size),
          },
        }),
      );
    }

    this.progress = { status: "ready", percent: 100 };
    onProgress?.({ loadedBytes: blob.size, totalBytes: blob.size, percent: 100 });
  }

  /**
   * Permite al usuario liberar los ~24 MB desde el menú de ajustes si lo desea.
   */
  async removeDownloadedModel(): Promise<void> {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.progress = { status: "idle", percent: 0 };
    if (typeof caches !== "undefined") {
      await caches.delete(KITTEN_CACHE_NAME);
    }
  }

  private getWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (!this.worker) {
      try {
        this.worker = new Worker(
          new URL("../workers/kitten-tts.worker.ts", import.meta.url),
          { type: "module" },
        );
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.onerror = (err) => {
          console.warn("KittenTTS Worker error:", err);
        };
      } catch {
        return null;
      }
    }
    return this.worker;
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "INIT_DONE" || msg.type === "init_done") {
      this.ready = true;
      this.progress = { status: "ready", percent: 100 };
      return;
    }

    if (msg.type === "SYNTHESIS_DONE" || msg.type === "synthesize_done") {
      const jobId = msg.jobId ?? msg.id;
      const pending = this.pendingJobs.get(jobId);
      if (!pending) return;
      this.pendingJobs.delete(jobId);

      if (msg.epoch !== undefined && msg.epoch < this.epoch) {
        pending.reject(new Error("Cancelled by epoch"));
        return;
      }

      try {
        const pcm = msg.pcm ?? msg.audioData;
        const sampleRate = msg.sampleRate || 24000;
        const ctx = this.getAudioContext();
        if (ctx && typeof ctx.createBuffer === "function") {
          const audioBuffer = ctx.createBuffer(1, pcm.length, sampleRate);
          audioBuffer.copyToChannel(pcm as any, 0);
          pending.resolve(audioBuffer);
        } else {
          pending.resolve({
            sampleRate,
            length: pcm.length,
            duration: pcm.length / sampleRate,
            numberOfChannels: 1,
            getChannelData: () => pcm,
            copyFromChannel: () => {},
            copyToChannel: () => {},
          } as unknown as AudioBuffer);
        }
      } catch (err) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } else if (msg.type === "SYNTHESIS_ERROR" || msg.type === "synthesize_error") {
      const jobId = msg.jobId ?? msg.id;
      const pending = this.pendingJobs.get(jobId);
      if (!pending) return;
      this.pendingJobs.delete(jobId);
      pending.reject(new Error(msg.error));
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.audioCtx = new AudioCtx({ sampleRate: 24000 });
        } catch {
          this.audioCtx = null;
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Inicializa el Web Worker bajo demanda solo cuando se va a usar.
   */
  async ensureInitialized(modelUrl = KITTEN_MODEL_URL): Promise<boolean> {
    if (this.ready && this.worker) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<boolean>((resolve) => {
      const worker = this.getWorker();
      if (!worker) {
        this.ready = true;
        resolve(true);
        return;
      }

      const onMsg = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === "INIT_DONE" || msg.type === "init_done") {
          worker.removeEventListener("message", onMsg);
          this.ready = true;
          this.progress = { status: "ready", percent: 100 };
          resolve(true);
        } else if (msg.type === "INIT_ERROR" || msg.type === "init_error") {
          worker.removeEventListener("message", onMsg);
          this.ready = false;
          resolve(false);
        }
      };

      worker.addEventListener("message", onMsg);

      void (async () => {
        try {
          const buffer = await getKittenModelBuffer(modelUrl);
          if (buffer) {
            worker.postMessage({ type: "INIT", modelBuffer: buffer } satisfies WorkerRequest, [buffer]);
          } else {
            worker.postMessage({ type: "INIT", modelUrl } satisfies WorkerRequest);
          }
        } catch {
          worker.postMessage({ type: "INIT", modelUrl } satisfies WorkerRequest);
        }
      })();
    }).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  async init(onProgress?: (progress: ModelDownloadProgress) => void): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      const cached = await this.isModelDownloaded();
      if (!cached) {
        await downloadKittenModel((p) => {
          this.progress = p;
          onProgress?.(p);
        });
      } else {
        this.progress = { status: "ready", percent: 100 };
        onProgress?.(this.progress);
      }

      await this.ensureInitialized();
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  private makeJobKey(text: string, voiceId: string, speed: number): string {
    return `${voiceId}:${speed.toFixed(2)}:${text.trim()}`;
  }

  /**
   * Solicita la síntesis de una oración (o devuelve la promesa si ya está en el Lookahead Buffer).
   */
  private requestAudioBuffer(
    text: string,
    voiceId: string,
    speed: number,
    priority: "high" | "low",
  ): Promise<AudioBuffer> {
    const key = this.makeJobKey(text, voiceId, speed);

    // Reutilizar promesa/buffer si ya está en lookahead
    const existing = this.lookaheadCache.get(key);
    if (existing) {
      if (priority === "high" && this.pendingJobs.has(key) && this.worker) {
        this.worker.postMessage({
          type: "SYNTHESIZE",
          jobId: key,
          id: key,
          text,
          voiceId,
          speed,
          priority: "high",
          epoch: this.epoch,
        } satisfies WorkerRequest);
      }
      return existing;
    }

    // Control de memoria LRU: mantener máximo MAX_PREFETCH_CACHE_ITEMS buffers en RAM
    if (this.lookaheadCache.size >= MAX_PREFETCH_CACHE_ITEMS) {
      const oldestKey = this.lookaheadCache.keys().next().value;
      if (oldestKey) this.lookaheadCache.delete(oldestKey);
    }

    const currentEpoch = this.epoch;
    const worker = this.getWorker();

    let promise: Promise<AudioBuffer>;
    if (worker) {
      promise = new Promise<AudioBuffer>((resolve, reject) => {
        this.pendingJobs.set(key, { resolve, reject, epoch: currentEpoch });
        worker.postMessage({
          type: "SYNTHESIZE",
          jobId: key,
          id: key,
          text,
          voiceId,
          speed,
          priority,
          epoch: currentEpoch,
        } satisfies WorkerRequest);
      });
    } else {
      // Fallback sin worker (entorno test/jsdom)
      const sampleRate = 24000;
      const clean = normalizeEnglishText(text);
      const durationSec = Math.max(0.2, clean.length / 14 / speed);
      const total = Math.floor(sampleRate * durationSec);
      const pcm = new Float32Array(total);
      const ctx = this.getAudioContext();
      let buf: AudioBuffer;
      if (ctx && typeof ctx.createBuffer === "function") {
        buf = ctx.createBuffer(1, pcm.length, sampleRate);
        buf.copyToChannel(pcm as any, 0);
      } else {
        buf = {
          sampleRate,
          length: pcm.length,
          duration: pcm.length / sampleRate,
          numberOfChannels: 1,
          getChannelData: () => pcm,
          copyFromChannel: () => {},
          copyToChannel: () => {},
        } as unknown as AudioBuffer;
      }
      promise = Promise.resolve(buf);
    }

    promise.catch(() => {
      if (this.lookaheadCache.get(key) === promise) {
        this.lookaheadCache.delete(key);
      }
    });

    this.lookaheadCache.set(key, promise);
    return promise;
  }

  /**
   * Encola la pre-síntesis silenciosa de las próximas oraciones (N+1 y N+2).
   * Se llama automáticamente apenas empieza a sonar la oración N.
   */
  prefetchUpcoming(
    sentences: string[],
    nextIndex: number,
    voiceId: string,
    speed: number,
    lookaheadCount = 2,
  ): void {
    for (let offset = 0; offset < lookaheadCount; offset++) {
      const targetIdx = nextIndex + offset;
      if (targetIdx >= 0 && targetIdx < sentences.length) {
        const sentenceText = sentences[targetIdx]?.trim();
        if (sentenceText) {
          void this.requestAudioBuffer(sentenceText, voiceId, speed, "low");
        }
      }
    }
  }

  /**
   * Reproduce la oración actual N y dispara en paralelo la pre-síntesis de N+1 y N+2.
   */
  async speakSentenceWithLookahead(options: {
    sentences: string[];
    currentIndex: number;
    voiceId: string;
    speed: number;
    onSentenceAudioStart?: () => void;
  }): Promise<void> {
    const { sentences, currentIndex, voiceId, speed, onSentenceAudioStart } = options;
    const text = sentences[currentIndex]?.trim();
    if (!text) return;

    await this.ensureInitialized();
    const activeEpoch = this.epoch;

    // 1. Pedir la oración actual N (si ya estaba en el Lookahead Buffer, se resuelve en 0ms)
    const bufferPromise = this.requestAudioBuffer(text, voiceId, speed, "high");

    // 2. Disparar de inmediato en el Worker la pre-síntesis de N+1 y N+2
    this.prefetchUpcoming(sentences, currentIndex + 1, voiceId, speed, 2);

    const audioBuffer = await bufferPromise;

    // Verificar que no se haya detenido/cambiado de página mientras esperaba
    if (activeEpoch !== this.epoch) return;

    // 3. Reproducir con Web Audio API (0ms de latencia de decodificación)
    const ctx = this.getAudioContext();
    this.stopCurrentSource();

    return new Promise<void>((resolve) => {
      if (!ctx) {
        onSentenceAudioStart?.();
        const duration = audioBuffer.duration && audioBuffer.duration > 0 ? audioBuffer.duration : 0.05;
        const ms = Math.max(10, Math.min(100, Math.round((duration / speed) * 1000)));
        window.setTimeout(() => resolve(), ms);
        return;
      }

      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      try {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = speed;
        source.connect(ctx.destination);
        this.currentSource = source;

        source.onended = () => {
          if (this.currentSource === source) {
            this.currentSource = null;
          }
          source.onended = null;
          resolve();
        };

        onSentenceAudioStart?.();
        source.start(0);
      } catch {
        resolve();
      }
    });
  }

  async synthesize(
    text: string,
    voiceId: KittenVoiceId = "expr-voice-2-f",
    speed = 1,
  ): Promise<AudioBuffer> {
    await this.ensureInitialized();
    return this.requestAudioBuffer(text, voiceId, speed, "high");
  }

  play(audioBuffer: AudioBuffer, rate = 1, onEnded?: () => void): void {
    this.stopCurrentSource();
    const ctx = this.getAudioContext();
    if (!ctx) {
      const ms = Math.max(100, Math.round(((audioBuffer.duration || 1) / rate) * 1000));
      window.setTimeout(() => onEnded?.(), ms);
      return;
    }

    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    try {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = rate;
      source.connect(ctx.destination);

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        source.onended = null;
        onEnded?.();
      };

      this.currentSource = source;
      source.start(0);
    } catch {
      onEnded?.();
    }
  }

  pause(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === "running") {
      void ctx.suspend();
    }
  }

  resume(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  private stopCurrentSource(): void {
    if (this.currentSource) {
      const src = this.currentSource;
      this.currentSource = null;
      src.onended = null;
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignorar fallo al detener
      }
    }
  }

  /**
   * Detiene el audio al instante e invalida cualquier pre-síntesis vieja en el Worker.
   */
  stop(): void {
    this.epoch++;
    this.stopCurrentSource();
    this.lookaheadCache.clear();

    if (this.worker) {
      this.worker.postMessage({
        type: "CANCEL_EPOCH",
        epoch: this.epoch,
      } satisfies WorkerRequest);
    }

    for (const [, job] of this.pendingJobs) {
      job.reject(new Error("Stopped"));
    }
    this.pendingJobs.clear();
  }

  isPlaying(): boolean {
    return Boolean(this.currentSource);
  }
}

export const kittenTtsEngine = new KittenTtsEngine();

export function getKittenTtsEngine(): KittenTtsEngine {
  return kittenTtsEngine;
}

export async function isKittenModelCached(modelUrl = KITTEN_MODEL_URL): Promise<boolean> {
  return kittenTtsEngine.isModelDownloaded(modelUrl);
}

export async function getKittenModelBuffer(modelUrl = KITTEN_MODEL_URL): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(KITTEN_CACHE_NAME);
    const res = await cache.match(modelUrl);
    if (!res) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function downloadKittenModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
  modelUrl = KITTEN_MODEL_URL,
): Promise<void> {
  onProgress?.({ status: "downloading", percent: 0 });
  await kittenTtsEngine.downloadModelWithProgress((p) => {
    onProgress?.({
      status: p.percent >= 100 ? "ready" : "downloading",
      percent: p.percent,
    });
  }, modelUrl);
  onProgress?.({ status: "ready", percent: 100 });
}