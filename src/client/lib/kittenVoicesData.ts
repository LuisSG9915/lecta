import {
  KITTEN_SPEED_PRIORS,
  KITTEN_VOICES_BYTES,
  KITTEN_VOICE_DIMS,
  KITTEN_VOICE_ORDER,
  KITTEN_VOICE_ROWS,
} from "./kittenModel";
import type { KittenVoiceId } from "./ttsTypes";

// Voces de Kitten TTS 0.8. Los vectores ya NO viven en el código: la tabla oficial
// (8 voces × 400 filas × 256 floats) se sirve como asset estático
// (`public/tts/kitten-voices-v1.bin`, ver kittenModel.ts) y el worker la recibe del
// motor. Los vectores de la 0.1 que estaban aquí daban estática con este modelo.

export const KITTEN_VOICE_ALIASES: Record<string, KittenVoiceId> = {
  bella: "expr-voice-2-f",
  jasper: "expr-voice-2-m",
  luna: "expr-voice-3-f",
  bruno: "expr-voice-3-m",
  rosie: "expr-voice-4-f",
  hugo: "expr-voice-4-m",
  kiki: "expr-voice-5-f",
  leo: "expr-voice-5-m",
};

/** Tabla por voz: cada valor es un Float32Array de `KITTEN_VOICE_ROWS * KITTEN_VOICE_DIMS`. */
export type KittenVoiceTable = ReadonlyMap<KittenVoiceId, Float32Array>;

const VOICE_FLOATS = KITTEN_VOICE_ROWS * KITTEN_VOICE_DIMS;

/** Resuelve alias («Bella») e ids desconocidos a una voz válida (por defecto expr-voice-2-f). */
export function resolveVoiceId(voiceId: string): KittenVoiceId {
  const lower = typeof voiceId === "string" ? voiceId.toLowerCase().trim() : "";
  const alias = KITTEN_VOICE_ALIASES[lower];
  if (alias) return alias;
  return (KITTEN_VOICE_ORDER as readonly string[]).includes(lower)
    ? (lower as KittenVoiceId)
    : "expr-voice-2-f";
}

/** Parte el binario de voces en una vista Float32Array por voz (sin copiar). */
export function parseVoiceTable(buffer: ArrayBuffer): KittenVoiceTable {
  if (buffer.byteLength !== KITTEN_VOICES_BYTES) {
    throw new Error(
      `Tabla de voces con tamaño inválido (${buffer.byteLength} bytes, se esperaban ${KITTEN_VOICES_BYTES})`,
    );
  }
  const table = new Map<KittenVoiceId, Float32Array>();
  KITTEN_VOICE_ORDER.forEach((id, index) => {
    table.set(id, new Float32Array(buffer, index * VOICE_FLOATS * 4, VOICE_FLOATS));
  });
  return table;
}

/**
 * Estilo de una síntesis: la fila `min(longitud del texto, 399)` de la voz, igual que
 * KittenTTS (`voices[voice][min(len(text), rows - 1)]`). La longitud se cuenta en
 * code points, como el `len` de Python.
 */
export function styleRow(
  table: KittenVoiceTable,
  voiceId: string,
  textLength: number,
): Float32Array {
  const rows = table.get(resolveVoiceId(voiceId));
  if (!rows) throw new Error("La tabla de voces no tiene la voz pedida");
  const row = Math.max(0, Math.min(Math.floor(textLength), KITTEN_VOICE_ROWS - 1));
  return rows.subarray(row * KITTEN_VOICE_DIMS, (row + 1) * KITTEN_VOICE_DIMS);
}

/** Velocidad que recibe el modelo: la pedida × el `speed_prior` de la voz. */
export function effectiveSpeed(voiceId: string, speed: number): number {
  return speed * KITTEN_SPEED_PRIORS[resolveVoiceId(voiceId)];
}
