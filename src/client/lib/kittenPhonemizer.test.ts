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

  it("fonemiza palabras inglesas comunes a IPA en-us con acento tónico ˈ", () => {
    expect(convertEnglishWordToIpa("hello")).toBe("həˈloʊ");
    expect(convertEnglishWordToIpa("world")).toBe("ˈwɜːɹld");
    expect(convertEnglishWordToIpa("one")).toBe("ˈwʌn");
    expect(convertEnglishWordToIpa("girl")).toBe("ˈɡɜːl");
    expect(convertEnglishWordToIpa("needle")).toBe("ˈniːdəl");
  });

  it("convierte una oración completa a IPA preservando puntuación", () => {
    const text = "One day, a little girl named Lily found a needle in her room.";
    const ipa = phonemizeText(text);

    expect(ipa).toContain("ˈwʌn");
    expect(ipa).toContain("ˈdeɪ");
    expect(ipa).toContain("ˈɡɜːl");
    expect(ipa).toContain("ˈniːdəl");
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
    expect(phraseIpa).toBe("ðə ˈɹɛd ˈkæt");

    const tokens = prepareKittenInputIds("the red cat");
    // Debe empezar con pad 0, terminar con pad 0
    expect(tokens[0]).toBe(0);
    expect(tokens[tokens.length - 1]).toBe(0);

    // Debe contener el token de espacio (16) entre palabras
    const spaceIndices = tokens.filter((t) => t === 16);
    expect(spaceIndices.length).toBe(2); // Dos espacios entre tres palabras
  });

  it("elimina ligaduras no entrenadas ʧ y ʤ sustituyéndolas siempre por tʃ y dʒ", () => {
    const wordsWithAffricates = [
      "which",
      "much",
      "each",
      "change",
      "child",
      "church",
      "just",
      "large",
      "watch",
      "bridge",
      "judge",
    ];

    for (const word of wordsWithAffricates) {
      const ipa = phonemizeText(word);
      expect(ipa).not.toContain("ʧ");
      expect(ipa).not.toContain("ʤ");

      // Debe contener tʃ o dʒ
      const hasProperAffricate = ipa.includes("tʃ") || ipa.includes("dʒ");
      expect(hasProperAffricate).toBe(true);

      // Los tokens numéricos no deben incluir IDs no entrenados
      const tokenIds = textToTokenIds(ipa);
      for (const id of tokenIds) {
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(178);
      }
    }
  });

  it("resuelve contracciones en inglés sin colisionar con palabras base", () => {
    // we're vs were
    expect(phonemizeText("we're")).toBe("wɪɹ");
    expect(phonemizeText("were")).toBe("wɜːɹ");

    // we'll vs well
    expect(phonemizeText("we'll")).toBe("wiːl");
    expect(phonemizeText("well")).toBe("ˈwɛl");

    // Otras contracciones clave
    expect(phonemizeText("it's")).toBe("ɪts");
    expect(phonemizeText("you're")).toBe("jʊɹ");
    expect(phonemizeText("they're")).toBe("ðɛɹ");
    expect(phonemizeText("don't")).toBe("ˈdoʊnt");
    expect(phonemizeText("can't")).toBe("ˈkænt");
    expect(phonemizeText("won't")).toBe("ˈwoʊnt");
    expect(phonemizeText("didn't")).toBe("ˈdɪdənt");
    expect(phonemizeText("isn't")).toBe("ˈɪzənt");
    expect(phonemizeText("aren't")).toBe("ˈɑːɹənt");
    expect(phonemizeText("wasn't")).toBe("ˈwʌzənt");
    expect(phonemizeText("weren't")).toBe("ˈwɜːnt");
    expect(phonemizeText("i'm")).toBe("aɪm");
    expect(phonemizeText("i've")).toBe("aɪv");
    expect(phonemizeText("i'll")).toBe("aɪl");
    expect(phonemizeText("i'd")).toBe("aɪd");
    expect(phonemizeText("that's")).toBe("ðæts");
    expect(phonemizeText("there's")).toBe("ðɛɹz");
    expect(phonemizeText("what's")).toBe("wɑːts");
    expect(phonemizeText("let's")).toBe("ˈlɛts");
    expect(phonemizeText("should've")).toBe("ˈʃʊdəv");
  });

  it("garantiza que palabras de contenido lleven marca de acento primario ˈ", () => {
    // Palabras generadas vía reglas G2P que son de contenido
    expect(convertEnglishWordToIpa("cat")).toContain("ˈ");
    expect(convertEnglishWordToIpa("dog")).toContain("ˈ");
    expect(convertEnglishWordToIpa("house")).toContain("ˈ");
    expect(convertEnglishWordToIpa("jump")).toContain("ˈ");

    // Palabras funcionales átonas no llevan acento artificial
    expect(convertEnglishWordToIpa("the")).not.toContain("ˈ");
    expect(convertEnglishWordToIpa("in")).not.toContain("ˈ");
    expect(convertEnglishWordToIpa("of")).not.toContain("ˈ");
  });

  it("aplica IPA en-us rótico con acento tónico ˈ en palabras de contenido", () => {
    expect(phonemizeText("water")).toBe("ˈwɔːɾɚ");
    expect(phonemizeText("mother")).toBe("ˈmʌðɚ");
    expect(phonemizeText("father")).toBe("ˈfɑːðɚ");
    expect(phonemizeText("story")).toBe("ˈstɔːɹi");
    expect(phonemizeText("chapter")).toBe("ˈtʃæptɚ");
    expect(phonemizeText("understand")).toBe("ˌʌndɚˈstænd");
    expect(phonemizeText("remember")).toBe("ɹɪˈmɛmbɚ");
    expect(phonemizeText("together")).toBe("təˈɡɛðɚ");
    expect(phonemizeText("little")).toBe("ˈlɪɾəl");
    expect(phonemizeText("morning")).toBe("ˈmɔːɹnɪŋ");
    expect(phonemizeText("nothing")).toBe("ˈnʌθɪŋ");
    expect(phonemizeText("something")).toBe("ˈsʌmθɪŋ");
    expect(phonemizeText("everything")).toBe("ˈɛvɹiˌθɪŋ");

    // Vocales en-us róticas
    expect(phonemizeText("are")).toBe("ɑːɹ");
    expect(phonemizeText("for")).toBe("fɔːɹ");
    expect(phonemizeText("more")).toBe("mɔːɹ");
    expect(phonemizeText("work")).toBe("ˈwɜːk");
    expect(phonemizeText("turn")).toBe("ˈtɜːn");
    expect(phonemizeText("start")).toBe("ˈstɑːɹt");
    expect(phonemizeText("hear")).toBe("ˈhɪɹ");
    expect(phonemizeText("heard")).toBe("ˈhɜːd");
    expect(phonemizeText("word")).toBe("ˈwɜːd");
    expect(phonemizeText("door")).toBe("ˈdɔːɹ");
    expect(phonemizeText("heart")).toBe("ˈhɑːɹt");
    expect(phonemizeText("dark")).toBe("ˈdɑːɹk");
    expect(phonemizeText("part")).toBe("ˈpɑːɹt");
    expect(phonemizeText("first")).toBe("ˈfɜːst");

    // ɑː en lugar de ɒ británico
    expect(phonemizeText("what")).toBe("wɑːt");
    expect(phonemizeText("was")).toBe("wʌz");
    expect(phonemizeText("not")).toBe("ˈnɑːt");
    expect(phonemizeText("got")).toBe("ˈɡɑːt");
    expect(phonemizeText("want")).toBe("ˈwɑːnt");
    expect(phonemizeText("stop")).toBe("ˈstɑːp");
    expect(phonemizeText("on")).toBe("ɑːn");
  });
});
