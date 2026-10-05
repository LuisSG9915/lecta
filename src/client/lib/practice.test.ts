import { describe, expect, it } from "vitest";
import { Rating } from "./fsrs";
import {
  blankWordInContext,
  modeForWord,
  pickDistractors,
  ratingToCorrect,
  shuffleStable,
} from "./practice";
import type { SavedWord } from "./idb";

const word = (over: Partial<SavedWord> & Pick<SavedWord, "key" | "form">): SavedWord => ({
  language: "es",
  savedAt: 0,
  ...over,
});

describe("blankWordInContext", () => {
  it("replaces the saved form with a blank", () => {
    expect(blankWordInContext("Luis leyó despacio una palabra difícil: perenne.", "perenne")).toBe(
      "Luis leyó despacio una palabra difícil: _____.",
    );
  });

  it("matches regardless of case", () => {
    expect(blankWordInContext("Perenne fue la palabra.", "perenne")).toBe(
      "_____ fue la palabra.",
    );
  });

  it("blanks every occurrence of the form", () => {
    expect(blankWordInContext("Perenne y perenne.", "perenne")).toBe("_____ y _____.");
  });

  it("does not blank a different word that contains the form", () => {
    expect(blankWordInContext("La casita era chica.", "casa")).toBeNull();
  });

  it("handles diacritics in the form", () => {
    expect(blankWordInContext("El corazón latía.", "corazón")).toBe("El _____ latía.");
  });

  it("returns null when the form is absent or input is empty", () => {
    expect(blankWordInContext("Otra oración.", "perenne")).toBeNull();
    expect(blankWordInContext("", "perenne")).toBeNull();
    expect(blankWordInContext("Texto.", "  ")).toBeNull();
  });
});

describe("pickDistractors", () => {
  const target = word({ key: "es:perenne", form: "perenne", pos: "adj" });
  const pool = [
    word({ key: "es:etéreo", form: "etéreo", pos: "adj" }),
    word({ key: "es:casa", form: "casa", pos: "noun" }),
    word({ key: "es:breve", form: "breve", pos: "adj" }),
    word({ key: "es:correr", form: "correr", pos: "verb" }),
    target,
  ];

  it("excludes the target and duplicate forms", () => {
    const dup = word({ key: "en:perenne", form: "Perenne", pos: "noun" });
    const picked = pickDistractors(target, [...pool, dup], 3);
    expect(picked.some((item) => item.key === target.key)).toBe(false);
    expect(picked.some((item) => item.form.toLowerCase() === "perenne")).toBe(false);
  });

  it("prefers same-pos words before falling back", () => {
    const picked = pickDistractors(target, pool, 3);
    expect(picked.map((item) => item.key)).toEqual(["es:breve", "es:etéreo", "es:casa"]);
  });

  it("fills with any pos when same-pos is not enough", () => {
    const picked = pickDistractors(target, pool, 4);
    expect(picked.map((item) => item.key)).toEqual([
      "es:breve",
      "es:etéreo",
      "es:casa",
      "es:correr",
    ]);
  });

  it("returns fewer than count when the pool is small", () => {
    expect(pickDistractors(target, pool, 10)).toHaveLength(4);
  });

  it("is deterministic regardless of pool order", () => {
    const reversed = [...pool].reverse();
    expect(pickDistractors(target, pool, 3).map((item) => item.key)).toEqual(
      pickDistractors(target, reversed, 3).map((item) => item.key),
    );
  });

  it("skips tombstones", () => {
    const dead = word({ key: "es:muestra", form: "muestra", pos: "adj", deleted: true });
    const picked = pickDistractors(target, [...pool, dead], 10);
    expect(picked.some((item) => item.key === dead.key)).toBe(false);
  });
});

describe("shuffleStable", () => {
  it("same seed gives the same order", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(shuffleStable(items, 42)).toEqual(shuffleStable(items, 42));
  });

  it("keeps the same elements and does not mutate the input", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const mixed = shuffleStable(items, 7);
    expect([...mixed].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("varies with the seed", () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    const orders = new Set(
      Array.from({ length: 8 }, (_, seed) => shuffleStable(items, seed + 1).join(",")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("ratingToCorrect", () => {
  it("counts only Again as a miss for the item stats", () => {
    expect(ratingToCorrect(Rating.Again)).toBe(false);
    expect(ratingToCorrect(Rating.Hard)).toBe(true);
    expect(ratingToCorrect(Rating.Good)).toBe(true);
    expect(ratingToCorrect(Rating.Easy)).toBe(true);
  });
});

describe("modeForWord", () => {
  it("alternates cloze/choose for words with context", () => {
    const withContext = word({ key: "es:x", form: "x", context: "una x aquí" });
    expect(modeForWord(withContext, 0)).toBe("cloze");
    expect(modeForWord(withContext, 1)).toBe("choose");
    expect(modeForWord(withContext, 2)).toBe("cloze");
    expect(modeForWord(withContext, 3)).toBe("choose");
  });

  it("alternates meaning/word for words without context", () => {
    const plain = word({ key: "es:y", form: "y" });
    expect(modeForWord(plain, 0)).toBe("meaning");
    expect(modeForWord(plain, 1)).toBe("word");
    expect(modeForWord(plain, 2)).toBe("meaning");
  });

  it("never returns sense", () => {
    const withContext = word({ key: "es:x", form: "x", context: "x", senseEntryId: "3" });
    for (let index = 0; index < 8; index++) {
      expect(modeForWord(withContext, index)).not.toBe("sense");
    }
  });
});
