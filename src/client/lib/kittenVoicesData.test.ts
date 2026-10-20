import { describe, expect, it } from "vitest";
import {
  KITTEN_VOICE_ALIASES,
  KITTEN_VOICE_EMBEDDINGS,
  getVoiceEmbedding,
  isRealVoiceEmbedding,
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
});
