import { describe, expect, it } from "vitest";
import {
  KITTEN_VOICE_ALIASES,
  KITTEN_VOICE_EMBEDDINGS,
  getVoiceEmbedding,
  isRealVoiceEmbedding,
  loadVoicesFromNpz,
  parseNpzVoices,
  registerVoiceEmbedding,
} from "./kittenVoicesData";

describe("kittenVoicesData", () => {
  it("contiene los tensores de 256 dimensiones reales de las 8 voces oficiales", () => {
    const voiceIds = Object.keys(KITTEN_VOICE_EMBEDDINGS) as (keyof typeof KITTEN_VOICE_EMBEDDINGS)[];
    expect(voiceIds).toHaveLength(8);

    for (const id of voiceIds) {
      const vec = KITTEN_VOICE_EMBEDDINGS[id];
      expect(vec).toHaveLength(256);
      expect(isRealVoiceEmbedding(vec)).toBe(true);

      // Verificar que los tensores NO son sintéticos oscilatorios uniformes (Math.sin/cos)
      let nonZero = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const val of vec) {
        expect(Number.isFinite(val)).toBe(true);
        if (val !== 0) nonZero++;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      expect(nonZero).toBe(256);
      expect(min).toBeLessThan(0);
      expect(max).toBeGreaterThan(0);
    }
  });

  it("getVoiceEmbedding devuelve un Float32Array y resuelve aliases", () => {
    const embBella = getVoiceEmbedding("bella");
    const emb2f = getVoiceEmbedding("expr-voice-2-f");

    expect(embBella).toBeInstanceOf(Float32Array);
    expect(embBella).toHaveLength(256);
    expect(embBella).toBe(emb2f); // Debe devolver la instancia cacheada

    const embBruno = getVoiceEmbedding("Bruno");
    const emb3m = getVoiceEmbedding("expr-voice-3-m");
    expect(embBruno).toBe(emb3m);
  });

  it("soporta todas las 8 alias oficiales", () => {
    const aliases = ["bella", "jasper", "luna", "bruno", "rosie", "hugo", "kiki", "leo"];
    for (const alias of aliases) {
      expect(KITTEN_VOICE_ALIASES[alias]).toBeDefined();
      const emb = getVoiceEmbedding(alias);
      expect(emb).toHaveLength(256);
    }
  });

  it("registerVoiceEmbedding permite registrar o sobrescribir embeddings válidos de 256 dims", () => {
    const customVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      customVec[i] = (i % 2 === 0 ? 0.1 : -0.1) * (i + 1);
    }

    const ok = registerVoiceEmbedding("custom-voice", customVec);
    expect(ok).toBe(true);

    const retrieved = getVoiceEmbedding("custom-voice");
    expect(retrieved).toBeInstanceOf(Float32Array);
    expect(retrieved).toHaveLength(256);
    expect(retrieved[0]).toBeCloseTo(0.1, 5);

    // Debe rechazar vectores de dimensión incorrecta
    const invalidShort = new Float32Array(128);
    expect(registerVoiceEmbedding("invalid", invalidShort)).toBe(false);
  });

  it("parseNpzVoices y loadVoicesFromNpz parsean archivos .npz oficiales de NumPy", () => {
    // Construir un archivo ZIP/NPZ en memoria con un archivo test-voice.npy
    const filename = "test-voice.npy";
    const headerStr = "{'descr': '<f4', 'fortran_order': False, 'shape': (1, 256), }";
    const padLen = 64 - ((10 + headerStr.length) % 64);
    const headerPadded = headerStr + " ".repeat(padLen - 1) + "\n";
    const headerBytes = new TextEncoder().encode(headerPadded);
    const headerLen = headerBytes.length;

    const dataFloats = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      dataFloats[i] = (i % 2 === 0 ? 0.05 : -0.05) * ((i % 10) + 1);
    }

    const npyTotalLen = 10 + headerLen + 256 * 4;
    const npyBuf = new Uint8Array(npyTotalLen);
    npyBuf.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
    new DataView(npyBuf.buffer).setUint16(8, headerLen, true);
    npyBuf.set(headerBytes, 10);
    new Uint8Array(npyBuf.buffer, 10 + headerLen).set(new Uint8Array(dataFloats.buffer));

    // Cabecera local ZIP
    const fnBytes = new TextEncoder().encode(filename);
    const zipHeaderLen = 30 + fnBytes.length;
    const zipBuf = new Uint8Array(zipHeaderLen + npyTotalLen);
    const dv = new DataView(zipBuf.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // Stored (sin compresión)
    dv.setUint32(18, npyTotalLen, true);
    dv.setUint32(22, npyTotalLen, true);
    dv.setUint16(26, fnBytes.length, true);
    dv.setUint16(28, 0, true);
    zipBuf.set(fnBytes, 30);
    zipBuf.set(npyBuf, 30 + fnBytes.length);

    const parsed = parseNpzVoices(zipBuf.buffer);
    expect(parsed["test-voice"]).toBeDefined();
    expect(parsed["test-voice"]).toHaveLength(256);
    expect(parsed["test-voice"][0]).toBeCloseTo(0.05, 5);

    const loaded = loadVoicesFromNpz(zipBuf.buffer);
    expect(loaded).toBe(true);
    expect(getVoiceEmbedding("test-voice")[0]).toBeCloseTo(0.05, 5);
  });
});
