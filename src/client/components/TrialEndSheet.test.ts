import { describe, expect, it } from "vitest";
import { trialFigures } from "./TrialEndSheet";

describe("trialFigures", () => {
  it("omite las cifras en 0", () => {
    expect(trialFigures({ aiUses: 0, wordsSaved: 4, cloudBooks: 0, kindleLinked: false })).toEqual(["Guardaste 4 palabras."]);
    expect(trialFigures({ aiUses: 0, wordsSaved: 0, cloudBooks: 0, kindleLinked: false })).toEqual([]);
    expect(trialFigures(null)).toEqual([]);
  });
  it("singulares y todas las cifras", () => {
    expect(trialFigures({ aiUses: 1, wordsSaved: 1, cloudBooks: 1, kindleLinked: true })).toEqual([
      "Usaste la IA 1 vez.",
      "Guardaste 1 palabra.",
      "1 libro vive en la nube.",
      "Vinculaste tu Kindle.",
    ]);
  });
});
