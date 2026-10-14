import { describe, expect, it } from "vitest";
import { Rating } from "./fsrs";
import {
  blankWordInContext,
  buildAdaptivePracticeQueue,
  conciseMeaning,
  modeForWord,
  pickDistractors,
  pickLevelDistractors,
  ratingToCorrect,
  rescueChallenge,
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

describe("pickLevelDistractors", () => {
  it("prioritizes distractors of the same FSRS level and same POS", () => {
    const target = word({
      key: "es:perenne",
      form: "perenne",
      pos: "adjetivo",
      card: { reps: 4, stability: 12 } as never,
    });
    const sameLevelAndPos = word({
      key: "es:efimero",
      form: "efímero",
      pos: "adjetivo",
      card: { reps: 3, stability: 10 } as never,
    });
    const diffPos = word({
      key: "es:montana",
      form: "montaña",
      pos: "sustantivo",
      card: { reps: 3, stability: 11 } as never,
    });
    const diffLevel = word({
      key: "es:canto",
      form: "canto",
      pos: "sustantivo",
      card: { reps: 1, stability: 1 } as never,
    });

    const pool = [target, diffLevel, diffPos, sameLevelAndPos];
    const picked = pickLevelDistractors(target, pool, 2);
    expect(picked).toHaveLength(2);
    expect(picked[0]).toBe("efímero");
  });
});

describe("buildAdaptivePracticeQueue", () => {
  it("enruta palabras nuevas o con S < 2.5 a Nivel 1 (contextual_cloze)", () => {
    const newWord = word({
      key: "es:alondra",
      form: "alondra",
      context: "El canto de la alondra en el alba.",
    });
    const lowSWord = word({
      key: "es:susurro",
      form: "susurro",
      context: "Un suave susurro nocturno.",
      card: { reps: 1, stability: 1.8 } as never,
    });
    const pool = [
      newWord,
      lowSWord,
      word({ key: "es:brisa", form: "brisa" }),
      word({ key: "es:canto", form: "canto" }),
    ];

    const queue = buildAdaptivePracticeQueue([newWord, lowSWord], { pool });
    expect(queue).toHaveLength(2);
    expect(queue[0].level).toBe(1);
    expect(queue[0].mechanic).toBe("contextual_cloze");
    expect(queue[0].clozeSentence).toBe("El canto de la _____ en el alba.");
    expect(queue[0].distractors.length).toBeGreaterThanOrEqual(1);

    expect(queue[1].level).toBe(1);
    expect(queue[1].mechanic).toBe("contextual_cloze");
    expect(queue[1].clozeSentence).toBe("Un suave _____ nocturno.");
  });

  it("enruta palabras con 2.5 <= S < 10 a Nivel 2 alternando syllable_scramble y phrase_weaver", () => {
    const w1 = word({
      key: "es:inmarcesible",
      form: "inmarcesible",
      card: { reps: 3, stability: 4.5 } as never,
      context: "Una gloria inmarcesible en la historia.",
    });
    const w2 = word({
      key: "es:efimero",
      form: "efímero",
      card: { reps: 4, stability: 7.2 } as never,
      context: "Un instante efímero pero eterno.",
    });
    const w3 = word({
      key: "es:quimera",
      form: "quimera",
      card: { reps: 3, stability: 5.0 } as never,
      context: "Persiguiendo una quimera lejana.",
    });

    const queue = buildAdaptivePracticeQueue([w1, w2, w3]);
    expect(queue[0].level).toBe(2);
    expect(queue[0].mechanic).toBe("syllable_scramble");

    expect(queue[1].level).toBe(2);
    expect(queue[1].mechanic).toBe("phrase_weaver");

    expect(queue[2].level).toBe(2);
    expect(queue[2].mechanic).toBe("syllable_scramble");
  });

  it("enruta palabras con S >= 10 a Nivel 3 (grammar_nuance o ai_sentence_craft)", () => {
    const highS = word({
      key: "es:melancolia",
      form: "melancolía",
      card: { reps: 6, stability: 18 } as never,
      pos: "sustantivo",
      context: "La melancolía del otoño.",
    });

    // Sin IA activa
    const queueNoAi = buildAdaptivePracticeQueue([highS], { useAi: false });
    expect(queueNoAi[0].level).toBe(3);
    expect(queueNoAi[0].mechanic).toBe("grammar_nuance");

    // Con IA activa y conexión
    const queueWithAi = buildAdaptivePracticeQueue([highS], { useAi: true, hasConnection: true });
    expect(queueWithAi[0].level).toBe(3);
    expect(queueWithAi[0].mechanic).toBe("ai_sentence_craft");
  });
});

describe("rescueChallenge (Regla de Rescate Pedagógico)", () => {
  it("degrada reto de Nivel 2 a Nivel 1 contextual_cloze con pista visual", () => {
    const challenge = {
      id: "ch-1",
      word: word({
        key: "es:crepusculo",
        form: "crepúsculo",
        context: "La luz suave del crepúsculo caía.",
      }),
      level: 2 as const,
      mechanic: "syllable_scramble" as const,
      distractors: ["amanecer", "mediodía", "noche"],
      clozeSentence: null,
      targetWord: "crepúsculo",
    };

    const rescued = rescueChallenge(challenge);
    expect(rescued.level).toBe(1);
    expect(rescued.mechanic).toBe("contextual_cloze");
    expect(rescued.originalMechanic).toBe("syllable_scramble");
    expect(rescued.rescued).toBe(true);
    expect(rescued.clozeSentence).toBe("La luz suave del _____ caía.");
    expect(rescued.hint).toContain("CR");
  });

  it("degrada reto de Nivel 3 a Nivel 1 contextual_cloze conservando originalMechanic", () => {
    const challenge = {
      id: "ch-2",
      word: word({
        key: "es:vasto",
        form: "vasto",
        context: "Miraron el vasto océano.",
      }),
      level: 3 as const,
      mechanic: "grammar_nuance" as const,
      distractors: [],
      clozeSentence: null,
      targetWord: "vasto",
    };

    const rescued = rescueChallenge(challenge, [
      word({ key: "es:hondo", form: "hondo" }),
      word({ key: "es:claro", form: "claro" }),
    ]);
    expect(rescued.level).toBe(1);
    expect(rescued.mechanic).toBe("contextual_cloze");
    expect(rescued.originalMechanic).toBe("grammar_nuance");
    expect(rescued.rescued).toBe(true);
    expect(rescued.hint).toContain("VA");
    expect(rescued.distractors.length).toBeGreaterThan(0);
  });
});

