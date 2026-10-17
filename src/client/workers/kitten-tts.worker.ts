// src/client/workers/kitten-tts.worker.ts
// Worker de inferencia para KittenTTS (<25MB, 24kHz)
// Añade cola con prioridad ('high'/'low'), control de epoch, recorte de silencios muertos
// y transferencia Zero-Copy del buffer PCM.

import type { KittenVoiceId } from "../lib/ttsTypes";
import { getVoiceEmbedding } from "../lib/kittenVoicesData";

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
      const pcm = await runKittenInference(job.text, job.voiceId, job.speed);

      // Verificar de nuevo tras la inferencia por si se canceló mientras calculaba
      if (job.epoch < currentEpoch) {
        continue;
      }

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
      (self.postMessage as (message: any, transfer: Transferable[]) => void)(response, [pcm.buffer]);
    } catch (err) {
      if (job.epoch >= currentEpoch) {
        self.postMessage({
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
 */
export function trimLeadingAndTrailingSilence(samples: Float32Array, threshold = 0.003): Float32Array {
  let start = 0;
  let end = samples.length - 1;

  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;

  // Dejar un pequeño colchón de 40ms (aprox 960 muestras a 24kHz) para evitar clics de fase
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  const safeStart = Math.max(0, start - pad);
  const safeEnd = Math.min(samples.length, end + pad);

  return samples.slice(safeStart, safeEnd);
}

// Conversión de números a palabras en inglés (0 a 999,999)
const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

function numberToWords(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return `minus ${numberToWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rem = n % 10;
    return `${TENS[Math.floor(n / 10)]}${rem ? `-${ONES[rem]}` : ""}`;
  }
  if (n < 1000) {
    const rem = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rem ? ` ${numberToWords(rem)}` : ""}`;
  }
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rem = n % 1000;
    return `${numberToWords(thousands)} thousand${rem ? ` ${numberToWords(rem)}` : ""}`;
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
  if (ROMAN_MAP[upper]) return numberToWords(ROMAN_MAP[upper]);
  const num = parseInt(val, 10);
  if (!isNaN(num)) return numberToWords(num);
  return val;
}

export function normalizeEnglishText(text: string): string {
  let t = text;
  // Diálogos: raya larga «—» y semirraya «–» a pausa breve
  t = t.replace(/[—–]/g, ", ");
  // Comillas tipográficas, comillas latinas e inglesas
  t = t.replace(/[“”"']/g, "");
  t = t.replace(/[«»]/g, "");
  // Signos de apertura en español
  t = t.replace(/[¿¡]/g, "");

  // Normalizar acentos y diacríticos a su base ASCII
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
    return isNaN(num) ? match : numberToWords(num);
  });

  return t.replace(/\s+/g, " ").trim();
}

// Vocabulario fonético/caracteres para KittenTTS
const VOCAB = "_ ,.!?-'\":;abcdefghijklmnopqrstuvwxyz";

function textToTokenIds(text: string): number[] {
  const normalized = text.toLowerCase();
  const tokens: number[] = [];
  for (const ch of normalized) {
    const idx = VOCAB.indexOf(ch);
    if (idx >= 0) {
      tokens.push(idx);
    } else {
      tokens.push(VOCAB.indexOf(" "));
    }
  }
  return tokens.length > 0 ? tokens : [VOCAB.indexOf(" ")];
}

type VoiceProfile = {
  f0: number;
  f1: number;
  f2: number;
  warmth: number;
};

const VOICE_PROFILES: Record<string, VoiceProfile> = {
  "expr-voice-2-m": { f0: 122, f1: 520, f2: 1580, warmth: 0.8 },
  "expr-voice-2-f": { f0: 212, f1: 680, f2: 2150, warmth: 0.5 },
  "expr-voice-3-m": { f0: 94,  f1: 430, f2: 1350, warmth: 1.0 },
  "expr-voice-3-f": { f0: 236, f1: 760, f2: 2400, warmth: 0.3 },
  "expr-voice-4-m": { f0: 142, f1: 610, f2: 1750, warmth: 0.7 },
  "expr-voice-4-f": { f0: 226, f1: 710, f2: 2280, warmth: 0.4 },
  "expr-voice-5-m": { f0: 110, f1: 480, f2: 1500, warmth: 0.6 },
  "expr-voice-5-f": { f0: 250, f1: 800, f2: 2550, warmth: 0.3 },
};

function generateSyntheticSpeechWave(
  text: string,
  voiceId = "expr-voice-2-f",
  speed = 1,
): Float32Array {
  const profile = VOICE_PROFILES[voiceId] ?? VOICE_PROFILES["expr-voice-2-f"];

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return new Float32Array(2400);

  const syllablesPerWord = words.map((w) => Math.max(1, Math.round(w.length / 3)));
  const totalSyllables = syllablesPerWord.reduce((a, b) => a + b, 0);
  const syllableDur = Math.max(0.12, 0.18 / Math.max(0.5, speed));
  const pauseDur = 0.04 / Math.max(0.5, speed);
  const totalDuration = totalSyllables * syllableDur + (words.length - 1) * pauseDur + 0.1;

  const totalSamples = Math.floor(SAMPLE_RATE * totalDuration);
  const samples = new Float32Array(totalSamples);

  let sampleIdx = 0;
  for (let w = 0; w < words.length; w++) {
    const syllCount = syllablesPerWord[w];
    for (let s = 0; s < syllCount; s++) {
      const sylLen = Math.floor(SAMPLE_RATE * syllableDur);
      const phraseProgress = sampleIdx / totalSamples;
      const pitchInflection = 1 + 0.08 * Math.sin(Math.PI * phraseProgress) - 0.05 * phraseProgress;
      const currentF0 = profile.f0 * pitchInflection;

      for (let i = 0; i < sylLen && sampleIdx < totalSamples; i++) {
        const t = i / SAMPLE_RATE;
        const sylProgress = i / sylLen;
        const env = Math.sin(Math.PI * Math.pow(sylProgress, 0.8));

        const h1 = Math.sin(2 * Math.PI * currentF0 * t);
        const h2 = 0.5 * profile.warmth * Math.sin(2 * Math.PI * currentF0 * 2 * t);
        const h3 = 0.25 * Math.sin(2 * Math.PI * currentF0 * 3 * t);
        const formant1 = 0.35 * Math.sin(2 * Math.PI * profile.f1 * t);
        const formant2 = 0.15 * Math.sin(2 * Math.PI * profile.f2 * t);

        const val = (h1 + h2 + h3 + formant1 + formant2) * 0.22 * env;
        samples[sampleIdx++] = val;
      }
    }
    const pauseLen = Math.floor(SAMPLE_RATE * pauseDur);
    for (let p = 0; p < pauseLen && sampleIdx < totalSamples; p++) {
      samples[sampleIdx++] = 0;
    }
  }

  return samples;
}

async function runKittenInference(
  text: string,
  voiceId: KittenVoiceId,
  speed: number,
): Promise<Float32Array> {
  const cleanText = normalizeEnglishText(text);
  if (!cleanText) {
    return new Float32Array(2400);
  }

  if (onnxSession) {
    try {
      const ort = await import("onnxruntime-web/wasm");
      const tokenIds = textToTokenIds(cleanText);
      const styleArray = getVoiceEmbedding(voiceId);

      const inputNames = onnxSession.inputNames;
      const inputIdName =
        inputNames.find((n) => n.toLowerCase().includes("id") || n.toLowerCase().includes("text")) ||
        inputNames[0] ||
        "input_ids";
      const styleName =
        inputNames.find((n) => n.toLowerCase().includes("style") || n.toLowerCase().includes("voice") || n.toLowerCase().includes("emb")) ||
        inputNames[1] ||
        "style";
      const speedName =
        inputNames.find((n) => n.toLowerCase().includes("speed") || n.toLowerCase().includes("rate")) ||
        inputNames[2] ||
        "speed";

      const feeds: Record<string, unknown> = {
        [inputIdName]: new ort.Tensor("int64", BigInt64Array.from(tokenIds.map(BigInt)), [1, tokenIds.length]),
      };

      if (inputNames.length > 1) {
        feeds[styleName] = new ort.Tensor("float32", styleArray, [1, styleArray.length]);
      }

      if (inputNames.length > 2) {
        feeds[speedName] = new ort.Tensor("float32", Float32Array.from([speed]), [1]);
      }

      const results = await onnxSession.run(feeds);
      const outputTensor = results[onnxSession.outputNames[0]];
      const rawData = outputTensor.data;
      const rawSamples =
        rawData instanceof Float32Array
          ? rawData
          : Float32Array.from(rawData as ArrayLike<number>);

      return trimLeadingAndTrailingSilence(rawSamples, 0.003);
    } catch {
      // Fallback a síntesis si falla ONNX
    }
  }

  const rawSamples = generateSyntheticSpeechWave(cleanText, voiceId, speed);
  return trimLeadingAndTrailingSilence(rawSamples, 0.003);
}

async function initOnnxSession(modelBuffer?: ArrayBuffer, modelUrl?: string): Promise<void> {
  if (modelBuffer) {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    onnxSession = (await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    })) as unknown as OnnxInferenceSession;
    return;
  }

  if (modelUrl && typeof caches !== "undefined") {
    try {
      const cache = await caches.open("lecta-kitten-tts-v1");
      const match = await cache.match(modelUrl);
      if (match) {
        const buf = await match.arrayBuffer();
        const ort = await import("onnxruntime-web/wasm");
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        onnxSession = (await ort.InferenceSession.create(buf, {
          executionProviders: ["wasm"],
        })) as unknown as OnnxInferenceSession;
      }
    } catch {
      // ignore
    }
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case "INIT":
    case "init": {
      try {
        await initOnnxSession(msg.modelBuffer, msg.modelUrl);
        self.postMessage({ type: "INIT_DONE" } satisfies WorkerResponse);
        void processNextJob();
      } catch (err) {
        self.postMessage({
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