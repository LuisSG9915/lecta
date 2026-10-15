import { describe, expect, it } from "vitest";
import { syllabifySpanish } from "./syllables";

describe("syllabifySpanish", () => {
  it("separa correctamente palabras comunes en español", () => {
    expect(syllabifySpanish("hegemonía")).toBe("he·ge·mo·ní·a");
    expect(syllabifySpanish("casa")).toBe("ca·sa");
    expect(syllabifySpanish("estrella")).toBe("es·tre·lla");
    expect(syllabifySpanish("árbol")).toBe("ár·bol");
    expect(syllabifySpanish("poeta")).toBe("po·e·ta");
    expect(syllabifySpanish("cantar")).toBe("can·tar");
  });

  it("devuelve palabras cortas o monosílabos sin separar", () => {
    expect(syllabifySpanish("sol")).toBe("sol");
    expect(syllabifySpanish("pan")).toBe("pan");
    expect(syllabifySpanish("el")).toBe("el");
  });

  it("permite personalizar el separador", () => {
    expect(syllabifySpanish("hegemonía", "-")).toBe("he-ge-mo-ní-a");
  });
});
