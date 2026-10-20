// src/client/workers/kitten-tts.worker.ts
// Worker de inferencia para KittenTTS (<25MB, 24kHz)
// Pipeline oficial de inferencia ONNX alineado con kittenml/kittentts_legacy/onnx_model.py:
// 1. Normalización de texto en inglés (kittenNormalize.ts)
// 2. Conversión a fonemas IPA y tokenización con 178 símbolos y padding 0 al inicio y final (kittenPhonemizer.ts)
// 3. Inferencia con tensores input_ids [1, N], style [1, 256] y speed [1] (kittenVoicesData.ts)
// 4. Recorte de padding del modelo y silencios muertos con transferencia Zero-Copy del buffer PCM.

import type { KittenVoiceId } from "../lib/ttsTypes";
import { getVoiceEmbedding, registerVoiceEmbedding } from "../lib/kittenVoicesData";
import { normalizeEnglishText } from "../lib/kittenNormalize";
import { prepareKittenInputIds } from "../lib/kittenPhonemizer";

export { normalizeEnglishText };

export type WorkerRequest =
  | {
      type: "INIT" | "init";
      modelUrl?: string;
      modelBuffer?: ArrayBuffer;
      voicesData?: Record<string, unknown>;
    }
  | {
      type: "SYNTHESIZE" | "synthesize";
      jobId?: string;
      id?: string;
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
  text: string;
  voiceId: KittenVoiceId;
  speed: number;
  priority: "high" | "low";
  epoch: number;
}

type OnnxInferenceSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};

const SAMPLE_RATE = 24000;
let currentEpoch = 0;
let isProcessing = false;
let onnxSession: OnnxInferenceSession | null = null;

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
  // Evitar duplicados en la cola
  const existingIdx = jobQueue.findIndex((j) => j.jobId === job.jobId);
  if (existingIdx !== -1) {
    if (job.priority === "high") {
      // Promover a prioridad alta si ya estaba como lookahead
      const [existing] = jobQueue.splice(existingIdx, 1);
      existing.priority = "high";
      jobQueue.unshift(existing);
    }
    void processNextJob();
    return;
  }

  if (job.priority === "high") {
    // Insertar después del último 'high' pero antes de cualquier 'low'
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
      const rawSamples = await runKittenInference(job.text, job.voiceId, job.speed);

      // Verificar de nuevo tras la inferencia por si se canceló mientras calculaba
      if (job.epoch < currentEpoch) {
        continue;
      }

      // Crear una copia fresca independiente antes de transferir para evitar buffers detached
      const pcm = new Float32Array(rawSamples);

      const response: WorkerResponse = {
        type: "SYNTHESIS_DONE",
        jobId: job.jobId,
        id: job.jobId,
        pcm,
        audioData: pcm,
        sampleRate: SAMPLE_RATE,
        epoch: job.epoch,
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
 * Elimina silencios muertos al principio y final del tensor de salida
 * para que la oración N y la N+1 se encadenen con ritmo humano natural.
 * Garantiza siempre devolver un buffer no-vacío (mínimo 240 muestras) para
 * prevenir que audioCtx.createBuffer falle con "The number of frames is 0".
 */
export function trimLeadingAndTrailingSilence(samples: Float32Array, threshold = 0.004): Float32Array {
  if (!samples || samples.length === 0) {
    return new Float32Array(240);
  }

  let start = 0;
  let end = samples.length - 1;

  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;

  // Si toda la muestra era silencio o no supera el umbral
  if (start >= end) {
    return new Float32Array(240);
  }

  // Dejar un pequeño colchón de 40ms (aprox 960 muestras a 24kHz) para evitar clics de fase
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  const safeStart = Math.max(0, start - pad);
  const safeEnd = Math.min(samples.length, end + pad);

  const trimmed = samples.slice(safeStart, safeEnd);
  return trimmed.length > 0 ? trimmed : new Float32Array(240);
}

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
    return new Float32Array(SAMPLE_RATE / 10); // 100ms silencio si texto vacío
  }

  if (!onnxSession) {
    throw new Error(
      "KittenTTS ONNX session is not initialized. Model weights must be downloaded and initialized before synthesis.",
    );
  }

  const ort = await import("onnxruntime-web/wasm");
  const tokenIds = prepareKittenInputIds(cleanText);
  const voiceEmbedding = getVoiceEmbedding(voiceId);

  const inputNames = onnxSession.inputNames;
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

  // 1. input_ids: tensor int64 [1, ids.length] con tokens envueltos en [0, ...ids, 0]
  const feeds: Record<string, unknown> = {
    [inputIdName]: new ort.Tensor(
      "int64",
      BigInt64Array.from(tokenIds.map(BigInt)),
      [1, tokenIds.length],
    ),
  };

  // 2. style: tensor float32 [1, 256] del embedding acústico real
  if (inputNames.includes(styleName) || inputNames.length > 1) {
    feeds[styleName] = new ort.Tensor("float32", voiceEmbedding, [1, voiceEmbedding.length]);
  }

  // 3. speed: tensor float32 [1] con la velocidad de habla
  if (inputNames.includes(speedName) || inputNames.length > 2) {
    feeds[speedName] = new ort.Tensor("float32", new Float32Array([speed]), [1]);
  }

  const results = await onnxSession.run(feeds);
  const outputName = onnxSession.outputNames[0];
  const outputTensor = results[outputName];
  if (!outputTensor) {
    throw new Error(`KittenTTS ONNX inference produced no output tensor for '${outputName}'`);
  }

  const rawData = outputTensor.data;
  const rawSamples =
    rawData instanceof Float32Array
      ? rawData
      : Float32Array.from(rawData as ArrayLike<number>);

  // Evitar amputar ciegamente 5000 muestras (~208ms), lo que destruye la última sílaba en oraciones cortas.
  // trimLeadingAndTrailingSilence detecta dinámicamente el umbral de silencio real (0.004) y preserva un colchón de 40ms.
  return trimLeadingAndTrailingSilence(rawSamples, 0.004);
}

async function configureOrtWasmEnv(): Promise<typeof import("onnxruntime-web/wasm")> {
  const ort = await import("onnxruntime-web/wasm");

  // Configuración explícita de rutas de WebAssembly:
  // Intentar usar /assets/ localmente; si no está disponible o devuelve SPA HTML fallback,
  // caer limpiamente al CDN oficial de jsdelivr.
  let wasmBase = "/assets/";
  if (typeof fetch === "function") {
    try {
      const resp = await fetch("/assets/ort-wasm-simd-threaded.wasm", { method: "HEAD" });
      const contentType = resp.headers.get("content-type") || "";
      if (!resp.ok || contentType.includes("text/html")) {
        wasmBase = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
      }
    } catch {
      wasmBase = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
    }
  }

  ort.env.wasm.wasmPaths = wasmBase;

  // Si no hay SharedArrayBuffer o el worker no corre en un contexto crossOriginIsolated,
  // forzar numThreads = 1 para evitar bloqueos y fallos silenciosos al instanciar pthread workers
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
  return ort;
}

async function initOnnxSession(modelBuffer?: ArrayBuffer, modelUrl?: string): Promise<void> {
  const ort = await configureOrtWasmEnv();

  if (modelBuffer) {
    onnxSession = (await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    })) as unknown as OnnxInferenceSession;
    return;
  }

  if (modelUrl && typeof caches !== "undefined") {
    try {
      const cache = await caches.open("lecta-kitten-tts-v1");
      const match = await cache.match(modelUrl);
      if (match && match.status === 200) {
        const buf = await match.arrayBuffer();
        if (buf.byteLength >= 10_000_000) {
          onnxSession = (await ort.InferenceSession.create(buf, {
            executionProviders: ["wasm"],
          })) as unknown as OnnxInferenceSession;
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  if (modelUrl) {
    onnxSession = (await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
    })) as unknown as OnnxInferenceSession;
  }
}

if (typeof self !== "undefined") {
  self.onerror = (event: string | Event, _source?: string, _lineno?: number, _colno?: number, error?: Error) => {
    const errorMsg = error?.message || (typeof event === "string" ? event : "Unknown worker error");
    postWorkerMessage({
      type: "INIT_ERROR",
      error: `KittenTTS worker error: ${errorMsg}`,
    } satisfies WorkerResponse);
  };

  self.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const errorMsg = reason instanceof Error ? reason.message : String(reason);
    postWorkerMessage({
      type: "INIT_ERROR",
      error: `KittenTTS worker unhandled rejection: ${errorMsg}`,
    } satisfies WorkerResponse);
  };

  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case "INIT":
      case "init": {
        try {
          if (msg.voicesData) {
            for (const [vId, vData] of Object.entries(msg.voicesData)) {
              if (vData instanceof Float32Array || Array.isArray(vData)) {
                registerVoiceEmbedding(vId, vData as Float32Array | number[]);
              }
            }
          }
          await initOnnxSession(msg.modelBuffer, msg.modelUrl);
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
          text: msg.text,
          voiceId: (msg.voiceId as KittenVoiceId) || "expr-voice-2-f",
          speed: msg.speed ?? 1,
          priority: msg.priority ?? "high",
          epoch: msg.epoch ?? currentEpoch,
        });
        break;
      }

      case "CANCEL_EPOCH":
      case "cancel_epoch": {
        currentEpoch = msg.epoch;
        // Limpiar inmediatamente de la cola todos los trabajos de épocas anteriores
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
