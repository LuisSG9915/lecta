import { describe, expect, it } from "vitest";
import {
  canonicalGrammarCategory,
  isGrammarEligible,
  isSentenceEligible,
  prepareSentenceBuilder,
  scrambleSentenceTokens,
} from "./grammar";
import type { SavedWord } from "./idb";

const testWord = (patch: Partial<SavedWord>): SavedWord => ({
  key: "es:test",
  form: "test",
  language: "es",
  savedAt: 1000,
  ...patch,
});

describe("canonicalGrammarCategory", () => {
  it("normaliza sustantivos en español e inglés", () => {
    expect(canonicalGrammarCategory("sustantivo")).toBe("sustantivo");
    expect(canonicalGrammarCategory("Sustantivo")).toBe("sustantivo");
    expect(canonicalGrammarCategory("sust")).toBe("sustantivo");
    expect(canonicalGrammarCategory("nombre")).toBe("sustantivo");
    expect(canonicalGrammarCategory("nombre propio")).toBe("sustantivo");
    expect(canonicalGrammarCategory("noun")).toBe("sustantivo");
    expect(canonicalGrammarCategory("n")).toBe("sustantivo");
  });

  it("normaliza verbos", () => {
    expect(canonicalGrammarCategory("verbo")).toBe("verbo");
    expect(canonicalGrammarCategory("Verbo")).toBe("verbo");
    expect(canonicalGrammarCategory("verb")).toBe("verbo");
    expect(canonicalGrammarCategory("participio")).toBe("verbo");
    expect(canonicalGrammarCategory("v")).toBe("verbo");
  });

  it("normaliza adjetivos", () => {
    expect(canonicalGrammarCategory("adjetivo")).toBe("adjetivo");
    expect(canonicalGrammarCategory("Adjetivo")).toBe("adjetivo");
    expect(canonicalGrammarCategory("adj")).toBe("adjetivo");
    expect(canonicalGrammarCategory("a")).toBe("adjetivo");
  });

  it("normaliza adverbios", () => {
    expect(canonicalGrammarCategory("adverbio")).toBe("adverbio");
    expect(canonicalGrammarCategory("Adverbio")).toBe("adverbio");
    expect(canonicalGrammarCategory("adv")).toBe("adverbio");
  });

  it("retorna null para categorías no léxicas o desconocidas", () => {
    expect(canonicalGrammarCategory(null)).toBeNull();
    expect(canonicalGrammarCategory(undefined)).toBeNull();
    expect(canonicalGrammarCategory("")).toBeNull();
    expect(canonicalGrammarCategory("preposición")).toBeNull();
    expect(canonicalGrammarCategory("conjunción")).toBeNull();
    expect(canonicalGrammarCategory("desconocido")).toBeNull();
  });
});

describe("isGrammarEligible", () => {
  it("acepta palabras con pos conocido y descarta deleted o sin pos", () => {
    expect(isGrammarEligible(testWord({ pos: "sustantivo" }))).toBe(true);
    expect(isGrammarEligible(testWord({ pos: "verbo" }))).toBe(true);
    expect(isGrammarEligible(testWord({ pos: "adjetivo" }))).toBe(true);
    expect(isGrammarEligible(testWord({ pos: "adverbio" }))).toBe(true);
    expect(isGrammarEligible(testWord({ pos: null }))).toBe(false);
    expect(isGrammarEligible(testWord({ pos: "sustantivo", deleted: true }))).toBe(false);
  });
});

describe("prepareSentenceBuilder", () => {
  it("prepara oraciones cortas de libro completas", () => {
    const res = prepareSentenceBuilder(
      "El libro tenía secretos antiguos.",
      "secretos",
      7,
    );
    expect(res).not.toBeNull();
    expect(res?.originalTokens).toEqual(["El", "libro", "tenía", "secretos", "antiguos."]);
    expect(res?.targetWordIndex).toBe(3);
  });

  it("extrae una ventana concisa si el texto del libro es muy largo", () => {
    const longContext =
      "En una tarde fría de invierno el caminante divisó una luz tenue que brillaba en la colina lejana.";
    const res = prepareSentenceBuilder(longContext, "tenue", 6);
    expect(res).not.toBeNull();
    expect(res?.originalTokens.length).toBeLessThanOrEqual(6);
    expect(res?.originalTokens.some((t) => t.includes("tenue"))).toBe(true);
  });

  it("retorna null si la oración es demasiado corta o no contiene la palabra", () => {
    expect(prepareSentenceBuilder("Dos palabras", "palabras")).toBeNull();
    expect(prepareSentenceBuilder("El gato duerme aquí.", "perro")).toBeNull();
  });
});

describe("scrambleSentenceTokens", () => {
  it("genera tokens con ids y mezclados", () => {
    const tokens = ["El", "sol", "brilla", "hoy"];
    const scrambled = scrambleSentenceTokens(tokens, 42);
    expect(scrambled.length).toBe(4);
    expect(scrambled.map((t) => t.text).sort()).toEqual([...tokens].sort());
    // No debe ser idéntico al original
    expect(scrambled.map((t) => t.text).join(" ")).not.toBe(tokens.join(" "));
  });
});

describe("isSentenceEligible", () => {
  it("valida palabras con contexto suficiente", () => {
    expect(
      isSentenceEligible(testWord({ form: "luz", context: "Una luz brillaba en la noche." })),
    ).toBe(true);
    expect(isSentenceEligible(testWord({ form: "luz", context: "" }))).toBe(false);
    expect(isSentenceEligible(testWord({ form: "luz", deleted: true }))).toBe(false);
  });
});
