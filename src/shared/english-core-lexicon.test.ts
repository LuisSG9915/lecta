import { describe, expect, it } from "vitest";
import { ENGLISH_CORE_LEXICON, getEnglishCoreEntry } from "./english-core-lexicon";

describe("ENGLISH_CORE_LEXICON", () => {
  it("contiene más de 250 palabras literarias y narrativas en inglés con definiciones en español", () => {
    const keys = Object.keys(ENGLISH_CORE_LEXICON);
    expect(keys.length).toBeGreaterThanOrEqual(250);

    for (const key of keys) {
      const item = ENGLISH_CORE_LEXICON[key];
      expect(item.definition).toBeTruthy();
      expect(typeof item.definition).toBe("string");
      expect(item.definition.length).toBeGreaterThan(3);
    }
  });

  it("incluye términos clave requeridos por OBJ-05", () => {
    const required = [
      "linger",
      "reluctant",
      "glimpse",
      "subtle",
      "dreary",
      "fathom",
      "eloquent",
      "upheaval",
      "ephemeral",
      "ubiquitous",
      "arduous",
      "ostentatious",
      "grim",
      "whisper",
      "shadow",
      "sorrow",
      "oath",
      "realm",
      "blade",
      "dread",
      "fierce",
      "solem", // o solemn
      "solemn",
      "weary",
      "beneath",
      "wander",
      "gaze",
      "sigh",
      "tremble",
      "dagger",
      "fate",
      "grief",
      "wrath",
      "kin",
      "foe",
    ];

    for (const word of required) {
      if (word === "solem") continue; // typo en prompt corregido por solemn
      const entry = getEnglishCoreEntry(word);
      expect(entry, `Falta la palabra ${word} en ENGLISH_CORE_LEXICON`).not.toBeNull();
      expect(entry?.lemma).toBe(word);
    }
  });

  it("resuelve formas flexionadas mediante lematización morfológica", () => {
    // -ing
    const lingering = getEnglishCoreEntry("lingering");
    expect(lingering?.lemma).toBe("linger");

    // -ed
    const whispered = getEnglishCoreEntry("whispered");
    expect(whispered?.lemma).toBe("whisper");

    // -ly
    const reluctantly = getEnglishCoreEntry("reluctantly");
    expect(reluctantly?.lemma).toBe("reluctant");

    // -s / plural
    const shadows = getEnglishCoreEntry("shadows");
    expect(shadows?.lemma).toBe("shadow");

    // mayúsculas o puntuación
    const upper = getEnglishCoreEntry("Wander");
    expect(upper?.lemma).toBe("wander");
  });
});
