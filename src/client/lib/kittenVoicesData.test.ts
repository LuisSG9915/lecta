import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KITTEN_SPEED_PRIORS,
  KITTEN_VOICES_BYTES,
  KITTEN_VOICES_SHA256,
  KITTEN_VOICE_DIMS,
  KITTEN_VOICE_ORDER,
  KITTEN_VOICE_ROWS,
} from "./kittenModel";
import {
  KITTEN_VOICE_ALIASES,
  effectiveSpeed,
  parseVoiceTable,
  resolveVoiceId,
  styleRow,
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

  it("styleRow elige la fila por la longitud del texto y la recorta a la última", () => {
    const table = syntheticTable();
    const first = KITTEN_VOICE_ORDER[0];
    expect(styleRow(table, first, 104)[0]).toBe(104);
    expect(styleRow(table, first, 104)).toHaveLength(KITTEN_VOICE_DIMS);
    expect(styleRow(table, first, 0)[0]).toBe(0);
    expect(styleRow(table, first, 5000)[0]).toBe(KITTEN_VOICE_ROWS - 1);
    expect(styleRow(table, first, -3)[0]).toBe(0);
    expect(styleRow(table, "expr-voice-3-m", 7)[0]).toBe(3 * 1000 + 7);
  });

  it("resolveVoiceId acepta alias, ids y cae a expr-voice-2-f con lo desconocido", () => {
    expect(resolveVoiceId("Bella")).toBe("expr-voice-2-f");
    expect(resolveVoiceId("  LEO ")).toBe("expr-voice-5-m");
    expect(resolveVoiceId("expr-voice-4-m")).toBe("expr-voice-4-m");
    expect(resolveVoiceId("nada")).toBe("expr-voice-2-f");
    for (const alias of Object.values(KITTEN_VOICE_ALIASES)) expect(KITTEN_VOICE_ORDER).toContain(alias);
  });

  it("effectiveSpeed multiplica por el speed_prior de la voz (0.8, y 0.9 en expr-voice-4-m)", () => {
    expect(effectiveSpeed("expr-voice-2-f", 1)).toBeCloseTo(0.8);
    expect(effectiveSpeed("Hugo", 1)).toBeCloseTo(0.9);
    expect(effectiveSpeed("expr-voice-5-f", 1.5)).toBeCloseTo(1.2);
    expect(Object.keys(KITTEN_SPEED_PRIORS).sort()).toEqual([...KITTEN_VOICE_ORDER].sort());
  });
});
