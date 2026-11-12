// Declaraciones mínimas para @piper-plus/g2p (paquete JS sin tipos).
// Solo cubre la API que usa el worker de Lecta: SpanishG2P + Encoder.

declare module "@piper-plus/g2p/es" {
  export interface G2PResult {
    tokens: string[];
    prosody: Array<Record<string, unknown> | null>;
  }
  export class SpanishG2P {
    constructor(options?: Record<string, unknown>);
    phonemize(text: string): G2PResult;
    phonemizeWithProsody(text: string): G2PResult;
  }
}

declare module "@piper-plus/g2p/encode" {
  export interface EncodeResult {
    phonemeIds: number[];
    prosodyFlat?: number[];
  }
  export class Encoder {
    constructor(
      phonemeIdMap: Record<string, number[]>,
      options?: { strict?: boolean },
    );
    encode(tokens: string[]): EncodeResult;
    encodeWithProsody(
      tokens: string[],
      prosody: Array<Record<string, unknown> | null>,
    ): EncodeResult;
  }
}
