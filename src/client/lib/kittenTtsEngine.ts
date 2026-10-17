// Adaptador del motor neural KittenTTS (<25MB, 24kHz) para Lecta.
// Maneja caché offline en CacheStorage ('lecta-kitten-tts-v1'), Web Worker
// para inferencia en segundo plano y reproducción mediante Web Audio API.

import type { KittenVoiceId, ModelDownloadProgress } from "./ttsTypes";
import type { WorkerRequest, WorkerResponse } from "../workers/kitten-tts.worker";

export const KITTEN_CACHE_NAME = "lecta-kitten-tts-v1";
export const KITTEN_MODEL_URL =
  "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx";
export const KITTEN_VOICES_URL =
  "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/voices.json";

// Normalización de texto en inglés para literatura y pronunciación
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

export async function isKittenModelCached(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(KITTEN_CACHE_NAME);
    const match = await cache.match(KITTEN_MODEL_URL);
    return Boolean(match);
  } catch {
    return false;
  }
}

export async function downloadKittenModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<void> {
  if (typeof caches === "undefined") {
    throw new Error("CacheStorage no soportado en este entorno.");
  }

  onProgress?.({ status: "downloading", percent: 0 });
  const cache = await caches.open(KITTEN_CACHE_NAME);
  const existing = await cache.match(KITTEN_MODEL_URL);
  if (existing) {
    onProgress?.({ status: "ready", percent: 100 });
    return;
  }

  try {
    const res = await fetch(KITTEN_MODEL_URL);
    if (!res.ok) {
      throw new Error(`Fallo al descargar modelo (${res.status} ${res.statusText})`);
    }

    const contentLength = Number(res.headers.get("content-length")) || 24_000_000;
    let receivedLength = 0;
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedLength += value.length;
          const percent = Math.min(99, Math.max(0, Math.round((receivedLength / contentLength) * 100)));
          onProgress?.({ status: "downloading", percent });
        }
      }
    } else {
      const blob = await res.blob();
      chunks.push(new Uint8Array(await blob.arrayBuffer()));
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const fullData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      fullData.set(chunk, offset);
      offset += chunk.length;
    }

    const cacheResponse = new Response(fullData, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(totalLength),
      },
    });
    await cache.put(KITTEN_MODEL_URL, cacheResponse);

    onProgress?.({ status: "ready", percent: 100 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress?.({ status: "error", percent: 0, errorMessage: msg });
    throw err;
  }
}

export async function getKittenModelBuffer(): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(KITTEN_CACHE_NAME);
    const match = await cache.match(KITTEN_MODEL_URL);
    if (!match) return null;
    return await match.arrayBuffer();
  } catch {
    return null;
  }
}

export class KittenTtsEngine {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: Float32Array) => void;
      reject: (err: Error) => void;
    }
  >();
  private reqIdCounter = 0;
  private ready = false;
  private progress: ModelDownloadProgress = { status: "idle", percent: 0 };

  constructor() {
    // Verificación preliminar de caché en segundo plano
    if (typeof caches !== "undefined") {
      void isKittenModelCached().then((cached) => {
        if (cached) {
          this.ready = true;
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
    const data = event.data;
    if (!data) return;

    if (data.type === "synthesize_done") {
      const p = this.pendingRequests.get(data.id);
      if (p) {
        this.pendingRequests.delete(data.id);
        p.resolve(data.audioData);
      }
    } else if (data.type === "synthesize_error") {
      const p = this.pendingRequests.get(data.id);
      if (p) {
        this.pendingRequests.delete(data.id);
        p.reject(new Error(data.error));
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        try {
          this.audioCtx = new AudioContextClass();
        } catch {
          this.audioCtx = null;
        }
      }
    }
    return this.audioCtx;
  }

  async init(onProgress?: (progress: ModelDownloadProgress) => void): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      const cached = await isKittenModelCached();
      if (!cached) {
        await downloadKittenModel((p) => {
          this.progress = p;
          onProgress?.(p);
        });
      } else {
        this.progress = { status: "ready", percent: 100 };
        onProgress?.(this.progress);
      }

      const buffer = await getKittenModelBuffer();
      const worker = this.getWorker();
      if (worker && buffer) {
        worker.postMessage({ type: "init", modelBuffer: buffer } satisfies WorkerRequest, [buffer]);
      }
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  async synthesize(
    text: string,
    voiceId: KittenVoiceId = "expr-voice-2-f",
    speed = 1,
  ): Promise<AudioBuffer> {
    const worker = this.getWorker();
    const id = `req_${++this.reqIdCounter}_${Date.now()}`;

    let pcm: Float32Array;
    if (worker) {
      pcm = await new Promise<Float32Array>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        worker.postMessage({
          type: "synthesize",
          id,
          text,
          voiceId,
          speed,
        } satisfies WorkerRequest);
      });
    } else {
      // Fallback si no hay Worker en el entorno (ej. vitest jsdom)
      const sampleRate = 24000;
      const clean = normalizeEnglishText(text);
      const durationSec = Math.max(0.3, clean.length / 14 / speed);
      const total = Math.floor(sampleRate * durationSec);
      pcm = new Float32Array(total);
    }

    const ctx = this.getAudioContext();
    if (ctx && typeof ctx.createBuffer === "function") {
      const audioBuffer = ctx.createBuffer(1, pcm.length, 24000);
      audioBuffer.getChannelData(0).set(pcm);
      return audioBuffer;
    }

    // Mock AudioBuffer si el entorno carece de Web Audio
    return {
      sampleRate: 24000,
      length: pcm.length,
      duration: pcm.length / 24000,
      numberOfChannels: 1,
      getChannelData: () => pcm,
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }

  play(audioBuffer: AudioBuffer, rate = 1, onEnded?: () => void): void {
    this.stop();
    const ctx = this.getAudioContext();
    if (!ctx) {
      // Sin Web Audio: llama a onEnded tras la duración estimada
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

  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Ignorar fallo al detener
      }
      this.currentSource = null;
    }
  }

  isPlaying(): boolean {
    return Boolean(this.currentSource);
  }
}

export const kittenTtsEngine = new KittenTtsEngine();

export function getKittenTtsEngine(): KittenTtsEngine {
  return kittenTtsEngine;
}
