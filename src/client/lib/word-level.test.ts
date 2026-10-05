import { describe, expect, it } from "vitest";
import type { Card } from "./fsrs";
import { dominatedLemmas, markLevel, savedFormLevels } from "./word-level";

const card = (s: number, reps = 0) => ({ stability: s, reps }) as unknown as Card;

describe("markLevel", () => {
  it("sin tarjeta es nueva", () => {
    expect(markLevel(undefined)).toBe("new");
    expect(markLevel(card(0))).toBe("new");
  });

  it("estabilidad baja tras repasar ya no es nueva", () => {
    expect(markLevel(card(1.9))).toBe("new");
    expect(markLevel(card(1.9, 1))).toBe("learning");
  });

  it("umbrales de estabilidad", () => {
    expect(markLevel(card(2))).toBe("learning");
    expect(markLevel(card(20.9))).toBe("learning");
    expect(markLevel(card(21))).toBe("settled");
    expect(markLevel(card(89))).toBe("settled");
  });

  it("dominada no se marca", () => {
    expect(markLevel(card(90))).toBeNull();
    expect(markLevel(card(500))).toBeNull();
  });
});

describe("savedFormLevels", () => {
  const word = (form: string, s: number, lemma?: string) =>
    ({ form, lemma, language: "es", key: form, savedAt: 0, card: card(s) }) as const;

  it("mapea form y lemma en minúsculas", () => {
    const levels = savedFormLevels([word("Perenne", 0, "PERENNE")]);
    expect(levels.get("perenne")).toBe("new");
  });

  it("omite las dominadas", () => {
    const levels = savedFormLevels([word("fácil", 120)]);
    expect(levels.size).toBe(0);
  });

  it("gana el nivel menos aprendido para la misma forma", () => {
    const levels = savedFormLevels([word("casa", 30), word("Casa", 1)]);
    expect(levels.get("casa")).toBe("new");
  });
});

describe("dominatedLemmas", () => {
  const saved = (form: string, s: number, reps: number, lemma?: string) =>
    ({ form, lemma, language: "es", key: form, savedAt: 0, card: card(s, reps) }) as const;

  it("devuelve el lemma en minúsculas de las dominadas", () => {
    expect(dominatedLemmas([saved("Perenne", 120, 3, "PERENNE")])).toEqual(["perenne"]);
  });

  it("usa la forma cuando no hay lemma", () => {
    expect(dominatedLemmas([saved("Fácil", 200, 5)])).toEqual(["fácil"]);
  });

  it("omite las nunca repasadas y las que siguen marcándose", () => {
    expect(dominatedLemmas([saved("casa", 120, 0)])).toEqual([]);
    expect(dominatedLemmas([saved("casa", 30, 4)])).toEqual([]);
    expect(dominatedLemmas([saved("casa", 0, 0)])).toEqual([]);
  });

  it("no repite un lema compartido por varias formas", () => {
    const words = [saved("gato", 120, 2), saved("gatas", 150, 3, "Gato")];
    expect(dominatedLemmas(words)).toEqual(["gato"]);
  });
});
