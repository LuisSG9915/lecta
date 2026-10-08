import { describe, expect, it } from "vitest";
import { Rating } from "./fsrs";
import {
  blankWordInContext,
  conciseMeaning,
  modeForWord,
  pickDistractors,
  ratingToCorrect,
  scrambleWord,
  shuffleStable,
  smartContextSnippet,
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

describe("smartContextSnippet", () => {
  it("keeps short context intact without trimming", () => {
    const short = "El hidalgo leyó despacio una palabra nueva.";
    const res = smartContextSnippet(short, "palabra");
    expect(res.isTrimmed).toBe(false);
    expect(res.snippet).toBe(short);
  });

  it("handles empty or null text safely", () => {
    expect(smartContextSnippet("")).toEqual({ snippet: "", isTrimmed: false });
    expect(smartContextSnippet(null)).toEqual({ snippet: "", isTrimmed: false });
    expect(smartContextSnippet("   ")).toEqual({ snippet: "", isTrimmed: false });
  });

  it("trims long context and centers around the target word", () => {
    const long =
      "En un lugar de la Mancha de cuyo nombre no quiero acordarme vivía un hidalgo que coleccionaba palabras raras como inmarcesible en sus viejos cuadernos de estudio bajo la luz tenue.";
    const res = smartContextSnippet(long, "inmarcesible", {
      maxWordsBefore: 3,
      maxWordsAfter: 3,
    });
    expect(res.isTrimmed).toBe(true);
    expect(res.snippet).toContain("inmarcesible");
    expect(res.snippet.startsWith("… ")).toBe(true);
    expect(res.snippet.endsWith(" …")).toBe(true);
  });

  it("centers around blank _____ when practicing cloze", () => {
    const long =
      "En un lugar de la Mancha de cuyo nombre no quiero acordarme vivía un hidalgo que coleccionaba palabras raras como _____ en sus viejos cuadernos de estudio bajo la luz tenue.";
    const res = smartContextSnippet(long, "_____", {
      maxWordsBefore: 2,
      maxWordsAfter: 2,
    });
    expect(res.isTrimmed).toBe(true);
    expect(res.snippet).toBe("… raras como _____ en sus …");
  });

  it("preserves trailing punctuation if next segment is a punctuation mark", () => {
    const long =
      "Muchos años después frente al pelotón de fusilamiento el coronel Aureliano Buendía había de recordar aquella tarde remota en que su padre lo llevó a conocer el hielo.";
    const res = smartContextSnippet(long, "fusilamiento", {
      maxWordsBefore: 3,
      maxWordsAfter: 2,
    });
    expect(res.isTrimmed).toBe(true);
    expect(res.snippet).toContain("fusilamiento");
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

describe("conciseMeaning", () => {
  it("keeps short definitions intact", () => {
    expect(conciseMeaning("Dicho breve y agudo.")).toBe("Dicho breve y agudo.");
  });

  it("removes parenthesis category markers and boilerplate", () => {
    expect(conciseMeaning("(Bot.) Planta herbácea vivaz de flores amarillas.")).toBe(
      "Planta herbácea vivaz de flores amarillas.",
    );
    expect(
      conciseMeaning("Dicho de una persona: Que habla con excesiva pedantería."),
    ).toBe("Que habla con excesiva pedantería.");
  });

  it("trims long text at word boundaries with ellipsis", () => {
    const long =
      "Persona que tiene por oficio recoger, seleccionar y preparar noticias para publicarlas en un periódico o difundirlas en la radio.";
    const trimmed = conciseMeaning(long, 50);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed.length).toBeLessThanOrEqual(51);
  });

  it("returns empty string for empty input", () => {
    expect(conciseMeaning("")).toBe("");
  });
});

describe("scrambleWord", () => {
  it("scrambles letters and ensures result is different from original for multi-letter words", () => {
    const res = scrambleWord("palabra", 42);
    expect(res.original).toBe("palabra");
    expect(res.letters.join("")).not.toBe("PALABRA");
    expect(res.letters.sort().join("")).toBe([..."PALABRA"].sort().join(""));
  });

  it("handles single-letter word and empty string", () => {
    expect(scrambleWord("").letters).toEqual([]);
    expect(scrambleWord("a").letters).toEqual(["A"]);
  });

  it("handles words with repeated letters like aaa", () => {
    const res = scrambleWord("aaa");
    expect(res.letters).toEqual(["A", "A", "A"]);
  });

  it("works with random shuffle without seed", () => {
    const res = scrambleWord("gato");
    expect(res.letters.join("")).not.toBe("GATO");
    expect(res.letters).toHaveLength(4);
  });
});
