// src/client/lib/kittenTtsEngine.ts
// Motor neural KittenTTS (<25MB, 24kHz) para Lecta.
// Soporta descarga opcional a CacheStorage ('lecta-kitten-tts-v2') con ReadableStream progress,
// Lookahead Buffer (N+1 y N+2) con cola LRU de 8 oraciones, y síntesis acelerada con Zero-Copy.

import type { KittenVoiceId, ModelDownloadProgress } from "./ttsTypes";
import type { TtsEngineKind, WorkerRequest, WorkerResponse } from "../workers/kitten-tts.worker";
import {
  KITTEN_CACHE_NAME,
  KITTEN_MODEL_BYTES,
  KITTEN_MODEL_SHA256,
  KITTEN_MODEL_URL,
  LEGACY_KITTEN_CACHE_NAMES,
} from "./kittenModel";
import {
  PIPER_CACHE_NAME,
  PIPER_CONFIG_URL,
  PIPER_MODEL_BYTES,
  PIPER_MODEL_SHA256,
  PIPER_MODEL_URL,
} from "./piperModel";

// Se reexportan para no romper a quien ya las importaba desde el motor; la fuente
// de verdad es `kittenModel.ts`, compartida con el worker y el service worker.
export {
  KITTEN_CACHE_NAME,
  KITTEN_MODEL_BYTES,
  KITTEN_MODEL_SHA256,
  KITTEN_MODEL_URL,
  LEGACY_KITTEN_CACHE_NAMES,
};

export const KITTEN_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos
export const WORKER_INFERENCE_TIMEOUT_MS = 12000; // 12 segundos límite por oración
// Piper VITS (~63 MB) es ~2.5× más pesado que Kitten: en gama media una
// oración larga puede tardar >12 s; el tope sube para no cortar a la mitad.
export const PIPER_INFERENCE_TIMEOUT_MS = 30000;
const MAX_PREFETCH_CACHE_ITEMS = 8; // Máximo de oraciones pre-sintetizadas en RAM
/** Tamaño mínimo aceptable antes de comprobar el hash: por debajo es un corte de red. */
const MIN_MODEL_BYTES = 10_000_000;

/** Metadatos del modelo ONNX por motor neural (kitten = inglés, piper = español). */
interface NeuralModelConfig {
  cacheName: string;
  modelUrl: string;
  configUrl?: string;
  sha256: string;
  bytes: number;
  label: string;
}

export function neuralModelConfig(engine: TtsEngineKind = "kitten"): NeuralModelConfig {
  if (engine === "piper") {
    return {
      cacheName: PIPER_CACHE_NAME,
      modelUrl: PIPER_MODEL_URL,
      configUrl: PIPER_CONFIG_URL,
      sha256: PIPER_MODEL_SHA256,
      bytes: PIPER_MODEL_BYTES,
      label: "Piper es_MX",
    };
  }
  return {
    cacheName: KITTEN_CACHE_NAME,
    modelUrl: KITTEN_MODEL_URL,
    sha256: KITTEN_MODEL_SHA256,
    bytes: KITTEN_MODEL_BYTES,
    label: "KittenTTS",
  };
}

/** SHA-256 en hex minúsculas, para comparar con `KITTEN_MODEL_SHA256`. */
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Borra cachés de versiones anteriores del modelo; no debe romper la descarga. */
async function purgeLegacyModelCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(
    LEGACY_KITTEN_CACHE_NAMES.map((name) => caches.delete(name).catch(() => false)),
  );
}

export interface DownloadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

interface PendingJob {
  resolve: (buffer: AudioBuffer) => void;
  reject: (err: Error) => void;
  epoch: number;
  engine: TtsEngineKind;
  timer?: ReturnType<typeof setTimeout> | number;
}

/** Última síntesis reportada por el worker (diagnóstico RTF por motor). */
export interface LastSynthStats {
  engine: TtsEngineKind;
  synthMs: number;
  audioMs: number;
}

import { normalizeEnglishText, numberToEnglishWords } from "./kittenNormalize";
export { normalizeEnglishText, numberToEnglishWords };

/**
 * Sanitiza las muestras de audio recibidas de la inferencia ONNX:
 * - Valida que el buffer no sea nulo ni esté detached (byteLength > 0).
 * - Convierte cualquier valor NaN o Infinity en 0.
 * - Aplica Peak Normalization (si maxPeak > 0.95, escala por 0.95 / maxPeak) en vez de hard-clipping
 *   para no distorsionar la onda ni saturar ("voz metálica/alien").
 * - Asegura un tamaño mínimo de 240 muestras (10ms a 24kHz) para que audioCtx.createBuffer jamás falle.
 */
export function sanitizeAudioSamples(
  samples: Float32Array | ArrayLike<number> | null | undefined,
): Float32Array {
  if (!samples) {
    return new Float32Array(240);
  }

  if (samples instanceof Float32Array && samples.byteLength === 0) {
    return new Float32Array(240);
  }

  const len = samples.length;
  if (len === 0) {
    return new Float32Array(240);
  }

  const targetLen = Math.max(240, len);
  const clean = new Float32Array(targetLen);

  // 1. Encontrar el pico máximo absoluto (maxPeak) de las muestras finitas
  let maxPeak = 0;
  for (let i = 0; i < len; i++) {
    const val = samples[i];
    if (Number.isFinite(val)) {
      const abs = Math.abs(val);
      if (abs > maxPeak) maxPeak = abs;
    }
  }

  // 2. Peak Normalization: si maxPeak > 0.95, multiplicar todas las muestras por 0.95 / maxPeak
  const scale = maxPeak > 0.95 ? 0.95 / maxPeak : 1.0;

  for (let i = 0; i < len; i++) {
    const val = samples[i];
    if (!Number.isFinite(val)) {
      clean[i] = 0;
    } else {
      clean[i] = val * scale;
    }
  }

  return clean;
}

export class KittenTtsEngine {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private epoch = 1;
  private ready = false;
  private initPromise: Promise<boolean> | null = null;
  private progress: ModelDownloadProgress = { status: "idle", percent: 0 };
  // Progreso por motor: «auto» del controlador no debe confundir el modelo
  // de un idioma con el del otro (kitten 24 MB vs piper ~63 MB).
  private progressByEngine: Record<TtsEngineKind, ModelDownloadProgress> = {
    kitten: { status: "idle", percent: 0 },
    piper: { status: "idle", percent: 0 },
  };
  private initEngine: TtsEngineKind = "kitten";

  // Trabajos esperando respuesta del Web Worker
  private pendingJobs = new Map<string, PendingJob>();
  private lastSynthStats: LastSynthStats | null = null;

  // Lookahead Buffer: guarda promesas de AudioBuffer listas o en proceso (LRU de 8 oraciones)
  private lookaheadCache = new Map<string, Promise<AudioBuffer>>();

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRequests = 0;
  private unbindVisibility: (() => void) | null = null;

  constructor() {
    this.attachVisibilityGuard();
    if (typeof caches !== "undefined") {
      void this.isModelDownloaded().then((cached) => {
        if (cached) {
          this.progress = { status: "ready", percent: 100 };
          this.progressByEngine.kitten = { status: "ready", percent: 100 };
        }
      });
    }
  }

  private scheduleIdleRelease(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.activeRequests > 0) return;

    this.idleTimer = setTimeout(() => {
      if (this.activeRequests === 0) {
        this.releaseWorkerMemory();
      }
    }, KITTEN_IDLE_TIMEOUT_MS);
  }

  private attachVisibilityGuard(): void {
    if (this.unbindVisibility || typeof document === 'undefined') return;

    const handleVisibility = () => {
      // En iOS Safari / Android Chrome, liberar el heap WASM/ONNX si la app pasa a background en pausa
      if (document.visibilityState === 'hidden' && this.activeRequests === 0) {
        this.releaseWorkerMemory();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    this.unbindVisibility = () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }

  /**
   * Termina el Web Worker de ONNX para devolver los ~24 MB de RAM al sistema operativo,
   * permitiendo que una futura llamada a synthesize() lo vuelva a instanciar bajo demanda.
   */
  public releaseWorkerMemory(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.initPromise = null;
    this.lookaheadCache.clear();
    for (const [, job] of this.pendingJobs) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(new Error("Worker terminated to release memory"));
    }
    this.pendingJobs.clear();
    this.activeRequests = 0;
  }

  public dispose(): void {
    this.releaseWorkerMemory();
    if (this.unbindVisibility) {
      this.unbindVisibility();
      this.unbindVisibility = null;
    }
    if (this.audioCtx && typeof this.audioCtx.close === "function") {
      void this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }

  public resetAudioContextForTesting(): void {
    this.audioCtx = null;
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

  getModelProgress(engine: TtsEngineKind = "kitten"): ModelDownloadProgress {
    return this.progressByEngine[engine];
  }

  /** Diagnóstico: ms de inferencia vs ms de audio de la última síntesis. */
  getLastSynthStats(): LastSynthStats | null {
    return this.lastSynthStats;
  }

  setReadyForTesting(ready: boolean): void {
    this.ready = ready;
    this.progress = ready
      ? { status: "ready", percent: 100 }
      : { status: "idle", percent: 0 };
  }

  /**
   * Verifica en 1ms si el usuario ya descargó el motor Kitten TTS previamente.
   * Valida estado 200, que no sea un fallback HTML y que el hash guardado en la
   * respuesta cacheada coincida con el esperado (no se recalcula el hash: son 24 MB).
   */
  async isModelDownloaded(
    modelUrl = KITTEN_MODEL_URL,
    expectedSha256: string = KITTEN_MODEL_SHA256,
    cacheName = KITTEN_CACHE_NAME,
  ): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    try {
      const cache = await caches.open(cacheName);
      const match = await cache.match(modelUrl);
      if (!match) return false;
      const status = match.status ?? 200;
      if (status !== 200) return false;
      const contentType = (match.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html")) return false;
      if (expectedSha256) {
        const cachedHash = (match.headers.get("x-model-sha256") || "").toLowerCase();
        if (cachedHash !== expectedSha256.toLowerCase()) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Descarga opcional del modelo ONNX (~24 MB) con barra de progreso real (0% a 100%).
   * Almacena en CacheStorage solo si el SHA-256 coincide: si no, no se cachea nada.
   * Sin fallbacks: el binario vive en R2 con la versión en el nombre, así que un 404
   * es un error de despliegue, no una razón para servir otra versión del modelo.
   */
  /** Versión engine-aware: elige caché/URL/hash según el motor neural. */
  async isEngineModelDownloaded(engine: TtsEngineKind = "kitten"): Promise<boolean> {
    const cfg = neuralModelConfig(engine);
    return this.isModelDownloaded(cfg.modelUrl, cfg.sha256, cfg.cacheName);
  }

  async downloadModelWithProgress(
    onProgress?: (p: DownloadProgress) => void,
    modelUrl = KITTEN_MODEL_URL,
    expectedSha256: string = KITTEN_MODEL_SHA256,
    cacheName = KITTEN_CACHE_NAME,
    expectedBytes = KITTEN_MODEL_BYTES,
  ): Promise<void> {
    if (await this.isModelDownloaded(modelUrl, expectedSha256, cacheName)) {
      this.progress = { status: "ready", percent: 100 };
      onProgress?.({
        loadedBytes: expectedBytes,
        totalBytes: expectedBytes,
        percent: 100,
      });
      return;
    }

    this.progress = { status: "downloading", percent: 0 };

    let response: Response | null = null;
    let lastStatus = 0;
    try {
      const res = await fetch(modelUrl);
      lastStatus = res.status ?? (res.ok ? 200 : 500);
      const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
      if (res.ok && lastStatus === 200 && !contentType.includes("text/html") && res.body) {
        response = res;
      }
    } catch {
      // Red caída: lastStatus sigue en 0 y el mensaje dirá "sin conexión".
    }

    // Exigir HTTP 200 íntegro (rechazando 206 Partial Content y páginas HTML de error/SPA)
    if (!response || !response.body) {
      this.progress = {
        status: "error",
        percent: 0,
        errorMessage: lastStatus === 206 ? "Respuesta parcial rechazada" : lastStatus ? `HTTP ${lastStatus}` : "Sin conexión",
      };
      throw new Error(
        `No se pudo descargar el motor de voz (${lastStatus || "sin conexión"})`,
      );
    }

    const declaredBytes = Number(response.headers.get("content-length")) || 0;
    const contentLength = declaredBytes || expectedBytes;
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

    if (loadedBytes < declaredBytes) {
      this.progress = { status: "error", percent: 0, errorMessage: "Descarga incompleta o corrupta" };
      throw new Error("El archivo del modelo ONNX está incompleto o truncado");
    }
    if (declaredBytes === 0 && loadedBytes < MIN_MODEL_BYTES) {
      this.progress = { status: "error", percent: 0, errorMessage: "Descarga incompleta o corrupta" };
      throw new Error("El archivo del modelo ONNX está incompleto o truncado");
    }

    const blob = new Blob(chunks as unknown as BlobPart[], { type: "application/octet-stream" });
    // Un solo ArrayBuffer para el hash y para la caché: un Response
    // construido sobre bytes no depende de que el Blob sea el nativo.
    const bytes = await blob.arrayBuffer();

    // Verificar integridad ANTES de escribir en caché: un binario alterado no se guarda.
    if (expectedSha256) {
      const actual = await sha256Hex(bytes);
      if (actual !== expectedSha256.toLowerCase()) {
        this.progress = {
          status: "error",
          percent: 0,
          errorMessage: "El modelo descargado no coincide con el esperado",
        };
        throw new Error(
          `Integridad del modelo inválida (esperado ${expectedSha256}, obtenido ${actual})`,
        );
      }
    }

    if (typeof caches !== "undefined") {
      const cache = await caches.open(cacheName);
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(blob.size),
        "Accept-Ranges": "bytes",
      };
      if (expectedSha256) {
        headers["x-model-sha256"] = expectedSha256.toLowerCase();
      }
      await cache.put(modelUrl, new Response(bytes, { headers }));
      if (cacheName === KITTEN_CACHE_NAME) {
        await purgeLegacyModelCaches();
      }
    }

    this.progress = { status: "ready", percent: 100 };
    onProgress?.({ loadedBytes: blob.size, totalBytes: blob.size, percent: 100 });
  }

  /**
   * Permite al usuario liberar el modelo desde el menú de ajustes si lo desea.
   */
  async removeDownloadedModel(engine: TtsEngineKind = "kitten"): Promise<void> {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.progress = { status: "idle", percent: 0 };
    this.progressByEngine[engine] = { status: "idle", percent: 0 };
    if (typeof caches !== "undefined") {
      await caches.delete(neuralModelConfig(engine).cacheName);
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
      this.progressByEngine[this.initEngine] = { status: "ready", percent: 100 };
      return;
    }

    if (msg.type === "SYNTHESIS_DONE" || msg.type === "synthesize_done") {
      const jobId = msg.jobId ?? msg.id;
      const pending = this.pendingJobs.get(jobId);
      if (!pending) return;
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pendingJobs.delete(jobId);

      if (msg.epoch !== undefined && msg.epoch < this.epoch) {
        pending.reject(new Error("Cancelled by epoch"));
        return;
      }

      try {
        const rawPcm = msg.pcm ?? msg.audioData;
        const cleanSamples = sanitizeAudioSamples(rawPcm);
        // Kitten devuelve 24 kHz; Piper lee audio.sample_rate del .onnx.json.
        const sampleRate = msg.sampleRate || 24000;
        if (typeof msg.synthMs === "number") {
          this.lastSynthStats = {
            engine: pending.engine,
            synthMs: msg.synthMs,
            audioMs: Math.round((cleanSamples.length / sampleRate) * 1000),
          };
        }
        const ctx = this.getAudioContext();

        if (ctx && typeof ctx.createBuffer === "function") {
          const audioBuffer = ctx.createBuffer(1, cleanSamples.length, sampleRate);
          audioBuffer.copyToChannel(cleanSamples as unknown as Float32Array<ArrayBuffer>, 0);
          pending.resolve(audioBuffer);
        } else {
          pending.resolve({
            sampleRate,
            length: cleanSamples.length,
            duration: cleanSamples.length / sampleRate,
            numberOfChannels: 1,
            getChannelData: () => cleanSamples,
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
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
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
    return this.audioCtx;
  }

  /**
   * Desbloquea de forma síncrona el AudioContext en el mismo tick del gesto del usuario
   * (click / tap), garantizando que navegadores móviles (iOS Safari, Chrome Android)
   * no silencien el contexto de audio antes de llamadas asíncronas o inferencia.
   */
  public unlockAudioContext(): AudioContext | null {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  }

  /**
   * Inicializa el Web Worker bajo demanda solo cuando se va a usar.
   * `engine` elige qué modelo se envía al worker (kitten por defecto).
   */
  async ensureInitialized(engine: TtsEngineKind = "kitten"): Promise<boolean> {
    if (this.ready && this.worker) return true;
    if (this.initPromise) return this.initPromise;
    this.initEngine = engine;

    this.initPromise = new Promise<boolean>((resolve) => {
      const worker = this.getWorker();
      if (!worker) {
        // En entornos sin Worker (como tests unitarios bajo jsdom), permitir el fallback de síntesis de test
        if (typeof Worker === "undefined") {
          this.ready = true;
          resolve(true);
          return;
        }
        this.ready = false;
        resolve(false);
        return;
      }

      const cleanup = () => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
      };

      const onMsg = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === "INIT_DONE" || msg.type === "init_done") {
          cleanup();
          this.ready = true;
          this.progress = { status: "ready", percent: 100 };
          this.progressByEngine[this.initEngine] = { status: "ready", percent: 100 };
          resolve(true);
        } else if (msg.type === "INIT_ERROR" || msg.type === "init_error") {
          cleanup();
          this.ready = false;
          this.progress = {
            status: "error",
            percent: 0,
            errorMessage: msg.error || "Error al inicializar sesión ONNX",
          };
          this.progressByEngine[this.initEngine] = this.progress;
          resolve(false);
        }
      };

      const onErr = (e: ErrorEvent) => {
        cleanup();
        this.ready = false;
        this.progress = {
          status: "error",
          percent: 0,
          errorMessage: e.message || "Error fatal en Web Worker de KittenTTS",
        };
        this.progressByEngine[this.initEngine] = this.progress;
        resolve(false);
      };

      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", onErr);

      void (async () => {
        try {
          if (engine === "piper") {
            const cfg = neuralModelConfig("piper");
            const [modelBuffer, configBuffer] = await Promise.all([
              getCachedModelBuffer(cfg.cacheName, cfg.modelUrl, cfg.sha256),
              getCachedModelBuffer(cfg.cacheName, cfg.configUrl!, ""),
            ]);
            if (modelBuffer) {
              worker.postMessage(
                {
                  type: "INIT",
                  engine: "piper",
                  modelBuffer,
                  configBuffer: configBuffer ?? undefined,
                } satisfies WorkerRequest,
                configBuffer ? [modelBuffer, configBuffer] : [modelBuffer],
              );
            } else {
              worker.postMessage({ type: "INIT", engine: "piper" } satisfies WorkerRequest);
            }
          } else {
            const buffer = await getKittenModelBuffer();
            if (buffer) {
              worker.postMessage({ type: "INIT", engine: "kitten", modelBuffer: buffer } satisfies WorkerRequest, [buffer]);
            } else {
              worker.postMessage({ type: "INIT", engine: "kitten", modelUrl: KITTEN_MODEL_URL } satisfies WorkerRequest);
            }
          }
        } catch {
          worker.postMessage({ type: "INIT", engine } satisfies WorkerRequest);
        }
      })();
    }).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  /**
   * Descarga el modelo del motor indicado. Para Piper baja además el
   * `.onnx.json` (~5 KB) que el worker necesita para phonemizar.
   */
  async downloadEngineModel(
    engine: TtsEngineKind = "kitten",
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    if (engine === "piper") {
      const cfg = neuralModelConfig("piper");
      await this.downloadModelWithProgress(
        (p) => {
          this.progressByEngine.piper = {
            status: p.percent >= 100 ? "ready" : "downloading",
            percent: p.percent,
          };
          onProgress?.(p);
        },
        cfg.modelUrl,
        cfg.sha256,
        cfg.cacheName,
        cfg.bytes,
      );
      // El JSON de config es diminuto: se baja y cachea sin barra propia.
      if (cfg.configUrl && typeof caches !== "undefined") {
        try {
          const cache = await caches.open(cfg.cacheName);
          if (!(await cache.match(cfg.configUrl))) {
            const res = await fetch(cfg.configUrl);
            if (res.ok) {
              const body = await res.arrayBuffer();
              await cache.put(
                cfg.configUrl,
                new Response(body, {
                  headers: { "Content-Type": "application/json" },
                }),
              );
            }
          }
        } catch {
          // Si falla el JSON, el worker lo reportará al sintetizar.
        }
      }
      return;
    }
    await this.downloadModelWithProgress((p) => {
      this.progressByEngine.kitten = {
        status: p.percent >= 100 ? "ready" : "downloading",
        percent: p.percent,
      };
      onProgress?.(p);
    });
  }

  async init(
    onProgress?: (progress: ModelDownloadProgress) => void,
    engine: TtsEngineKind = "kitten",
  ): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      const cfg = neuralModelConfig(engine);
      const cached = await this.isModelDownloaded(cfg.modelUrl, cfg.sha256, cfg.cacheName);
      if (!cached) {
        await this.downloadEngineModel(engine, (p) => {
          this.progress = { status: p.percent >= 100 ? "ready" : "downloading", percent: p.percent };
          onProgress?.(this.progress);
        });
      } else {
        this.progress = { status: "ready", percent: 100 };
        this.progressByEngine[engine] = { status: "ready", percent: 100 };
        onProgress?.(this.progress);
      }

      const ok = await this.ensureInitialized(engine);
      this.ready = ok;
      return ok;
    } catch (err) {
      this.ready = false;
      this.progress = {
        status: "error",
        percent: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      this.progressByEngine[engine] = this.progress;
      return false;
    }
  }

  private makeJobKey(text: string, voiceId: string, speed: number, engine: TtsEngineKind): string {
    return `${engine}:${voiceId}:${speed.toFixed(2)}:${text.trim()}`;
  }

  /**
   * Solicita la síntesis de una oración (o devuelve la promesa si ya está en el Lookahead Buffer).
   */
  private requestAudioBuffer(
    text: string,
    voiceId: string,
    speed: number,
    priority: "high" | "low",
    engine: TtsEngineKind = "kitten",
  ): Promise<AudioBuffer> {
    const key = this.makeJobKey(text, voiceId, speed, engine);

    // Reutilizar promesa/buffer si ya está en lookahead
    const existing = this.lookaheadCache.get(key);
    if (existing) {
      if (priority === "high" && this.pendingJobs.has(key) && this.worker) {
        this.worker.postMessage({
          type: "SYNTHESIZE",
          jobId: key,
          id: key,
          engine,
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
      const jobTimeoutMs = engine === "piper" ? PIPER_INFERENCE_TIMEOUT_MS : WORKER_INFERENCE_TIMEOUT_MS;
      promise = new Promise<AudioBuffer>((resolve, reject) => {
        const timer = typeof window !== "undefined"
          ? window.setTimeout(() => {
              const pending = this.pendingJobs.get(key);
              if (pending) {
                this.pendingJobs.delete(key);
                pending.reject(
                  new Error(
                    `TTS inference timed out after ${jobTimeoutMs}ms`,
                  ),
                );
              }
            }, jobTimeoutMs)
          : undefined;

        this.pendingJobs.set(key, { resolve, reject, epoch: currentEpoch, engine, timer });
        worker.postMessage({
          type: "SYNTHESIZE",
          jobId: key,
          id: key,
          engine,
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
        buf.copyToChannel(pcm, 0);
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
    engine: TtsEngineKind = "kitten",
  ): void {
    for (let offset = 0; offset < lookaheadCount; offset++) {
      const targetIdx = nextIndex + offset;
      if (targetIdx >= 0 && targetIdx < sentences.length) {
        const sentenceText = sentences[targetIdx]?.trim();
        if (sentenceText) {
          void this.requestAudioBuffer(sentenceText, voiceId, speed, "low", engine);
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
    engine?: TtsEngineKind;
    onSentenceAudioStart?: () => void;
  }): Promise<void> {
    const { sentences, currentIndex, voiceId, speed, onSentenceAudioStart } = options;
    const engine = options.engine ?? "kitten";
    const text = sentences[currentIndex]?.trim();
    if (!text) return;

    // Desbloqueo síncrono del AudioContext en el tick del gesto del usuario
    this.unlockAudioContext();

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.activeRequests++;
    this.attachVisibilityGuard();

    try {
      if (!(await this.isEngineModelDownloaded(engine))) {
        try {
          await this.downloadEngineModel(engine);
        } catch {
          // Si falla la descarga, ensureInitialized reportará el error
        }
      }
      const ok = await this.ensureInitialized(engine);
      if (!ok) {
        throw new Error("TTS neural engine failed to initialize");
      }
      const activeEpoch = this.epoch;

      // 1. Pedir la oración actual N (si ya estaba en el Lookahead Buffer, se resuelve en 0ms)
      const bufferPromise = this.requestAudioBuffer(text, voiceId, speed, "high", engine);

      // 2. Disparar de inmediato en el Worker la pre-síntesis de N+1 y N+2
      //    (Piper es más lento: un colchón extra reduce las pausas entre bloques).
      this.prefetchUpcoming(sentences, currentIndex + 1, voiceId, speed, engine === "piper" ? 3 : 2, engine);

      const audioBuffer = await bufferPromise;

      // Verificar que no se haya detenido/cambiado de página mientras esperaba
      if (activeEpoch !== this.epoch) return;

      // 3. Reproducir con Web Audio API (0ms de latencia de decodificación)
      const ctx = this.unlockAudioContext();
      this.stopCurrentSource();

      return await new Promise<void>((resolve) => {
        let settled = false;
        let source: AudioBufferSourceNode | null = null;
        const duration = audioBuffer.duration && audioBuffer.duration > 0 ? audioBuffer.duration : 0.05;
        const expectedDurationMs = Math.max(50, Math.round(duration * 1000));

        // Watchdog de seguridad: garantiza que la cola de lectura avance incluso si source.onended
        // se traba en background o la oración fue puramente silenciosa
        // Reloj del AudioContext (no de pared): en pausa o con la pantalla bloqueada no avanza en falso.
        let cancelWatchdog: (() => void) | undefined;

        const onDone = () => {
          if (!settled) {
            settled = true;
            cancelWatchdog?.();
            if (this.currentSource === source) {
              this.currentSource = null;
            }
            if (source) source.onended = null;
            resolve();
          }
        };

        if (!ctx) {
          onSentenceAudioStart?.();
          const ms = Math.max(10, Math.min(100, expectedDurationMs));
          if (typeof window !== "undefined") {
            window.setTimeout(onDone, ms);
          } else {
            onDone();
          }
          return;
        }

        try {
          source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          // El modelo ONNX ya sintetizó a la velocidad speed manteniendo el pitch y formantes naturales.
          // playbackRate debe ser 1.0 para no remuestrear ni distorsionar la voz ("alien / ardilla").
          source.playbackRate.value = 1.0;
          source.connect(ctx.destination);
          this.currentSource = source;

          source.onended = onDone;

          onSentenceAudioStart?.();
          source.start(0);
          cancelWatchdog = this.armPlaybackWatchdog(ctx, duration, () => {
            this.stopCurrentSource();
            onDone();
          });
        } catch {
          onDone();
        }
      });
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      this.scheduleIdleRelease();
    }
  }

  async synthesize(
    text: string,
    voiceId: KittenVoiceId | string = "expr-voice-2-f",
    speed = 1,
    priority: "high" | "low" = "high",
    engine: TtsEngineKind = "kitten",
  ): Promise<AudioBuffer> {
    this.unlockAudioContext();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.activeRequests++;
    this.attachVisibilityGuard();

    try {
      if (!(await this.isEngineModelDownloaded(engine))) {
        try {
          await this.downloadEngineModel(engine);
        } catch {
          // Si falla la descarga, ensureInitialized reportará el error
        }
      }
      const ok = await this.ensureInitialized(engine);
      if (!ok) {
        throw new Error("TTS neural engine failed to initialize");
      }
      return await this.requestAudioBuffer(text, voiceId, speed, priority, engine);
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      this.scheduleIdleRelease();
    }
  }

  async synthesizeLookahead(
    text: string,
    voiceId: KittenVoiceId | string = "expr-voice-2-f",
    speed = 1,
    engine: TtsEngineKind = "kitten",
  ): Promise<AudioBuffer> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.activeRequests++;
    try {
      if (!(await this.isEngineModelDownloaded(engine))) {
        try {
          await this.downloadEngineModel(engine);
        } catch {
          // Si falla la descarga, ensureInitialized reportará el error
        }
      }
      const ok = await this.ensureInitialized(engine);
      if (!ok) throw new Error("TTS neural engine failed to initialize");
      return await this.requestAudioBuffer(text, voiceId, speed, "low", engine);
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      this.scheduleIdleRelease();
    }
  }

  play(audioBuffer: AudioBuffer, _rate = 1, onEnded?: () => void): void {
    void _rate;
    this.stopCurrentSource();
    const ctx = this.unlockAudioContext();

    let settled = false;
    let source: AudioBufferSourceNode | null = null;
    const duration = audioBuffer.duration && audioBuffer.duration > 0 ? audioBuffer.duration : 0.05;
    const expectedDurationMs = Math.max(50, Math.round(duration * 1000));

    let cancelWatchdog: (() => void) | undefined;

    const onDone = () => {
      if (!settled) {
        settled = true;
        cancelWatchdog?.();
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        if (source) source.onended = null;
        onEnded?.();
      }
    };

    if (!ctx) {
      if (typeof window !== "undefined") {
        window.setTimeout(onDone, Math.max(50, Math.min(100, expectedDurationMs)));
      } else {
        onDone();
      }
      return;
    }

    try {
      source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      // playbackRate = 1.0 preserva la frecuencia original de 24kHz sin distorsión de resampling
      source.playbackRate.value = 1.0;
      source.connect(ctx.destination);

      source.onended = onDone;

      this.currentSource = source;
      source.start(0);
      cancelWatchdog = this.armPlaybackWatchdog(ctx, duration, () => {
        this.stopCurrentSource();
        onDone();
      });
    } catch {
      onDone();
    }
  }

  /**
   * Respaldo por si `onended` no llega. Mide con `ctx.currentTime`: un contexto suspendido
   * (pausa, pantalla bloqueada) no avanza, así que no dispara en falso. Devuelve el cancelador.
   */
  private armPlaybackWatchdog(ctx: AudioContext, durationSec: number, onTimeout: () => void): () => void {
    const startAt = ctx.currentTime;
    const limit = durationSec + 0.8;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const arm = (ms: number) => {
      timer = setTimeout(tick, ms);
    };
    const tick = () => {
      if (cancelled) return;
      if (ctx.state === "closed") {
        onTimeout();
        return;
      }
      if (ctx.state !== "running") {
        arm(1000);
        return;
      }
      const elapsed = ctx.currentTime - startAt;
      if (elapsed >= limit) {
        onTimeout();
        return;
      }
      arm((limit - elapsed) * 1000 + 50);
    };
    arm(limit * 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
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
      if (job.timer) clearTimeout(job.timer);
      job.reject(new Error("Stopped"));
    }
    this.pendingJobs.clear();
    this.activeRequests = 0;
    this.scheduleIdleRelease();
  }

  isPlaying(): boolean {
    return Boolean(this.currentSource);
  }
}

export const kittenTtsEngine = new KittenTtsEngine();

export function getKittenTtsEngine(): KittenTtsEngine {
  return kittenTtsEngine;
}

export function unlockAudioContext(): AudioContext | null {
  return kittenTtsEngine.unlockAudioContext();
}

export async function isKittenModelCached(
  modelUrl = KITTEN_MODEL_URL,
  expectedSha256: string = KITTEN_MODEL_SHA256,
): Promise<boolean> {
  return kittenTtsEngine.isModelDownloaded(modelUrl, expectedSha256);
}

/**
 * Lee un artefacto del modelo desde CacheStorage validando el sello
 * `x-model-sha256` guardado al descargar (sin recalcular el hash).
 * Genérico para Kitten (.onnx) y Piper (.onnx + .onnx.json).
 */
export async function getCachedModelBuffer(
  cacheName: string,
  modelUrl: string,
  expectedSha256 = "",
): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(cacheName);
    const res = await cache.match(modelUrl);
    if (!res || res.status !== 200) return null;
    const contentType = (res.headers?.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      await cache.delete(modelUrl);
      return null;
    }
    if (expectedSha256) {
      const cachedHash = (res.headers.get("x-model-sha256") || "").toLowerCase();
      if (cachedHash !== expectedSha256.toLowerCase()) {
        await cache.delete(modelUrl);
        return null;
      }
    }
    const buffer = await res.arrayBuffer();
    // Validar integridad mínima: por debajo de 10 MB está truncado/corrupto.
    if (expectedSha256 && buffer.byteLength < MIN_MODEL_BYTES) {
      await cache.delete(modelUrl);
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

export async function getKittenModelBuffer(
  modelUrl = KITTEN_MODEL_URL,
  expectedSha256: string = KITTEN_MODEL_SHA256,
): Promise<ArrayBuffer | null> {
  return getCachedModelBuffer(KITTEN_CACHE_NAME, modelUrl, expectedSha256);
}

export async function downloadKittenModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
  modelUrl = KITTEN_MODEL_URL,
  expectedSha256: string = KITTEN_MODEL_SHA256,
): Promise<void> {
  onProgress?.({ status: "downloading", percent: 0 });
  await kittenTtsEngine.downloadModelWithProgress((p) => {
    onProgress?.({
      status: p.percent >= 100 ? "ready" : "downloading",
      percent: p.percent,
    });
  }, modelUrl, expectedSha256);
  onProgress?.({ status: "ready", percent: 100 });
}