// src/client/lib/piperPhonemizer.ts
// Fonemizador español es_MX para el modelo Piper VITS.
//
// Usa el G2P español de @piper-plus/g2p (port del Rust de piper-plus: seseo,
// sílabas, acento tónico ˈ, alófonos b/d/g, yeísmo) + su Encoder, que produce
// la secuencia exacta de IDs que espera el grafo VITS:
//   [BOS, ids_token0…, PAD, ids_token1…, PAD, …, EOS]
// con PAD (0) intercalado tras cada token y BOS=1 / EOS=2 del phoneme_id_map.
//
// Antes de fonemizar se aplica normalizeSpanishText: números→palabras,
// abreviaturas, símbolos y la excepción «x»→«j» (/x/ en Méjico, Oajaca…).
// Este módulo solo vive en el chunk del Web Worker: cero peso en la UI.

import { SpanishG2P } from "@piper-plus/g2p/es";
import { Encoder } from "@piper-plus/g2p/encode";
import { normalizeSpanishText } from "./normalizerEs";

/** Subconjunto del `.onnx.json` de Piper que consume el worker. */
export interface PiperModelConfig {
  audio?: { sample_rate?: number };
  inference?: {
    noise_scale?: number;
    length_scale?: number;
    noise_w?: number;
  };
  num_speakers?: number;
  speaker_id_map?: Record<string, number>;
  phoneme_id_map?: Record<string, number[]>;
}

export function parsePiperModelConfig(json: unknown): PiperModelConfig {
  if (!json || typeof json !== "object") {
    throw new Error("Configuración Piper inválida: se esperaba un objeto JSON");
  }
  return json as PiperModelConfig;
}

let g2pInstance: SpanishG2P | null = null;
let cachedMap: Record<string, number[]> | null = null;
let cachedEncoder: Encoder | null = null;

function getG2P(): SpanishG2P {
  if (!g2pInstance) g2pInstance = new SpanishG2P();
  return g2pInstance;
}

function getEncoder(phonemeIdMap: Record<string, number[]>): Encoder {
  // El mapa es inmutable por modelo; si cambia (otro .onnx.json) se recrea.
  if (cachedEncoder && cachedMap === phonemeIdMap) return cachedEncoder;
  cachedMap = phonemeIdMap;
  cachedEncoder = new Encoder(phonemeIdMap);
  return cachedEncoder;
}

/**
 * Texto en español → IDs de fonemas listos para el tensor `input` de Piper.
 * Devuelve [] si tras normalizar no queda nada pronunciable.
 */
export function textToPiperIds(
  text: string,
  phonemeIdMap: Record<string, number[]>,
): number[] {
  const normalized = normalizeSpanishText(text);
  if (!normalized.trim()) return [];

  const { tokens } = getG2P().phonemize(normalized);
  if (tokens.length === 0) return [];

  const { phonemeIds } = getEncoder(phonemeIdMap).encode(tokens);
  return phonemeIds;
}
