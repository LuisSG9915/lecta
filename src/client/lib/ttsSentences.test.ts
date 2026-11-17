import { describe, expect, it } from "vitest";
import { sentenceIndexForLanding } from "./ttsSentences";
import type { SentenceLayoutItem } from "./ttsTypes";

const items = (...texts: string[]) => texts.map((text) => ({ text })) as SentenceLayoutItem[];

describe("sentenceIndexForLanding", () => {
  const landing = { sentenceIndex: 1, paragraphText: "Segunda frase aquí.", anchor: "Primera frase. Segunda frase aquí." };

  it("usa el índice guardado si el texto coincide", () => {
    expect(sentenceIndexForLanding(items("Primera frase.", "Segunda frase aquí."), landing)).toBe(1);
  });

  it("busca por texto si el mapa se desplazó", () => {
    expect(sentenceIndexForLanding(items("Nueva.", "Primera frase.", "Segunda frase aquí."), landing)).toBe(2);
  });

  it("devuelve -1 si ya no está", () => {
    expect(sentenceIndexForLanding(items("Otra cosa."), landing)).toBe(-1);
  });
});
