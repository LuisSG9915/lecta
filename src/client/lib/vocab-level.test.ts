import { describe, expect, it } from "vitest";
import { catLevelLabel, vocabLevelOf } from "./vocab-level";

describe("vocabLevelOf", () => {
  it("mapea theta alto a «broad», intermedio a «medium» y bajo a «developing»", () => {
    expect(vocabLevelOf(2.5)).toBe("broad");
    expect(vocabLevelOf(0.8)).toBe("broad");
    expect(vocabLevelOf(0.79)).toBe("medium");
    expect(vocabLevelOf(0)).toBe("medium");
    expect(vocabLevelOf(-0.8)).toBe("medium");
    expect(vocabLevelOf(-0.81)).toBe("developing");
    expect(vocabLevelOf(-2.5)).toBe("developing");
  });
});

describe("catLevelLabel", () => {
  it("devuelve etiquetas en español llano", () => {
    expect(catLevelLabel(1.5)).toBe("amplio");
    expect(catLevelLabel(0)).toBe("medio");
    expect(catLevelLabel(-1.5)).toBe("en desarrollo");
  });
});
