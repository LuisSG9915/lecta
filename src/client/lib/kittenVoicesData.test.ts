import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KITTEN_VOICES_BYTES,
  KITTEN_VOICES_SHA256,
  KITTEN_VOICE_DIMS,
  KITTEN_VOICE_ORDER,
  KITTEN_VOICE_ROWS,
} from "./kittenModel";
import {
  KITTEN_VOICE_ALIASES,
  parseVoiceTable,
  resolveVoiceId,
  voiceStyle,
} from "./kittenVoicesData";

const VOICE_FLOATS = KITTEN_VOICE_ROWS * KITTEN_VOICE_DIMS;

/** Tabla sintética: cada fila vale `voz * 1000 + fila`, para reconocerla al leerla. */
function syntheticTable() {
  const floats = new Float32Array(KITTEN_VOICE_ORDER.length * VOICE_FLOATS);
  for (let v = 0; v < KITTEN_VOICE_ORDER.length; v += 1)
    for (let r = 0; r < KITTEN_VOICE_ROWS; r += 1)
      floats.fill(v * 1000 + r, v * VOICE_FLOATS + r * KITTEN_VOICE_DIMS, v * VOICE_FLOATS + (r + 1) * KITTEN_VOICE_DIMS);
  return parseVoiceTable(floats.buffer);
}

describe("kittenVoicesData", () => {
  it("el asset publicado coincide con el tamaño y el SHA-256 que espera el cliente", () => {
    const bytes = readFileSync(resolve(__dirname, "../../../public/tts/kitten-voices-v1.bin"));
    expect(bytes.length).toBe(KITTEN_VOICES_BYTES);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(KITTEN_VOICES_SHA256);
  });

  it("parseVoiceTable rechaza un binario de tamaño distinto", () => {
    expect(() => parseVoiceTable(new ArrayBuffer(KITTEN_VOICES_BYTES - 4))).toThrow(/tamaño inválido/);
  });

  it("parseVoiceTable parte el binario en una vista por voz, en el orden fijo", () => {
    const table = syntheticTable();
    expect([...table.keys()]).toEqual([...KITTEN_VOICE_ORDER]);
    for (const rows of table.values()) expect(rows.length).toBe(VOICE_FLOATS);
  });

  it("voiceStyle devuelve el promedio constante de las filas de la voz", () => {
    const table = syntheticTable();
    const mean = (KITTEN_VOICE_ROWS - 1) / 2; // filas 0..399 valen voz*1000 + fila
    const style = voiceStyle(table, KITTEN_VOICE_ORDER[0]);
    expect(style).toHaveLength(KITTEN_VOICE_DIMS);
    expect(style[0]).toBeCloseTo(mean, 3);
    expect(style[KITTEN_VOICE_DIMS - 1]).toBeCloseTo(mean, 3);
    expect(voiceStyle(table, "expr-voice-3-m")[5]).toBeCloseTo(3 * 1000 + mean, 2);
    // Memoizado: misma instancia, y no depende del texto.
    expect(voiceStyle(table, "Bella")).toBe(style);
  });

  it("resolveVoiceId acepta alias, ids y cae a expr-voice-2-f con lo desconocido", () => {
    expect(resolveVoiceId("Bella")).toBe("expr-voice-2-f");
    expect(resolveVoiceId("  LEO ")).toBe("expr-voice-5-m");
    expect(resolveVoiceId("expr-voice-4-m")).toBe("expr-voice-4-m");
    expect(resolveVoiceId("nada")).toBe("expr-voice-2-f");
    for (const alias of Object.values(KITTEN_VOICE_ALIASES)) expect(KITTEN_VOICE_ORDER).toContain(alias);
  });
});
