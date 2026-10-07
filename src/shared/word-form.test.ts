import { describe, expect, it } from "vitest";
import { isWordToken, menteBaseForms } from "./word-form";

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
