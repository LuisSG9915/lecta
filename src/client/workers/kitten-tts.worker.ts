// src/client/workers/kitten-tts.worker.ts
// Worker de inferencia TTS multi-motor (Kitten nano 0.8 inglés + Piper VITS es_MX).
// Comparte una sola instancia de onnxruntime-web (WASM, numThreads=1) y mantiene
// COMO MÁXIMO una InferenceSession viva: al cambiar de motor se libera la sesión
// anterior antes de crear la nueva (los pesos quedan en CacheStorage y recargan
// sin red). Cola con prioridad high/low y cancelación por época, igual que antes.
//
// Pipeline Kitten: normalizeEnglishText → phonemas IPA → input_ids/style/speed.
// Pipeline Piper:  normalizeSpanishText → SpanishG2P → Encoder → input/input_lengths/scales.

import type { KittenVoiceId } from "../lib/ttsTypes";
import { getVoiceEmbedding, registerVoiceEmbedding } from "../lib/kittenVoicesData";
import { normalizeEnglishText } from "../lib/kittenNormalize";
import { prepareKittenInputIds } from "../lib/kittenPhonemizer";
import { KITTEN_CACHE_NAME, KITTEN_MODEL_URL } from "../lib/kittenModel";
import {
  PIPER_CACHE_NAME,
  PIPER_CONFIG_URL,
  PIPER_MODEL_URL,
} from "../lib/piperModel";
import {
  parsePiperModelConfig,
  textToPiperIds,
  type PiperModelConfig,
} from "../lib/piperPhonemizer";

export const ORT_WASM_VERSION = "1.30.0";
export const ORT_WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`;

export { normalizeEnglishText };

export type TtsEngineKind = "kitten" | "piper";

export type WorkerRequest =
  | {
      type: "INIT" | "init";
      engine?: TtsEngineKind;
      modelUrl?: string;
      modelBuffer?: ArrayBuffer;
      /** JSON del `.onnx.json` de Piper (phoneme_id_map, escalas, sample rate). */
      configBuffer?: ArrayBuffer;
      voicesData?: Record<string, unknown>;
    }
  | {
      type: "SYNTHESIZE" | "synthesize";
      jobId?: string;
      id?: string;
      engine?: TtsEngineKind;
      text: string;
      voiceId?: KittenVoiceId | string;
      speed?: number;
      priority?: "high" | "low";
      epoch?: number;
    }
  | {
      type: "CANCEL_EPOCH" | "cancel_epoch";
      epoch: number;
    };

export type WorkerResponse =
  | { type: "INIT_DONE" | "init_done" }
  | { type: "INIT_ERROR" | "init_error"; error: string }
  | {
      type: "SYNTHESIS_DONE" | "synthesize_done";
      jobId: string;
      id: string;
      pcm: Float32Array;
      audioData: Float32Array;
      sampleRate: number;
      epoch: number;
      /** ms de inferencia ONNX en el worker (diagnóstico RTF). */
      synthMs?: number;
    }
  | {
      type: "SYNTHESIS_ERROR" | "synthesize_error";
      jobId: string;
      id: string;
      error: string;
      epoch: number;
    };

interface SynthJob {
  jobId: string;
  engine: TtsEngineKind;
  text: string;
  voiceId: KittenVoiceId | string;
  speed: number;
  priority: "high" | "low";
  epoch: number;
}

type OnnxTensorData = Float32Array | Int32Array | BigInt64Array | Uint8Array;

type OnnxInferenceSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, { data: OnnxTensorData }>): Promise<
    Record<string, { data: OnnxTensorData }>
  >;
  release?: () => Promise<void>;
};

type OrtModule = Awaited<typeof import("onnxruntime-web/wasm")>;

const KITTEN_SAMPLE_RATE = 24000;
const PIPER_DEFAULT_SAMPLE_RATE = 22050;

let currentEpoch = 0;
let isProcessing = false;
let ortModule: OrtModule | null = null;

// Una sola sesión ONNX viva a la vez (RAM de móvil).
let kittenSession: OnnxInferenceSession | null = null;
let piperSession: OnnxInferenceSession | null = null;
let piperConfig: PiperModelConfig | null = null;

function postWorkerMessage(message: WorkerResponse, transfer?: Transferable[]): void {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    if (transfer && transfer.length > 0) {
      (self.postMessage as (msg: unknown, tr: Transferable[]) => void)(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

// Cola de trabajos: los de prioridad 'high' siempre van antes que los 'low' (lookahead)
const jobQueue: SynthJob[] = [];

function enqueueJob(job: SynthJob) {
  const existingIdx = jobQueue.findIndex((j) => j.jobId === job.jobId);
  if (existingIdx !== -1) {
    if (job.priority === "high") {
      const [existing] = jobQueue.splice(existingIdx, 1);
      existing.priority = "high";
      jobQueue.unshift(existing);
    }
    void processNextJob();
    return;
  }

  if (job.priority === "high") {
    const firstLowIdx = jobQueue.findIndex((j) => j.priority === "low");
    if (firstLowIdx === -1) {
      jobQueue.push(job);
    } else {
      jobQueue.splice(firstLowIdx, 0, job);
    }
  } else {
    jobQueue.push(job);
  }

  void processNextJob();
}

async function processNextJob() {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;

  while (jobQueue.length > 0) {
    const job = jobQueue.shift()!;

    // Si el usuario cambió de página o detuvo el audio, descartar lookahead viejo
    if (job.epoch < currentEpoch) {
      continue;
    }

    try {
      // Garantiza la sesión del motor correcto antes de sintetizar
      // (libera la sesión ONNX del otro motor si estaba activa).
      await ensureEngine(job.engine);

      const synthStart = performance.now();
      const result =
        job.engine === "piper"
          ? await runPiperInference(job.text, job.voiceId, job.speed)
          : {
              samples: await runKittenInference(
                job.text,
                job.voiceId as KittenVoiceId,
                job.speed,
              ),
              sampleRate: KITTEN_SAMPLE_RATE,
            };
      const synthMs = Math.round(performance.now() - synthStart);

      // Verificar de nuevo tras la inferencia por si se canceló mientras calculaba
      if (job.epoch < currentEpoch) {
        continue;
      }

      // Crear una copia fresca independiente antes de transferir para evitar buffers detached
      const pcm = new Float32Array(result.samples);

      const response: WorkerResponse = {
        type: "SYNTHESIS_DONE",
        jobId: job.jobId,
        id: job.jobId,
        pcm,
        audioData: pcm,
        sampleRate: result.sampleRate,
        epoch: job.epoch,
        synthMs,
      };

      // Transferencia Zero-Copy del ArrayBuffer al hilo principal
      postWorkerMessage(response, [pcm.buffer]);
    } catch (err) {
      if (job.epoch >= currentEpoch) {
        postWorkerMessage({
          type: "SYNTHESIS_ERROR",
          jobId: job.jobId,
          id: job.jobId,
          error: err instanceof Error ? err.message : String(err),
          epoch: job.epoch,
        } satisfies WorkerResponse);
      }
    }
  }

  isProcessing = false;
}

/**
 * Elimina silencios muertos al principio y final del tensor de salida.
 * `sampleRate` solo ajusta el colchón de 40 ms (Kitten 24 kHz, Piper 22.05 kHz).
 * Garantiza siempre devolver un buffer no-vacío (mínimo ~240 muestras) para
 * prevenir que audioCtx.createBuffer falle con "The number of frames is 0".
 */
export function trimLeadingAndTrailingSilence(
  samples: Float32Array,
  threshold = 0.003,
  sampleRate = KITTEN_SAMPLE_RATE,
): Float32Array {
  if (!samples || samples.length === 0) {
    return new Float32Array(240);
  }

  let start = 0;
  let end = samples.length - 1;

  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;

  if (start >= end) {
    return new Float32Array(240);
  }

  const pad = Math.floor(sampleRate * 0.025);
  const safeStart = Math.max(0, start - pad);
  const safeEnd = Math.min(samples.length, end + pad);

  const trimmed = samples.slice(safeStart, safeEnd);
  return trimmed.length > 0 ? trimmed : new Float32Array(240);
}

// ---------------------------------------------------------------------------
// Sesiones ONNX: una sola activa (Kitten XOR Piper)
// ---------------------------------------------------------------------------

async function releaseSession(session: OnnxInferenceSession | null): Promise<void> {
  if (!session) return;
  try {
    if (typeof session.release === "function") {
      await session.release();
    }
  } catch {
    // liberar es best-effort
  }
}

/** Crea una InferenceSession desde un ArrayBuffer ya descargado. */
async function createSessionFromBuffer(buffer: ArrayBuffer): Promise<OnnxInferenceSession> {
  const ort = await configureOrtWasmEnv();
  return (await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  })) as unknown as OnnxInferenceSession;
}

/** Lee un modelo desde CacheStorage (sin red) y crea la sesión. */
async function createSessionFromCache(
  cacheName: string,
  modelUrl: string,
  minBytes: number,
): Promise<OnnxInferenceSession> {
  if (typeof caches === "undefined") {
    throw new Error("CacheStorage no disponible");
  }
  const cache = await caches.open(cacheName);
  const match = await cache.match(modelUrl);
  if (!match || match.status !== 200) {
    throw new Error(`Modelo no descargado en caché (${modelUrl})`);
  }
  const buf = await match.arrayBuffer();
  if (buf.byteLength < minBytes) {
    throw new Error("Modelo en caché truncado o corrupto");
  }
  return createSessionFromBuffer(buf);
}

async function loadPiperConfigFromCache(): Promise<PiperModelConfig | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(PIPER_CACHE_NAME);
    const match = await cache.match(PIPER_CONFIG_URL);
    if (!match || match.status !== 200) return null;
    const text = await match.text();
    return parsePiperModelConfig(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Garantiza que el motor pedido tenga su sesión ONNX lista y que sea la
 * única viva. Si el otro motor estaba activo, libera su sesión primero.
 */
async function ensureEngine(engine: TtsEngineKind): Promise<void> {
  if (engine === "kitten" && kittenSession) {
    return;
  }
  if (engine === "piper" && piperSession && piperConfig) {
    return;
  }

  // Liberar la sesión del otro motor antes de instanciar la nueva.
  if (engine === "kitten") {
    await releaseSession(piperSession);
    piperSession = null;
  } else {
    await releaseSession(kittenSession);
    kittenSession = null;
  }

  if (engine === "kitten") {
    kittenSession = await createSessionFromCache(
      KITTEN_CACHE_NAME,
      KITTEN_MODEL_URL,
      10_000_000,
    );
    return;
  }

  // Piper: necesita sesión + config (phoneme_id_map, escalas, sample rate).
  if (!piperConfig) {
    piperConfig = await loadPiperConfigFromCache();
  }
  if (!piperConfig?.phoneme_id_map) {
    throw new Error("Configuración del modelo Piper no disponible");
  }
  piperSession = await createSessionFromCache(
    PIPER_CACHE_NAME,
    PIPER_MODEL_URL,
    10_000_000,
  );
}

// ---------------------------------------------------------------------------
// Pipeline Kitten (inglés, 24 kHz)
// ---------------------------------------------------------------------------

/**
 * Ejecuta inferencia ONNX usando los tensores exactos del modelo KittenTTS:
 * - input_ids: int64 [1, length]
 * - style: float32 [1, 256]
 * - speed: float32 [1]
 */
async function runKittenInference(
  text: string,
  voiceId: KittenVoiceId | string,
  speed: number,
): Promise<Float32Array> {
  const cleanText = normalizeEnglishText(text);
  if (!cleanText) {
    return new Float32Array(KITTEN_SAMPLE_RATE / 10); // 100ms silencio si texto vacío
  }

  if (!kittenSession) {
    throw new Error(
      "KittenTTS ONNX session is not initialized. Model weights must be downloaded and initialized before synthesis.",
    );
  }

  const ort = await configureOrtWasmEnv();
  const tokenIds = prepareKittenInputIds(cleanText);
  const voiceEmbedding = getVoiceEmbedding(voiceId);

  const inputNames = kittenSession.inputNames;
  const inputIdName =
    inputNames.find(
      (n) => n === "input_ids" || n.toLowerCase().includes("id") || n.toLowerCase().includes("text"),
    ) ??
    inputNames[0] ??
    "input_ids";
  const styleName =
    inputNames.find(
      (n) =>
        n === "style" ||
        n.toLowerCase().includes("style") ||
        n.toLowerCase().includes("voice") ||
        n.toLowerCase().includes("emb"),
    ) ??
    inputNames[1] ??
    "style";
  const speedName =
    inputNames.find(
      (n) => n === "speed" || n.toLowerCase().includes("speed") || n.toLowerCase().includes("rate"),
    ) ??
    inputNames[2] ??
    "speed";

  const feeds: Record<string, unknown> = {
    [inputIdName]: new ort.Tensor(
      "int64",
      BigInt64Array.from(tokenIds.map(BigInt)),
      [1, tokenIds.length],
    ),
  };

  if (inputNames.includes(styleName) || inputNames.length > 1) {
    feeds[styleName] = new ort.Tensor("float32", voiceEmbedding, [1, voiceEmbedding.length]);
  }

  if (inputNames.includes(speedName) || inputNames.length > 2) {
    feeds[speedName] = new ort.Tensor("float32", new Float32Array([speed]), [1]);
  }

  const results = await kittenSession.run(feeds as never);
  const outputName = kittenSession.outputNames[0];
  const outputTensor = results[outputName];
  if (!outputTensor) {
    throw new Error(`KittenTTS ONNX inference produced no output tensor for '${outputName}'`);
  }

  const rawData = outputTensor.data;
  const rawSamples =
    rawData instanceof Float32Array
      ? rawData
      : Float32Array.from(rawData as ArrayLike<number>);

  return trimLeadingAndTrailingSilence(rawSamples, 0.003, KITTEN_SAMPLE_RATE);
}

// ---------------------------------------------------------------------------
// Pipeline Piper VITS (es_MX, 22.05 kHz)
// ---------------------------------------------------------------------------

interface PiperInferenceResult {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Tensores exactos del contrato VITS de Piper:
 *   input: int64 [1, N] — IDs del Encoder (BOS…PAD…EOS)
 *   input_lengths: int64 [1]
 *   scales: float32 [3] — noise_scale, length_scale, noise_w
 *   sid: int64 [1] — solo si num_speakers > 1
 * length_scale es inversamente proporcional a la velocidad.
 */
async function runPiperInference(
  text: string,
  voiceId: string,
  speed: number,
): Promise<PiperInferenceResult> {
  const session = piperSession;
  const config = piperConfig;
  const phonemeIdMap = config?.phoneme_id_map;
  if (!session || !config || !phonemeIdMap) {
    throw new Error("Piper ONNX session/config is not initialized");
  }

  const sampleRate = config.audio?.sample_rate ?? PIPER_DEFAULT_SAMPLE_RATE;
  const ids = textToPiperIds(text, phonemeIdMap);
  if (ids.length === 0) {
    return { samples: new Float32Array(Math.floor(sampleRate / 10)), sampleRate };
  }

  const ort = await configureOrtWasmEnv();
  const names = session.inputNames;
  const inputName = names.find((n) => n === "input") ?? names[0] ?? "input";
  const lengthsName =
    names.find((n) => n.toLowerCase().includes("length")) ?? "input_lengths";
  const scalesName =
    names.find((n) => n.toLowerCase().includes("scale")) ?? "scales";

  const feeds: Record<string, unknown> = {
    [inputName]: new ort.Tensor(
      "int64",
      BigInt64Array.from(ids.map(BigInt)),
      [1, ids.length],
    ),
    [lengthsName]: new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(ids.length)]),
      [1],
    ),
  };

  const inference = config.inference ?? {};
  const baseLengthScale = inference.length_scale ?? 1.0;
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speed || 1));
  const effectiveLengthScale = baseLengthScale / clampedSpeed;
  feeds[scalesName] = new ort.Tensor(
    "float32",
    new Float32Array([
      inference.noise_scale ?? 0.667,
      effectiveLengthScale,
      inference.noise_w ?? 0.8,
    ]),
    [3],
  );

  const numSpeakers = config.num_speakers ?? 1;
  if (numSpeakers > 1) {
    const sidName = names.find((n) => n.toLowerCase().includes("sid") || n.toLowerCase().includes("speaker")) ?? "sid";
    const sidMap = config.speaker_id_map ?? {};
    const sid = typeof sidMap[voiceId] === "number" ? sidMap[voiceId] : 0;
    feeds[sidName] = new ort.Tensor("int64", BigInt64Array.from([BigInt(sid)]), [1]);
  }

  const results = await session.run(feeds as never);
  const outputName = session.outputNames[0];
  const outputTensor = results[outputName] ?? results.output;
  if (!outputTensor) {
    throw new Error(`Piper ONNX inference produced no output tensor for '${outputName}'`);
  }

  const rawData = outputTensor.data;
  const rawSamples =
    rawData instanceof Float32Array
      ? rawData
      : Float32Array.from(rawData as ArrayLike<number>);

  return {
    samples: trimLeadingAndTrailingSilence(rawSamples, 0.003, sampleRate),
    sampleRate,
  };
}

// ---------------------------------------------------------------------------
// Configuración ORT WASM (compartida por ambos motores)
// ---------------------------------------------------------------------------

async function configureOrtWasmEnv(): Promise<OrtModule> {
  if (ortModule) return ortModule;
  const ort = await import("onnxruntime-web/wasm");

  let wasmBase = "/assets/";
  if (typeof fetch === "function") {
    try {
      // ORT importa el .mjs (glue Emscripten) y luego descarga el .wasm:
      // ambos deben existir en /assets/ o el backend wasm no arranca.
      const probe = async (name: string, mimes: string[]) => {
        const url =
          typeof self !== "undefined" && self.location?.origin
            ? new URL(`/assets/${name}`, self.location.origin).href
            : `/assets/${name}`;
        const resp = await fetch(url, { method: "HEAD" });
        const contentType = (resp.headers.get("content-type") || "").toLowerCase();
        return (
          resp.ok &&
          resp.status === 200 &&
          !contentType.includes("text/html") &&
          mimes.some((m) => contentType.includes(m))
        );
      };
      const [wasmOk, mjsOk] = await Promise.all([
        probe("ort-wasm-simd-threaded.wasm", ["wasm"]),
        probe("ort-wasm-simd-threaded.mjs", ["javascript", "ecmascript", "text/plain"]),
      ]);
      if (!wasmOk || !mjsOk) {
        wasmBase = ORT_WASM_CDN_BASE;
      }
    } catch {
      wasmBase = ORT_WASM_CDN_BASE;
    }
  }

  ort.env.wasm.wasmPaths = wasmBase;

  const hasSharedArrayBuffer =
    typeof SharedArrayBuffer !== "undefined" &&
    typeof self !== "undefined" &&
    Boolean((self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated);

  if (!hasSharedArrayBuffer) {
    ort.env.wasm.numThreads = 1;
  } else {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 1;
    ort.env.wasm.numThreads = Math.min(4, Math.max(1, Math.floor((hw || 1) / 2)));
  }

  ort.env.wasm.proxy = false;
  ortModule = ort;
  return ort;
}

// ---------------------------------------------------------------------------
// Mensajes del worker
// ---------------------------------------------------------------------------

if (typeof self !== "undefined") {
  self.onerror = (event: string | Event, _source?: string, _lineno?: number, _colno?: number, error?: Error) => {
    const errorMsg = error?.message || (typeof event === "string" ? event : "Unknown worker error");
    postWorkerMessage({
      type: "INIT_ERROR",
      error: `TTS worker error: ${errorMsg}`,
    } satisfies WorkerResponse);
  };

  self.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const errorMsg = reason instanceof Error ? reason.message : String(reason);
    postWorkerMessage({
      type: "INIT_ERROR",
      error: `TTS worker unhandled rejection: ${errorMsg}`,
    } satisfies WorkerResponse);
  };

  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case "INIT":
      case "init": {
        const engine: TtsEngineKind = msg.engine ?? "kitten";
        try {
          if (msg.voicesData) {
            for (const [vId, vData] of Object.entries(msg.voicesData)) {
              if (vData instanceof Float32Array || Array.isArray(vData)) {
                registerVoiceEmbedding(vId, vData as Float32Array | number[]);
              }
            }
          }

          if (engine === "piper") {
            // Config del modelo (.onnx.json): llega como buffer en INIT o se
            // recupera de CacheStorage al sintetizar.
            if (msg.configBuffer) {
              const text = new TextDecoder().decode(msg.configBuffer);
              piperConfig = parsePiperModelConfig(JSON.parse(text));
            }
            if (msg.modelBuffer) {
              // Liberar la sesión del otro motor y crear la de Piper.
              await releaseSession(kittenSession);
              kittenSession = null;
              await releaseSession(piperSession);
              piperSession = await createSessionFromBuffer(msg.modelBuffer);
            } else {
              await ensureEngine("piper");
            }
          } else {
            // Kitten: mismo comportamiento de antes (buffer → cache → URL).
            await releaseSession(piperSession);
            piperSession = null;
            if (!kittenSession) {
              if (msg.modelBuffer) {
                kittenSession = await createSessionFromBuffer(msg.modelBuffer);
              } else {
                const url = msg.modelUrl ?? KITTEN_MODEL_URL;
                try {
                  kittenSession = await createSessionFromCache(
                    KITTEN_CACHE_NAME,
                    url,
                    10_000_000,
                  );
                } catch {
                  const ort = await configureOrtWasmEnv();
                  kittenSession = (await ort.InferenceSession.create(url, {
                    executionProviders: ["wasm"],
                  })) as unknown as OnnxInferenceSession;
                }
              }
            }
          }

          postWorkerMessage({ type: "INIT_DONE" } satisfies WorkerResponse);
          void processNextJob();
        } catch (err) {
          postWorkerMessage({
            type: "INIT_ERROR",
            error: err instanceof Error ? err.message : String(err),
          } satisfies WorkerResponse);
        }
        break;
      }

      case "SYNTHESIZE":
      case "synthesize": {
        const jobId = msg.jobId ?? msg.id ?? `job_${Date.now()}_${Math.random()}`;
        enqueueJob({
          jobId,
          engine: msg.engine ?? "kitten",
          text: msg.text,
          voiceId: msg.voiceId ?? "expr-voice-2-f",
          speed: msg.speed ?? 1,
          priority: msg.priority ?? "high",
          epoch: msg.epoch ?? currentEpoch,
        });
        break;
      }

      case "CANCEL_EPOCH":
      case "cancel_epoch": {
        currentEpoch = msg.epoch;
        for (let i = jobQueue.length - 1; i >= 0; i--) {
          if (jobQueue[i].epoch < currentEpoch) {
            jobQueue.splice(i, 1);
          }
        }
        break;
      }
    }
  };
}
