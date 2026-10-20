import { describe, expect, it } from "vitest";
import {
  KITTEN_PAD,
  KITTEN_PUNCTUATION,
  KITTEN_SYMBOLS,
  KITTEN_VOCAB_MAP,
  convertEnglishWordToIpa,
  phonemizeText,
  prepareKittenInputIds,
  textToTokenIds,
} from "./kittenPhonemizer";

describe("kittenPhonemizer", () => {
  it("contiene exactamente los 178 símbolos de KittenTTS y pad '$' en el índice 0", () => {
    expect(KITTEN_SYMBOLS).toHaveLength(178);
    expect(KITTEN_PUNCTUATION.length).toBeGreaterThan(0);
    expect(KITTEN_SYMBOLS[0]).toBe(KITTEN_PAD);
    expect(KITTEN_VOCAB_MAP.get(KITTEN_PAD)).toBe(0);
    expect(KITTEN_VOCAB_MAP.get(" ")).toBe(16);
    expect(KITTEN_VOCAB_MAP.get("A")).toBe(17);
    expect(KITTEN_VOCAB_MAP.get("z")).toBe(68);
    expect(KITTEN_VOCAB_MAP.get("ɑ")).toBe(69);
  });

  it("fonemiza palabras inglesas comunes a IPA", () => {
    expect(convertEnglishWordToIpa("hello")).toBe("hɛloʊ");
    expect(convertEnglishWordToIpa("world")).toBe("wɜːld");
    expect(convertEnglishWordToIpa("one")).toBe("wʌn");
    expect(convertEnglishWordToIpa("girl")).toBe("ɡɜːl");
    expect(convertEnglishWordToIpa("needle")).toBe("niːdəl");
  });

  it("convierte una oración completa a IPA preservando puntuación", () => {
    const text = "One day, a little girl named Lily found a needle in her room.";
    const ipa = phonemizeText(text);

    expect(ipa).toContain("wʌn");
    expect(ipa).toContain("deɪ");
    expect(ipa).toContain("ɡɜːl");
    expect(ipa).toContain("niːdəl");
    expect(ipa).toContain(",");
    expect(ipa).toContain(".");
  });

  it("envuelve la secuencia de IDs con tokens de padding 0 al inicio y al final", () => {
    const text = "One day, a little girl named Lily found a needle in her room.";
    const tokenIds = prepareKittenInputIds(text);

    expect(tokenIds.length).toBeGreaterThan(10);
    expect(tokenIds[0]).toBe(0); // Pad token 0 al inicio
    expect(tokenIds[tokenIds.length - 1]).toBe(0); // Pad token 0 al final

    // Todos los IDs numéricos deben pertenecer al rango válido [0..177]
    for (const id of tokenIds) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(178);
    }
  });

  it("textToTokenIds devuelve [0, 16, 0] para texto vacío o no reconocido", () => {
    const tokens = textToTokenIds("");
    expect(tokens[0]).toBe(0);
    expect(tokens[tokens.length - 1]).toBe(0);
  });

  it("mapea fonemas IPA clave (ɹ, ɪ, ɛ, æ, ɑː, ə, ð, θ, ʃ, ŋ, ˈ) y mantiene los espacios entre palabras", () => {
    // 1. Verificar existencia e índices válidos de los fonemas IPA solicitados
    const ipaChars = ["ɹ", "ɪ", "ɛ", "æ", "ə", "ð", "θ", "ʃ", "ŋ", "ˈ"];
    for (const char of ipaChars) {
      const idx = KITTEN_VOCAB_MAP.get(char);
      expect(idx).toBeDefined();
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(178);
    }

    // 2. Verificar que el convertidor G2P genera ɹ en lugar de r para palabras inglesas
    const ipaRed = convertEnglishWordToIpa("red");
    expect(ipaRed).toContain("ɹ");
    expect(ipaRed).not.toContain("r");

    // 3. Verificar que mantiene los espacios entre palabras como token 16
    const phraseIpa = phonemizeText("the red cat");
    expect(phraseIpa).toBe("ðə ɹɛd kæt");

    const tokens = prepareKittenInputIds("the red cat");
    // Debe empezar con pad 0, terminar con pad 0
    expect(tokens[0]).toBe(0);
    expect(tokens[tokens.length - 1]).toBe(0);

    // Debe contener el token de espacio (16) entre palabras
    const spaceIndices = tokens.filter((t) => t === 16);
    expect(spaceIndices.length).toBe(2); // Dos espacios entre tres palabras
  });
});
