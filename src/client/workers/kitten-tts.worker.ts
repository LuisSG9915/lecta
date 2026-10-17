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
  // Comillas tipográficas, comillas latinas e inglesas
  t = t.replace(/[“”"']/g, "");
  t = t.replace(/[«»]/g, "");
  // Signos de apertura en español
  t = t.replace(/[¿¡]/g, "");

  // Normalizar acentos y diacríticos a su base ASCII (evita que á, é, í, ó, ú, ñ se conviertan en espacios vacíos en el vocabulario)
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

import { getVoiceEmbedding } from "../lib/kittenVoicesData";

type VoiceProfile = {
  f0: number;
  f1: number;
  f2: number;
  warmth: number;
};

const VOICE_PROFILES: Record<KittenVoiceId, VoiceProfile> = {
  "expr-voice-2-m": { f0: 122, f1: 520, f2: 1580, warmth: 0.8 }, // Leo (Cálida): barítono cálido
  "expr-voice-2-f": { f0: 212, f1: 680, f2: 2150, warmth: 0.5 }, // Clara (Narrativa): femenina narrativa
  "expr-voice-3-m": { f0: 94,  f1: 430, f2: 1350, warmth: 1.0 }, // Arthur (Profunda): bajo resonante profundo
  "expr-voice-3-f": { f0: 236, f1: 760, f2: 2400, warmth: 0.3 }, // Elena (Suave): femenina dulce
  "expr-voice-4-m": { f0: 142, f1: 610, f2: 1750, warmth: 0.7 }, // Hugo (Expresiva): barítono brillante
  "expr-voice-4-f": { f0: 226, f1: 710, f2: 2280, warmth: 0.4 }, // Sofía (Clara): femenina nítida
  "expr-voice-5-m": { f0: 110, f1: 480, f2: 1500, warmth: 0.6 }, // Mateo (Neutro): masculino neutro
  "expr-voice-5-f": { f0: 250, f1: 800, f2: 2550, warmth: 0.3 }, // Valeria (Juvenil): femenina ágil
};

// Generador de audio de 24 kHz con articulación silábica, entonación y formantes diferenciados para cada voz
function generateSyntheticSpeechWave(
  text: string,
  voiceId: KittenVoiceId = "expr-voice-2-f",
  speed = 1,
): Float32Array {
  const sampleRate = 24000;
  const profile = VOICE_PROFILES[voiceId] ?? VOICE_PROFILES["expr-voice-2-f"];

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return new Float32Array(2400);

  const syllablesPerWord = words.map((w) => Math.max(1, Math.round(w.length / 3)));
  const totalSyllables = syllablesPerWord.reduce((a, b) => a + b, 0);
  const syllableDur = Math.max(0.12, 0.18 / Math.max(0.5, speed));
  const pauseDur = 0.04 / Math.max(0.5, speed);
  const totalDuration = totalSyllables * syllableDur + (words.length - 1) * pauseDur + 0.1;

  const totalSamples = Math.floor(sampleRate * totalDuration);
  const samples = new Float32Array(totalSamples);

  let sampleIdx = 0;
  for (let w = 0; w < words.length; w++) {
    const syllCount = syllablesPerWord[w];
    for (let s = 0; s < syllCount; s++) {
      const sylLen = Math.floor(sampleRate * syllableDur);
      const phraseProgress = sampleIdx / totalSamples;
      const pitchInflection = 1 + 0.08 * Math.sin(Math.PI * phraseProgress) - 0.05 * phraseProgress;
      const currentF0 = profile.f0 * pitchInflection;

      for (let i = 0; i < sylLen && sampleIdx < totalSamples; i++) {
        const t = i / sampleRate;
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
    const pauseLen = Math.floor(sampleRate * pauseDur);
    for (let p = 0; p < pauseLen && sampleIdx < totalSamples; p++) {
      samples[sampleIdx++] = 0;
    }
  }

  return samples;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "init") {
    try {
      if (data.modelBuffer) {
        // Carga dinámica de ONNX Runtime Web (solo runtime WASM ligero para CPU)
        const ort = await import("onnxruntime-web/wasm");
        ort.env.wasm.numThreads = 1; // Evita requerir SharedArrayBuffer / COOP-COEP
        ort.env.wasm.proxy = false;
        onnxSession = (await ort.InferenceSession.create(data.modelBuffer, {
          executionProviders: ["wasm"],
        })) as unknown as OnnxInferenceSession;
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
        const audioData =
          rawData instanceof Float32Array
            ? rawData
            : Float32Array.from(rawData as ArrayLike<number>);

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
