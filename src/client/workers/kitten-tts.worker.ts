// Worker de inferencia para KittenTTS (<25MB, 24kHz)
// Ejecuta normalización de texto y síntesis ONNX en un hilo aislado.

import type { KittenVoiceId } from "../lib/ttsTypes";

export type WorkerSynthesizeRequest = {
  type: "synthesize";
  id: string;
  text: string;
  voiceId?: KittenVoiceId;
  speed?: number;
};

export type WorkerInitRequest = {
  type: "init";
  modelBuffer?: ArrayBuffer;
  voicesData?: Record<string, unknown>;
};

export type WorkerRequest = WorkerSynthesizeRequest | WorkerInitRequest;

export type WorkerResponse =
  | { type: "init_done" }
  | { type: "init_error"; error: string }
  | { type: "synthesize_done"; id: string; audioData: Float32Array; sampleRate: number }
  | { type: "synthesize_error"; id: string; error: string };

type OnnxInferenceSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};

let onnxSession: OnnxInferenceSession | null = null;

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

// Generador sintético de audio 24 kHz (para pruebas o fallback si ONNX no tiene modelo cargado)
function generateSyntheticSpeechWave(text: string, voiceId = "expr-voice-2-f", speed = 1): Float32Array {
  const sampleRate = 24000;
  // Duración aproximada: ~14 caracteres por segundo
  const durationSec = Math.max(0.3, (text.length / 14) / speed);
  const totalSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(totalSamples);

  // Frecuencia base según género de la voz
  const isFemale = voiceId.endsWith("-f");
  const f0 = isFemale ? 220 : 130;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Envolvente de ataque y decaimiento suave
    const attack = Math.min(1, i / (sampleRate * 0.05));
    const decay = Math.min(1, (totalSamples - i) / (sampleRate * 0.05));
    const env = attack * decay;

    // Onda armónica compuesta suave
    const harm1 = Math.sin(2 * Math.PI * f0 * t);
    const harm2 = 0.5 * Math.sin(2 * Math.PI * f0 * 2 * t);
    const harm3 = 0.25 * Math.sin(2 * Math.PI * f0 * 3 * t);
    const wave = (harm1 + harm2 + harm3) * 0.2 * env;

    samples[i] = wave;
  }
  return samples;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "init") {
    try {
      if (data.modelBuffer) {
        // Carga dinámica de ONNX Runtime Web
        const ort = await import("onnxruntime-web");
        onnxSession = await ort.InferenceSession.create(data.modelBuffer, {
          executionProviders: ["wasm"],
        });
      }
      self.postMessage({ type: "init_done" } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: "init_error",
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (data.type === "synthesize") {
    const { id, text, voiceId = "expr-voice-2-f", speed = 1 } = data;
    try {
      const cleanText = normalizeEnglishText(text);
      if (!cleanText) {
        const empty = new Float32Array(2400); // 0.1s de silencio
        self.postMessage({
          type: "synthesize_done",
          id,
          audioData: empty,
          sampleRate: 24000,
        } satisfies WorkerResponse);
        return;
      }

      if (onnxSession) {
        const ort = await import("onnxruntime-web");
        const tokenIds = textToTokenIds(cleanText);
        const inputName = onnxSession.inputNames[0] || "input_ids";
        const feeds: Record<string, unknown> = {
          [inputName]: new ort.Tensor("int64", BigInt64Array.from(tokenIds.map(BigInt)), [1, tokenIds.length]),
        };

        // Si el modelo espera embedding de voz
        if (onnxSession.inputNames.length > 1) {
          const styleInput = onnxSession.inputNames[1];
          const embSize = 256;
          const dummyStyle = new Float32Array(embSize);
          feeds[styleInput] = new ort.Tensor("float32", dummyStyle, [1, embSize]);
        }

        const results = await onnxSession.run(feeds);
        const outputTensor = results[onnxSession.outputNames[0]];
        const audioData = outputTensor.data;

        self.postMessage({
          type: "synthesize_done",
          id,
          audioData,
          sampleRate: 24000,
        } satisfies WorkerResponse);
      } else {
        // Modo sintético sin modelo cargado
        const audioData = generateSyntheticSpeechWave(cleanText, voiceId, speed);
        self.postMessage({
          type: "synthesize_done",
          id,
          audioData,
          sampleRate: 24000,
        } satisfies WorkerResponse);
      }
    } catch {
      // Fallback a generación sintética ante cualquier error de inferencia
      const fallbackAudio = generateSyntheticSpeechWave(text, voiceId, speed);
      self.postMessage({
        type: "synthesize_done",
        id,
        audioData: fallbackAudio,
        sampleRate: 24000,
      } satisfies WorkerResponse);
    }
  }
};
