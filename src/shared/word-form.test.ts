import { describe, expect, it } from "vitest";
import { findLexicalFamily, inferContextualPos, isWordToken, menteBaseForms } from "./word-form";

describe("isWordToken", () => {
  it("acepta letras del español con tildes, ñ y ü", () => {
    for (const form of [
      "casa",
      "perenne",
      "tomándose",
      "ñandú",
      "pingüino",
      "Billy",
      "rarísima",
    ])
      expect(isWordToken(form)).toBe(true);
  });

  it("rechaza dígitos, puntuación y tokens de menos de tres letras", () => {
    for (const form of [
      "1",
      "10",
      "3,5",
      "a1b",
      "c4",
      "e-mail",
      "no.",
      "sí",
      "él",
      "tú",
      "a",
      "rock'n'roll",
      "Владимир",
    ])
      expect(isWordToken(form)).toBe(false);
  });
});

describe("menteBaseForms", () => {
  it("devuelve la raíz femenina y su lema masculino", () => {
    expect(menteBaseForms("perfectamente")).toEqual(["perfecta", "perfecto"]);
    expect(menteBaseForms("solamente")).toEqual(["sola", "solo"]);
  });

  it("devuelve solo la raíz cuando no termina en -a", () => {
    expect(menteBaseForms("fácilmente")).toEqual(["fácil"]);
    expect(menteBaseForms("realmente")).toEqual(["real"]);
  });

  it("no produce raíces cortas ni formas ajenas", () => {
    expect(menteBaseForms("mente")).toEqual([]);
    // «demente» termina en «mente» pero la raíz «de» no es adjetivo.
    expect(menteBaseForms("demente")).toEqual([]);
    expect(menteBaseForms("casa")).toEqual([]);
    expect(menteBaseForms("momento")).toEqual([]);
  });
});

describe("inferContextualPos", () => {
  it("detecta sustantivo cuando va precedido de un determinante", () => {
    expect(
      inferContextualPos(
        "afrenta",
        "Dejar al chico como pupilo de cualquier otro sería una afrenta",
      ),
    ).toBe("sustantivo");

    expect(
      inferContextualPos(
        "afrenta",
        "Aquello fue una terrible afrenta para la familia",
      ),
    ).toBe("sustantivo");

    expect(
      inferContextualPos("perro", "El perro corría por el campo"),
    ).toBe("sustantivo");
  });

  it("detecta verbo cuando va precedido de un pronombre proclítico o sujeto", () => {
    expect(
      inferContextualPos("afrenta", "Eso me afrenta profundamente"),
    ).toBe("verbo");

    expect(
      inferContextualPos("afrenta", "Él no afrenta a nadie"),
    ).toBe("verbo");
  });

  it("soporta inglés con artículos y auxiliares verbales", () => {
    expect(
      inferContextualPos("night", "It was a dark night", "en"),
    ).toBe("sustantivo");

    expect(
      inferContextualPos("run", "They will run fast", "en"),
    ).toBe("verbo");
  });

  it("devuelve null cuando no hay contexto o no hay marcadores claros", () => {
    expect(inferContextualPos("afrenta", null)).toBeNull();
    expect(inferContextualPos("afrenta", "")).toBeNull();
    expect(inferContextualPos("afrenta", "afrenta")).toBeNull();
    expect(inferContextualPos("afrenta", "quizás afrenta")).toBeNull();
  });
});

describe("findLexicalFamily", () => {
  it("encuentra familia léxica directa para términos comunes", () => {
    expect(findLexicalFamily("afrenta")).toEqual(["afrentar", "afrentoso", "afrentado"]);
    expect(findLexicalFamily("lector")).toEqual(["lectura", "leer", "legible"]);
  });

  it("deriva morfológicamente según sufijos productivos", () => {
    const family = findLexicalFamily("caminamiento");
    expect(family.length).toBeGreaterThan(0);
    expect(family.some((f) => f.startsWith("camin"))).toBe(true);
  });

  it("no incluye la palabra consultada y respeta el tope de 3", () => {
    const res = findLexicalFamily("caminar");
    expect(res).not.toContain("caminar");
    expect(res.length).toBeLessThanOrEqual(3);
  });
});
