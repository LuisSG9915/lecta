import { describe, expect, it } from "vitest";
import { blankWordInContext } from "./practice";

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

  it("only blanks the first occurrence", () => {
    expect(blankWordInContext("Perenne y perenne.", "perenne")).toBe("_____ y perenne.");
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
